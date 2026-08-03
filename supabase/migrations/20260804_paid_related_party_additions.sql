alter table public.filings
  add column if not exists paid_related_party_count integer not null default 0;

update public.filings
set paid_related_party_count = jsonb_array_length(coalesce(related_parties, '[]'::jsonb))
where status in ('paid', 'completed')
  and paid_related_party_count = 0;

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
      raise exception 'This filing is paid. Its identity fields are locked.'
        using errcode = '42501';
    end if;

    if public.jsonb_arr_len(new.related_parties) < old.paid_related_party_count then
      raise exception 'A related party already covered by payment cannot be removed.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
