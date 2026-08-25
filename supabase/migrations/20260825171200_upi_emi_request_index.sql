-- Advisor follow-up: cover the UPI request EMI foreign key for lookups/cascades.
create index if not exists upi_payment_requests_emi_idx
on public.upi_payment_requests(emi_id);
