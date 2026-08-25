-- Final UPI refinement: next-EMI-only payments, resumable accidental taps,
-- user UTR/reference claims, and full-loan foreclosure requests.

alter table public.upi_payment_requests
    add column if not exists request_type text not null default 'emi',
    add column if not exists user_reference text,
    add column if not exists user_claimed_at timestamptz,
    add column if not exists settlement_id uuid references public.loan_settlements(id) on delete set null;

alter table public.upi_payment_requests drop constraint if exists upi_payment_requests_status_check;
alter table public.upi_payment_requests add constraint upi_payment_requests_status_check
    check (status in ('pending','confirmed','rejected','expired','cancelled'));
alter table public.upi_payment_requests drop constraint if exists upi_payment_requests_request_type_check;
alter table public.upi_payment_requests add constraint upi_payment_requests_request_type_check
    check (request_type in ('emi','foreclosure'));
alter table public.upi_payment_requests drop constraint if exists upi_payment_requests_user_reference_length_check;
alter table public.upi_payment_requests add constraint upi_payment_requests_user_reference_length_check
    check (user_reference is null or char_length(user_reference) between 6 and 80);
alter table public.upi_payment_requests alter column expires_at set default (now() + interval '30 minutes');

-- Existing requests did not collect a transaction reference. Expire them so legacy accidental taps cannot block the new flow.
update public.upi_payment_requests
   set status='expired', resolved_at=coalesce(resolved_at,now())
 where status='pending' and user_reference is null;

drop index if exists public.upi_payment_requests_one_pending_per_emi_idx;
create unique index if not exists upi_payment_requests_one_pending_per_loan_idx
on public.upi_payment_requests(loan_id) where status='pending';
create index if not exists upi_payment_requests_settlement_idx
on public.upi_payment_requests(settlement_id) where settlement_id is not null;

create or replace function public.abhi_start_upi_payment_request(
    p_loan_code text,
    p_installment_number integer,
    p_request_type text default 'emi'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_loan_id uuid;
    v_borrower_id uuid;
    v_loan_code text;
    v_loan_status text;
    v_borrower_name text;
    v_emi_id uuid;
    v_first_installment integer;
    v_scheduled integer;
    v_paid integer;
    v_remaining integer;
    v_outstanding integer;
    v_amount integer;
    v_type text := lower(trim(coalesce(p_request_type,'emi')));
    v_request_id uuid;
    v_existing_type text;
    v_existing_emi_id uuid;
    v_existing_amount integer;
    v_existing_reference text;
    v_expires_at timestamptz;
    v_upi_id text;
    v_payee_name text;
    v_enabled boolean;
begin
    if nullif(trim(coalesce(p_loan_code,'')),'') is null then raise exception 'Loan ID required'; end if;
    if v_type not in ('emi','foreclosure') then raise exception 'Invalid payment request type'; end if;

    update public.upi_payment_requests set status='expired', resolved_at=now()
     where status='pending' and expires_at <= now();

    select l.id,l.borrower_id,l.loan_code,l.status,b.name
      into v_loan_id,v_borrower_id,v_loan_code,v_loan_status,v_borrower_name
      from public.loans l left join public.borrowers b on b.id=l.borrower_id
     where l.deleted_at is null and trim(l.loan_code)=trim(p_loan_code)
     limit 1;
    if v_loan_id is null then raise exception 'Loan not found'; end if;
    if v_loan_status='closed' then raise exception 'Closed loan cannot accept a new payment request'; end if;

    select e.id,e.installment_number,e.amount,coalesce(e.paid_amount,0)
      into v_emi_id,v_first_installment,v_scheduled,v_paid
      from public.emis e
     where e.loan_id=v_loan_id
       and greatest(e.amount - least(greatest(coalesce(e.paid_amount,0),0),e.amount),0) > 0
     order by e.installment_number,e.due_date nulls last,e.id
     limit 1 for update;
    if v_emi_id is null then raise exception 'No unpaid EMI remains on this loan'; end if;
    v_remaining := greatest(v_scheduled - least(greatest(v_paid,0),v_scheduled),0);

    select coalesce(sum(greatest(e.amount - least(greatest(coalesce(e.paid_amount,0),0),e.amount),0)),0)::integer
      into v_outstanding from public.emis e where e.loan_id=v_loan_id;
    if v_outstanding <= 0 then raise exception 'No unpaid EMI remains on this loan'; end if;

    if v_type='emi' then
        if p_installment_number is null or p_installment_number <= 0 then raise exception 'Valid installment number required'; end if;
        if p_installment_number <> v_first_installment then raise exception 'Only the next unpaid EMI can be paid online'; end if;
        v_amount := v_remaining;
    else
        v_amount := v_outstanding;
    end if;

    select nullif(trim(c.upi_id),''),coalesce(nullif(trim(c.payee_name),''),'Abhishek Management'),c.enabled
      into v_upi_id,v_payee_name,v_enabled from public.upi_payment_config c where c.id='primary';
    if coalesce(v_enabled,false) is not true or v_upi_id is null then raise exception 'UPI payment is not enabled yet'; end if;

    select r.id,r.request_type,r.emi_id,r.amount,r.user_reference,r.expires_at
      into v_request_id,v_existing_type,v_existing_emi_id,v_existing_amount,v_existing_reference,v_expires_at
      from public.upi_payment_requests r
     where r.loan_id=v_loan_id and r.status='pending'
     order by r.created_at desc limit 1 for update;

    if v_request_id is not null then
        if v_existing_type <> v_type or v_existing_emi_id <> v_emi_id then
            raise exception 'Another payment request is already pending. Cancel it before switching payment type';
        end if;
        if v_existing_amount <> v_amount then
            if v_existing_reference is not null then
                raise exception 'Payment amount changed after UTR submission; admin must review this request';
            end if;
            update public.upi_payment_requests set amount=v_amount,expires_at=now()+interval '30 minutes' where id=v_request_id;
            v_expires_at := now()+interval '30 minutes';
        end if;
    else
        insert into public.upi_payment_requests(
            emi_id,loan_id,borrower_id,loan_code,installment_number,amount,request_type,expires_at
        ) values (
            v_emi_id,v_loan_id,v_borrower_id,v_loan_code,v_first_installment,v_amount,v_type,now()+interval '30 minutes'
        ) on conflict (loan_id) where status='pending' do nothing
        returning id,expires_at into v_request_id,v_expires_at;
        if v_request_id is null then
            select r.id,r.expires_at into v_request_id,v_expires_at
              from public.upi_payment_requests r
             where r.loan_id=v_loan_id and r.status='pending'
             order by r.created_at desc limit 1;
        end if;
    end if;

    return jsonb_build_object(
        'success',true,'request_id',v_request_id,'request_type',v_type,'loan_code',v_loan_code,
        'installment_number',v_first_installment,'borrower_name',coalesce(v_borrower_name,'Borrower'),
        'amount',v_amount,'emi_remaining',v_remaining,'loan_outstanding',v_outstanding,'expires_at',v_expires_at,
        'upi_id',v_upi_id,'payee_name',v_payee_name
    );
end;
$$;

create or replace function public.abhi_start_upi_payment_request(p_loan_code text,p_installment_number integer)
returns jsonb language sql security definer set search_path = public, pg_temp
as $$ select public.abhi_start_upi_payment_request(p_loan_code,p_installment_number,'emi'); $$;

create or replace function public.abhi_submit_upi_reference(p_request_id uuid,p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_request public.upi_payment_requests%rowtype;
    v_reference text := upper(trim(coalesce(p_reference,'')));
begin
    if v_reference !~ '^[A-Z0-9][A-Z0-9._/-]{5,79}$' then raise exception 'Enter a valid UPI UTR or transaction reference'; end if;
    select * into v_request from public.upi_payment_requests where id=p_request_id for update;
    if v_request.id is null then raise exception 'UPI payment request not found'; end if;
    if v_request.status <> 'pending' then raise exception 'UPI payment request is no longer pending'; end if;
    if v_request.expires_at <= now() then
        update public.upi_payment_requests set status='expired',resolved_at=now() where id=p_request_id;
        raise exception 'UPI payment request has expired';
    end if;
    update public.upi_payment_requests
       set user_reference=v_reference,user_claimed_at=now(),expires_at=now()+interval '24 hours'
     where id=p_request_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('SUBMIT_UPI_REFERENCE','upi_payment_requests',p_request_id::text,'User submitted UPI transaction reference for admin verification');
    return jsonb_build_object('success',true,'request_id',p_request_id,'request_status','pending','reference_submitted',true,'expires_at',now()+interval '24 hours');
end;
$$;

create or replace function public.abhi_cancel_upi_payment_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_request public.upi_payment_requests%rowtype;
begin
    select * into v_request from public.upi_payment_requests where id=p_request_id for update;
    if v_request.id is null then raise exception 'UPI payment request not found'; end if;
    if v_request.status <> 'pending' then raise exception 'UPI payment request is no longer pending'; end if;
    if v_request.user_reference is not null then raise exception 'A submitted payment claim cannot be cancelled by the user'; end if;
    update public.upi_payment_requests
       set status='cancelled',resolved_at=now(),admin_note='Cancelled by user before UTR submission'
     where id=p_request_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('CANCEL_UPI_PAYMENT_REQUEST','upi_payment_requests',p_request_id::text,'User cancelled an unclaimed UPI payment request; ledger unchanged');
    return jsonb_build_object('success',true,'request_id',p_request_id,'request_status','cancelled');
end;
$$;

create or replace function public.abhi_confirm_upi_payment_request(
    p_request_id uuid,p_amount integer default null,p_payment_date date default current_date,p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_request public.upi_payment_requests%rowtype;
    v_amount integer;
    v_state jsonb;
    v_payment_id uuid;
    v_settlement_id uuid;
    v_current_outstanding integer;
    v_note text;
begin
    select * into v_request from public.upi_payment_requests where id=p_request_id for update;
    if v_request.id is null then raise exception 'UPI payment request not found'; end if;
    if v_request.status <> 'pending' then raise exception 'UPI payment request is no longer pending'; end if;
    if v_request.expires_at <= now() then
        update public.upi_payment_requests
           set status='expired',resolved_at=now(),admin_note=left(coalesce(p_admin_note,'Expired before confirmation'),1000)
         where id=p_request_id;
        raise exception 'UPI payment request has expired';
    end if;
    v_amount := coalesce(p_amount,v_request.amount);
    if v_amount is null or v_amount <= 0 then raise exception 'Confirmed amount must be greater than zero'; end if;
    v_note := left('Public UPI '||v_request.request_type||' request '||v_request.id::text||
        case when v_request.user_reference is not null then ' • UTR/Ref '||v_request.user_reference else ' • UTR not submitted' end||
        case when nullif(trim(coalesce(p_admin_note,'')),'') is not null then ' • '||trim(p_admin_note) else '' end,500);

    if v_request.request_type='foreclosure' then
        select coalesce(sum(greatest(e.amount - least(greatest(coalesce(e.paid_amount,0),0),e.amount),0)),0)::integer
          into v_current_outstanding from public.emis e where e.loan_id=v_request.loan_id;
        if v_current_outstanding <= 0 then raise exception 'Loan has no remaining balance'; end if;
        if v_amount <> v_request.amount or v_amount <> v_current_outstanding then
            raise exception 'Foreclosure amount changed; create a new payment request';
        end if;
        v_state := public.abhi_settle_loan(v_request.loan_id,v_amount,coalesce(p_payment_date,current_date),'UPI',v_note);
        v_settlement_id := nullif(v_state->>'settlement_id','')::uuid;
        update public.upi_payment_requests
           set status='confirmed',amount=v_amount,settlement_id=v_settlement_id,confirmed_at=now(),resolved_at=now(),
               admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000)
         where id=p_request_id;
    else
        v_state := public.abhi_add_emi_payment(v_request.emi_id,v_amount,coalesce(p_payment_date,current_date),'UPI',v_note);
        v_payment_id := nullif(v_state->>'payment_id','')::uuid;
        update public.upi_payment_requests
           set status='confirmed',amount=v_amount,payment_id=v_payment_id,confirmed_at=now(),resolved_at=now(),
               admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000)
         where id=p_request_id;
    end if;

    insert into public.activity_log(action,table_name,record_id,description)
    values (case when v_request.request_type='foreclosure' then 'CONFIRM_UPI_FORECLOSURE_REQUEST' else 'CONFIRM_UPI_PAYMENT_REQUEST' end,
            'upi_payment_requests',p_request_id::text,format('Public UPI %s confirmed: %s',v_request.request_type,v_amount));
    return v_state || jsonb_build_object('success',true,'request_id',p_request_id,'request_status','confirmed','request_type',v_request.request_type);
end;
$$;

create or replace function public.abhi_reject_upi_payment_request(p_request_id uuid,p_admin_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_request public.upi_payment_requests%rowtype;
begin
    select * into v_request from public.upi_payment_requests where id=p_request_id for update;
    if v_request.id is null then raise exception 'UPI payment request not found'; end if;
    if v_request.status <> 'pending' then raise exception 'UPI payment request is no longer pending'; end if;
    update public.upi_payment_requests set status='rejected',resolved_at=now(),admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000) where id=p_request_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('REJECT_UPI_PAYMENT_REQUEST','upi_payment_requests',p_request_id::text,'Public UPI payment request rejected; ledger unchanged');
    return jsonb_build_object('success',true,'request_id',p_request_id,'request_status','rejected');
end;
$$;

revoke all on function public.abhi_start_upi_payment_request(text,integer,text) from public,anon,authenticated;
revoke all on function public.abhi_start_upi_payment_request(text,integer) from public,anon,authenticated;
revoke all on function public.abhi_submit_upi_reference(uuid,text) from public,anon,authenticated;
revoke all on function public.abhi_cancel_upi_payment_request(uuid) from public,anon,authenticated;
revoke all on function public.abhi_confirm_upi_payment_request(uuid,integer,date,text) from public,anon,authenticated;
revoke all on function public.abhi_reject_upi_payment_request(uuid,text) from public,anon,authenticated;
grant execute on function public.abhi_start_upi_payment_request(text,integer,text) to service_role;
grant execute on function public.abhi_start_upi_payment_request(text,integer) to service_role;
grant execute on function public.abhi_submit_upi_reference(uuid,text) to service_role;
grant execute on function public.abhi_cancel_upi_payment_request(uuid) to service_role;
grant execute on function public.abhi_confirm_upi_payment_request(uuid,integer,date,text) to service_role;
grant execute on function public.abhi_reject_upi_payment_request(uuid,text) to service_role;
