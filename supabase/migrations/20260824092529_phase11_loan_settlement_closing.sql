-- Phase 11: audit-safe loan settlement, closing and reopen workflow.

create table if not exists public.loan_settlements (
    id uuid primary key default gen_random_uuid(),
    loan_id uuid not null references public.loans(id) on delete cascade,
    settlement_date date not null default current_date,
    scheduled_remaining_before integer not null default 0 check (scheduled_remaining_before >= 0),
    final_payment_amount integer not null default 0 check (final_payment_amount >= 0),
    waived_amount integer not null default 0 check (waived_amount >= 0),
    method text,
    notes text,
    created_at timestamptz not null default now(),
    reopened_at timestamptz,
    reopen_note text,
    constraint loan_settlements_balance_check check (final_payment_amount + waived_amount = scheduled_remaining_before)
);

create unique index if not exists loan_settlements_one_active_per_loan
    on public.loan_settlements(loan_id)
    where reopened_at is null;
create index if not exists loan_settlements_loan_date_idx
    on public.loan_settlements(loan_id, settlement_date desc, created_at desc);

alter table public.emi_payments
    add column if not exists settlement_id uuid references public.loan_settlements(id) on delete set null;
create index if not exists emi_payments_settlement_id_idx on public.emi_payments(settlement_id);

alter table public.loan_settlements enable row level security;
revoke all on table public.loan_settlements from public, anon, authenticated;
grant select, insert, update, delete on table public.loan_settlements to service_role;

create or replace function public.abhi_settle_loan(
    p_loan_id uuid,
    p_final_payment_amount integer default 0,
    p_settlement_date date default current_date,
    p_method text default null,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_loan public.loans%rowtype;
    v_outstanding integer := 0;
    v_final integer := greatest(coalesce(p_final_payment_amount,0),0);
    v_left integer;
    v_waived integer;
    v_settlement_id uuid;
    v_emi record;
    v_emi_remaining integer;
    v_alloc integer;
    v_payment_id uuid;
    v_payment_count integer := 0;
begin
    select * into v_loan from public.loans where id=p_loan_id for update;
    if v_loan.id is null then raise exception 'Loan not found'; end if;
    if exists(select 1 from public.loan_settlements s where s.loan_id=p_loan_id and s.reopened_at is null) then
        raise exception 'Loan already has an active settlement';
    end if;
    if v_loan.status='closed' then raise exception 'Loan is already closed'; end if;

    select coalesce(sum(greatest(e.amount - least(greatest(coalesce(e.paid_amount,0),0),e.amount),0)),0)::integer
      into v_outstanding
      from public.emis e
     where e.loan_id=p_loan_id;

    if v_final > v_outstanding then raise exception 'Final settlement payment exceeds remaining EMI balance'; end if;
    v_waived := v_outstanding - v_final;

    insert into public.loan_settlements(
        loan_id, settlement_date, scheduled_remaining_before, final_payment_amount, waived_amount, method, notes
    ) values (
        p_loan_id,
        coalesce(p_settlement_date,current_date),
        v_outstanding,
        v_final,
        v_waived,
        nullif(trim(coalesce(p_method,'')),''),
        nullif(trim(coalesce(p_notes,'')),'')
    ) returning id into v_settlement_id;

    v_left := v_final;
    if v_left > 0 then
        for v_emi in
            select e.id,e.amount,coalesce(e.paid_amount,0) paid_amount,e.due_date,e.installment_number
              from public.emis e
             where e.loan_id=p_loan_id
             order by e.due_date nulls last,e.installment_number,e.id
             for update
        loop
            exit when v_left <= 0;
            v_emi_remaining := greatest(v_emi.amount - least(greatest(v_emi.paid_amount,0),v_emi.amount),0);
            if v_emi_remaining <= 0 then continue; end if;
            v_alloc := least(v_left,v_emi_remaining);
            insert into public.emi_payments(emi_id,amount,payment_date,method,notes,source,settlement_id)
            values (
                v_emi.id,
                v_alloc,
                coalesce(p_settlement_date,current_date),
                nullif(trim(coalesce(p_method,'')),''),
                'Loan settlement closing payment'||case when nullif(trim(coalesce(p_notes,'')),'') is not null then ': '||left(trim(p_notes),300) else '' end,
                'settlement',
                v_settlement_id
            ) returning id into v_payment_id;
            perform public.abhi_recalculate_emi(v_emi.id);
            v_left := v_left - v_alloc;
            v_payment_count := v_payment_count + 1;
        end loop;
    end if;

    if v_left <> 0 then raise exception 'Could not allocate full settlement payment'; end if;

    update public.loans
       set status='closed', end_date=coalesce(p_settlement_date,current_date), updated_at=now()
     where id=p_loan_id;

    insert into public.activity_log(action,table_name,record_id,description)
    values (
        'SETTLE_LOAN','loan_settlements',v_settlement_id::text,
        format('Loan %s settled. Remaining before: %s, final payment: %s, waived: %s',v_loan.loan_code,v_outstanding,v_final,v_waived)
    );

    return jsonb_build_object(
        'success',true,
        'settlement_id',v_settlement_id,
        'loan_id',p_loan_id,
        'loan_code',v_loan.loan_code,
        'settlement_date',coalesce(p_settlement_date,current_date),
        'remaining_before',v_outstanding,
        'final_payment_amount',v_final,
        'waived_amount',v_waived,
        'payment_rows_created',v_payment_count,
        'status','closed'
    );
end;
$$;

create or replace function public.abhi_reopen_loan_settlement(
    p_settlement_id uuid,
    p_reopen_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_settlement public.loan_settlements%rowtype;
    v_loan_code text;
    v_emi_id uuid;
    v_reversed integer := 0;
begin
    select * into v_settlement from public.loan_settlements where id=p_settlement_id for update;
    if v_settlement.id is null then raise exception 'Settlement not found'; end if;
    if v_settlement.reopened_at is not null then raise exception 'Settlement is already reopened'; end if;

    perform 1 from public.loans where id=v_settlement.loan_id for update;
    select loan_code into v_loan_code from public.loans where id=v_settlement.loan_id;

    for v_emi_id in
        select distinct p.emi_id
          from public.emi_payments p
         where p.settlement_id=v_settlement.id and p.reversed_at is null
    loop
        update public.emi_payments
           set reversed_at=now(),updated_at=now()
         where settlement_id=v_settlement.id and emi_id=v_emi_id and reversed_at is null;
        get diagnostics v_reversed = row_count;
        perform public.abhi_recalculate_emi(v_emi_id);
    end loop;

    update public.loan_settlements
       set reopened_at=now(),reopen_note=nullif(trim(coalesce(p_reopen_note,'')),'')
     where id=v_settlement.id;

    update public.loans set status='active',end_date=null,updated_at=now() where id=v_settlement.loan_id;
    perform public.abhi_refresh_due_statuses();

    insert into public.activity_log(action,table_name,record_id,description)
    values ('REOPEN_LOAN','loan_settlements',v_settlement.id::text,'Loan '||coalesce(v_loan_code,'')||' settlement reopened: '||coalesce(nullif(trim(p_reopen_note),''),'No reason supplied'));

    return jsonb_build_object(
        'success',true,'settlement_id',v_settlement.id,'loan_id',v_settlement.loan_id,
        'status','active','reopened_at',now()
    );
end;
$$;


revoke all on function public.abhi_settle_loan(uuid,integer,date,text,text) from public,anon,authenticated;
revoke all on function public.abhi_reopen_loan_settlement(uuid,text) from public,anon,authenticated;
grant execute on function public.abhi_settle_loan(uuid,integer,date,text,text) to service_role;
grant execute on function public.abhi_reopen_loan_settlement(uuid,text) to service_role;
