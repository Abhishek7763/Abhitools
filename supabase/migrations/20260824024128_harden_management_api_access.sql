alter view public.active_loans_view set (security_invoker = true);
alter view public.monthly_summary set (security_invoker = true);
alter view public.todays_due_emis set (security_invoker = true);

revoke all privileges on table public.borrowers from anon, authenticated;
revoke all privileges on table public.loans from anon, authenticated;
revoke all privileges on table public.emis from anon, authenticated;
revoke all privileges on table public.documents from anon, authenticated;
revoke all privileges on table public.activity_log from anon, authenticated;
revoke all privileges on table public.active_loans_view from anon, authenticated;
revoke all privileges on table public.monthly_summary from anon, authenticated;
revoke all privileges on table public.todays_due_emis from anon, authenticated;

alter function public.update_updated_at() set search_path = public, pg_temp;
revoke execute on function public.update_updated_at() from public;
grant execute on function public.update_updated_at() to service_role;
