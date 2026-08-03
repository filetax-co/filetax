-- ============================================================================
-- Eligibility re-confirmation, captured at filing time.
--
-- NOTE ON SCOPE: nothing here comes from the eligibility checker. That screen
-- holds its answers in React state, writes nothing, and emits no query params,
-- and the page tells the user so. These two columns are filled in by a
-- signed-in user inside intake, as part of a filing they are creating, in the
-- same way as final_return or extension_filed.
--
-- Why this exists: the checker is a first-visit screen. A returning filer goes
-- Dashboard -> startFiling -> /intake and never sees it again, but Form 5472 is
-- an annual obligation for the life of the LLC, and the things the checker
-- screens for change between years: a second member joins, the owner gets a
-- Green Card or meets the Substantial Presence Test, an 8832/2553 election gets
-- filed, the LLC starts earning U.S.-source income. Nothing asked again means
-- nothing caught.
--
--   eligibility_confirmed - the filer re-attested, for THIS tax year, that the
--                           conditions this flow depends on still hold.
--   has_us_activity       - the filer reported U.S. real estate, or work
--                           performed inside the U.S., this year. True is a
--                           warning state: it points at a possible Form 1040-NR
--                           obligation for the owner personally, which this
--                           flow does not prepare. The Form 5472 obligation is
--                           separate and still applies, so it does not block.
--
-- Deliberately NOT added to either column list in 20260702_lock_paid_filings:
-- not identity (so changing it never raises the locked-filing exception), and
-- not "correctable" (so re-attesting never burns one of the two post-payment
-- edits a filer gets for fixing a typo).
--
-- Idempotent; safe to run / re-run.
-- ============================================================================

alter table public.filings
  add column if not exists eligibility_confirmed boolean;

alter table public.filings
  add column if not exists has_us_activity boolean;
