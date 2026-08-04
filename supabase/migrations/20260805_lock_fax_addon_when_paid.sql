-- ============================================================================
-- 2026-08-05  A paid add-on cannot be switched on or off after payment.
-- ============================================================================
--
-- `include_irs_fax` is the $9 IRS fax add-on. It has existed on `filings` since
-- the schema was written, and both edge functions already read it:
-- create-checkout-session adds the fee, verify-payment re-derives the total.
-- Nothing in the client ever WROTE it, so the flag was false on every filing
-- and this gap was theoretical.
--
-- Intake now writes it, which makes it real in both directions:
--
--   off -> on  after payment   a fax transmission nobody paid for
--   on  -> off after payment   the filer loses the $9 with no refund path
--
-- The wizard already hides the control on a paid filing, but the UI is the
-- courtesy and the trigger is the guarantee. Anything holding a session can
-- PATCH the row, and the same lesson is written across this schema already.
--
-- Deliberately its own check rather than an addition to `identity_changed`.
-- This is not identity: the message has to say something different, because a
-- filer who wants the fax after paying does not need a new filing, they need to
-- talk to us about the $9.
--
-- The rest of the trigger is reproduced UNCHANGED from
-- 20260804_unlimited_paid_corrections, which is the definition currently live.
-- `create or replace` rewrites the whole body, so anything omitted here is
-- silently dropped: check this against that file before editing either.
--
-- Idempotent; safe to run / re-run.
-- ============================================================================

create or replace function public.filings_freeze_when_paid()
returns trigger language plpgsql security definer as $$
declare
  identity_changed boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status in ('paid','completed') then
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
