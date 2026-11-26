-- Apply once, before deploying the matching app build. Installing this migration does not reset data.
begin;

-- A single stable statement captures all tables at the same point in time, including soft-deleted rows.
create or replace function public.abhi_backup_data()
returns jsonb language sql stable security invoker set search_path = '' as $$
    select jsonb_build_object(
        'recycle_bin', coalesce((select jsonb_agg(t order by t.id) from public.recycle_bin t), '[]'::jsonb),
        'app_settings', coalesce((select jsonb_agg(t order by t.id) from public.app_settings t), '[]'::jsonb),
        'upi_payment_config', coalesce((select jsonb_agg(t order by t.id) from public.upi_payment_config t), '[]'::jsonb),
        'borrowers', coalesce((select jsonb_agg(t order by t.id) from public.borrowers t), '[]'::jsonb),
        'loans', coalesce((select jsonb_agg(t order by t.id) from public.loans t), '[]'::jsonb),
        'emis', coalesce((select jsonb_agg(t order by t.id) from public.emis t), '[]'::jsonb),
        'loan_settlements', coalesce((select jsonb_agg(t order by t.id) from public.loan_settlements t), '[]'::jsonb),
        'emi_payments', coalesce((select jsonb_agg(t order by t.id) from public.emi_payments t), '[]'::jsonb),
        'documents', coalesce((select jsonb_agg(t order by t.id) from public.documents t), '[]'::jsonb),
        'collection_followups', coalesce((select jsonb_agg(t order by t.id) from public.collection_followups t), '[]'::jsonb),
        'upi_payment_requests', coalesce((select jsonb_agg(t order by t.id) from public.upi_payment_requests t), '[]'::jsonb),
        'activity_log', coalesce((select jsonb_agg(t order by t.id) from public.activity_log t), '[]'::jsonb)
    );
$$;

create or replace function public.abhi_create_backup_snapshot(p_label text default null, p_reason text default 'manual')
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
    snapshot_id uuid;
    backup_data jsonb := public.abhi_backup_data();
    counts jsonb;
begin
    select jsonb_object_agg(key, jsonb_array_length(value)) into counts from jsonb_each(backup_data);
    insert into public.backup_snapshots(label, reason, payload, summary)
    values (p_label, coalesce(p_reason,'manual'),
        backup_data || jsonb_build_object('format','abhitools-snapshot','version',8,'created_at', now()),
        counts || jsonb_build_object('settings',counts->'app_settings','followups',counts->'collection_followups','recycle_items',counts->'recycle_bin'))
    returning id into snapshot_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('CREATE_BACKUP','backup_snapshots',snapshot_id::text,coalesce(p_label,'Backup snapshot'));
    return snapshot_id;
end;
$$;

-- The legacy restore handles missing columns and synthesizes historical EMI ledger entries.
do $$ begin
    if to_regprocedure('public.abhi_restore_backup_v7(uuid)') is null then
        alter function public.abhi_restore_backup_snapshot(uuid) rename to abhi_restore_backup_v7;
    end if;
end $$;

-- Serialize whole-ledger replacements with normal writes before a safety snapshot is taken.
create or replace function public.abhi_lock_business_data()
returns void language sql security invoker set search_path = '' as $$
    lock table public.borrowers, public.loans, public.emis, public.loan_settlements, public.emi_payments,
        public.collection_followups, public.documents, public.upi_payment_requests, public.upi_payment_config,
        public.recycle_bin, public.app_settings, public.activity_log, public.backup_snapshots in share row exclusive mode;
$$;
revoke all on function public.abhi_lock_business_data() from public,anon,authenticated;
grant execute on function public.abhi_lock_business_data() to service_role;

create or replace function public.abhi_clear_business_records()
returns void language sql security invoker set search_path = '' as $$
    delete from public.upi_payment_requests where true;
    delete from public.collection_followups where true;
    delete from public.documents where true;
    delete from public.emi_payments where true;
    delete from public.loan_settlements where true;
    delete from public.emis where true;
    delete from public.loans where true;
    delete from public.borrowers where true;
    delete from public.upi_payment_config where true;
    delete from public.app_settings where true;
    delete from public.recycle_bin where true;
    delete from public.activity_log where true;
$$;

create or replace function public.abhi_restore_backup_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    snapshot jsonb;
    table_name text;
    counts jsonb := '{}';
    log_sequence regclass;
    max_log_id bigint;
    last_log_id bigint;
begin
    perform public.abhi_lock_business_data();
    select payload into strict snapshot from public.backup_snapshots where id = p_snapshot_id;
    if coalesce((snapshot->>'version')::integer, 1) < 8 then
        return public.abhi_restore_backup_v7(p_snapshot_id);
    end if;
    if snapshot->>'version' <> '8' then raise exception 'Unsupported snapshot version'; end if;
    perform public.abhi_create_backup_snapshot('Before restore ' || p_snapshot_id, 'pre-restore');
    perform public.abhi_clear_business_records();
    -- Fixed list in foreign-key order. A missing table or invalid row rolls back the entire operation.
    foreach table_name in array array[
        'recycle_bin','app_settings','upi_payment_config','borrowers','loans','emis',
        'loan_settlements','emi_payments','documents','collection_followups','upi_payment_requests','activity_log'
    ] loop
        if jsonb_typeof(snapshot->table_name) is distinct from 'array' then
            raise exception 'Missing or invalid backup table: %', table_name;
        end if;
        execute format('insert into public.%1$I overriding system value select * from jsonb_populate_recordset(null::public.%1$I, $1)', table_name)
            using snapshot->table_name;
        counts := counts || jsonb_build_object(table_name, jsonb_array_length(snapshot->table_name));
    end loop;
    -- Some older base schemas use a numeric activity ID instead of a UUID.
    log_sequence := pg_get_serial_sequence('public.activity_log','id')::regclass;
    if log_sequence is not null then
        execute 'select max(id) from public.activity_log' into max_log_id;
        execute format('select last_value from %s',log_sequence) into last_log_id;
        if max_log_id >= last_log_id then perform setval(log_sequence,max_log_id,true); end if;
    end if;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('RESTORE_BACKUP','backup_snapshots',p_snapshot_id::text,'Backup snapshot restored');
    return jsonb_build_object('success',true,'snapshot_id',p_snapshot_id,'summary',counts);
end;
$$;

-- Store object IDs only. They survive a tab close or interrupted Storage request.
create table if not exists public.abhi_reset_jobs (
    id uuid primary key,
    file_ids uuid[] not null,
    created_at timestamptz not null default now()
);
alter table public.abhi_reset_jobs enable row level security;
revoke all on public.abhi_reset_jobs from public, anon, authenticated;
grant select, insert, update on public.abhi_reset_jobs to service_role;

create or replace function public.abhi_reset_preview()
returns jsonb language sql stable security invoker set search_path = '' as $$
    select jsonb_build_object(
        'borrowers',(select count(*) from public.borrowers), 'loans',(select count(*) from public.loans),
        'emis',(select count(*) from public.emis), 'payments',(select count(*) from public.emi_payments),
        'snapshots',(select count(*) from public.backup_snapshots),
        'uploads',(select count(*) from storage.objects where bucket_id in ('photos','documents') and name like 'borrowers/%'),
        'pending_job',(select id from public.abhi_reset_jobs where cardinality(file_ids)>0 order by created_at limit 1)
    );
$$;

create or replace function public.abhi_start_data_reset(p_job uuid, p_confirm text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
    pending uuid;
begin
    if p_job is null or p_confirm is distinct from 'DELETE ALL' then raise exception 'Confirmation required'; end if;
    lock table public.abhi_reset_jobs in share row exclusive mode;
    if exists (select 1 from public.abhi_reset_jobs where id = p_job) then return p_job; end if;
    select id into pending from public.abhi_reset_jobs where cardinality(file_ids)>0 order by created_at limit 1;
    if pending is not null then return pending; end if;
    perform public.abhi_lock_business_data();
    insert into public.abhi_reset_jobs(id,file_ids)
    select p_job, array(select id from storage.objects where bucket_id in ('photos','documents') and name like 'borrowers/%');
    perform public.abhi_clear_business_records();
    delete from public.backup_snapshots where true;
    return p_job;
end;
$$;

create or replace function public.abhi_reset_file_batch(p_job uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    ids uuid[];
    files jsonb;
    remaining integer;
begin
    select file_ids into strict ids from public.abhi_reset_jobs where id = p_job for update;
    select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',name)), '[]'::jsonb),
           coalesce(max(total),0) into files, remaining
    from (select bucket_id, name, count(*) over () as total from storage.objects
          where id = any(ids) and bucket_id in ('photos','documents') and name like 'borrowers/%'
          order by bucket_id,name limit 100) batch;
    if remaining = 0 and cardinality(ids)>0 then
        update public.abhi_reset_jobs set file_ids = '{}' where id = p_job;
    end if;
    return jsonb_build_object('files',files,'remaining',remaining);
end;
$$;

revoke all on function public.abhi_backup_data() from public, anon, authenticated;
grant execute on function public.abhi_backup_data() to service_role;

revoke all on function public.abhi_clear_business_records() from public, anon, authenticated;
grant execute on function public.abhi_clear_business_records() to service_role;

revoke all on function public.abhi_create_backup_snapshot(text,text) from public, anon, authenticated;
grant execute on function public.abhi_create_backup_snapshot(text,text) to service_role;

revoke all on function public.abhi_restore_backup_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.abhi_restore_backup_snapshot(uuid) to service_role;

revoke all on function public.abhi_reset_preview() from public, anon, authenticated;
grant execute on function public.abhi_reset_preview() to service_role;

revoke all on function public.abhi_start_data_reset(uuid,text) from public, anon, authenticated;
grant execute on function public.abhi_start_data_reset(uuid,text) to service_role;

revoke all on function public.abhi_reset_file_batch(uuid) from public, anon, authenticated;
grant execute on function public.abhi_reset_file_batch(uuid) to service_role;

create or replace function public.abhi_restore_backup_file(p_payload jsonb, p_counts jsonb, p_label text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare source_id uuid;
begin
    perform public.abhi_lock_business_data();
    insert into public.backup_snapshots(label,reason,payload,summary)
    values ('File restore source: ' || p_label, 'file-restore-source',p_payload,p_counts) returning id into source_id;
    return public.abhi_restore_backup_snapshot(source_id) || jsonb_build_object('staged_snapshot_id',source_id);
end;
$$;
revoke all on function public.abhi_restore_backup_file(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.abhi_restore_backup_file(jsonb,jsonb,text) to service_role;

-- Keep the loan mapping and history writes in the same transaction as the import.
alter function public.abhi_import_management_data(jsonb,text,text) security invoker;
create or replace function public.abhi_import_with_history(p_payload jsonb, p_mode text, p_label text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    result jsonb;
    settlement_map jsonb := '{}';
    item record;
    target_settlement uuid;
    count_documents integer;
    count_settlements integer := 0;
    count_payments integer := 0;
    affected_emis uuid[];
    target_emi uuid;
begin
    perform public.abhi_lock_business_data();
    if exists (select 1 from public.recycle_bin where restored_at is null and purged_at is null) then
        raise exception 'Resolve recycle bin before smart import';
    end if;
    -- Use the existing borrower/loan mapper, then add document links exactly once per target.
    result := public.abhi_import_management_data(p_payload - 'documents',p_mode,p_label);
    with mapped as (
        select distinct b.target_id as borrower_id,l.target_id as loan_id,x.doc_type,x.file_name,x.file_url
        from jsonb_to_recordset(p_payload->'documents') as x(borrower_key text,loan_key text,doc_type text,file_name text,file_url text)
        left join pg_temp.abhi_borrower_map b on b.source_key=x.borrower_key
        left join pg_temp.abhi_loan_map l on l.source_key=x.loan_key
        where (x.borrower_key is null or b.target_id is not null) and (x.loan_key is null or l.target_id is not null)
    )
    insert into public.documents(borrower_id,loan_id,doc_type,file_name,file_url)
    select m.* from mapped m where not exists (
        select 1 from public.documents d where d.borrower_id is not distinct from m.borrower_id
        and d.loan_id is not distinct from m.loan_id and d.doc_type=m.doc_type and d.file_name=m.file_name and d.file_url=m.file_url
    );
    get diagnostics count_documents = row_count;
    for item in
        select x.*, m.target_id from jsonb_to_recordset(p_payload->'settlements')
          as x(source_key text,loan_key text,settlement_date date,scheduled_remaining_before int,final_payment_amount int,
               waived_amount int,method text,notes text,created_at timestamptz,reopened_at timestamptz,reopen_note text)
        join pg_temp.abhi_loan_map m on m.source_key=x.loan_key and m.inserted
    loop
        insert into public.loan_settlements(loan_id,settlement_date,scheduled_remaining_before,final_payment_amount,waived_amount,method,notes,created_at,reopened_at,reopen_note)
        values (item.target_id,item.settlement_date,item.scheduled_remaining_before,item.final_payment_amount,item.waived_amount,item.method,item.notes,item.created_at,item.reopened_at,item.reopen_note)
        returning id into target_settlement;
        settlement_map := settlement_map || jsonb_build_object(item.source_key,target_settlement);
        count_settlements := count_settlements+1;
    end loop;
    with imported as (
        insert into public.emi_payments(emi_id,amount,payment_date,method,notes,source,settlement_id,reversed_at)
        select e.id,x.amount,x.payment_date,x.method,x.notes,x.source,(settlement_map->>x.settlement_key)::uuid,x.reversed_at
        from jsonb_to_recordset(p_payload->'payments')
          as x(loan_key text,installment_number int,amount int,payment_date date,method text,notes text,source text,settlement_key text,reversed_at timestamptz)
        join pg_temp.abhi_loan_map m on m.source_key=x.loan_key and m.inserted
        join public.emis e on e.loan_id=m.target_id and e.installment_number=x.installment_number
        returning emi_id
    ) select count(*), array_agg(distinct emi_id) into count_payments,affected_emis from imported;
    foreach target_emi in array coalesce(affected_emis,'{}'::uuid[]) loop
        perform public.abhi_recalculate_emi(target_emi);
    end loop;
    return result || jsonb_build_object(
        'inserted_documents',count_documents, 'skipped_documents',jsonb_array_length(p_payload->'documents')-count_documents,
        'settlement_history_inserted',count_settlements,'settlement_history_skipped',jsonb_array_length(p_payload->'settlements')-count_settlements,
        'payment_history_inserted',count_payments,'payment_history_skipped',jsonb_array_length(p_payload->'payments')-count_payments);
end;
$$;
revoke all on function public.abhi_import_with_history(jsonb,text,text) from public,anon,authenticated;
grant execute on function public.abhi_import_with_history(jsonb,text,text) to service_role;

-- Only look up names/codes present in the submitted file. The scalar response avoids the Data API row cap.
create or replace function public.abhi_import_matches(p_names text[], p_codes text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
    select jsonb_build_object(
        'names',coalesce((select jsonb_agg(distinct upper(trim(name))) from public.borrowers where deleted_at is null and upper(trim(name))=any(p_names)), '[]'::jsonb),
        'codes',coalesce((select jsonb_agg(distinct loan_code) from public.loans where loan_code=any(p_codes)), '[]'::jsonb)
    );
$$;
revoke all on function public.abhi_import_matches(text[],text[]) from public,anon,authenticated;
grant execute on function public.abhi_import_matches(text[],text[]) to service_role;

commit;
