-- AbhiTools Phase 3: automatic due/overdue engine.
-- Uses Asia/Kolkata as the business date for this personal India-based tool.

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
       and e.status is distinct from case
           when coalesce(e.paid_amount,0) >= e.amount then 'paid'
           when e.due_date < v_today then 'overdue'
           when coalesce(e.paid_amount,0) > 0 then 'partial'
           else 'pending'
       end;
    get diagnostics v_updated = row_count;
    return jsonb_build_object('business_date', v_today, 'updated_count', v_updated);
end;
$$;

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
    v_due_date date;
    v_today date := (now() at time zone 'Asia/Kolkata')::date;
    v_status text;
begin
    select e.amount, e.due_date into v_amount, v_due_date
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
    elsif v_due_date is not null and v_due_date < v_today then
        v_status := 'overdue';
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
        'last_paid_date', v_last_date,
        'business_date', v_today
    );
end;
$$;

revoke all on function public.abhi_refresh_due_statuses() from public, anon, authenticated;
grant execute on function public.abhi_refresh_due_statuses() to service_role;
revoke all on function public.abhi_recalculate_emi(uuid) from public, anon, authenticated;
grant execute on function public.abhi_recalculate_emi(uuid) to service_role;
