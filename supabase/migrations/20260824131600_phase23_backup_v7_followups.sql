-- Phase 23: include collection follow-ups/PTP in server snapshots and restore (backup format v7).

create or replace function public.abhi_create_backup_snapshot(p_label text default null, p_reason text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_payload jsonb; v_summary jsonb;
begin
    v_payload := jsonb_build_object(
        'format','abhitools-snapshot','version',7,'created_at',now(),
        'app_settings',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.app_settings s),'[]'::jsonb),
        'collection_followups',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from public.collection_followups f),'[]'::jsonb),
        'recycle_bin',coalesce((select jsonb_agg(to_jsonb(r) order by r.deleted_at,r.id) from public.recycle_bin r),'[]'::jsonb),
        'borrowers',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at,b.id) from public.borrowers b),'[]'::jsonb),
        'loans',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.id) from public.loans l),'[]'::jsonb),
        'emis',coalesce((select jsonb_agg(to_jsonb(e) order by e.loan_id,e.installment_number,e.id) from public.emis e),'[]'::jsonb),
        'loan_settlements',coalesce((select jsonb_agg(to_jsonb(s) order by s.settlement_date,s.created_at,s.id) from public.loan_settlements s),'[]'::jsonb),
        'emi_payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.payment_date,p.created_at,p.id) from public.emi_payments p),'[]'::jsonb),
        'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at,d.id) from public.documents d),'[]'::jsonb)
    );
    v_summary := jsonb_build_object(
        'settings',(select count(*) from public.app_settings),
        'followups',(select count(*) from public.collection_followups),
        'borrowers',(select count(*) from public.borrowers where deleted_at is null),
        'loans',(select count(*) from public.loans where deleted_at is null),
        'emis',(select count(*) from public.emis e join public.loans l on l.id=e.loan_id where l.deleted_at is null),
        'loan_settlements',(select count(*) from public.loan_settlements s join public.loans l on l.id=s.loan_id where s.reopened_at is null and l.deleted_at is null),
        'emi_payments',(select count(*) from public.emi_payments p join public.emis e on e.id=p.emi_id join public.loans l on l.id=e.loan_id where p.reversed_at is null and l.deleted_at is null),
        'documents',(select count(*) from public.documents where deleted_at is null),
        'recycle_items',(select count(*) from public.recycle_bin where restored_at is null and purged_at is null)
    );
    insert into public.backup_snapshots(label,reason,payload,summary)
    values (nullif(trim(coalesce(p_label,'')),''),coalesce(nullif(trim(p_reason),''),'manual'),v_payload,v_summary) returning id into v_id;
    insert into public.activity_log(action,table_name,record_id,description)
    values ('CREATE_BACKUP','backup_snapshots',v_id::text,'Backup snapshot created: '||coalesce(nullif(trim(p_label),''),p_reason,'manual'));
    return v_id;
end;
$$;

create or replace function public.abhi_restore_backup_snapshot(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_payload jsonb; v_summary jsonb;
begin
    select payload into v_payload from public.backup_snapshots where id=p_snapshot_id;
    if v_payload is null then raise exception 'Backup snapshot not found'; end if;
    perform public.abhi_create_backup_snapshot('Before restore '||p_snapshot_id::text,'pre-restore');

    delete from public.collection_followups;
    delete from public.documents;
    delete from public.loan_settlements;
    delete from public.emis;
    delete from public.loans;
    delete from public.borrowers;
    delete from public.recycle_bin;

    -- Settings are restored only from v6+ snapshots. Older backups intentionally preserve current settings.
    if v_payload ? 'app_settings' then
        delete from public.app_settings;
        insert into public.app_settings(id,config,updated_at)
        select x.id,coalesce(x.config,'{}'::jsonb),coalesce(x.updated_at,now())
        from jsonb_to_recordset(coalesce(v_payload->'app_settings','[]'::jsonb))
          as x(id text,config jsonb,updated_at timestamptz)
        where x.id='primary';
        if not exists (select 1 from public.app_settings where id='primary') then
            insert into public.app_settings(id,config) values ('primary','{}'::jsonb);
        end if;
    end if;

    insert into public.recycle_bin(id,entity_type,record_id,label,summary,deleted_at,restored_at,purged_at,created_at)
    select x.id,x.entity_type,x.record_id,x.label,coalesce(x.summary,'{}'::jsonb),coalesce(x.deleted_at,now()),x.restored_at,x.purged_at,coalesce(x.created_at,now())
    from jsonb_to_recordset(coalesce(v_payload->'recycle_bin','[]'::jsonb))
      as x(id uuid,entity_type text,record_id uuid,label text,summary jsonb,deleted_at timestamptz,restored_at timestamptz,purged_at timestamptz,created_at timestamptz);

    insert into public.borrowers(id,name,father_name,phone,whatsapp,address,aadhaar,pan,photo_url,notes,created_at,updated_at,deleted_at,recycle_batch_id)
    select x.id,x.name,x.father_name,x.phone,x.whatsapp,x.address,x.aadhaar,x.pan,x.photo_url,x.notes,coalesce(x.created_at,now()),coalesce(x.updated_at,now()),x.deleted_at,x.recycle_batch_id
    from jsonb_to_recordset(coalesce(v_payload->'borrowers','[]'::jsonb))
      as x(id uuid,name text,father_name text,phone text,whatsapp text,address text,aadhaar text,pan text,photo_url text,notes text,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz,recycle_batch_id uuid);

    insert into public.loans(id,borrower_id,loan_code,amount,interest_rate,loan_date,loan_year,end_date,status,agreement_url,notes,created_at,updated_at,deleted_at,recycle_batch_id)
    select x.id,x.borrower_id,x.loan_code,x.amount,coalesce(x.interest_rate,0),x.loan_date,x.loan_year,x.end_date,coalesce(x.status,'active'),x.agreement_url,x.notes,coalesce(x.created_at,now()),coalesce(x.updated_at,now()),x.deleted_at,x.recycle_batch_id
    from jsonb_to_recordset(coalesce(v_payload->'loans','[]'::jsonb))
      as x(id uuid,borrower_id uuid,loan_code text,amount integer,interest_rate numeric,loan_date date,loan_year integer,end_date date,status text,agreement_url text,notes text,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz,recycle_batch_id uuid);

    insert into public.emis(id,loan_id,installment_number,due_date,due_day,due_month,due_year,amount,status,paid_date,paid_amount,notes,created_at)
    select x.id,x.loan_id,x.installment_number,x.due_date,x.due_day,x.due_month,x.due_year,x.amount,
           case when x.status in ('pending','partial','paid','overdue') then x.status else 'pending' end,
           x.paid_date,x.paid_amount,x.notes,coalesce(x.created_at,now())
    from jsonb_to_recordset(coalesce(v_payload->'emis','[]'::jsonb))
      as x(id uuid,loan_id uuid,installment_number integer,due_date date,due_day integer,due_month text,due_year integer,amount integer,status text,paid_date date,paid_amount integer,notes text,created_at timestamptz);

    insert into public.collection_followups(id,borrower_id,loan_id,emi_id,followup_date,channel,outcome,notes,next_followup_date,promise_date,promise_amount,promise_status,status,created_at,updated_at)
    select x.id,x.borrower_id,x.loan_id,x.emi_id,coalesce(x.followup_date,current_date),
           case when x.channel in ('whatsapp','call','manual','visit','other') then x.channel else 'manual' end,
           case when x.outcome in ('contacted','no_answer','callback','promised_to_pay','payment_received','dispute','wrong_number','other') then x.outcome else 'other' end,
           x.notes,x.next_followup_date,x.promise_date,x.promise_amount,
           case when x.promise_status in ('none','pending','kept','broken','cancelled') then x.promise_status else 'none' end,
           case when x.status in ('open','done','cancelled') then x.status else 'done' end,
           coalesce(x.created_at,now()),coalesce(x.updated_at,now())
    from jsonb_to_recordset(coalesce(v_payload->'collection_followups','[]'::jsonb))
      as x(id uuid,borrower_id uuid,loan_id uuid,emi_id uuid,followup_date date,channel text,outcome text,notes text,next_followup_date date,promise_date date,promise_amount integer,promise_status text,status text,created_at timestamptz,updated_at timestamptz);

    insert into public.loan_settlements(id,loan_id,settlement_date,scheduled_remaining_before,final_payment_amount,waived_amount,method,notes,created_at,reopened_at,reopen_note)
    select x.id,x.loan_id,coalesce(x.settlement_date,current_date),coalesce(x.scheduled_remaining_before,0),coalesce(x.final_payment_amount,0),coalesce(x.waived_amount,0),x.method,x.notes,coalesce(x.created_at,now()),x.reopened_at,x.reopen_note
    from jsonb_to_recordset(coalesce(v_payload->'loan_settlements','[]'::jsonb))
      as x(id uuid,loan_id uuid,settlement_date date,scheduled_remaining_before integer,final_payment_amount integer,waived_amount integer,method text,notes text,created_at timestamptz,reopened_at timestamptz,reopen_note text);

    insert into public.emi_payments(id,emi_id,amount,payment_date,method,notes,source,settlement_id,created_at,updated_at,reversed_at)
    select x.id,x.emi_id,x.amount,coalesce(x.payment_date,current_date),x.method,x.notes,coalesce(x.source,'manual'),x.settlement_id,coalesce(x.created_at,now()),coalesce(x.updated_at,now()),x.reversed_at
    from jsonb_to_recordset(coalesce(v_payload->'emi_payments','[]'::jsonb))
      as x(id uuid,emi_id uuid,amount integer,payment_date date,method text,notes text,source text,settlement_id uuid,created_at timestamptz,updated_at timestamptz,reversed_at timestamptz);

    insert into public.emi_payments(emi_id,amount,payment_date,method,notes,source)
    select e.id,least(greatest(coalesce(e.paid_amount,e.amount),1),e.amount),coalesce(e.paid_date,current_date),'Previous record','Restored from older backup paid state','baseline'
    from public.emis e where (e.status in ('paid','partial') or coalesce(e.paid_amount,0)>0)
      and not exists (select 1 from public.emi_payments p where p.emi_id=e.id and p.reversed_at is null);

    insert into public.documents(id,borrower_id,loan_id,doc_type,file_name,file_url,uploaded_at,deleted_at,recycle_batch_id)
    select x.id,x.borrower_id,x.loan_id,x.doc_type,x.file_name,x.file_url,coalesce(x.uploaded_at,now()),x.deleted_at,x.recycle_batch_id
    from jsonb_to_recordset(coalesce(v_payload->'documents','[]'::jsonb))
      as x(id uuid,borrower_id uuid,loan_id uuid,doc_type text,file_name text,file_url text,uploaded_at timestamptz,deleted_at timestamptz,recycle_batch_id uuid);

    v_summary := jsonb_build_object(
        'settings',(select count(*) from public.app_settings),
        'followups',(select count(*) from public.collection_followups),
        'borrowers',(select count(*) from public.borrowers where deleted_at is null),
        'loans',(select count(*) from public.loans where deleted_at is null),
        'emis',(select count(*) from public.emis e join public.loans l on l.id=e.loan_id where l.deleted_at is null),
        'loan_settlements',(select count(*) from public.loan_settlements s join public.loans l on l.id=s.loan_id where s.reopened_at is null and l.deleted_at is null),
        'emi_payments',(select count(*) from public.emi_payments p join public.emis e on e.id=p.emi_id join public.loans l on l.id=e.loan_id where p.reversed_at is null and l.deleted_at is null),
        'documents',(select count(*) from public.documents where deleted_at is null),
        'recycle_items',(select count(*) from public.recycle_bin where restored_at is null and purged_at is null)
    );
    insert into public.activity_log(action,table_name,record_id,description)
    values ('RESTORE_BACKUP','backup_snapshots',p_snapshot_id::text,'Backup snapshot restored');
    return jsonb_build_object('success',true,'snapshot_id',p_snapshot_id,'summary',v_summary);
end;
$$;

revoke all on function public.abhi_create_backup_snapshot(text,text) from public,anon,authenticated;
revoke all on function public.abhi_restore_backup_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.abhi_create_backup_snapshot(text,text) to service_role;
grant execute on function public.abhi_restore_backup_snapshot(uuid) to service_role;
