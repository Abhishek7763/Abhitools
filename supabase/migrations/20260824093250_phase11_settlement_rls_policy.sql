-- Phase 11: explicit service-role-only policy for settlement audit table.
drop policy if exists loan_settlements_service_role_all on public.loan_settlements;
create policy loan_settlements_service_role_all
on public.loan_settlements
for all
to service_role
using (true)
with check (true);
