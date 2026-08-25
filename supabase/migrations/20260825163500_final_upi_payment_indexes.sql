-- Final UPI request performance cleanup after Supabase advisor review.
create index if not exists upi_payment_requests_borrower_idx
on public.upi_payment_requests(borrower_id)
where borrower_id is not null;

create index if not exists upi_payment_requests_payment_idx
on public.upi_payment_requests(payment_id)
where payment_id is not null;
