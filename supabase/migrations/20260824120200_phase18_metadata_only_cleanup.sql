create or replace function public.abhi_apply_legacy_due_dates(
    p_loan_id uuid,
    p_updates jsonb,
    p_loan_year integer default null,
    p_loan_date date default null,
    p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_loan public.loans%rowtype;
    v_missing_count integer;
    v_update_count integer;
    v_distinct_count integer;
    v_item jsonb;
    v_emi public.emis%rowtype;
    v_emi_id uuid;
    v_year integer;
    v_month integer;
    v_due_date date;
    v_snapshot_id uuid;
    v_updated integer := 0;
    v_label text;
begin
    if p_loan_id is null then raise exception 'loan_id is required'; end if;
    if jsonb_typeof(p_updates) is distinct from 'array' then raise exception 'updates must be an array'; end if;
    v_update_count := jsonb_array_length(p_updates);

    select * into v_loan from public.loans where id = p_loan_id and deleted_at is null for update;
    if not found then raise exception 'Loan not found or is in Recycle Bin'; end if;

    if p_loan_year is not null and (p_loan_year < 2000 or p_loan_year > 2200) then raise exception 'Invalid loan year'; end if;
    if p_loan_date is not null and (extract(year from p_loan_date)::integer < 2000 or extract(year from p_loan_date)::integer > 2200) then raise exception 'Invalid loan date'; end if;
    if p_loan_year is not null and p_loan_date is not null and extract(year from p_loan_date)::integer <> p_loan_year then raise exception 'Loan year must match the exact loan date year'; end if;

    select count(*) into v_missing_count from public.emis where loan_id = p_loan_id and (due_year is null or due_date is null);
    if v_missing_count > 0 and v_update_count <> v_missing_count then
        raise exception 'All missing EMI dates must be reviewed together. Expected %, received %', v_missing_count, v_update_count;
    end if;
    if v_missing_count = 0 and v_update_count <> 0 then raise exception 'This loan has no legacy EMI date gaps'; end if;
    if v_update_count = 0 and p_loan_year is null and p_loan_date is null then raise exception 'Nothing to clean up'; end if;

    if v_update_count > 0 then
        select count(distinct (x->>'emi_id')) into v_distinct_count from jsonb_array_elements(p_updates) x;
        if v_distinct_count <> v_update_count then raise exception 'Duplicate EMI ids are not allowed'; end if;
    end if;

    for v_item in select value from jsonb_array_elements(p_updates)
    loop
        begin v_emi_id := (v_item->>'emi_id')::uuid; exception when others then raise exception 'Invalid EMI id'; end;
        begin v_year := (v_item->>'due_year')::integer; exception when others then raise exception 'Invalid EMI year'; end;
        if v_year < 2000 or v_year > 2200 then raise exception 'EMI year out of range'; end if;
        select * into v_emi from public.emis where id = v_emi_id and loan_id = p_loan_id for update;
        if not found then raise exception 'EMI does not belong to this loan'; end if;
        if v_emi.due_year is not null and v_emi.due_date is not null then raise exception 'A reviewed EMI is already fully dated'; end if;
        v_month := case upper(trim(coalesce(v_emi.due_month,'')))
            when 'JAN' then 1 when 'FEB' then 2 when 'MAR' then 3 when 'APR' then 4 when 'MAY' then 5 when 'JUN' then 6
            when 'JUL' then 7 when 'AUG' then 8 when 'SEP' then 9 when 'OCT' then 10 when 'NOV' then 11 when 'DEC' then 12 else null end;
        if v_month is null or v_emi.due_day is null or v_emi.due_day < 1 or v_emi.due_day > 31 then raise exception 'Legacy EMI has invalid day/month and cannot be auto-fixed'; end if;
        begin v_due_date := make_date(v_year, v_month, v_emi.due_day);
        exception when datetime_field_overflow then raise exception 'Invalid calendar date for EMI #% (% % %)', v_emi.installment_number, v_emi.due_day, v_emi.due_month, v_year; end;
    end loop;

    if p_loan_year is not null and v_loan.loan_year is not null and v_loan.loan_year <> p_loan_year then raise exception 'Existing loan year cannot be overwritten from Data Quality Center'; end if;
    if p_loan_date is not null and v_loan.loan_date is not null and v_loan.loan_date <> p_loan_date then raise exception 'Existing loan date cannot be overwritten from Data Quality Center'; end if;

    v_label := 'Before Phase 18 data cleanup - ' || coalesce(nullif(trim(v_loan.loan_code),''), p_loan_id::text);
    v_snapshot_id := public.abhi_create_backup_snapshot(v_label, 'pre-phase18-data-quality');

    if p_loan_year is not null and v_loan.loan_year is null then update public.loans set loan_year = p_loan_year where id = p_loan_id; end if;
    if p_loan_date is not null and v_loan.loan_date is null then update public.loans set loan_date = p_loan_date where id = p_loan_id; end if;

    for v_item in select value from jsonb_array_elements(p_updates)
    loop
        v_emi_id := (v_item->>'emi_id')::uuid;
        v_year := (v_item->>'due_year')::integer;
        select * into v_emi from public.emis where id = v_emi_id and loan_id = p_loan_id;
        v_month := case upper(trim(v_emi.due_month))
            when 'JAN' then 1 when 'FEB' then 2 when 'MAR' then 3 when 'APR' then 4 when 'MAY' then 5 when 'JUN' then 6
            when 'JUL' then 7 when 'AUG' then 8 when 'SEP' then 9 when 'OCT' then 10 when 'NOV' then 11 when 'DEC' then 12 end;
        v_due_date := make_date(v_year, v_month, v_emi.due_day);
        update public.emis set due_year = v_year, due_date = v_due_date where id = v_emi_id;
        v_updated := v_updated + 1;
    end loop;

    if v_updated > 0 then perform public.abhi_refresh_due_statuses(); end if;

    insert into public.activity_log(action, table_name, record_id, description)
    values ('LEGACY_DATE_CLEANUP','loans',p_loan_id::text,
        'Data quality cleanup: ' || v_updated || ' EMI date row(s)' ||
        case when p_loan_year is not null then ' • loan year ' || p_loan_year else '' end ||
        case when p_loan_date is not null then ' • loan date ' || p_loan_date else '' end ||
        case when nullif(trim(coalesce(p_note,'')),'') is not null then ' • ' || left(trim(p_note),220) else '' end);

    return jsonb_build_object('success',true,'loan_id',p_loan_id,'updated_emis',v_updated,
        'loan_year',coalesce(p_loan_year,v_loan.loan_year),'loan_date',coalesce(p_loan_date,v_loan.loan_date),'snapshot_id',v_snapshot_id);
end;
$$;

revoke all on function public.abhi_apply_legacy_due_dates(uuid,jsonb,integer,date,text) from public, anon, authenticated;
grant execute on function public.abhi_apply_legacy_due_dates(uuid,jsonb,integer,date,text) to service_role;
