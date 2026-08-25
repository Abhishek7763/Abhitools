-- Keep frequent relationship lookups and foreign-key checks efficient.
-- These indexes do not alter any stored financial data.
create index if not exists loans_borrower_id_idx
    on public.loans (borrower_id);

create index if not exists emis_loan_id_idx
    on public.emis (loan_id);

create index if not exists documents_borrower_id_idx
    on public.documents (borrower_id);

create index if not exists documents_loan_id_idx
    on public.documents (loan_id);
