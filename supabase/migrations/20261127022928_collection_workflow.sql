begin;

create or replace function public.abhi_review_import_matches(p_names text[], p_codes text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
    select public.abhi_import_matches(p_names,p_codes) || jsonb_build_object('candidates',coalesce((
        select jsonb_agg(jsonb_build_object('id',b.id,'name',upper(trim(b.name)),'father',b.father_name,
            'phone_last4',right(regexp_replace(coalesce(b.phone,b.whatsapp,''),'[^0-9]','','g'),4),
            'loans',array(select l.loan_code from public.loans l where l.borrower_id=b.id and l.deleted_at is null order by l.loan_code limit 6))
            order by upper(trim(b.name)),b.id)
        from public.borrowers b where b.deleted_at is null and upper(trim(b.name))=any(p_names)
    ),'[]'::jsonb));
$$;

-- Preserve the existing loan/EMI import and its source mappings. Borrower identity now uses reviewed choices.
create or replace function public.abhi_import_management_data(
    p_payload jsonb,
    p_mode text default 'merge',
    p_label text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_mode text := lower(coalesce(p_mode, 'merge'));
    v_snapshot uuid;
    v_item jsonb;
    v_borrower_id uuid;
    v_loan_id uuid;
    v_name text;
    v_source_key text;
    v_borrower_key text;
    v_loan_key text;
    v_loan_code text;
    v_inserted_borrowers integer := 0;
    v_reused_borrowers integer := 0;
    v_inserted_loans integer := 0;
    v_duplicate_loans integer := 0;
    v_inserted_emis integer := 0;
    v_skipped_emis integer := 0;
    v_inserted_documents integer := 0;
begin
    if v_mode not in ('merge', 'replace') then
        raise exception 'Import mode must be merge or replace';
    end if;

    if jsonb_typeof(coalesce(p_payload->'borrowers', '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(p_payload->'loans', '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(p_payload->'emis', '[]'::jsonb)) <> 'array' then
        raise exception 'Invalid normalized import payload';
    end if;

    v_snapshot := public.abhi_create_backup_snapshot(
        coalesce(nullif(trim(p_label), ''), 'Before import'),
        'pre-import'
    );

    if v_mode = 'replace' then
        delete from public.documents;
        delete from public.emis;
        delete from public.loans;
        delete from public.borrowers;
    end if;

    create temporary table if not exists pg_temp.abhi_borrower_map(
        source_key text primary key,
        target_id uuid not null
    ) on commit drop;
    truncate pg_temp.abhi_borrower_map;

    create temporary table if not exists pg_temp.abhi_loan_map(
        source_key text primary key,
        target_id uuid,
        inserted boolean not null default false
    ) on commit drop;
    truncate pg_temp.abhi_loan_map;

    for v_item in select value from jsonb_array_elements(coalesce(p_payload->'borrowers', '[]'::jsonb))
    loop
        v_source_key := nullif(trim(v_item->>'source_key'), '');
        v_name := upper(trim(coalesce(v_item->>'name', '')));
        if v_source_key is null or v_name = '' then
            continue;
        end if;

        v_borrower_id := null;
        case coalesce(v_item->'match'->>'kind', 'auto')
        when 'new' then null;
        when 'existing' then
            if v_mode <> 'merge' then raise exception 'Borrower review changed'; end if;
            select b.id into v_borrower_id from public.borrowers b
             where b.id=(v_item->'match'->>'id')::uuid and b.deleted_at is null and upper(trim(b.name))=v_name;
            if v_borrower_id is null then raise exception 'Borrower review changed'; end if;
        when 'incoming' then
            select b.id into v_borrower_id from pg_temp.abhi_borrower_map m
            join public.borrowers b on b.id=m.target_id
            where m.source_key=(v_item->'match'->>'key') and upper(trim(b.name))=v_name and b.deleted_at is null;
            if v_borrower_id is null then raise exception 'Borrower review changed'; end if;
        when 'auto' then
            if exists (select 1 from public.borrowers b where upper(trim(b.name))=v_name and b.deleted_at is null) then
                raise exception 'Borrower review changed';
            end if;
        else raise exception 'Invalid borrower decision';
        end case;

        if v_borrower_id is null then
            insert into public.borrowers(name, father_name, phone, whatsapp, address, aadhaar, pan, photo_url, notes)
            values (
                v_name,
                nullif(trim(v_item->>'father_name'), ''),
                nullif(trim(v_item->>'phone'), ''),
                nullif(trim(v_item->>'whatsapp'), ''),
                nullif(trim(v_item->>'address'), ''),
                nullif(trim(v_item->>'aadhaar'), ''),
                nullif(trim(v_item->>'pan'), ''),
                nullif(trim(v_item->>'photo_url'), ''),
                nullif(trim(v_item->>'notes'), '')
            ) returning id into v_borrower_id;
            v_inserted_borrowers := v_inserted_borrowers + 1;
        else
            -- Merge only fills missing profile fields; it never overwrites populated values.
            update public.borrowers b set
                father_name = coalesce(b.father_name, nullif(trim(v_item->>'father_name'), '')),
                phone = coalesce(b.phone, nullif(trim(v_item->>'phone'), '')),
                whatsapp = coalesce(b.whatsapp, nullif(trim(v_item->>'whatsapp'), '')),
                address = coalesce(b.address, nullif(trim(v_item->>'address'), '')),
                aadhaar = coalesce(b.aadhaar, nullif(trim(v_item->>'aadhaar'), '')),
                pan = coalesce(b.pan, nullif(trim(v_item->>'pan'), '')),
                photo_url = coalesce(b.photo_url, nullif(trim(v_item->>'photo_url'), '')),
                notes = coalesce(b.notes, nullif(trim(v_item->>'notes'), ''))
            where b.id = v_borrower_id;
            v_reused_borrowers := v_reused_borrowers + 1;
        end if;

        insert into pg_temp.abhi_borrower_map(source_key, target_id)
        values (v_source_key, v_borrower_id)
        on conflict (source_key) do update set target_id = excluded.target_id;
    end loop;

    for v_item in select value from jsonb_array_elements(coalesce(p_payload->'loans', '[]'::jsonb))
    loop
        v_loan_key := nullif(trim(v_item->>'source_key'), '');
        v_borrower_key := nullif(trim(v_item->>'borrower_key'), '');
        v_loan_code := trim(coalesce(v_item->>'loan_code', ''));
        if v_loan_key is null or v_borrower_key is null or v_loan_code = '' then
            continue;
        end if;

        select target_id into v_borrower_id from pg_temp.abhi_borrower_map where source_key = v_borrower_key;
        if v_borrower_id is null then
            continue;
        end if;

        v_loan_id := null;
        if v_mode = 'merge' then
            select l.id into v_loan_id from public.loans l where l.loan_code = v_loan_code limit 1;
        end if;

        if v_loan_id is null then
            insert into public.loans(
                borrower_id, loan_code, amount, interest_rate, loan_date, loan_year, end_date, status, agreement_url, notes
            ) values (
                v_borrower_id,
                v_loan_code,
                greatest(1, coalesce((v_item->>'amount')::integer, 0)),
                coalesce(nullif(v_item->>'interest_rate','')::numeric, 0),
                nullif(v_item->>'loan_date','')::date,
                nullif(v_item->>'loan_year','')::integer,
                nullif(v_item->>'end_date','')::date,
                case when v_item->>'status' in ('active','closed','defaulted') then v_item->>'status' else 'active' end,
                nullif(trim(v_item->>'agreement_url'), ''),
                nullif(trim(v_item->>'notes'), '')
            ) returning id into v_loan_id;
            v_inserted_loans := v_inserted_loans + 1;

            insert into pg_temp.abhi_loan_map(source_key, target_id, inserted)
            values (v_loan_key, v_loan_id, true)
            on conflict (source_key) do update set target_id = excluded.target_id, inserted = true;
        else
            v_duplicate_loans := v_duplicate_loans + 1;
            -- A duplicate code owned by another borrower must not receive incoming documents.
            if not exists (select 1 from public.loans where id=v_loan_id and borrower_id=v_borrower_id) then
                continue;
            end if;
            insert into pg_temp.abhi_loan_map(source_key, target_id, inserted)
            values (v_loan_key, v_loan_id, false)
            on conflict (source_key) do update set target_id = excluded.target_id, inserted = false;
        end if;
    end loop;

    for v_item in select value from jsonb_array_elements(coalesce(p_payload->'emis', '[]'::jsonb))
    loop
        v_loan_key := nullif(trim(v_item->>'loan_key'), '');
        select target_id into v_loan_id
        from pg_temp.abhi_loan_map
        where source_key = v_loan_key and inserted = true;

        if v_loan_id is null then
            v_skipped_emis := v_skipped_emis + 1;
            continue;
        end if;

        insert into public.emis(
            loan_id, installment_number, due_date, due_day, due_month, due_year, amount, status, paid_date, paid_amount, notes
        ) values (
            v_loan_id,
            greatest(1, coalesce((v_item->>'installment_number')::integer, 1)),
            nullif(v_item->>'due_date','')::date,
            (v_item->>'due_day')::integer,
            upper(v_item->>'due_month'),
            nullif(v_item->>'due_year','')::integer,
            greatest(1, coalesce((v_item->>'amount')::integer, 0)),
            case when v_item->>'status' in ('pending','paid','overdue') then v_item->>'status' else 'pending' end,
            nullif(v_item->>'paid_date','')::date,
            nullif(v_item->>'paid_amount','')::integer,
            nullif(trim(v_item->>'notes'), '')
        );
        v_inserted_emis := v_inserted_emis + 1;
    end loop;

    -- Document metadata is restored/imported only when it can be mapped safely.
    for v_item in select value from jsonb_array_elements(coalesce(p_payload->'documents', '[]'::jsonb))
    loop
        v_borrower_id := null;
        v_loan_id := null;
        v_borrower_key := nullif(trim(v_item->>'borrower_key'), '');
        v_loan_key := nullif(trim(v_item->>'loan_key'), '');
        if v_borrower_key is not null then
            select target_id into v_borrower_id from pg_temp.abhi_borrower_map where source_key = v_borrower_key;
        end if;
        if v_loan_key is not null then
            select target_id into v_loan_id from pg_temp.abhi_loan_map where source_key = v_loan_key;
        end if;

        if (v_borrower_key is not null and v_borrower_id is null) or (v_loan_key is not null and v_loan_id is null) then
            continue;
        end if;
        if nullif(trim(v_item->>'doc_type'), '') is null or nullif(trim(v_item->>'file_name'), '') is null or nullif(trim(v_item->>'file_url'), '') is null then
            continue;
        end if;

        insert into public.documents(borrower_id, loan_id, doc_type, file_name, file_url)
        values (v_borrower_id, v_loan_id, v_item->>'doc_type', v_item->>'file_name', v_item->>'file_url');
        v_inserted_documents := v_inserted_documents + 1;
    end loop;

    insert into public.activity_log(action, table_name, record_id, description)
    values (
        'SMART_IMPORT', 'loans', v_snapshot::text,
        format('Smart import (%s): %s borrowers added, %s loans added, %s EMIs added; pre-import snapshot %s',
               v_mode, v_inserted_borrowers, v_inserted_loans, v_inserted_emis, v_snapshot)
    );

    return jsonb_build_object(
        'success', true,
        'mode', v_mode,
        'backup_snapshot_id', v_snapshot,
        'inserted_borrowers', v_inserted_borrowers,
        'reused_borrowers', v_reused_borrowers,
        'inserted_loans', v_inserted_loans,
        'duplicate_loans', v_duplicate_loans,
        'inserted_emis', v_inserted_emis,
        'skipped_emis', v_skipped_emis,
        'inserted_documents', v_inserted_documents
    );
exception
    when others then
        -- The function is transactional: any import changes and the pre-import snapshot are rolled back together on error.
        raise;
end;
$$;

-- Nullable columns preserve existing payments and allow v8 snapshots to keep replay receipts.
alter table public.emi_payments add column if not exists entry_request_id uuid,
    add column if not exists entry_receipt jsonb;
create unique index if not exists emi_payments_entry_request_idx on public.emi_payments(entry_request_id)
    where entry_request_id is not null;

create or replace function public.abhi_record_collection(p_request_id uuid,p_emi_id uuid,p_amount integer,
    p_payment_date date,p_method text,p_notes text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    previous public.emi_payments%rowtype;
    result jsonb;
    signature jsonb := jsonb_build_array(p_emi_id,p_amount,p_payment_date,p_method,p_notes);
begin
    if p_request_id is null then raise exception 'Payment request ID required'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
    select * into previous from public.emi_payments where entry_request_id=p_request_id for update;
    if found then
        if previous.entry_receipt->'input' is distinct from signature then raise exception 'Payment request details differ'; end if;
        if previous.reversed_at is not null then raise exception 'Payment was reversed'; end if;
        return (previous.entry_receipt->'result') || jsonb_build_object('replayed',true);
    end if;
    perform 1 from public.emis e join public.loans l on l.id=e.loan_id
        where e.id=p_emi_id and l.deleted_at is null and l.status <> 'closed' for share of l;
    if not found then raise exception 'Loan unavailable for collection'; end if;
    result := public.abhi_add_emi_payment(p_emi_id,p_amount,p_payment_date,p_method,p_notes);
    update public.emi_payments set entry_request_id=p_request_id,
        entry_receipt=jsonb_build_object('input',signature,'result',result)
        where id=(result->>'payment_id')::uuid;
    return result || jsonb_build_object('replayed',false);
end;
$$;

create or replace function public.abhi_daily_collection(p_day date)
returns jsonb language sql stable security invoker set search_path = '' as $$
    with ledger as (
        select p.amount,
            case when lower(trim(p.method))='upi' and exists (
                select 1 from public.upi_payment_requests u where u.status='confirmed'
                    and ((u.payment_id=p.id and u.amount=p.amount) or (p.settlement_id is not null and u.settlement_id=p.settlement_id))
            ) then 'verified_upi'
            when lower(trim(p.method))='cash' then 'cash'
            when lower(trim(p.method))='upi' then 'manual_upi'
            else 'other' end as channel
        from public.emi_payments p where p.payment_date=p_day and p.reversed_at is null and p.source <> 'baseline'
    )
    select jsonb_build_object('date',p_day,'cash',coalesce(sum(amount) filter(where channel='cash'),0),
        'verified_upi',coalesce(sum(amount) filter(where channel='verified_upi'),0),
        'manual_upi',coalesce(sum(amount) filter(where channel='manual_upi'),0),
        'other',coalesce(sum(amount) filter(where channel='other'),0),'collected',coalesce(sum(amount),0),
        'pending_upi',(select coalesce(sum(u.amount),0) from public.upi_payment_requests u where u.status='pending'
            and u.expires_at>now() and u.created_at >= (p_day::timestamp at time zone 'Asia/Kolkata')
            and u.created_at < ((p_day+1)::timestamp at time zone 'Asia/Kolkata'))) from ledger;
$$;

revoke all on function public.abhi_review_import_matches(text[],text[]),public.abhi_record_collection(uuid,uuid,integer,date,text,text),
    public.abhi_daily_collection(date),public.abhi_import_management_data(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.abhi_review_import_matches(text[],text[]),public.abhi_record_collection(uuid,uuid,integer,date,text,text),
    public.abhi_daily_collection(date),public.abhi_import_management_data(jsonb,text,text) to service_role;

commit;
