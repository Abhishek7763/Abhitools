-- The unauthenticated home page gets account and calendar totals only.
create function public.abhi_public_directory(p_search text default '')
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
        sum(coalesce(b.remaining,0)) as remaining,
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

-- Share the existing durable attempt counter, with a separate key space from admin login.
-- The counter's row lock spans both the number check and the failure increment.
create function public.abhi_unlock_borrower(p_key text,p_phone text,p_bucket text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    target uuid;
    limiter jsonb;
begin
    limiter := public.abhi_admin_login_rate_limit(p_bucket,'check');
    if not (limiter->>'allowed')::boolean then return limiter; end if;
    select b.id into target from public.borrowers b
    where b.deleted_at is null
        and encode(sha256(convert_to('public-folder:' || b.id::text,'UTF8')),'hex')=p_key
        and p_phone ~ '^[0-9]{10}$'
        and regexp_replace(coalesce(b.phone,''),'[[:space:]()+.-]','','g') in (p_phone,'91'||p_phone,'0'||p_phone);
    if target is null then
        return public.abhi_admin_login_rate_limit(p_bucket,'fail');
    end if;
    return jsonb_build_object('borrower_id',target);
end;
$$;

-- Bind each public UPI write to the verified owner in the same transaction as the write.
create function public.abhi_borrower_upi_write(p_owner uuid,p_action text,p_code text,p_installment integer,
    p_type text,p_request uuid,p_reference text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare owners uuid[];
begin
    if p_action='start' then
        select array_agg(x.borrower_id) into owners from (
            select l.borrower_id from public.loans l join public.borrowers b on b.id=l.borrower_id
            where trim(l.loan_code)=trim(p_code) and l.deleted_at is null and b.deleted_at is null for share of l,b
        ) x;
        if owners is distinct from array[p_owner] then raise exception 'Account mismatch'; end if;
        return public.abhi_start_upi_payment_request(p_code,p_installment,p_type);
    end if;
    perform 1 from public.upi_payment_requests u join public.loans l on l.id=u.loan_id join public.borrowers b on b.id=l.borrower_id
        where u.id=p_request and l.borrower_id=p_owner and l.deleted_at is null and b.deleted_at is null for update of u for share of l,b;
    if not found then raise exception 'Account mismatch'; end if;
    if p_action='reference' then return public.abhi_submit_upi_reference(p_request,p_reference); end if;
    if p_action='cancel' then return public.abhi_cancel_upi_payment_request(p_request); end if;
    raise exception 'Unsupported action';
end;
$$;
revoke all on function public.abhi_public_directory(text),public.abhi_unlock_borrower(text,text,text),
    public.abhi_borrower_upi_write(uuid,text,text,integer,text,uuid,text) from public,anon,authenticated;
grant execute on function public.abhi_public_directory(text),public.abhi_unlock_borrower(text,text,text),
    public.abhi_borrower_upi_write(uuid,text,text,integer,text,uuid,text) to service_role;
