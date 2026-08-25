-- Allow stale recycle metadata to be closed safely when its original row is already gone.
-- A same-ID row that no longer belongs to this recycle batch is still protected.

create or replace function public.abhi_purge_recycle_item(p_recycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_item public.recycle_bin%rowtype;
    v_deleted integer := 0;
    v_original_exists boolean := false;
    v_record_already_missing boolean := false;
begin
    select * into v_item
      from public.recycle_bin
     where id = p_recycle_id
     for update;

    if v_item.id is null then raise exception 'Recycle item not found'; end if;
    if v_item.restored_at is not null then raise exception 'Restored item cannot be purged from this recycle entry'; end if;
    if v_item.purged_at is not null then raise exception 'Recycle item already permanently deleted'; end if;

    if v_item.entity_type = 'borrower' then
        delete from public.borrowers
         where id = v_item.record_id
           and recycle_batch_id = p_recycle_id;
        get diagnostics v_deleted = row_count;
        if v_deleted = 0 then
            select exists (select 1 from public.borrowers where id = v_item.record_id)
              into v_original_exists;
        end if;
    elsif v_item.entity_type = 'loan' then
        delete from public.loans
         where id = v_item.record_id
           and recycle_batch_id = p_recycle_id;
        get diagnostics v_deleted = row_count;
        if v_deleted = 0 then
            select exists (select 1 from public.loans where id = v_item.record_id)
              into v_original_exists;
        end if;
    elsif v_item.entity_type = 'document' then
        delete from public.documents
         where id = v_item.record_id
           and recycle_batch_id = p_recycle_id;
        get diagnostics v_deleted = row_count;
        if v_deleted = 0 then
            select exists (select 1 from public.documents where id = v_item.record_id)
              into v_original_exists;
        end if;
    else
        raise exception 'Unsupported recycle item type';
    end if;

    if v_deleted = 0 then
        if v_original_exists then
            raise exception 'Original record no longer belongs to this recycle entry';
        end if;
        v_record_already_missing := true;
    end if;

    update public.recycle_bin
       set purged_at = now()
     where id = p_recycle_id;

    insert into public.activity_log(action, table_name, record_id, description)
    values (
        case when v_record_already_missing then 'PURGE_STALE_RECYCLE_ITEM' else 'PURGE_RECYCLE_ITEM' end,
        'recycle_bin',
        p_recycle_id::text,
        case when v_record_already_missing
             then 'Closed stale recycle entry; original record was already missing: '
             else 'Permanently deleted from recycle bin: '
        end || coalesce(v_item.label, v_item.entity_type)
    );

    return jsonb_build_object(
        'success', true,
        'recycle_id', p_recycle_id,
        'entity_type', v_item.entity_type,
        'record_id', v_item.record_id,
        'record_already_missing', v_record_already_missing
    );
end;
$$;

revoke all on function public.abhi_purge_recycle_item(uuid) from public, anon, authenticated;
grant execute on function public.abhi_purge_recycle_item(uuid) to service_role;
