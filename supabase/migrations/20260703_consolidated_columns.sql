-- ============================================================================
-- CONSOLIDATED column safety-net.
--
-- One idempotent script that ensures EVERY column the application writes
-- actually exists. Safe to run on a live database even if some columns were
-- already added by earlier migrations (all use IF NOT EXISTS). Run this in the
-- Supabase SQL editor to guarantee the schema matches the code.
--
-- (The triggers/tables for filing_jobs and the paid-filing lock live in their
--  own migrations: 20260701_* and 20260702_*. Run those too.)
-- ============================================================================

-- ── filings: every column the wizard + generator read/write ─────────────────
alter table public.filings
  -- wizard step 1 (entity)
  add column if not exists entity_date_of_incorporation text,
  add column if not exists entity_principal_country     text,
  add column if not exists entity_business_activity      text,
  add column if not exists entity_business_code          text,
  add column if not exists mailing_address               jsonb,
  -- canonical entity columns the PDF generator reads
  add column if not exists date_of_incorporation         date,
  add column if not exists naics_code                    text,
  add column if not exists naics_description             text,
  -- wizard step 1b (late filing)
  add column if not exists extension_filed               boolean,
  add column if not exists include_reasonable_cause      boolean,
  add column if not exists reasonable_cause_reasons      text[],
  -- wizard step 2 (owner)
  add column if not exists owner_country                 text,
  add column if not exists owner_ssn                     text,
  add column if not exists owner_ref_number              text,
  add column if not exists owner_address                 jsonb,
  add column if not exists owner_business_activity        text,
  add column if not exists owner_business_code            text,
  -- canonical owner columns the PDF generator reads
  add column if not exists owner_primary_country         text,
  add column if not exists owner_country_citizenship     text,
  add column if not exists owner_us_tin                  text,
  add column if not exists owner_reference_id            text,
  add column if not exists owner_naics_code              text,
  -- wizard step 3 (related parties) + step 4
  add column if not exists related_parties               jsonb not null default '[]'::jsonb,
  add column if not exists no_transactions_confirmed     boolean not null default false,
  add column if not exists part_vi_managerial            boolean not null default true,
  -- final / fiscal year
  add column if not exists final_return                  boolean not null default false,
  add column if not exists is_fiscal_year                boolean not null default false,
  add column if not exists tax_period_begin              date,
  add column if not exists tax_period_end                date,
  -- multi-year job link
  add column if not exists job_id                        uuid,
  -- post-payment correction budget (payment integrity)
  add column if not exists post_payment_edits            int not null default 0,
  -- signer
  add column if not exists signer_title                  text;

-- ── reportable_transactions: new per-row columns ────────────────────────────
alter table public.reportable_transactions
  add column if not exists related_party_index int     not null default 0,
  add column if not exists loan_begin_usd      numeric,
  add column if not exists is_royalty          boolean;

-- The DB CHECK on transaction_type must allow the full canonical vocabulary the
-- generator + mapping layer produce. Re-assert it idempotently.
do $$
begin
  alter table public.reportable_transactions
    drop constraint if exists reportable_transactions_transaction_type_check;
  alter table public.reportable_transactions
    add constraint reportable_transactions_transaction_type_check
    check (transaction_type in (
      'sales','service_payment','rent_royalty','loan_to_llc','loan_from_llc',
      'interest','insurance','dividend','commission','intangible','other',
      'capital_contribution','distribution','formation_costs','property_transfer',
      'tangible_property','loan_guarantee','nonmonetary_other'
    ));
exception when others then
  -- If existing rows violate the constraint, leave the old one in place and
  -- surface a notice rather than failing the whole migration.
  raise notice 'Could not re-assert transaction_type check: %', sqlerrm;
end $$;
