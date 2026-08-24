-- Phase 22: server-side Settings & Business Rules Center + backup format v6.
-- Existing borrower/loan/EMI data is not modified.

create table if not exists public.app_settings (
    id text primary key,
    config jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    constraint app_settings_primary_id check (id = 'primary')
);

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated;
grant all on table public.app_settings to service_role;

drop policy if exists app_settings_service_role_all on public.app_settings;
create policy app_settings_service_role_all
on public.app_settings
for all
to service_role
using (true)
with check (true);

insert into public.app_settings(id, config)
values (
    'primary',
    jsonb_build_object(
        'business_name','Abhishek Management',
        'message_signature','Abhishek Management',
        'default_payment_method','Cash',
        'reminder_window_days',7,
        'reminder_default_bucket','all',
        'default_contact_channel','whatsapp',
        'default_layout','list',
        'home_command_default','expanded',
        'browser_alerts_default',false,
        'whatsapp_templates',jsonb_build_object(
            'due', E'Namaskar {name},\n\naapki EMI{emi_no_text} {due_date} ko due hai.\nLoan ID: {loan_id}\nDue amount: {amount}\n\nKripya due date tak payment complete karein. Agar payment already ho chuka hai to is message ko ignore karein.\n\n- {signature}',
            'overdue', E'Namaskar {name},\n\naapki EMI{emi_no_text} overdue hai.\nLoan ID: {loan_id}\nDue date: {due_date}\nPending amount: {amount}\n\nKripya payment jaldi complete karein. Agar payment already ho chuka hai to is message ko ignore karein.\n\n- {signature}',
            'payment', E'Namaskar {name},\n\naapka {payment_amount} payment receive ho gaya hai. ✅\nLoan ID: {loan_id}{emi_line}\nPayment date: {payment_date}\nEMI remaining: {emi_remaining}\n\nDhanyavaad.\n- {signature}',
            'closing', E'Namaskar {name},\n\nLoan ID {loan_id} ka account {closing_status} hai.\nPrincipal: {principal}\nCollected: {collected}\nRemaining EMI balance: {remaining}\n\nAapke cooperation ke liye dhanyavaad.\n- {signature}'
        )
    )
)
on conflict (id) do nothing;
