-- Paid customers may make unlimited genuine corrections and re-download.
-- Only the identity fields that define the purchased filing remain frozen,
-- and a related party already covered by payment cannot be removed.

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
  end if;

  return new;
end;
$$;

drop trigger if exists filings_freeze_when_paid on public.filings;
create trigger filings_freeze_when_paid
  before update on public.filings
  for each row execute procedure public.filings_freeze_when_paid();

-- Transactions and all non-identity filing details remain editable after
-- payment without a numeric correction limit.
drop trigger if exists txn_block_when_filing_paid on public.reportable_transactions;
drop function if exists public.txn_block_when_filing_paid();
