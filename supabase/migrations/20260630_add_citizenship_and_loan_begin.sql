-- ============================================================================
-- Adds fields required to make the generated Form 5472 / Pro Forma 1120 match
-- the intake input exactly:
--   • owner_country_citizenship — Part II "country of citizenship" (was never
--     collected, so the form printed residence/US as a wrong fallback).
--   • reportable_transactions.loan_begin_usd — Form 5472 lines 17a / 31a
--     (beginning-of-year loan balance). Intake previously collected only the
--     closing balance, leaving the beginning line blank or wrong.
--   • reportable_transactions.is_royalty — distinguishes rent (13a/27a) from
--     royalty (13b/27b) when the canonical type is 'rent_royalty'. Idempotent
--     here in case an older DB predates the schema.sql block that adds it.
-- All statements are idempotent and safe to re-run.
-- ============================================================================

-- Owner citizenship (Form 5472 Part II, line 4b country of citizenship).
alter table public.filings
  add column if not exists owner_country_citizenship text;

-- Additional related parties (besides the owner), stored as JSON on the filing.
-- The Intake wizard writes this in step 3; the PDF generator emits one Form
-- 5472 per entry.
alter table public.filings
  add column if not exists related_parties jsonb not null default '[]'::jsonb;

-- Canonical entity columns the PDF generator reads. The wizard historically
-- wrote entity_date_of_incorporation / entity_business_* only; mirror them
-- into the canonical columns so the generator never reads a null.
alter table public.filings
  add column if not exists date_of_incorporation date,
  add column if not exists naics_code            text,
  add column if not exists naics_description     text,
  add column if not exists owner_primary_country text,
  add column if not exists owner_us_tin          text,
  add column if not exists owner_reference_id    text,
  add column if not exists owner_naics_code      text;

-- Which related party a transaction is with: 0 = owner, 1..n = related party
-- index. Drives one Form 5472 per party. The wizard has always written this;
-- it was missing from the table definition.
alter table public.reportable_transactions
  add column if not exists related_party_index int not null default 0;

-- Beginning-of-year loan balance for loan_to_llc / loan_from_llc rows.
alter table public.reportable_transactions
  add column if not exists loan_begin_usd numeric;

-- Rent-vs-royalty discriminator for rent_royalty rows.
alter table public.reportable_transactions
  add column if not exists is_royalty boolean;
