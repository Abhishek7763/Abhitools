-- AbhiTools V2.4 hardening: duplicate UTR protection and serverless-safe admin login throttling.

-- Normalize uniqueness at the database boundary so concurrent requests cannot reuse the same UTR/reference.
create unique index if not exists upi_payment_requests_user_reference_unique_idx
on public.upi_payment_requests ((upper(trim(user_reference))))
where user_reference is not null and trim(user_reference) <> '';

create or replace function public.abhi_submit_upi_reference(p_request_id uuid,p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_request public.upi_payment_requests%rowtype;
    v_reference text := upper(trim(coalesce(p_reference,'')));
    v_expires_at timestamptz;
begin
    if v_reference !~ '^[A-Z0-9][A-Z0-9._/-]{5,79}$' then
        raise exception 'Enter a valid UPI UTR or transaction reference';
    end if;

    select * into v_request
      from public.upi_payment_requests
     where id=p_request_id
     for update;

    if v_request.id is null then raise exception 'UPI payment request not found'; end if;
    if v_request.status <> 'pending' then raise exception 'UPI payment request is no longer pending'; end if;
    if v_request.expires_at <= now() then
        update public.upi_payment_requests
           set status='expired',resolved_at=now()
         where id=p_request_id;
        raise exception 'UPI payment request has expired';
    end if;

    if exists (
        select 1
          from public.upi_payment_requests r
         where r.id <> p_request_id
           and r.user_reference is not null
           and upper(trim(r.user_reference)) = v_reference
    ) then
        raise exception 'This UTR/transaction reference is already linked to another payment request';
    end if;

    v_expires_at := now()+interval '24 hours';
    begin
        update public.upi_payment_requests
           set user_reference=v_reference,
               user_claimed_at=now(),
               expires_at=v_expires_at
         where id=p_request_id;
    exception when unique_violation then
        raise exception 'This UTR/transaction reference is already linked to another payment request';
    end;

    insert into public.activity_log(action,table_name,record_id,description)
    values ('SUBMIT_UPI_REFERENCE','upi_payment_requests',p_request_id::text,
            'User submitted UPI transaction reference for admin verification');

    return jsonb_build_object(
        'success',true,
        'request_id',p_request_id,
        'request_status','pending',
        'reference_submitted',true,
        'expires_at',v_expires_at
    );
end;
$$;

revoke all on function public.abhi_submit_upi_reference(uuid,text) from public,anon,authenticated;
grant execute on function public.abhi_submit_upi_reference(uuid,text) to service_role;

-- Serverless instances cannot safely keep login counters in memory. Store only a keyed HMAC
-- fingerprint from the API; raw client IPs are never persisted in this table.
create table if not exists public.admin_login_rate_limits (
    bucket_hash text primary key,
    failure_count integer not null default 0,
    window_started_at timestamptz not null default now(),
    locked_until timestamptz,
    updated_at timestamptz not null default now(),
    constraint admin_login_rate_limits_bucket_hash_check
        check (bucket_hash ~ '^[a-f0-9]{64}$'),
    constraint admin_login_rate_limits_failure_count_check
        check (failure_count >= 0)
);

alter table public.admin_login_rate_limits enable row level security;
revoke all on table public.admin_login_rate_limits from public,anon,authenticated;

create or replace function public.abhi_admin_login_rate_limit(
    p_bucket_hash text,
    p_action text default 'check'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_action text := lower(trim(coalesce(p_action,'check')));
    v_failure_count integer;
    v_window_started_at timestamptz;
    v_locked_until timestamptz;
    v_retry integer := 0;
    v_limit constant integer := 5;
    v_window constant interval := interval '10 minutes';
    v_lock constant interval := interval '10 minutes';
begin
    if coalesce(p_bucket_hash,'') !~ '^[a-f0-9]{64}$' then
        raise exception 'Invalid login rate-limit bucket';
    end if;
    if v_action not in ('check','fail','clear') then
        raise exception 'Invalid login rate-limit action';
    end if;

    if v_action='clear' then
        delete from public.admin_login_rate_limits where bucket_hash=p_bucket_hash;
        return jsonb_build_object('allowed',true,'failure_count',0,'retry_after_seconds',0);
    end if;

    insert into public.admin_login_rate_limits(bucket_hash,failure_count,window_started_at,updated_at)
    values (p_bucket_hash,0,v_now,v_now)
    on conflict (bucket_hash) do nothing;

    select failure_count,window_started_at,locked_until
      into v_failure_count,v_window_started_at,v_locked_until
      from public.admin_login_rate_limits
     where bucket_hash=p_bucket_hash
     for update;

    if v_locked_until is not null and v_locked_until > v_now then
        v_retry := greatest(1,ceil(extract(epoch from (v_locked_until-v_now)))::integer);
        update public.admin_login_rate_limits set updated_at=v_now where bucket_hash=p_bucket_hash;
        return jsonb_build_object(
            'allowed',false,
            'failure_count',v_failure_count,
            'retry_after_seconds',v_retry
        );
    end if;

    if v_window_started_at <= v_now-v_window then
        v_failure_count := 0;
        v_window_started_at := v_now;
        v_locked_until := null;
        update public.admin_login_rate_limits
           set failure_count=0,window_started_at=v_now,locked_until=null,updated_at=v_now
         where bucket_hash=p_bucket_hash;
    end if;

    if v_action='fail' then
        v_failure_count := v_failure_count + 1;
        if v_failure_count >= v_limit then
            v_locked_until := v_now+v_lock;
            v_retry := ceil(extract(epoch from v_lock))::integer;
        else
            v_locked_until := null;
            v_retry := 0;
        end if;

        update public.admin_login_rate_limits
           set failure_count=v_failure_count,
               window_started_at=v_window_started_at,
               locked_until=v_locked_until,
               updated_at=v_now
         where bucket_hash=p_bucket_hash;

        return jsonb_build_object(
            'allowed',v_locked_until is null,
            'failure_count',v_failure_count,
            'retry_after_seconds',v_retry
        );
    end if;

    update public.admin_login_rate_limits set updated_at=v_now where bucket_hash=p_bucket_hash;
    return jsonb_build_object(
        'allowed',true,
        'failure_count',v_failure_count,
        'retry_after_seconds',0
    );
end;
$$;

revoke all on function public.abhi_admin_login_rate_limit(text,text) from public,anon,authenticated;
grant execute on function public.abhi_admin_login_rate_limit(text,text) to service_role;
