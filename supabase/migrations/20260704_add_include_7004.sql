-- ============================================================================
-- Adds the one column introduced with Form 7004 generation: include_7004.
-- It flags whether to generate Form 7004 (6-month extension) for a filing or
-- as a standalone extension-only service. (extension_filed already exists and
-- also triggers 7004 — for users who filed an extension elsewhere and want a
-- copy.) Idempotent; safe to run / re-run.
-- ============================================================================

alter table public.filings
  add column if not exists include_7004 boolean;
