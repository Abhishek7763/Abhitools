create table public.private_ledger_entries (
    id uuid primary key,
    person text not null check (length(trim(person)) between 1 and 100),
    direction text not null check (direction in ('given', 'received')),
    amount numeric(12,2) not null check (amount > 0),
    created_at timestamptz not null default now()
);
alter table public.private_ledger_entries enable row level security;
revoke all on public.private_ledger_entries from public, anon, authenticated;
grant select, insert on public.private_ledger_entries to service_role;
