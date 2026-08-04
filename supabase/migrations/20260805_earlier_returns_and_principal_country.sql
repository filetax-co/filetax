-- ALSO FOLDED INTO supabase/FINAL_SETUP.sql, which is the canonical, idempotent
-- schema for this project. Run that file, or run this one on its own against a
-- database that is already up to date. Both are safe to re-run.

-- The answer to "Have you already filed for earlier years?", asked in intake
-- step 1 when the LLC was formed before the year being filed.
--
-- It was collected, shown in the review summary, and never written anywhere, so
-- the question came back on every reload. We know what was filed THROUGH US,
-- never what was filed elsewhere, so this records the filer's own statement and
-- nothing more: null means unanswered, and no code may read a null as "no".
--
-- Nullable on purpose. Every filing written before this column existed is
-- genuinely unanswered, and a default of false would assert something about
-- those filers that they never said.
alter table public.filings
  add column if not exists earlier_returns_filed boolean;

-- The LLC's principal country of business (Form 5472 line 1o). It is asked in
-- intake step 1 and is the same answer for every year of a catch-up, but it was
-- missing from the profile, so year two asked for it again from a blank field.
alter table public.user_profiles
  add column if not exists entity_principal_country text;
