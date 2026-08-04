-- ============================================================================
-- 2026-08-05  Remember which missing years the filer says are already handled.
-- ============================================================================
--
-- The dashboard works out, per company, which tax years have no filing here:
-- every year from the later of 2019 and the formation date up to the most
-- recent filable year, minus the years that already have a filing for that EIN.
-- Each remaining year is shown as an empty row in that company's list.
--
-- Those rows have to be dismissible PER YEAR, not per company. The common real
-- case is partial: a filer who did 2023 and 2024 with an accountant before they
-- found us, and genuinely has not filed 2021 and 2022. A single "hide this"
-- boolean would be wrong in both directions, silencing the two years that
-- matter and staying silent when 2026 comes due next January.
--
-- Why not reuse `filings.earlier_returns_filed`, which intake already writes:
-- that is one boolean on one FILING, meaning "the filer said earlier returns
-- were handled". This is a per-COMPANY, per-YEAR fact, so it belongs on the
-- company and it has to name the years.
--
-- jsonb array of year STRINGS, e.g. '["2021","2022"]'. Strings because
-- `filings.tax_year` is text and every comparison in the app is made against
-- that; storing integers here would mean a cast at every read, and one
-- forgotten cast is a dismissed year that silently reappears.
--
-- NOT a claim that the year was filed anywhere. It records what the filer told
-- us, which is why the UI says they told us, and keeps an undo.
--
-- Idempotent; safe to run / re-run.
-- ============================================================================

alter table public.company_profiles
  add column if not exists years_filed_elsewhere jsonb not null default '[]'::jsonb;

comment on column public.company_profiles.years_filed_elsewhere is
  'Tax years (as strings) the filer said are already filed somewhere else, so '
  'the dashboard stops offering them. Records what the filer said; it is not '
  'evidence that a return exists.';

notify pgrst, 'reload schema';
