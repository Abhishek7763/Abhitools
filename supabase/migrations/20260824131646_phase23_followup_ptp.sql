-- Phase 23: Follow-up Notes & Promise-to-Pay (PTP) Center.
-- Adds admin-only operational follow-up history without changing existing loan/EMI values.

create table if not exists public.collection_followups (
    id uuid primary key default gen_random_uuid(),
    borrower_id uuid not null references public.borrowers(id) on delete cascade,
    loan_id uuid references public.loans(id) on delete cascade,
    emi_id uuid references public.emis(id) on delete cascade,
    followup_date date not null default current_date,
    channel text not null default 'manual',
    outcome text not null default 'contacted',
    notes text,
    next_followup_date date,
    promise_date date,
    promise_amount integer,
    promise_status text not null default 'none',
    status text not null default 'done',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint collection_followups_channel_check check (channel in ('whatsapp','call','manual','visit','other')),
    constraint collection_followups_outcome_check check (outcome in ('contacted','no_answer','callback','promised_to_pay','payment_received','dispute','wrong_number','other')),
    constraint collection_followups_status_check check (status in ('open','done','cancelled')),
    constraint collection_followups_promise_status_check check (promise_status in ('none','pending','kept','broken','cancelled')),
    constraint collection_followups_promise_amount_check check (promise_amount is null or promise_amount > 0),
    constraint collection_followups_next_date_check check (next_followup_date is null or next_followup_date >= followup_date),
    constraint collection_followups_promise_date_check check (promise_date is null or promise_date >= followup_date),
    constraint collection_followups_promise_pair_check check (
        (promise_status = 'none' and promise_date is null and promise_amount is null)
        or
        (promise_status <> 'none' and promise_date is not null and promise_amount is not null)
    )
);

create index if not exists idx_collection_followups_borrower_created
    on public.collection_followups(borrower_id, created_at desc);
create index if not exists idx_collection_followups_next_open
    on public.collection_followups(next_followup_date, status)
    where status = 'open';
create index if not exists idx_collection_followups_promise_pending
    on public.collection_followups(promise_date, promise_status)
    where promise_status = 'pending';
create index if not exists idx_collection_followups_loan
    on public.collection_followups(loan_id, created_at desc);
create index if not exists idx_collection_followups_emi
    on public.collection_followups(emi_id, created_at desc);

alter table public.collection_followups enable row level security;
revoke all on table public.collection_followups from anon, authenticated;
grant all on table public.collection_followups to service_role;

drop policy if exists collection_followups_service_role_all on public.collection_followups;
create policy collection_followups_service_role_all
on public.collection_followups
for all
to service_role
using (true)
with check (true);
