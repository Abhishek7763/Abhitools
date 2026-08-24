alter table public.documents drop constraint if exists documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check
check (doc_type = any (array['agreement'::text,'aadhaar'::text,'pan'::text,'receipt'::text,'photo'::text,'other'::text]));
