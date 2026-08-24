-- Phase 2 follow-up: payment actions on the existing emi_payments ledger.
-- The base Phase 2 schema (emi_payments + partial status + snapshot support) already exists.

alter table public.emi_payments add column if not exists method text;
alter table public.emi_payments add column if not exists source text not null default 'manual';

create index if not exists emi_payments_active_emi_idx
on public.emi_payments(emi_id)
where reversed_at is null;

create or replace function public.abhi_recalculate_emi(p_emi_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_amount integer;
    v_paid integer;
    v_last_date date;
    v_status text;
begin
    select e.amount into v_amount
      from public.emis e
     where e.id = p_emi_id
     for update;

    if v_amount is null then raise exception 'EMI not found'; end if;

    select coalesce(sum(p.amount),0)::integer, max(p.payment_date)
      into v_paid, v_last_date
      from public.emi_payments p
     where p.emi_id = p_emi_id and p.reversed_at is null;

    if v_paid >= v_amount then
        v_status := 'paid';
    elsif v_paid > 0 then
        v_status := 'partial';
    else
        v_status := 'pending';
    end if;

    update public.emis
       set paid_amount = case when v_paid > 0 then v_paid else null end,
           paid_date = case when v_paid > 0 then v_last_date else null end,
           status = v_status
     where id = p_emi_id;

    return jsonb_build_object(
        'emi_id', p_emi_id,
        'scheduled_amount', v_amount,
        'paid_amount', v_paid,
        'remaining_amount', greatest(v_amount-v_paid,0),
        'status', v_status,
        'last_paid_date', v_last_date
    );
end;
$$;

create or replace function public.abhi_add_emi_payment(
    p_emi_id uuid,
    p_amount integer,
    p_payment_date date default current_date,
    p_method text default null,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_scheduled integer;
    v_existing_paid integer;
    v_ledger_paid integer;
    v_baseline integer;
    v_payment_id uuid;
    v_state jsonb;
begin
    if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;

    select e.amount, coalesce(e.paid_amount,0)
      into v_scheduled, v_existing_paid
      from public.emis e
     where e.id = p_emi_id
     for update;
    if v_scheduled is null then raise exception 'EMI not found'; end if;

    select coalesce(sum(p.amount),0)::integer
      into v_ledger_paid
      from public.emi_payments p
     where p.emi_id = p_emi_id and p.reversed_at is null;

    -- Preserve older/imported aggregate payment totals as a baseline ledger item.
    v_baseline := greatest(least(v_existing_paid,v_scheduled)-v_ledger_paid,0);
    if v_baseline > 0 then
        insert into public.emi_payments(emi_id,amount,payment_date,method,notes,source)
        values (
            p_emi_id,
            v_baseline,
            coalesce((select e.paid_date from public.emis e where e.id=p_emi_id),current_date),
            'Previous record',
            'Opening paid balance preserved from an older/imported EMI record.',
            'baseline'
        );
        v_ledger_paid := v_ledger_paid + v_baseline;
    end if;

    if v_ledger_paid + p_amount > v_scheduled then raise exception 'Payment exceeds EMI remaining amount'; end if;

    insert into public.emi_payments(emi_id,amount,payment_date,method,notes,source)
    values (
        p_emi_id,
        p_amount,
        coalesce(p_payment_date,current_date),
        nullif(trim(coalesce(p_method,'')),''),
        nullif(trim(coalesce(p_notes,'')),''),
        'manual'
    ) returning id into v_payment_id;

    v_state := public.abhi_recalculate_emi(p_emi_id);
    insert into public.activity_log(action,table_name,record_id,description)
    values ('ADD_EMI_PAYMENT','emi_payments',v_payment_id::text,format('EMI payment added: %s',p_amount));

    return v_state || jsonb_build_object('success',true,'payment_id',v_payment_id);
end;
$$;

create or replace function public.abhi_update_emi_payment(
    p_payment_id uuid,
    p_amount integer,
    p_payment_date date default current_date,
    p_method text default null,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_emi_id uuid;
    v_source text;
    v_scheduled integer;
    v_other_paid integer;
    v_state jsonb;
begin
    if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;

    select p.emi_id,p.source
      into v_emi_id,v_source
      from public.emi_payments p
     where p.id=p_payment_id and p.reversed_at is null;
    if v_emi_id is null then raise exception 'Payment not found'; end if;
    if v_source <> 'manual' then raise exception 'Opening balance payment cannot be edited'; end if;

    select e.amount into v_scheduled from public.emis e where e.id=v_emi_id for update;
    select coalesce(sum(p.amount),0)::integer
      into v_other_paid
      from public.emi_payments p
     where p.emi_id=v_emi_id and p.id<>p_payment_id and p.reversed_at is null;
    if v_other_paid + p_amount > v_scheduled then raise exception 'Payment exceeds EMI remaining amount'; end if;

    update public.emi_payments
       set amount=p_amount,
           payment_date=coalesce(p_payment_date,current_date),
           method=nullif(trim(coalesce(p_method,'')),''),
           notes=nullif(trim(coalesce(p_notes,'')),''),
           updated_at=now()
     where id=p_payment_id;

    v_state := public.abhi_recalculate_emi(v_emi_id);
    insert into public.activity_log(action,table_name,record_id,description)
    values ('UPDATE_EMI_PAYMENT','emi_payments',p_payment_id::text,format('EMI payment corrected: %s',p_amount));
    return v_state || jsonb_build_object('success',true,'payment_id',p_payment_id);
end;
$$;

create or replace function public.abhi_reverse_emi_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_emi_id uuid;
    v_source text;
    v_amount integer;
    v_state jsonb;
begin
    select p.emi_id,p.source,p.amount
      into v_emi_id,v_source,v_amount
      from public.emi_payments p
     where p.id=p_payment_id and p.reversed_at is null;
    if v_emi_id is null then raise exception 'Payment not found'; end if;
    if v_source <> 'manual' then raise exception 'Opening balance payment cannot be reversed'; end if;

    perform 1 from public.emis e where e.id=v_emi_id for update;
    update public.emi_payments set reversed_at=now(),updated_at=now() where id=p_payment_id;
    v_state := public.abhi_recalculate_emi(v_emi_id);

    insert into public.activity_log(action,table_name,record_id,description)
    values ('REVERSE_EMI_PAYMENT','emi_payments',p_payment_id::text,format('EMI payment reversed: %s',v_amount));
    return v_state || jsonb_build_object('success',true,'reversed_payment_id',p_payment_id);
end;
$$;

-- Preserve the new method/source fields when restoring Phase 2+ snapshots.
create or replace function public.abhi_restore_backup_snapshot(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_payload jsonb; v_summary jsonb;
begin
    select payload into v_payload from public.backup_snapshots where id=p_snapshot_id;
    if v_payload is null then raise exception 'Backup snapshot not found'; end if;
    perform public.abhi_create_backup_snapshot('Before restore '||p_snapshot_id::text,'pre-restore');

    delete from public.documents;
    delete from public.emis;
    delete from public.loans;
    delete from public.borrowers;

    insert into public.borrowers(id,name,father_name,phone,whatsapp,address,aadhaar,pan,photo_url,notes,created_at,updated_at)
    select x.id,x.name,x.father_name,x.phone,x.whatsapp,x.address,x.aadhaar,x.pan,x.photo_url,x.notes,coalesce(x.created_at,now()),coalesce(x.updated_at,now())
    from jsonb_to_recordset(coalesce(v_payload->'borrowers','[]'::jsonb)) as x(id uuid,name text,father_name text,phone text,whatsapp text,address text,aadhaar text,pan text,photo_url text,notes text,created_at timestamptz,updated_at timestamptz);

    insert into public.loans(id,borrower_id,loan_code,amount,interest_rate,loan_date,loan_year,end_date,status,agreement_url,notes,created_at,updated_at)
    select x.id,x.borrower_id,x.loan_code,x.amount,coalesce(x.interest_rate,0),x.loan_date,x.loan_year,x.end_date,coalesce(x.status,'active'),x.agreement_url,x.notes,coalesce(x.created_at,now()),coalesce(x.updated_at,now())
    from jsonb_to_recordset(coalesce(v_payload->'loans','[]'::jsonb)) as x(id uuid,borrower_id uuid,loan_code text,amount integer,interest_rate numeric,loan_date date,loan_year integer,end_date date,status text,agreement_url text,notes text,created_at timestamptz,updated_at timestamptz);

    insert into public.emis(id,loan_id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount,notes,created_at)
    select x.id,x.loan_id,x.installment_number,x.due_date,x.due_day,x.due_month,x.due_year,x.amount,
           case when x.status in ('pending','partial','paid','overdue') then x.status else 'pending' end,
           x.paid_date,x.paid_amount,x.notes,coalesce(x.created_at,now())
    from jsonb_to_recordset(coalesce(v_payload->'emis','[]'::jsonb)) as x(id uuid,loan_id uuid,installment_number integer,due_date date,due_day integer,due_month text,due_year integer,amount integer,status text,paid_date date,paid_amount integer,notes text,created_at timestamptz);

    insert into public.emi_payments(id,emi_id,amount,payment_date,method,notes,source,created_at,updated_at,reversed_at)
    select x.id,x.emi_id,x.amount,coalesce(x.payment_date,current_date),x.method,x.notes,coalesce(x.source,'manual'),coalesce(x.created_at,now()),coalesce(x.updated_at,now()),x.reversed_at
    from jsonb_to_recordset(coalesce(v_payload->'emi_payments','[]'::jsonb)) as x(id uuid,emi_id uuid,amount integer,payment_date date,method text,notes text,source text,created_at timestamptz,updated_at timestamptz,reversed_at timestamptz);

    insert into public.emi_payments(emi_id,amount,payment_date,method,notes,source)
    select e.id,least(greatest(coalesce(e.paid_amount,e.amount),1),e.amount),coalesce(e.paid_date,current_date),'Previous record','Restored from older backup paid state','baseline'
    from public.emis e where (e.status in ('paid','partial') or coalesce(e.paid_amount,0)>0)
      and not exists (select 1 from public.emi_payments p where p.emi_id=e.id and p.reversed_at is null);

    insert into public.documents(id,borrower_id,loan_id,doc_type,file_name,file_url,uploaded_at)
    select x.id,x.borrower_id,x.loan_id,x.doc_type,x.file_name,x.file_url,coalesce(x.uploaded_at,now())
    from jsonb_to_recordset(coalesce(v_payload->'documents','[]'::jsonb)) as x(id uuid,borrower_id uuid,loan_id uuid,doc_type text,file_name text,file_url text,uploaded_at timestamptz);

    v_summary := jsonb_build_object('borrowers',(select count(*) from public.borrowers),'loans',(select count(*) from public.loans),'emis',(select count(*) from public.emis),'emi_payments',(select count(*) from public.emi_payments where reversed_at is null),'documents',(select count(*) from public.documents));
    insert into public.activity_log(action,table_name,record_id,description) values ('RESTORE_BACKUP','backup_snapshots',p_snapshot_id::text,'Backup snapshot restored');
    return jsonb_build_object('success',true,'snapshot_id',p_snapshot_id,'summary',v_summary);
end;
$$;

revoke all on function public.abhi_recalculate_emi(uuid) from public,anon,authenticated;
revoke all on function public.abhi_add_emi_payment(uuid,integer,date,text,text) from public,anon,authenticated;
revoke all on function public.abhi_update_emi_payment(uuid,integer,date,text,text) from public,anon,authenticated;
revoke all on function public.abhi_reverse_emi_payment(uuid) from public,anon,authenticated;
revoke all on function public.abhi_restore_backup_snapshot(uuid) from public,anon,authenticated;

grant execute on function public.abhi_recalculate_emi(uuid) to service_role;
grant execute on function public.abhi_add_emi_payment(uuid,integer,date,text,text) to service_role;
grant execute on function public.abhi_update_emi_payment(uuid,integer,date,text,text) to service_role;
grant execute on function public.abhi_reverse_emi_payment(uuid) to service_role;
grant execute on function public.abhi_restore_backup_snapshot(uuid) to service_role;
