-- ============================================================================
-- 2026-08-06  `submitted` becomes a real status, and every guard learns it.
-- ============================================================================
--
-- WHAT CHANGED ABOVE THE DATABASE
-- `filings.status = 'submitted'` has been in the check constraint since the
-- schema was written and NOTHING EVER WROTE IT. A delivered fax lived only in
-- `fax_transmissions`, so the dashboard queried that table separately and drew
-- a second green "Faxed to the IRS" chip next to the real status pill: two
-- pills for one fact, from two reads that could disagree. `sinch-fax-webhook`
-- and `reconcile-fax-status` now advance the filing itself to `submitted` on
-- delivery, the chip is gone, and the status pill carries the meaning.
--
-- WHY THIS MIGRATION IS NOT OPTIONAL
-- Every guard in this schema tests `status in ('paid','completed')`. Those
-- lists were exhaustive only because `submitted` was unreachable. The moment a
-- fax can produce it, each of them silently STOPS APPLYING to the filings that
-- deserve them most:
--
-- NOTE ON SECTION 2, ADDED 7 AUGUST 2026. The list below is what this file was
-- written to fix, and it was right about the hole. It was wrong about the
-- remedy for `txn_block_when_filing_paid`, which it reproduced from a source
-- superseded four days earlier. See the long comment above that function.
--
--   filings_freeze_when_paid    a faxed filing's EIN, LLC name, tax year and
--                               owner identity become editable again, on the
--                               one filing whose pages the IRS is already
--                               holding. The client refuses this in
--                               Intake.persistPatch; that is the courtesy, and
--                               this trigger is the guarantee.
--   txn_block_when_filing_paid  same hole, for its reportable transactions.
--   filings_block_payment_writes  worse: `submitted` was never on its ban list
--                               because it was never reachable, so any session
--                               could PATCH a draft straight to "Faxed to the
--                               IRS" and read a delivery receipt off a fax
--                               nobody ever sent.
--
-- All three functions are reproduced IN FULL from the definitions currently
-- live, and only the status lists change. `create or replace` rewrites the
-- whole body, so anything omitted here is silently dropped. Sources:
--   filings_freeze_when_paid      20260805_lock_fax_addon_when_paid
--   txn_block_when_filing_paid    20260702_lock_paid_filings
--   filings_block_payment_writes  20260805_payment_currency
--
-- Idempotent; safe to run / re-run.
-- ============================================================================

-- ── 1. A faxed filing stays as frozen as a paid one ─────────────────────────
create or replace function public.filings_freeze_when_paid()
returns trigger language plpgsql security definer as $$
declare
  identity_changed boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- `submitted` added. It is the strongest paid state there is, not a state
  -- past the point where the freeze matters.
  if tg_op = 'UPDATE' and old.status in ('paid','completed','submitted') then
    identity_changed :=
         new.ein                   is distinct from old.ein
      or new.llc_name              is distinct from old.llc_name
      or new.tax_year              is distinct from old.tax_year
      or new.owner_full_name       is distinct from old.owner_full_name
      or new.owner_foreign_tax_id  is distinct from old.owner_foreign_tax_id
      or new.date_of_incorporation is distinct from old.date_of_incorporation;

    if identity_changed then
      raise exception 'This filing is paid. Its identity (EIN, LLC name, tax year, owner name and tax ID, incorporation date) is locked. Start a new filing for a different company, owner, or year.'
        using errcode = '42501';
    end if;

    if public.jsonb_arr_len(new.related_parties) < public.jsonb_arr_len(old.related_parties) then
      raise exception 'A related party that was already covered by payment cannot be removed. Contact support if it was added in error.'
        using errcode = '42501';
    end if;

    -- The paid add-on. Coalesced because the column is nullable on older rows,
    -- and null vs false is not a change the filer made.
    if coalesce(new.include_irs_fax, false) is distinct from coalesce(old.include_irs_fax, false) then
      raise exception 'IRS fax delivery cannot be added or removed after payment. Email support@filetax.co and we will sort it out.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists filings_freeze_when_paid on public.filings;
create trigger filings_freeze_when_paid
  before update on public.filings
  for each row execute procedure public.filings_freeze_when_paid();

-- ── 2. And so do its transactions ───────────────────────────────────────────
--
-- READ THIS BEFORE RESTORING THE OLD BODY. The version of this function in
-- `20260702_lock_paid_filings` refused any transaction write once the parent
-- filing was paid AND `post_payment_edits >= 2`. That two-correction budget was
-- DELIBERATELY REMOVED on 4 August by `20260804_unlimited_paid_corrections`,
-- which dropped this trigger and this function outright, and production has
-- correctly had no trigger on `reportable_transactions` since. Reproducing the
-- old body here to add `submitted` to its status list would have silently
-- reimposed the cap on every paying customer, and /guide now promises in as
-- many words that corrections are unlimited and free.
--
-- So the function comes back NARROWED, not restored. `paid` and `completed`
-- are absent on purpose: a paid filing's transactions stay freely editable,
-- without a numeric limit, which is the settled decision. The only thing that
-- locks them is a fax the IRS has already received, because at that point an
-- edit here changes nothing about what they hold, and `post_payment_edits`
-- is not consulted at all.
create or replace function public.txn_block_when_filing_paid()
returns trigger language plpgsql security definer as $$
declare
  v_filing_id uuid;
  v_status    text;
begin
  if auth.role() = 'service_role' then
    return coalesce(new, old);
  end if;

  v_filing_id := coalesce(new.filing_id, old.filing_id);
  select status into v_status
    from public.filings where id = v_filing_id;

  if v_status = 'submitted' then
    raise exception 'This filing has already been faxed to the IRS, so its transactions can no longer be changed. The IRS holds the pages exactly as they were sent. Email support@filetax.co: a correction is a new filing, not an edit to this one.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists txn_block_when_filing_paid on public.reportable_transactions;
create trigger txn_block_when_filing_paid
  before insert or update or delete on public.reportable_transactions
  for each row execute procedure public.txn_block_when_filing_paid();

-- ── 3. No client may claim a filing was faxed to the IRS ────────────────────
create or replace function public.filings_block_payment_writes()
returns trigger language plpgsql security definer as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'paid' then
      raise exception 'filings.status cannot be set to paid from the client'
        using errcode = '42501';
    end if;
    if new.status = 'completed' and (old.status is null or old.status not in ('paid','completed')) then
      raise exception 'filings.status cannot be set to completed until status=paid'
        using errcode = '42501';
    end if;
    -- Unconditional, unlike `completed`. There is no legitimate client
    -- transition into this state at all: `submitted` means a fax provider
    -- confirmed delivery to Ogden, which is a fact only the two fax edge
    -- functions can know, and both run as service_role. A filer who could set
    -- it would be minting their own proof of filing.
    if new.status = 'submitted' then
      raise exception 'filings.status cannot be set to submitted from the client'
        using errcode = '42501';
    end if;
  end if;

  if new.paid_at              is distinct from old.paid_at
  or new.payment_id           is distinct from old.payment_id
  or new.payment_amount_cents is distinct from old.payment_amount_cents
  or new.payment_currency     is distinct from old.payment_currency
  or new.forms_generated_at   is distinct from old.forms_generated_at then
    raise exception 'payment columns are server-managed and cannot be written from the client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ── 4. Backfill: filings already faxed before `submitted` had a writer ──────
-- Every delivered transmission to date left its filing sitting at `paid` or
-- `completed`, with the truth visible only through the chip this change
-- deletes. Without this they would silently lose the fact. Job-scoped where
-- there is a job, because one $9 transmission covers every year in a catch-up,
-- which is exactly what `dispatch_key` encodes.
-- FIRST, CLAIM THE ROLE THE GUARDS EXEMPT. Every function in this file opens
-- with `if auth.role() = 'service_role' then return ...`, and that exemption is
-- the only reason a server write gets past them. But `auth.role()` reads the
-- PostgREST request context, and a migration HAS NO REQUEST: it returns NULL,
-- so the exemption is skipped and the guards treat this statement as a browser.
-- Section 3, installed ten lines above, then refuses this very backfill with
-- 'filings.status cannot be set to submitted from the client'. Verified against
-- the live `auth.role()` definition on 7 August 2026, which coalesces two
-- `current_setting` reads and yields NULL when neither is set.
--
-- `true` scopes this to the current transaction, so it is gone the moment the
-- migration commits and no session inherits it.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

update public.filings f
   set status = 'submitted',
       updated_at = now()
 where f.status in ('paid','completed')
   and exists (
     select 1 from public.fax_transmissions t
      where t.status = 'delivered'
        and t.dispatch_key = case when f.job_id is not null
                                  then 'job:'  || f.job_id::text
                                  else 'filing:' || f.id::text
                             end
   );

notify pgrst, 'reload schema';
