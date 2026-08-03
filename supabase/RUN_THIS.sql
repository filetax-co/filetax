-- ============================================================================
-- RUN_THIS.sql - schema changes for the 2026-07 filing-improvements update.
--
-- Idempotent: safe to run on an existing database (every statement is
-- IF NOT EXISTS / guarded). Run it once in the Supabase SQL editor.
--
-- What it adds:
--   1. filing_jobs.reasonable_cause_reasons  - reasonable-cause reasons are now
--      collected ONCE per multi-year job (not per year). One letter, one set of
--      reasons, covering every year in the job.
--   2. filings.signer_title                  - the owner's signing title/role
--      (e.g. "Managing Member"), printed on the pro forma 1120 signature block
--      and the reasonable-cause letter. (No-op if your DB already has it.)
--   3. filings.include_7004                   - Form 7004 (extension) is only
--      generated/downloadable when this is true. (No-op if already present.)
--   4. filings.include_reasonable_cause + reasonable_cause_reasons - single-year
--      RCL opt-in + reasons (No-op if already present.)
-- ============================================================================

-- 1. Multi-year job: reasonable-cause reasons collected once, at the job level.
alter table public.filing_jobs
  add column if not exists reasonable_cause_reasons text[] default '{}';

-- 2. Owner signing title/role (printed on 1120 + RCL). Defaults handled in app.
alter table public.filings
  add column if not exists signer_title text;

-- 3. Form 7004 extension flag (7004 is only produced when this is true).
alter table public.filings
  add column if not exists include_7004 boolean default false;

-- 4. Single-year reasonable-cause opt-in + reasons (used by intake step 1b).
alter table public.filings
  add column if not exists include_reasonable_cause boolean default false;
alter table public.filings
  add column if not exists reasonable_cause_reasons text[] default '{}';

-- 5. Signature date printed on the Form 1120 "Date" line (collected in intake
--    with the owner's details) so forms are ready to print and mail as-is.
alter table public.filings
  add column if not exists signature_date date;

-- Done.
