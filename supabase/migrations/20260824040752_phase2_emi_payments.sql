-- Phase 2 base: EMI payment ledger + partial-payment status + snapshot support.

create table if not exists public.emi_payments (
    id uuid primary key default gen_random_uuid(),
    emi_id uuid not null references public.emis(id) on delete cascade,
    amount integer not null check (amount > 0),
    payment_date date not null default current_date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    reversed_at timestamptz
);

create index if not exists emi_payments_emi_id_idx on public.emi_payments(emi_id);
create index if not exists emi_payments_payment_date_idx on public.emi_payments(payment_date);

alter table public.emi_payments enable row level security;
revoke all on table public.emi_payments from anon, authenticated;
grant all on table public.emi_payments to service_role;

drop policy if exists emi_payments_service_role_all on public.emi_payments;
create policy emi_payments_service_role_all
on public.emi_payments for all to service_role using (true) with check (true);

alter table public.emis drop constraint if exists emis_status_check;
alter table public.emis add constraint emis_status_check
check (status in ('pending','partial','paid','overdue'));

-- If Phase 1 already contains aggregate paid EMIs, seed one ledger row so payment history starts safely.
insert into public.emi_payments(emi_id, amount, payment_date, notes)
select e.id,
       least(greatest(coalesce(e.paid_amount,e.amount),1),e.amount),
       coalesce(e.paid_date,current_date),
       'Backfilled from EMI paid state before Phase 2'
from public.emis e
where (e.status in ('paid','partial') or coalesce(e.paid_amount,0)>0)
  and not exists (select 1 from public.emi_payments p where p.emi_id=e.id and p.reversed_at is null);

create or replace function public.abhi_create_backup_snapshot(p_label text default null, p_reason text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_payload jsonb; v_summary jsonb;
begin
    v_payload := jsonb_build_object(
        'format','abhitools-snapshot','version',2,'created_at',now(),
        'borrowers',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at,b.id) from public.borrowers b),'[]'::jsonb),
        'loans',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from public.loans l),'[]'::jsonb),
        'emis',coalesce((select jsonb_agg(to_jsonb(e) order by e.loan_id,e.installment_number,e.id) from public.emis e),'[]'::jsonb),
        'emi_payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.payment_date,p.created_at,p.id) from public.emi_payments p),'[]'::jsonb),
        'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at,d.id) from public.documents d),'[]'::jsonb)
    );
    v_summary := jsonb_build_object(
        'borrowers',(select count(*) from public.borrowers),
        'loans',(select count(*) from public.loans),
        'emis',(select count(*) from public.emis),
        'emi_payments',(select count(*) from public.emi_payments where reversed_at is null),
        'documents',(select count(*) from public.documents)
    );
    insert into public.backup_snapshots(label,reason,payload,summary)
    values (nullif(trim(coalesce(p_label,'')),''),coalesce(nullif(trim(p_reason),''),'manual'),v_payload,v_summary)
    returning id into v_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('CREATE_BACKUP','backup_snapshots',v_id::text,'Backup snapshot created: '||coalesce(nullif(trim(p_label),''),p_reason,'manual'));
    return v_id;
end;
$$;

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

    insert into public.emi_payments(id,emi_id,amount,payment_date,notes,created_at,updated_at,reversed_at)
    select x.id,x.emi_id,x.amount,coalesce(x.payment_date,current_date),x.notes,coalesce(x.created_at,now()),coalesce(x.updated_at,now()),x.reversed_at
    from jsonb_to_recordset(coalesce(v_payload->'emi_payments','[]'::jsonb)) as x(id uuid,emi_id uuid,amount integer,payment_date date,notes text,created_at timestamptz,updated_at timestamptz,reversed_at timestamptz);

    insert into public.emi_payments(emi_id,amount,payment_date,notes)
    select e.id,least(greatest(coalesce(e.paid_amount,e.amount),1),e.amount),coalesce(e.paid_date,current_date),'Restored from older backup paid state'
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

revoke all on function public.abhi_create_backup_snapshot(text,text) from public,anon,authenticated;
revoke all on function public.abhi_restore_backup_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.abhi_create_backup_snapshot(text,text) to service_role;
grant execute on function public.abhi_restore_backup_snapshot(uuid) to service_role;
