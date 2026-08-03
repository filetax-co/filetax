-- ============================================================================
-- Multi-year catch-up, per-user prefill profile, fiscal-year & final-return.
--
-- Adds:
--   • filing_jobs            — groups one or more year-filings that share a
--                              SINGLE reasonable-cause letter + delivery prefs.
--   • filings.job_id         — links a year-filing into its job.
--   • filings.final_return   — Form 1120 item E "Final return".
--   • filings.is_fiscal_year — non-calendar filer flag (drives the review notice;
--                              tax_period_begin/end already exist for the dates).
--   • filings.part_vi_managerial — owner managerial-services Part VI disclosure
--                              toggle (default true; user may opt out).
--   • user_profiles.*        — every prefillable entity + owner field, so year 2+
--                              is auto-populated for review.
--
-- All statements idempotent; safe to re-run.
-- ============================================================================

-- ── filing_jobs ─────────────────────────────────────────────────────────────
-- One job per catch-up batch. The RCL narrative + the set of late years live
-- here so a single reasonable-cause letter can cover every year in the job.
create table if not exists public.filing_jobs (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  -- Years selected for catch-up, e.g. [2021, 2023]. Informational; the
  -- authoritative per-year records are the linked `filings` rows.
  tax_years     int[]       not null default '{}',
  -- One reasonable-cause letter covers all late years in the job.
  include_rcl   boolean     not null default false,
  rcl_narrative text,
  -- Delivery preference shared across the job.
  delivery      text        not null default 'self_mail'
                check (delivery in ('self_mail','fax')),
  status        text        not null default 'draft'
);

alter table public.filing_jobs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='filing_jobs' and policyname='Users manage own filing jobs') then
    execute $p$ create policy "Users manage own filing jobs" on public.filing_jobs
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id) $p$;
  end if;
end $$;

drop trigger if exists filing_jobs_set_updated_at on public.filing_jobs;
create trigger filing_jobs_set_updated_at
  before update on public.filing_jobs
  for each row execute procedure public.set_updated_at();

-- ── filings: link to job + new flags ─────────────────────────────────────────
alter table public.filings
  add column if not exists job_id              uuid references public.filing_jobs(id) on delete set null,
  add column if not exists final_return        boolean not null default false,
  add column if not exists is_fiscal_year      boolean not null default false,
  -- Owner managerial-services Part VI disclosure. Default true (owner of a DE
  -- necessarily provides managerial services); user may deselect, in which case
  -- the Part VI box is NOT ticked and no Part VI statement is generated.
  add column if not exists part_vi_managerial  boolean not null default true;

create index if not exists filings_job_id_idx on public.filings(job_id);

-- ── user_profiles: full prefill surface ──────────────────────────────────────
-- The wizard prefills a new filing's entity + owner data from here, and upserts
-- it back on submit. "Edits apply to future filings only" — editing a filing
-- does not retroactively change other filings.
alter table public.user_profiles
  add column if not exists mailing_address            jsonb,
  add column if not exists entity_business_activity   text,
  add column if not exists entity_business_code       text,
  add column if not exists naics_code                 text,
  add column if not exists naics_description          text,
  add column if not exists owner_full_name            text,
  add column if not exists owner_country              text,
  add column if not exists owner_primary_country      text,
  add column if not exists owner_country_residence    text,
  add column if not exists owner_country_citizenship  text,
  add column if not exists owner_foreign_tax_id       text,
  add column if not exists owner_us_tin               text,
  add column if not exists owner_reference_id         text,
  add column if not exists owner_ref_number           text,
  add column if not exists owner_address              jsonb,
  add column if not exists owner_business_activity    text,
  add column if not exists owner_business_code        text,
  add column if not exists owner_naics_code           text,
  add column if not exists signer_title               text,
  add column if not exists related_parties            jsonb not null default '[]'::jsonb;
