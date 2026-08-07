-- ============================================================================
-- 2026-08-07  Security audit remediation.
--
-- Three UPDATE policies were written with a USING clause and no WITH CHECK.
-- In Postgres, an UPDATE policy with no WITH CHECK reuses USING for the row
-- SELECTION only; the row as it is being WRITTEN is unchecked. So a policy of
-- `using (auth.uid() = user_id)` says "you may update a row you own" and says
-- nothing whatever about who owns it afterwards.
--
-- What that allowed, against the live policies as of this migration:
--
--   filings                  PATCH /rest/v1/filings?id=eq.<own filing>
--                            {"user_id":"<victim uuid>"}
--                            The row passes USING (it is still yours when
--                            selected) and lands in the victim's account. The
--                            attacker plants a filing carrying an EIN, owner
--                            name and foreign tax ID of their choosing into
--                            another filer's dashboard, and loses sight of it
--                            themselves. `filings_freeze_when_paid` does not
--                            look at user_id, so a paid row moves too.
--
--   reportable_transactions  PATCH .../reportable_transactions?id=eq.<own row>
--                            {"filing_id":"<victim filing uuid>"}
--                            Worse, because the transaction rows ARE the
--                            Part IV numbers. An attacker who learns a victim's
--                            filing id adds a transaction line to a Form 5472
--                            that is not theirs. `txn_block_when_filing_paid`
--                            only refuses when the parent filing is already
--                            `submitted`, so every draft, paid and completed
--                            filing is reachable.
--
--   intake_submissions       Same shape: re-point user_id / linked_filing_id at
--                            another account.
--
-- The fix is one clause per policy. Nothing else about the model changes: the
-- USING predicates were already correct, and every legitimate client write
-- already satisfies the WITH CHECK, because the app never rewrites user_id or
-- filing_id on an existing row.
--
-- Idempotent; safe to run / re-run.
-- ============================================================================

-- ── 1. filings: an update may not hand the row to another account ───────────
drop policy if exists "Users can update own filings" on public.filings;
create policy "Users can update own filings"
  on public.filings for update
  using       (auth.uid() = user_id)
  with check  (auth.uid() = user_id);

-- ── 2. reportable_transactions: an update may not re-parent the row ─────────
drop policy if exists "Users can update own transactions" on public.reportable_transactions;
create policy "Users can update own transactions"
  on public.reportable_transactions for update
  using (
    exists (
      select 1 from public.filings f
       where f.id = reportable_transactions.filing_id
         and f.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.filings f
       where f.id = reportable_transactions.filing_id
         and f.user_id = auth.uid()
    )
  );

-- ── 3. intake_submissions ───────────────────────────────────────────────────
drop policy if exists "Users can update own submissions" on public.intake_submissions;
create policy "Users can update own submissions"
  on public.intake_submissions for update
  using       (auth.uid() = user_id)
  with check  (auth.uid() = user_id);

-- ── 4. Pin search_path on every function in `public` ────────────────────────
--
-- Not currently exploitable on this project: `anon` and `authenticated` have no
-- CREATE on schema `public`, so neither can plant a shadowing `filings` or
-- `jsonb_arr_len` for a SECURITY DEFINER body to resolve to. That is a property
-- of today's grants, not of these functions, and the four SECURITY DEFINER ones
-- here are the guards that stop a browser marking its own filing paid. They
-- should not depend on a grant elsewhere staying the way it is.
--
-- `pg_catalog, public` rather than `''`: the bodies reference `public.` objects
-- explicitly, but `auth.role()`, `now()` and the operators resolve through
-- pg_catalog, and an empty path would break them.
alter function public.set_updated_at()               set search_path = pg_catalog, public;
alter function public.jsonb_arr_len(jsonb)           set search_path = pg_catalog, public;
alter function public.filings_freeze_when_paid()     set search_path = pg_catalog, public;
alter function public.txn_block_when_filing_paid()   set search_path = pg_catalog, public;
alter function public.filings_block_payment_writes() set search_path = pg_catalog, public;

-- ── 5. Trigger functions are not API endpoints ──────────────────────────────
-- PostgREST exposes everything executable in `public` at /rest/v1/rpc/<name>.
-- A direct call to a trigger function raises "can only be called as a trigger",
-- so this closes a door that does not currently open onto anything, but these
-- run as SECURITY DEFINER and there is no reason for a browser to hold EXECUTE
-- on them at all.
-- `from public` IS THE LOAD-BEARING PART, and the first version of this file
-- got it wrong. Postgres grants EXECUTE on every new function to the pseudo-role
-- PUBLIC, which `anon` and `authenticated` inherit. Naming only those two roles
-- revokes a grant they were never held by directly, so it succeeds, reports
-- nothing, and changes nothing: verified against the live database on
-- 7 August 2026, where both roles still had EXECUTE afterwards.
--
-- Safe despite these being live triggers. Postgres checks EXECUTE when a trigger
-- is CREATED, not each time it fires, so the guards keep working. And
-- jsonb_arr_len is only ever called from inside a SECURITY DEFINER body, which
-- runs as the owner and keeps its own grant.
revoke execute on function
    public.set_updated_at(),
    public.jsonb_arr_len(jsonb),
    public.filings_freeze_when_paid(),
    public.txn_block_when_filing_paid(),
    public.filings_block_payment_writes()
  from public, anon, authenticated;

-- ── 6. Close the unauthenticated write endpoint on intake_submissions ───────
--
-- `"Anyone can insert intake"` allowed a row from a caller with NO SESSION AT
-- ALL, provided user_id and linked_filing_id were null. `full_name` and `email`
-- are the only NOT NULL columns, the anon key ships inside the JS bundle by
-- design, and there is no captcha, no rate limit and no unique constraint
-- anywhere in the repo. So the endpoint is a loop of
--   POST /rest/v1/intake_submissions  {"full_name":"x","email":"x@x"}
-- run by anyone, until the table is whatever size they feel like, with every
-- row indistinguishable from a real lead.
--
-- The reason this is a deletion rather than a rate limit: THE TABLE IS DEAD.
-- Nothing in `src` reads or writes it (the intake flow writes `filings`), and
-- it holds zero rows in production. It is an open unauthenticated write
-- endpoint attached to a feature that no longer exists.
--
-- The TABLE is kept, not dropped. It costs nothing empty, `filings` is
-- referenced by its foreign key, and keeping it makes this migration a
-- reversible change to permissions rather than an irreversible loss of a
-- schema. What is removed is every route a browser has to it.
drop policy if exists "Anyone can insert intake"          on public.intake_submissions;
drop policy if exists "Users can read own submissions"    on public.intake_submissions;
drop policy if exists "Users can update own submissions"  on public.intake_submissions;

-- Belt and braces. Supabase grants every privilege on new public tables to
-- `anon` and `authenticated` by default and leans entirely on RLS to gate them.
-- With no policy left, RLS denies everything regardless, but a future policy
-- added in haste should not silently re-open anonymous writes.
revoke all on public.intake_submissions from anon, authenticated;

notify pgrst, 'reload schema';
