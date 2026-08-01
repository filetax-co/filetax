-- ============================================================================
-- Remember which transaction type the filer actually picked.
--
-- `reportable_transactions.transaction_type` holds the CANONICAL code, which is
-- what the DB CHECK constraint allows and what the PDF generator switches on.
-- The intake UI offers a richer vocabulary that collapses onto it, many-to-one:
--
--     rent, royalty                       -> rent_royalty
--     tangible_purchase, tangible_sale    -> tangible_property
--     service_payment, tech_services      -> service_payment
--     platform_contribution, cost_sharing,
--     digital_asset, dissolution_tx, other -> other
--
-- So reopening a saved filing could not reliably show what the filer chose.
-- Three things went wrong on every reopened filing:
--
--   1. the transaction list printed the raw canonical code, which is why
--      "rent_royalty" appeared on screen where a label belonged
--   2. the type card rendered with nothing selected, so pressing Edit offered
--      to re-pick a type that had in fact already been chosen, and a filer who
--      just saved and came back would reasonably conclude their answer was lost
--   3. the specific classification was genuinely gone. `is_royalty` rescued
--      rent vs royalty, but nothing distinguished a CRYPTO transaction from any
--      other "other": digital_asset maps to `other` because Form 5472 has no
--      digital-asset line, so a filer who carefully classified their crypto saw
--      it come back as "IP, insurance & other".
--
-- This column stores the intake code alongside the canonical one. The canonical
-- column is unchanged and remains the single input to the generator and the
-- CHECK constraint; this is a display and round-trip aid only. NOTHING may read
-- this column to decide what goes on a form.
--
-- Deliberately NOT added to either column list in 20260702_lock_paid_filings.
-- It is not identity, and it is written as a side effect of saving a row the
-- filer already has the right to save, so it must not burn a post-payment edit
-- on its own.
--
-- Nullable with no default and no backfill, on purpose. Rows written before
-- this column existed have no honest value to put here, and inventing one would
-- assert a specificity that was never captured. `resolveUiTxType` in
-- src/lib/filingMapping.ts derives a best-effort code for those, and prefers
-- this column whenever it is present.
--
-- Idempotent; safe to run / re-run.
-- ============================================================================

alter table public.reportable_transactions
  add column if not exists ui_transaction_type text;

comment on column public.reportable_transactions.ui_transaction_type is
  'The intake UI transaction-type code the filer selected, e.g. royalty, '
  'digital_asset, tangible_purchase. Display and round-trip only. '
  'transaction_type remains the canonical value that drives the forms.';
