begin;

-- Only uploads in the two folders managed by Abhi Tools belong to a portable backup.
create or replace view public.abhi_backup_uploads with (security_invoker = true) as
select o.bucket_id as bucket, o.name,
       (o.metadata->>'size')::bigint as size, o.metadata->>'mimetype' as type,
       o.id::text || '/' || coalesce(o.version::text, o.updated_at::text, '') as revision
from storage.objects o
where o.bucket_id in ('photos','documents') and o.name like 'borrowers/%'
  and not (o.name like '%/.emptyFolderPlaceholder' and coalesce((o.metadata->>'size')::bigint,0)=0);

revoke all on public.abhi_backup_uploads from public,anon,authenticated;
grant select on public.abhi_backup_uploads to service_role;

create or replace function public.abhi_portable_catalog()
returns jsonb language sql stable security invoker set search_path = '' as $$
    select jsonb_build_object('data',public.abhi_backup_data(),'files',
        coalesce((select jsonb_agg(u order by u.bucket,u.name) from public.abhi_backup_uploads u),'[]'::jsonb));
$$;

create or replace function public.abhi_portable_object(p_bucket text,p_name text)
returns jsonb language sql stable security invoker set search_path = '' as $$
    select to_jsonb(u) from public.abhi_backup_uploads u where u.bucket=p_bucket and u.name=p_name;
$$;

create or replace function public.abhi_media_present(p_files jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
    select jsonb_typeof(p_files) = 'array' and not exists (
        select 1 from jsonb_to_recordset(p_files) as f(bucket text,name text,revision text)
        left join public.abhi_backup_uploads u on (u.bucket,u.name,u.revision)=(f.bucket,f.name,f.revision)
        where u.name is null);
$$;
revoke all on function public.abhi_media_present(jsonb) from public,anon,authenticated;
grant execute on function public.abhi_media_present(jsonb) to service_role;

-- Recheck the exact Storage revisions verified by the browser before swapping any records.
create or replace function public.abhi_restore_portable(p_payload jsonb,p_counts jsonb,p_label text,p_files jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
    lock table public.abhi_reset_jobs in share mode;
    if exists (select 1 from public.abhi_reset_jobs where cardinality(file_ids)>0) then
        raise exception 'Finish the pending data reset first';
    end if;
    perform public.abhi_lock_business_data();
    if public.abhi_media_present(p_files) is distinct from true then raise exception 'Backup uploads changed before restore'; end if;
    return public.abhi_restore_backup_file(p_payload,p_counts,p_label);
end;
$$;

revoke all on function public.abhi_portable_catalog(), public.abhi_portable_object(text,text),
    public.abhi_restore_portable(jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.abhi_portable_catalog(), public.abhi_portable_object(text,text),
    public.abhi_restore_portable(jsonb,jsonb,text,jsonb) to service_role;

commit;
