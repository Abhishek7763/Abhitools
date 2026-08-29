-- AbhiTools core bootstrap for a brand-new Supabase project.
-- Purpose: recreate only the foundational objects that pre-date the tracked phase migrations.
-- Financial/payment/settlement/UPI business rules are intentionally NOT defined here;
-- those remain owned by the existing later migrations in this repository.

create extension if not exists pgcrypto;

create or replace function public.update_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create table if not exists public.borrowers (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    father_name text,
    phone text,
    whatsapp text,
    address text,
    aadhaar text,
    pan text,
    photo_url text,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.loans (
    id uuid primary key default gen_random_uuid(),
    borrower_id uuid not null references public.borrowers(id) on delete cascade,
    loan_code text not null,
    amount integer not null check (amount > 0),
    interest_rate numeric not null default 0 check (interest_rate >= 0),
    loan_date date not null,
    loan_year integer not null,
    end_date date,
    status text not null default 'active' check (status in ('active','closed','defaulted')),
    agreement_url text,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.emis (
    id uuid primary key default gen_random_uuid(),
    loan_id uuid not null references public.loans(id) on delete cascade,
    installment_number integer not null check (installment_number > 0),
    due_date date not null,
    due_day integer not null check (due_day between 1 and 31),
    due_month text not null check (due_month in ('JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC')),
    due_year integer not null,
    amount integer not null check (amount > 0),
    status text not null default 'pending',
    paid_date date,
    paid_amount integer,
    notes text,
    created_at timestamptz not null default now(),
    constraint emis_status_check check (status in ('pending','paid','overdue'))
);

create table if not exists public.documents (
    id uuid primary key default gen_random_uuid(),
    borrower_id uuid not null references public.borrowers(id) on delete cascade,
    loan_id uuid references public.loans(id) on delete cascade,
    doc_type text not null,
    file_name text not null,
    file_url text not null,
    uploaded_at timestamptz not null default now(),
    constraint documents_doc_type_check check (doc_type in ('agreement','aadhaar','pan','photo','other'))
);

create table if not exists public.activity_log (
    id uuid primary key default gen_random_uuid(),
    action text not null,
    table_name text,
    record_id text,
    description text,
    created_at timestamptz not null default now()
);

create index if not exists activity_log_created_at_idx on public.activity_log(created_at desc);

-- Keep updated_at current for the two foundational mutable profile/account tables.
drop trigger if exists borrowers_set_updated_at on public.borrowers;
create trigger borrowers_set_updated_at
before update on public.borrowers
for each row execute function public.update_updated_at();

drop trigger if exists loans_set_updated_at on public.loans;
create trigger loans_set_updated_at
before update on public.loans
for each row execute function public.update_updated_at();

-- Legacy views existed before the tracked hardening migration. They are retained only for
-- compatibility; current app APIs use direct server-side table reads.
create or replace view public.active_loans_view as
select l.*, b.name as borrower_name
from public.loans l
join public.borrowers b on b.id = l.borrower_id
where l.status = 'active';

create or replace view public.monthly_summary as
select
    e.due_year,
    e.due_month,
    count(*)::bigint as emi_count,
    coalesce(sum(e.amount),0)::bigint as scheduled_amount,
    coalesce(sum(coalesce(e.paid_amount,0)),0)::bigint as paid_amount
from public.emis e
group by e.due_year, e.due_month;

create or replace view public.todays_due_emis as
select e.*
from public.emis e
where e.due_date = (now() at time zone 'Asia/Kolkata')::date;

-- New Supabase projects no longer guarantee automatic Data API grants. The app accesses
-- these tables only from Vercel server functions with the service-role key.
alter table public.borrowers enable row level security;
alter table public.loans enable row level security;
alter table public.emis enable row level security;
alter table public.documents enable row level security;
alter table public.activity_log enable row level security;

revoke all on table public.borrowers from public, anon, authenticated;
revoke all on table public.loans from public, anon, authenticated;
revoke all on table public.emis from public, anon, authenticated;
revoke all on table public.documents from public, anon, authenticated;
revoke all on table public.activity_log from public, anon, authenticated;
revoke all on table public.active_loans_view from public, anon, authenticated;
revoke all on table public.monthly_summary from public, anon, authenticated;
revoke all on table public.todays_due_emis from public, anon, authenticated;

grant all on table public.borrowers to service_role;
grant all on table public.loans to service_role;
grant all on table public.emis to service_role;
grant all on table public.documents to service_role;
grant all on table public.activity_log to service_role;
grant select on table public.active_loans_view to service_role;
grant select on table public.monthly_summary to service_role;
grant select on table public.todays_due_emis to service_role;

drop policy if exists borrowers_service_role_all on public.borrowers;
create policy borrowers_service_role_all on public.borrowers for all to service_role using (true) with check (true);
drop policy if exists loans_service_role_all on public.loans;
create policy loans_service_role_all on public.loans for all to service_role using (true) with check (true);
drop policy if exists emis_service_role_all on public.emis;
create policy emis_service_role_all on public.emis for all to service_role using (true) with check (true);
drop policy if exists documents_service_role_all on public.documents;
create policy documents_service_role_all on public.documents for all to service_role using (true) with check (true);
drop policy if exists activity_log_service_role_all on public.activity_log;
create policy activity_log_service_role_all on public.activity_log for all to service_role using (true) with check (true);

-- Storage contract used by api/upload.js and api/documents.js.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = excluded.public;
