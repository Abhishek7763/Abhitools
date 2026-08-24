-- Phase 12: recoverable recycle bin for borrowers, loans and documents.

create table if not exists public.recycle_bin (
    id uuid primary key default gen_random_uuid(),
    entity_type text not null check (entity_type in ('borrower','loan','document')),
    record_id uuid not null,
    label text,
    summary jsonb not null default '{}'::jsonb,
    deleted_at timestamptz not null default now(),
    restored_at timestamptz,
    purged_at timestamptz,
    created_at timestamptz not null default now()
);

create unique index if not exists recycle_bin_one_open_item
    on public.recycle_bin(entity_type, record_id)
    where restored_at is null and purged_at is null;
create index if not exists recycle_bin_deleted_at_idx on public.recycle_bin(deleted_at desc);

alter table public.borrowers add column if not exists deleted_at timestamptz;
alter table public.borrowers add column if not exists recycle_batch_id uuid references public.recycle_bin(id) on delete set null;
alter table public.loans add column if not exists deleted_at timestamptz;
alter table public.loans add column if not exists recycle_batch_id uuid references public.recycle_bin(id) on delete set null;
alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists recycle_batch_id uuid references public.recycle_bin(id) on delete set null;

create index if not exists borrowers_deleted_at_idx on public.borrowers(deleted_at);
create index if not exists loans_deleted_at_idx on public.loans(deleted_at);
create index if not exists documents_deleted_at_idx on public.documents(deleted_at);
create index if not exists borrowers_recycle_batch_idx on public.borrowers(recycle_batch_id);
create index if not exists loans_recycle_batch_idx on public.loans(recycle_batch_id);
create index if not exists documents_recycle_batch_idx on public.documents(recycle_batch_id);

alter table public.recycle_bin enable row level security;
revoke all on table public.recycle_bin from public, anon, authenticated;
grant select, insert, update, delete on table public.recycle_bin to service_role;
drop policy if exists recycle_bin_service_role_all on public.recycle_bin;
create policy recycle_bin_service_role_all on public.recycle_bin
    for all to service_role using (true) with check (true);

create or replace function public.abhi_recycle_borrower(p_borrower_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_name text;
    v_batch uuid;
    v_loans integer := 0;
    v_documents integer := 0;
begin
    select name into v_name from public.borrowers
     where id=p_borrower_id and deleted_at is null
     for update;
    if v_name is null then raise exception 'Borrower not found or already recycled'; end if;

    select count(*) into v_loans from public.loans where borrower_id=p_borrower_id and deleted_at is null;
    select count(*) into v_documents from public.documents where borrower_id=p_borrower_id and deleted_at is null;

    insert into public.recycle_bin(entity_type,record_id,label,summary)
    values ('borrower',p_borrower_id,v_name,jsonb_build_object('loans',v_loans,'documents',v_documents))
    returning id into v_batch;

    update public.borrowers set deleted_at=now(),recycle_batch_id=v_batch,updated_at=now()
     where id=p_borrower_id and deleted_at is null;
    update public.loans set deleted_at=now(),recycle_batch_id=v_batch,updated_at=now()
     where borrower_id=p_borrower_id and deleted_at is null;
    update public.documents set deleted_at=now(),recycle_batch_id=v_batch
     where borrower_id=p_borrower_id and deleted_at is null;

    insert into public.activity_log(action,table_name,record_id,description)
    values ('RECYCLE_BORROWER','recycle_bin',v_batch::text,
            format('Borrower moved to recycle bin: %s (%s loans, %s documents)',v_name,v_loans,v_documents));

    return jsonb_build_object('success',true,'recycle_id',v_batch,'entity_type','borrower','record_id',p_borrower_id,'loans',v_loans,'documents',v_documents);
end;
$$;

create or replace function public.abhi_recycle_loan(p_loan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_code text;
    v_batch uuid;
    v_documents integer := 0;
    v_emis integer := 0;
begin
    select loan_code into v_code from public.loans
     where id=p_loan_id and deleted_at is null
     for update;
    if v_code is null then raise exception 'Loan not found or already recycled'; end if;

    select count(*) into v_documents from public.documents where loan_id=p_loan_id and deleted_at is null;
    select count(*) into v_emis from public.emis where loan_id=p_loan_id;

    insert into public.recycle_bin(entity_type,record_id,label,summary)
    values ('loan',p_loan_id,v_code,jsonb_build_object('emis',v_emis,'documents',v_documents))
    returning id into v_batch;

    update public.loans set deleted_at=now(),recycle_batch_id=v_batch,updated_at=now()
     where id=p_loan_id and deleted_at is null;
    update public.documents set deleted_at=now(),recycle_batch_id=v_batch
     where loan_id=p_loan_id and deleted_at is null;

    insert into public.activity_log(action,table_name,record_id,description)
    values ('RECYCLE_LOAN','recycle_bin',v_batch::text,
            format('Loan moved to recycle bin: %s (%s EMIs, %s documents)',v_code,v_emis,v_documents));

    return jsonb_build_object('success',true,'recycle_id',v_batch,'entity_type','loan','record_id',p_loan_id,'emis',v_emis,'documents',v_documents);
end;
$$;

create or replace function public.abhi_recycle_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_name text;
    v_type text;
    v_batch uuid;
begin
    select file_name,doc_type into v_name,v_type from public.documents
     where id=p_document_id and deleted_at is null
     for update;
    if v_name is null then raise exception 'Document not found or already recycled'; end if;

    insert into public.recycle_bin(entity_type,record_id,label,summary)
    values ('document',p_document_id,v_name,jsonb_build_object('doc_type',v_type))
    returning id into v_batch;

    update public.documents set deleted_at=now(),recycle_batch_id=v_batch
     where id=p_document_id and deleted_at is null;

    insert into public.activity_log(action,table_name,record_id,description)
    values ('RECYCLE_DOCUMENT','recycle_bin',v_batch::text,'Document moved to recycle bin: '||coalesce(v_name,''));

    return jsonb_build_object('success',true,'recycle_id',v_batch,'entity_type','document','record_id',p_document_id);
end;
$$;

create or replace function public.abhi_restore_recycle_item(p_recycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_item public.recycle_bin%rowtype;
    v_restored integer := 0;
begin
    select * into v_item from public.recycle_bin where id=p_recycle_id for update;
    if v_item.id is null then raise exception 'Recycle item not found'; end if;
    if v_item.restored_at is not null then raise exception 'Recycle item already restored'; end if;
    if v_item.purged_at is not null then raise exception 'Recycle item permanently deleted'; end if;

    if v_item.entity_type='borrower' then
        update public.borrowers set deleted_at=null,recycle_batch_id=null,updated_at=now() where recycle_batch_id=p_recycle_id;
        get diagnostics v_restored = row_count;
        update public.loans set deleted_at=null,recycle_batch_id=null,updated_at=now() where recycle_batch_id=p_recycle_id;
        update public.documents set deleted_at=null,recycle_batch_id=null where recycle_batch_id=p_recycle_id;
    elsif v_item.entity_type='loan' then
        update public.loans set deleted_at=null,recycle_batch_id=null,updated_at=now() where recycle_batch_id=p_recycle_id;
        get diagnostics v_restored = row_count;
        update public.documents set deleted_at=null,recycle_batch_id=null where recycle_batch_id=p_recycle_id;
    elsif v_item.entity_type='document' then
        update public.documents set deleted_at=null,recycle_batch_id=null where recycle_batch_id=p_recycle_id;
        get diagnostics v_restored = row_count;
    else
        raise exception 'Unsupported recycle item type';
    end if;

    if v_restored=0 then raise exception 'Original record is missing and cannot be restored'; end if;

    update public.recycle_bin set restored_at=now() where id=p_recycle_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('RESTORE_RECYCLE_ITEM','recycle_bin',p_recycle_id::text,'Restored from recycle bin: '||coalesce(v_item.label,v_item.entity_type));

    return jsonb_build_object('success',true,'recycle_id',p_recycle_id,'entity_type',v_item.entity_type,'record_id',v_item.record_id);
end;
$$;

create or replace function public.abhi_purge_recycle_item(p_recycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_item public.recycle_bin%rowtype;
    v_deleted integer := 0;
begin
    select * into v_item from public.recycle_bin where id=p_recycle_id for update;
    if v_item.id is null then raise exception 'Recycle item not found'; end if;
    if v_item.restored_at is not null then raise exception 'Restored item cannot be purged from this recycle entry'; end if;
    if v_item.purged_at is not null then raise exception 'Recycle item already permanently deleted'; end if;

    if v_item.entity_type='borrower' then
        delete from public.borrowers where id=v_item.record_id and recycle_batch_id=p_recycle_id;
        get diagnostics v_deleted = row_count;
    elsif v_item.entity_type='loan' then
        delete from public.loans where id=v_item.record_id and recycle_batch_id=p_recycle_id;
        get diagnostics v_deleted = row_count;
    elsif v_item.entity_type='document' then
        delete from public.documents where id=v_item.record_id and recycle_batch_id=p_recycle_id;
        get diagnostics v_deleted = row_count;
    else
        raise exception 'Unsupported recycle item type';
    end if;

    if v_deleted=0 then raise exception 'Original recycled record is missing'; end if;

    update public.recycle_bin set purged_at=now() where id=p_recycle_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('PURGE_RECYCLE_ITEM','recycle_bin',p_recycle_id::text,'Permanently deleted from recycle bin: '||coalesce(v_item.label,v_item.entity_type));

    return jsonb_build_object('success',true,'recycle_id',p_recycle_id,'entity_type',v_item.entity_type,'record_id',v_item.record_id);
end;
$$;

-- Do not refresh overdue states for EMIs belonging to recycled loans.
create or replace function public.abhi_refresh_due_statuses()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_today date := (now() at time zone 'Asia/Kolkata')::date;
    v_updated integer := 0;
begin
    update public.emis e
       set status = case
           when coalesce(e.paid_amount,0) >= e.amount then 'paid'
           when e.due_date is not null and e.due_date < v_today then 'overdue'
           when coalesce(e.paid_amount,0) > 0 then 'partial'
           else 'pending'
       end
     where e.due_date is not null
       and e.due_year is not null
       and exists (select 1 from public.loans l where l.id=e.loan_id and l.deleted_at is null)
       and e.status is distinct from case
           when coalesce(e.paid_amount,0) >= e.amount then 'paid'
           when e.due_date < v_today then 'overdue'
           when coalesce(e.paid_amount,0) > 0 then 'partial'
           else 'pending'
       end;
    get diagnostics v_updated = row_count;
    return jsonb_build_object('business_date',v_today,'updated_count',v_updated);
end;
$$;

revoke all on function public.abhi_recycle_borrower(uuid) from public,anon,authenticated;
revoke all on function public.abhi_recycle_loan(uuid) from public,anon,authenticated;
revoke all on function public.abhi_recycle_document(uuid) from public,anon,authenticated;
revoke all on function public.abhi_restore_recycle_item(uuid) from public,anon,authenticated;
revoke all on function public.abhi_purge_recycle_item(uuid) from public,anon,authenticated;
revoke all on function public.abhi_refresh_due_statuses() from public,anon,authenticated;
grant execute on function public.abhi_recycle_borrower(uuid) to service_role;
grant execute on function public.abhi_recycle_loan(uuid) to service_role;
grant execute on function public.abhi_recycle_document(uuid) to service_role;
grant execute on function public.abhi_restore_recycle_item(uuid) to service_role;
grant execute on function public.abhi_purge_recycle_item(uuid) to service_role;
grant execute on function public.abhi_refresh_due_statuses() to service_role;
