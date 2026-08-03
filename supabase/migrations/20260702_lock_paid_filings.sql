-- ============================================================================
-- Payment integrity (nuanced model).
--
-- Goal: one payment must produce ONE company's filing — a user cannot pay once,
-- then re-skin the filing as a DIFFERENT company/owner/year and re-download.
-- BUT genuine corrections (a typo in an address, a wrong transaction amount)
-- must still be possible after payment, within a small edit budget.
--
-- Rules enforced at the DATABASE layer (defence in depth):
--   1. IDENTITY columns are frozen forever once paid:
--        ein, llc_name, tax_year, owner_full_name, owner_foreign_tax_id,
--        date_of_incorporation.
--      Changing any of these on a paid filing is rejected outright.
--   2. Other (correctable) columns may change, but only up to a small cap:
--        max 2 correcting edits (post_payment_edits 0 -> 1 -> 2). A change that
--        would push the counter past 2 is rejected with a "contact support"
--        error. The client must increment post_payment_edits on each correcting
--        save; the trigger refuses correcting changes once it has reached 2.
--   3. Related parties: ADDING a party is allowed (it's a paid add-on, billed
--        separately, so it doesn't consume the correction budget). REMOVING a
--        party post-payment is rejected (the removed taxpayer was already filed).
--   4. Transactions: editable while within the correction budget; locked once
--        the parent filing's budget is exhausted.
--   5. status / payment columns remain server-only (existing
--        filings_block_payment_writes trigger, unchanged).
--   6. Re-downloads are unlimited (download_count may always increment).
--
-- Service-role (edge functions) bypasses all of this.
-- Idempotent; safe to re-run.
-- ============================================================================

-- Track how many post-payment correcting edits have been made.
alter table public.filings
  add column if not exists post_payment_edits int not null default 0;

-- Helper: count related parties in a jsonb array (null-safe).
create or replace function public.jsonb_arr_len(v jsonb)
returns int language sql immutable as $$
  select coalesce(jsonb_array_length(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end), 0)
$$;

-- ── 1+2+3. Identity freeze + correction budget on filings ────────────────────
create or replace function public.filings_freeze_when_paid()
returns trigger language plpgsql security definer as $$
declare
  identity_changed boolean;
  correctable_changed boolean;
begin
  -- Service role (edge functions) may always write.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Only constrain UPDATEs of an already-paid filing.
  if tg_op = 'UPDATE' and old.status in ('paid','completed') then

    -- (1) Identity columns — frozen forever.
    identity_changed :=
         new.ein                  is distinct from old.ein
      or new.llc_name             is distinct from old.llc_name
      or new.tax_year             is distinct from old.tax_year
      or new.owner_full_name      is distinct from old.owner_full_name
      or new.owner_foreign_tax_id is distinct from old.owner_foreign_tax_id
      or new.date_of_incorporation is distinct from old.date_of_incorporation;

    if identity_changed then
      raise exception 'This filing is paid. Its identity (EIN, LLC name, tax year, owner name & tax ID, incorporation date) is locked. Start a new filing to file for a different company, owner, or year.'
        using errcode = '42501';
    end if;

    -- (3) Related parties: allow ADD, block REMOVE.
    if public.jsonb_arr_len(new.related_parties) < public.jsonb_arr_len(old.related_parties) then
      raise exception 'A related party that was already filed cannot be removed after payment. Contact support if this was filed in error.'
        using errcode = '42501';
    end if;

    -- (2) Correctable columns — allowed only within the edit budget.
    -- Adding related parties is a separate paid add-on and does NOT consume the
    -- budget, so it is excluded from this check.
    correctable_changed :=
         new.state_of_formation        is distinct from old.state_of_formation
      or new.total_assets              is distinct from old.total_assets
      or new.mailing_address           is distinct from old.mailing_address
      or new.naics_code                is distinct from old.naics_code
      or new.naics_description         is distinct from old.naics_description
      or new.owner_us_tin              is distinct from old.owner_us_tin
      or new.owner_reference_id        is distinct from old.owner_reference_id
      or new.owner_country             is distinct from old.owner_country
      or new.owner_primary_country     is distinct from old.owner_primary_country
      or new.owner_country_residence   is distinct from old.owner_country_residence
      or new.owner_country_citizenship is distinct from old.owner_country_citizenship
      or new.owner_address             is distinct from old.owner_address
      or new.final_return              is distinct from old.final_return
      or new.is_fiscal_year            is distinct from old.is_fiscal_year
      or new.tax_period_begin          is distinct from old.tax_period_begin
      or new.tax_period_end            is distinct from old.tax_period_end
      or new.part_vi_managerial        is distinct from old.part_vi_managerial;

    if correctable_changed and old.post_payment_edits >= 2 then
      raise exception 'You have used all available post-payment edits for this filing. Please contact support@filetax.co for further changes. (You can still re-download the current version.)'
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

-- ── 4. Transactions: editable within budget, locked when budget exhausted ────
create or replace function public.txn_block_when_filing_paid()
returns trigger language plpgsql security definer as $$
declare
  v_filing_id uuid;
  v_status    text;
  v_edits     int;
begin
  if auth.role() = 'service_role' then
    return coalesce(new, old);
  end if;

  v_filing_id := coalesce(new.filing_id, old.filing_id);
  select status, post_payment_edits into v_status, v_edits
    from public.filings where id = v_filing_id;

  -- Once the parent filing is paid, transaction edits are corrections — allowed
  -- only while the filing still has correction budget left.
  if v_status in ('paid','completed') and coalesce(v_edits, 0) >= 2 then
    raise exception 'This filing has used all available post-payment edits; its transactions are locked. Contact support@filetax.co for further changes.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists txn_block_when_filing_paid on public.reportable_transactions;
create trigger txn_block_when_filing_paid
  before insert or update or delete on public.reportable_transactions
  for each row execute procedure public.txn_block_when_filing_paid();
