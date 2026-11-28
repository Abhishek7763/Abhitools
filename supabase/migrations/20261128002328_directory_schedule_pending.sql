-- The unauthenticated home page gets account and calendar totals only.
create or replace function public.abhi_public_directory(p_search text default '')
returns jsonb language sql stable security invoker set search_path = '' as $$
with visible as materialized (
    select l.id,l.borrower_id,l.amount,l.status,l.created_at,l.loan_code,b.name,
        encode(sha256(convert_to('public-folder:' || b.id::text,'UTF8')),'hex') as folder_key
    from public.loans l join public.borrowers b on b.id=l.borrower_id
    where l.deleted_at is null and b.deleted_at is null
), installments as materialized (
    select e.loan_id,e.due_month,e.due_year,e.amount,
        least(greatest(coalesce(e.paid_amount,0),0),e.amount) as paid
    from public.emis e join visible l on l.id=e.loan_id
), balances as (
    select loan_id,sum(amount-paid) as remaining from installments group by loan_id
), folders as (
    select l.folder_key as key,l.name,count(*) as count,sum(l.amount) as sum,
        case when count(b.loan_id) = count(*) then sum(b.remaining) end as remaining,
        (array_agg(l.loan_code order by l.created_at desc,l.id))[1] as label
    from visible l left join balances b on b.loan_id=l.id where l.status='active'
    group by l.folder_key,l.name
    having bool_or(strpos(lower(l.name), lower(p_search))>0 or strpos(lower(l.loan_code), lower(p_search))>0)
), months as (
    select e.due_month as month,e.due_year as year,sum(e.amount) as total,sum(e.paid) as collected,
        jsonb_agg(distinct jsonb_build_object('key',l.folder_key,'name',l.name)) as members
    from installments e join visible l on l.id=e.loan_id where p_search='' group by e.due_month,e.due_year
)
select jsonb_build_object('folders',coalesce((select jsonb_agg(f order by f.name,f.key) from folders f),'[]'::jsonb),
    'months',coalesce((select jsonb_agg(m) from months m),'[]'::jsonb));
$$;


-- Account verification happens at the API boundary. Only the server can read this projection.
create function public.abhi_borrower_account(p_owner uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'loan_code', l.loan_code, 'amount', l.amount, 'status', l.status,
    'loan_year', l.loan_year, 'borrowers', jsonb_build_object('name', b.name),
    'emis', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'installment_number', e.installment_number, 'amount', e.amount, 'status', e.status,
            'due_date', e.due_date, 'due_day', e.due_day, 'due_month', e.due_month,
            'due_year', e.due_year, 'paid_date', e.paid_date, 'paid_amount', e.paid_amount,
            'payments', (
                select coalesce(jsonb_agg(jsonb_build_object('amount', p.amount, 'payment_date', p.payment_date)
                    order by p.payment_date desc, p.created_at desc, p.id), '[]'::jsonb)
                from public.emi_payments p where p.emi_id = e.id and p.reversed_at is null
                  and p.source <> 'baseline'
                  and coalesce(p.notes,'') not in ('Backfilled from EMI paid state before Phase 2', 'Restored from older backup paid state')
            )
        ) order by e.installment_number, e.id), '[]'::jsonb)
        from public.emis e where e.loan_id = l.id
    )
) order by l.created_at desc, l.id), '[]'::jsonb)
from public.loans l join public.borrowers b on b.id = l.borrower_id
where l.borrower_id = p_owner and b.deleted_at is null and l.deleted_at is null;
$$;
revoke all on function public.abhi_borrower_account(uuid) from public, anon, authenticated;
grant execute on function public.abhi_borrower_account(uuid) to service_role;
