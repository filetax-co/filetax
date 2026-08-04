-- ============================================================================
-- 2026-08-05  Split rent / royalty, retire is_royalty, add structural_event.
-- ============================================================================
--
-- Two vocabulary corrections to reportable_transactions.transaction_type.
--
-- 1. 'rent_royalty' was one canonical code covering two different Form 5472
--    lines, 13a / 27a for rents and 13b / 27b for royalties, told apart by a
--    nullable boolean `is_royalty`. That made a null column the only thing
--    keeping a rent off the royalty line, and null and false had to be treated
--    as the same answer. They are separate codes now and the flag is dropped.
--
-- 2. Acquisitions, disposals and other entity-level events used to be stored as
--    'capital_contribution' and 'distribution'. The Part V statement then
--    printed "Capital Contribution by Owner" over the purchase of a third
--    company, and the amount was rolled into contributions_received and so into
--    the line 1f gross. 'structural_event' produces a statement entry, no Part
--    IV line and no monetary subtotal.
--
-- Idempotent, and safe to run against a database that has no such rows.
-- ============================================================================

-- ── 0. Drop the old CHECK before touching any row ────────────────────────────
-- ORDER MATTERS, AND IT IS THE OPPOSITE OF WHAT IT LOOKS LIKE.
--
-- The backfill below writes the NEW codes ('rent', 'royalty',
-- 'structural_event'), and it is the OLD constraint that is still attached
-- while it runs. That constraint does not list any of them, so the first
-- updated row fails:
--
--   ERROR: new row for relation "reportable_transactions" violates check
--   constraint "reportable_transactions_transaction_type_check"
--
-- The constraint is therefore dropped first, the rows are rewritten with no
-- constraint in force, and the new constraint is added at the end, where it
-- validates the finished table in one pass. Adding it earlier would reject the
-- 'rent_royalty' rows that have not been converted yet, so there is no ordering
-- in which the constraint can be in place while the backfill runs.
alter table public.reportable_transactions
  drop constraint if exists reportable_transactions_transaction_type_check;

-- ── 1. rent / royalty ────────────────────────────────────────────────────────
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'reportable_transactions'
      and column_name  = 'is_royalty'
  ) then
    update public.reportable_transactions
       set transaction_type = case when is_royalty then 'royalty' else 'rent' end
     where transaction_type = 'rent_royalty';

    alter table public.reportable_transactions drop column is_royalty;
  end if;
end $$;

-- Databases that never had the column but do have the old code (nothing can
-- tell those apart any more, so they are rents, matching the old null default).
update public.reportable_transactions
   set transaction_type = 'rent'
 where transaction_type = 'rent_royalty';

-- ── 2. structural_event ──────────────────────────────────────────────────────
-- Existing acquisition / disposal / other-structural rows are identified by the
-- intake code the filer actually picked, which is preserved on the row.
-- ui_transaction_type is absent on rows written before 20260801, and those
-- cannot be reclassified: a 'capital_contribution' with no intake code really is
-- indistinguishable from a contribution, so it is deliberately left alone.
update public.reportable_transactions
   set transaction_type = 'structural_event'
 where ui_transaction_type in ('acquisition_tx', 'disposition_tx', 'other_part_v');

-- ── 3. CHECK constraint ──────────────────────────────────────────────────────
-- Dropped in step 0; added here, against a table whose rows are all converted.
do $$ begin
  alter table public.reportable_transactions
    add constraint reportable_transactions_transaction_type_check
    check (transaction_type in (
      'sales','service_payment','rent','royalty','loan_to_llc','loan_from_llc',
      'interest','insurance','dividend','commission','intangible','other',
      'capital_contribution','distribution','formation_costs','structural_event',
      'property_transfer','tangible_property','loan_guarantee','nonmonetary_other'
    ));
end $$;
