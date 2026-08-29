-- Fresh-project bootstrap compatibility cleanup.
-- Phase 13 already provides activity_log_created_at_desc_idx on the same expression.
-- Keep one canonical index and remove the bootstrap duplicate; no data or business logic changes.
drop index if exists public.activity_log_created_at_idx;
