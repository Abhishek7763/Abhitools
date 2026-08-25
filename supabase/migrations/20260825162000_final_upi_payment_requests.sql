-- Final public UPI repayment request workflow.
-- A public Pay tap never changes the EMI ledger. Only an authenticated admin
-- confirmation calls the existing abhi_add_emi_payment ledger function.

create table if not exists public.upi_payment_config (
    id text primary key default 'primary',
    upi_id text,
    payee_name text,
    enabled boolean not null default false,
    updated_at timestamptz not null default now(),
    constraint upi_payment_config_primary_only check (id = 'primary'),
    constraint upi_payment_config_upi_id_length check (upi_id is null or char_length(upi_id) between 3 and 120),
    constraint upi_payment_config_payee_name_length check (payee_name is null or char_length(payee_name) <= 100)
);

insert into public.upi_payment_config(id, upi_id, payee_name, enabled)
values ('primary', null, 'Abhishek Management', false)
on conflict (id) do nothing;

create table if not exists public.upi_payment_requests (
    id uuid primary key default gen_random_uuid(),
    emi_id uuid not null references public.emis(id) on delete cascade,
    loan_id uuid not null references public.loans(id) on delete cascade,
    borrower_id uuid references public.borrowers(id) on delete set null,
    loan_code text not null,
    installment_number integer not null check (installment_number > 0),
    amount integer not null check (amount > 0),
    status text not null default 'pending' check (status in ('pending','confirmed','rejected','expired')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '24 hours'),
    confirmed_at timestamptz,
    resolved_at timestamptz,
    payment_id uuid references public.emi_payments(id) on delete set null,
    admin_note text,
    constraint upi_payment_request_note_length check (admin_note is null or char_length(admin_note) <= 1000)
);

create index if not exists upi_payment_requests_status_created_idx
on public.upi_payment_requests(status, created_at desc);

create index if not exists upi_payment_requests_loan_idx
on public.upi_payment_requests(loan_id, created_at desc);

create unique index if not exists upi_payment_requests_one_pending_per_emi_idx
on public.upi_payment_requests(emi_id)
where status = 'pending';

alter table public.upi_payment_config enable row level security;
alter table public.upi_payment_requests enable row level security;

revoke all on table public.upi_payment_config from public, anon, authenticated;
revoke all on table public.upi_payment_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.upi_payment_config to service_role;
grant select, insert, update, delete on table public.upi_payment_requests to service_role;

create or replace function public.abhi_start_upi_payment_request(
    p_loan_code text,
    p_installment_number integer
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
    v_scheduled integer;
    v_paid integer;
    v_remaining integer;
    v_request_id uuid;
    v_expires_at timestamptz;
    v_upi_id text;
    v_payee_name text;
    v_enabled boolean;
begin
    if nullif(trim(coalesce(p_loan_code,'')),'') is null then
        raise exception 'Loan ID required';
    end if;
    if p_installment_number is null or p_installment_number <= 0 then
        raise exception 'Valid installment number required';
    end if;

    update public.upi_payment_requests
       set status = 'expired', resolved_at = now()
     where status = 'pending' and expires_at <= now();

    select l.id, l.borrower_id, l.loan_code, l.status, b.name
      into v_loan_id, v_borrower_id, v_loan_code, v_loan_status, v_borrower_name
      from public.loans l
      left join public.borrowers b on b.id = l.borrower_id
     where l.deleted_at is null
       and trim(l.loan_code) = trim(p_loan_code)
     limit 1;

    if v_loan_id is null then raise exception 'Loan not found'; end if;
    if v_loan_status = 'closed' then raise exception 'Closed loan cannot accept a new payment request'; end if;

    select e.id, e.amount, coalesce(e.paid_amount,0)
      into v_emi_id, v_scheduled, v_paid
      from public.emis e
     where e.loan_id = v_loan_id
       and e.installment_number = p_installment_number
     for update;

    if v_emi_id is null then raise exception 'EMI not found'; end if;
    v_remaining := greatest(coalesce(v_scheduled,0) - greatest(coalesce(v_paid,0),0), 0);
    if v_remaining <= 0 then raise exception 'This EMI is already paid'; end if;

    select nullif(trim(c.upi_id),''), coalesce(nullif(trim(c.payee_name),''),'Abhishek Management'), c.enabled
      into v_upi_id, v_payee_name, v_enabled
      from public.upi_payment_config c
     where c.id = 'primary';

    if coalesce(v_enabled,false) is not true or v_upi_id is null then
        raise exception 'UPI payment is not enabled yet';
    end if;

    select r.id, r.expires_at
      into v_request_id, v_expires_at
      from public.upi_payment_requests r
     where r.emi_id = v_emi_id and r.status = 'pending'
     order by r.created_at desc
     limit 1
     for update;

    if v_request_id is null then
        insert into public.upi_payment_requests(
            emi_id, loan_id, borrower_id, loan_code, installment_number, amount
        ) values (
            v_emi_id, v_loan_id, v_borrower_id, v_loan_code, p_installment_number, v_remaining
        )
        on conflict (emi_id) where status = 'pending' do nothing
        returning id, expires_at into v_request_id, v_expires_at;

        if v_request_id is null then
            select r.id, r.expires_at
              into v_request_id, v_expires_at
              from public.upi_payment_requests r
             where r.emi_id = v_emi_id and r.status = 'pending'
             order by r.created_at desc
             limit 1;
        end if;
    end if;

    return jsonb_build_object(
        'success', true,
        'request_id', v_request_id,
        'loan_code', v_loan_code,
        'installment_number', p_installment_number,
        'borrower_name', coalesce(v_borrower_name,'Borrower'),
        'amount', v_remaining,
        'expires_at', v_expires_at,
        'upi_id', v_upi_id,
        'payee_name', v_payee_name
    );
end;
$$;

create or replace function public.abhi_confirm_upi_payment_request(
    p_request_id uuid,
    p_amount integer default null,
    p_payment_date date default current_date,
    p_admin_note text default null
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
begin
    select * into v_request
      from public.upi_payment_requests
     where id = p_request_id
     for update;

    if v_request.id is null then raise exception 'UPI payment request not found'; end if;
    if v_request.status <> 'pending' then raise exception 'UPI payment request is no longer pending'; end if;
    if v_request.expires_at <= now() then
        update public.upi_payment_requests
           set status='expired', resolved_at=now(), admin_note=left(coalesce(p_admin_note,'Expired before confirmation'),1000)
         where id=p_request_id;
        raise exception 'UPI payment request has expired';
    end if;

    v_amount := coalesce(p_amount, v_request.amount);
    if v_amount is null or v_amount <= 0 then raise exception 'Confirmed amount must be greater than zero'; end if;

    v_state := public.abhi_add_emi_payment(
        v_request.emi_id,
        v_amount,
        coalesce(p_payment_date,current_date),
        'UPI',
        left('Public UPI request ' || v_request.id::text || case when nullif(trim(coalesce(p_admin_note,'')),'') is not null then ' - ' || trim(p_admin_note) else '' end, 500)
    );

    v_payment_id := nullif(v_state->>'payment_id','')::uuid;

    update public.upi_payment_requests
       set status='confirmed',
           amount=v_amount,
           payment_id=v_payment_id,
           confirmed_at=now(),
           resolved_at=now(),
           admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000)
     where id=p_request_id;

    insert into public.activity_log(action,table_name,record_id,description)
    values ('CONFIRM_UPI_PAYMENT_REQUEST','upi_payment_requests',p_request_id::text,format('Public UPI payment confirmed: %s',v_amount));

    return v_state || jsonb_build_object(
        'success', true,
        'request_id', p_request_id,
        'request_status', 'confirmed'
    );
end;
$$;

create or replace function public.abhi_reject_upi_payment_request(
    p_request_id uuid,
    p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_request public.upi_payment_requests%rowtype;
begin
    select * into v_request
      from public.upi_payment_requests
     where id=p_request_id
     for update;

    if v_request.id is null then raise exception 'UPI payment request not found'; end if;
    if v_request.status <> 'pending' then raise exception 'UPI payment request is no longer pending'; end if;

    update public.upi_payment_requests
       set status='rejected', resolved_at=now(), admin_note=left(nullif(trim(coalesce(p_admin_note,'')),''),1000)
     where id=p_request_id;

    insert into public.activity_log(action,table_name,record_id,description)
    values ('REJECT_UPI_PAYMENT_REQUEST','upi_payment_requests',p_request_id::text,'Public UPI payment request rejected; EMI ledger unchanged');

    return jsonb_build_object('success',true,'request_id',p_request_id,'request_status','rejected');
end;
$$;

revoke all on function public.abhi_start_upi_payment_request(text,integer) from public,anon,authenticated;
revoke all on function public.abhi_confirm_upi_payment_request(uuid,integer,date,text) from public,anon,authenticated;
revoke all on function public.abhi_reject_upi_payment_request(uuid,text) from public,anon,authenticated;

grant execute on function public.abhi_start_upi_payment_request(text,integer) to service_role;
grant execute on function public.abhi_confirm_upi_payment_request(uuid,integer,date,text) to service_role;
grant execute on function public.abhi_reject_upi_payment_request(uuid,text) to service_role;
