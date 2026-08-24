alter table public.loans alter column loan_date drop not null;
alter table public.loans alter column loan_year drop not null;
alter table public.emis alter column due_date drop not null;
alter table public.emis alter column due_year drop not null;
