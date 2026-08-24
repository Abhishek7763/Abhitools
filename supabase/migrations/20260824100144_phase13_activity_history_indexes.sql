create index if not exists activity_log_created_at_desc_idx
    on public.activity_log (created_at desc);

create index if not exists activity_log_action_created_idx
    on public.activity_log (action, created_at desc);

create index if not exists activity_log_table_record_idx
    on public.activity_log (table_name, record_id);
