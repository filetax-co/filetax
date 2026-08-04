-- ============================================================================
-- 2026-08-05  Record the settlement currency alongside the amount.
-- ============================================================================
--
-- filings.payment_amount_cents was a bare integer with no currency beside it,
-- so every reader took it for USD. verify-payment reinforced that by recording
-- the amount ONLY when the provider settled in USD:
--
--   const amount =
--     payment.settlement_currency === 'USD' && Number.isInteger(...)
--       ? payment.settlement_amount
--       : null;
--
-- A settlement in anything else therefore flipped the filing to paid, stored
-- the payment_id, and left payment_amount_cents at whatever it already held.
-- The row then read as a paid filing whose recorded total was lower than what
-- the customer was actually charged, with nothing anywhere marking it as
-- incomplete. A wrong number that looks right is worse than a missing one.
--
-- The column is nullable and stays null on filings paid before this ran: their
-- amounts were only ever written on the USD path, so they are USD by
-- construction, but backfilling a value the old code never observed would be
-- inventing a fact. Null here means "not recorded", which is true.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table public.filings
  add column if not exists payment_currency text;

comment on column public.filings.payment_currency is
  'ISO-4217 code for payment_amount_cents. Null on filings paid before the '
  'column existed, and on any payment whose amount could not be recorded. '
  'Server-managed: the filings_block_payment_writes trigger rejects client '
  'writes to it, like every other payment column.';

-- Bring the column under the same client-write ban as the rest of the payment
-- block. Recreated in full rather than patched: this function is the whole
-- rule, and a partial redefinition is how the list drifts.
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
