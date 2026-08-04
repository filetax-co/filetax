# Supabase setup - apply these to make the app's DB match the code

Run the migration files in `supabase/migrations/` in the SQL editor, in this order.
Every script is **idempotent** (uses `if not exists` / `create or replace`), so it's
safe to run on your existing database and safe to re-run.

## Run these, in order

1. **`20260703_consolidated_columns.sql`** - the safety-net. Adds **every column**
   the app reads/writes to `filings` and `reportable_transactions`, and re-asserts
   the `transaction_type` CHECK. If you run only one file, run this.
2. **`20260701_multiyear_profile_fiscal.sql`** - creates the `filing_jobs` table
   (multi-year catch-up; holds the one shared reasonable-cause letter) + its RLS,
   and expands `user_profiles` with the prefill columns.
3. **`20260702_lock_paid_filings.sql`** - payment-integrity triggers (identity
   freeze + 2-edit correction budget). Adds `filings.post_payment_edits`.

(`20260630_*` and `20260622_*` are older and fully covered by `20260703_*` - you can skip them.)

## What gets added

### New table: `filing_jobs`
Groups the year-filings of a multi-year catch-up so one reasonable-cause letter
covers them all. Columns: `id, user_id, tax_years int[], include_rcl, rcl_narrative,
delivery, status, created_at, updated_at`. RLS: owner-only.

### `filings` - new columns
Entity: `date_of_incorporation`, `naics_code`, `naics_description`,
`entity_date_of_incorporation`, `entity_principal_country`,
`entity_business_activity`, `entity_business_code`, `mailing_address`.
Late-filing: `extension_filed`, `include_reasonable_cause`, `reasonable_cause_reasons`.
Owner: `owner_country`, `owner_ssn`, `owner_ref_number`, `owner_address`,
`owner_business_activity`, `owner_business_code`, `owner_primary_country`,
`owner_country_citizenship`, `owner_us_tin`, `owner_reference_id`, `owner_naics_code`.
Related parties / flags: `related_parties` (jsonb), `no_transactions_confirmed`,
`part_vi_managerial`, `final_return`, `is_fiscal_year`, `tax_period_begin`,
`tax_period_end`, `job_id`, `signer_title`, `post_payment_edits`.

### `reportable_transactions` - new columns
`related_party_index` (0 = owner, 1..n = related parties), `loan_begin_usd`
(Form 5472 lines 17a/31a beginning balance).
Plus the `transaction_type` CHECK is re-asserted to the full canonical set.

`is_royalty` is dropped. Rent and royalty are separate `transaction_type` values
(`rent` on lines 13a/27a, `royalty` on 13b/27b) rather than one `rent_royalty`
code split by a nullable boolean. Existing `rent_royalty` rows are migrated by
the setup scripts before the CHECK is re-asserted.

### `user_profiles` - new columns
All prefillable entity + owner fields + `related_parties`, so year-2+ filings
auto-fill for review.

## Payment integrity - how it's enforced

Two DB triggers (in `20260702`) guarantee one payment = one company's filing:

- **`filings_freeze_when_paid`** - once `status` is `paid`/`completed`, the
  identity columns (`ein`, `llc_name`, `tax_year`, `owner_full_name`,
  `owner_foreign_tax_id`, `date_of_incorporation`) can never change. Other
  fields can be corrected up to **2 times** (`post_payment_edits` 0→1→2);
  the 3rd is rejected with a "contact support" error. Removing a related party
  is rejected; adding one is allowed (it's a billed add-on - gated in the UI).
- **`txn_block_when_filing_paid`** - transactions of a paid filing lock once the
  filing's correction budget is exhausted.

The existing `filings_block_payment_writes` trigger still makes `status` and the
payment columns server-only (the client can never self-mark a filing paid).

Re-downloads are unlimited (`download_count` may always increment).
