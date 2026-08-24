-- Phase 1: server-side backup snapshots + atomic import/restore helpers

create table if not exists public.backup_snapshots (
    id uuid primary key default gen_random_uuid(),
    label text,
    reason text not null default 'manual',
    payload jsonb not null,
    summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.backup_snapshots enable row level security;

revoke all on table public.backup_snapshots from anon, authenticated;
grant all on table public.backup_snapshots to service_role;

drop policy if exists backup_snapshots_service_role_all on public.backup_snapshots;
create policy backup_snapshots_service_role_all
on public.backup_snapshots
for all
to service_role
using (true)
with check (true);

create or replace function public.abhi_create_backup_snapshot(
    p_label text default null,
    p_reason text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id uuid;
    v_payload jsonb;
    v_summary jsonb;
begin
    v_payload := jsonb_build_object(
        'format', 'abhitools-snapshot',
        'version', 1,
        'created_at', now(),
        'borrowers', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at, b.id) from public.borrowers b), '[]'::jsonb),
        'loans', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at, l.id) from public.loans l), '[]'::jsonb),
        'emis', coalesce((select jsonb_agg(to_jsonb(e) order by e.loan_id, e.installment_number, e.id) from public.emis e), '[]'::jsonb),
        'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at, d.id) from public.documents d), '[]'::jsonb)
    );

    v_summary := jsonb_build_object(
        'borrowers', (select count(*) from public.borrowers),
        'loans', (select count(*) from public.loans),
        'emis', (select count(*) from public.emis),
        'documents', (select count(*) from public.documents)
    );

    insert into public.backup_snapshots(label, reason, payload, summary)
    values (nullif(trim(coalesce(p_label, '')), ''), coalesce(nullif(trim(p_reason), ''), 'manual'), v_payload, v_summary)
    returning id into v_id;

    insert into public.activity_log(action, table_name, record_id, description)
    values ('CREATE_BACKUP', 'backup_snapshots', v_id::text, 'Backup snapshot created: ' || coalesce(nullif(trim(p_label), ''), p_reason, 'manual'));

    return v_id;
end;
$$;

create or replace function public.abhi_restore_backup_snapshot(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_payload jsonb;
    v_summary jsonb;
begin
    select payload into v_payload
    from public.backup_snapshots
    where id = p_snapshot_id;

    if v_payload is null then
        raise exception 'Backup snapshot not found';
    end if;

    -- Current state is preserved before restore so restore itself can be undone.
    perform public.abhi_create_backup_snapshot('Before restore ' || p_snapshot_id::text, 'pre-restore');

    delete from public.documents;
    delete from public.emis;
    delete from public.loans;
    delete from public.borrowers;

    insert into public.borrowers(id, name, father_name, phone, whatsapp, address, aadhaar, pan, photo_url, notes, created_at, updated_at)
    select x.id, x.name, x.father_name, x.phone, x.whatsapp, x.address, x.aadhaar, x.pan, x.photo_url, x.notes,
           coalesce(x.created_at, now()), coalesce(x.updated_at, now())
    from jsonb_to_recordset(coalesce(v_payload->'borrowers', '[]'::jsonb)) as x(
        id uuid, name text, father_name text, phone text, whatsapp text, address text, aadhaar text, pan text,
        photo_url text, notes text, created_at timestamptz, updated_at timestamptz
    );

    insert into public.loans(id, borrower_id, loan_code, amount, interest_rate, loan_date, loan_year, end_date, status, agreement_url, notes, created_at, updated_at)
    select x.id, x.borrower_id, x.loan_code, x.amount, coalesce(x.interest_rate, 0), x.loan_date, x.loan_year, x.end_date,
           coalesce(x.status, 'active'), x.agreement_url, x.notes, coalesce(x.created_at, now()), coalesce(x.updated_at, now())
    from jsonb_to_recordset(coalesce(v_payload->'loans', '[]'::jsonb)) as x(
        id uuid, borrower_id uuid, loan_code text, amount integer, interest_rate numeric, loan_date date, loan_year integer,
        end_date date, status text, agreement_url text, notes text, created_at timestamptz, updated_at timestamptz
    );

    insert into public.emis(id, loan_id, installment_number, due_date, due_day, due_month, due_year, amount, status, paid_date, paid_amount, notes, created_at)
    select x.id, x.loan_id, x.installment_number, x.due_date, x.due_day, x.due_month, x.due_year, x.amount,
           coalesce(x.status, 'pending'), x.paid_date, x.paid_amount, x.notes, coalesce(x.created_at, now())
    from jsonb_to_recordset(coalesce(v_payload->'emis', '[]'::jsonb)) as x(
        id uuid, loan_id uuid, installment_number integer, due_date date, due_day integer, due_month text, due_year integer,
        amount integer, status text, paid_date date, paid_amount integer, notes text, created_at timestamptz
    );

    insert into public.documents(id, borrower_id, loan_id, doc_type, file_name, file_url, uploaded_at)
    select x.id, x.borrower_id, x.loan_id, x.doc_type, x.file_name, x.file_url, coalesce(x.uploaded_at, now())
    from jsonb_to_recordset(coalesce(v_payload->'documents', '[]'::jsonb)) as x(
        id uuid, borrower_id uuid, loan_id uuid, doc_type text, file_name text, file_url text, uploaded_at timestamptz
    );

    v_summary := jsonb_build_object(
        'borrowers', (select count(*) from public.borrowers),
        'loans', (select count(*) from public.loans),
        'emis', (select count(*) from public.emis),
        'documents', (select count(*) from public.documents)
    );

    insert into public.activity_log(action, table_name, record_id, description)
    values ('RESTORE_BACKUP', 'backup_snapshots', p_snapshot_id::text, 'Backup snapshot restored');

    return jsonb_build_object('success', true, 'snapshot_id', p_snapshot_id, 'summary', v_summary);
end;
$$;

create or replace function public.abhi_import_management_data(
    p_payload jsonb,
    p_mode text default 'merge',
    p_label text default null
)
returns jsonb
language plpgsql
security definer
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
        if v_mode = 'merge' then
            select b.id into v_borrower_id
            from public.borrowers b
            where upper(trim(b.name)) = v_name
            order by b.created_at nulls last, b.id
            limit 1;
        end if;

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

revoke all on function public.abhi_create_backup_snapshot(text, text) from public, anon, authenticated;
revoke all on function public.abhi_restore_backup_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.abhi_import_management_data(jsonb, text, text) from public, anon, authenticated;

grant execute on function public.abhi_create_backup_snapshot(text, text) to service_role;
grant execute on function public.abhi_restore_backup_snapshot(uuid) to service_role;
grant execute on function public.abhi_import_management_data(jsonb, text, text) to service_role;
