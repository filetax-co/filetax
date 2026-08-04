-- ============================================================================
-- 2026-08-05  One saved profile per COMPANY, not per user.
-- ============================================================================
--
-- `user_profiles` holds exactly one row per user (`upsert onConflict user_id`),
-- and every submitted filing overwrites it. That is fine for the case it was
-- built for, a filer coming back for next year with the same LLC. It fails the
-- moment someone files for a second company:
--
--   1. filing for LLC A saves A into the profile
--   2. filing for LLC B silently PREFILLS A's name, EIN and owner
--   3. if the filer does not catch it before paying, filings_freeze_when_paid
--      locks ein, llc_name and owner_full_name permanently
--
-- Prefill was also unconditional, so nothing asked. The new intake step asks
-- which company a filing is for, and this table is what it lists.
--
-- Keyed on (user_id, ein) because the EIN is what actually identifies a US
-- entity. `ein` is stored DIGITS ONLY so "99-9999999" and "999999999" cannot
-- become two companies; the app normalises before every read and write.
--
-- `user_profiles` is left in place and stops being read. Dropping it is a
-- separate, deliberate step once this flow has been exercised, so there is a
-- way back that does not involve restoring a backup.
--
-- Idempotent; safe to re-run.
-- ============================================================================

create table if not exists public.company_profiles (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  user_id     uuid        not null references auth.users(id) on delete cascade,

  -- Digits only. The identity of the company, and half of the natural key.
  ein         text        not null check (ein ~ '^[0-9]{9}$'),

  -- Entity
  llc_name                 text,
  state_of_formation       text,
  date_of_incorporation    date,
  mailing_address          jsonb,
  entity_business_activity text,
  entity_business_code     text,
  entity_principal_country text,
  naics_code               text,
  naics_description        text,

  -- Owner
  owner_full_name           text,
  owner_country             text,
  owner_primary_country     text,
  owner_country_residence   text,
  owner_country_citizenship text,
  owner_foreign_tax_id      text,
  owner_us_tin              text,
  owner_reference_id        text,
  owner_ref_number          text,
  owner_address             jsonb,
  owner_business_activity   text,
  owner_business_code       text,
  owner_naics_code          text,
  signer_title              text,

  -- Carried forward like the rest, but imported separately in the UI: related
  -- parties go stale between years far more often than an address does.
  related_parties           jsonb,

  -- Drives "last filed 2024" in the picker, so the filer can tell two similar
  -- companies apart by something other than the EIN.
  last_filed_tax_year       text,

  unique (user_id, ein)
);

alter table public.company_profiles enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='company_profiles'
       and policyname='Users manage own company profiles'
  ) then
    execute $p$ create policy "Users manage own company profiles"
      on public.company_profiles for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id) $p$;
  end if;
end $$;

drop trigger if exists company_profiles_set_updated_at on public.company_profiles;
create trigger company_profiles_set_updated_at before update on public.company_profiles
  for each row execute procedure public.set_updated_at();

create index if not exists company_profiles_user_idx
  on public.company_profiles (user_id, updated_at desc);

-- ── Backfill from user_profiles ──────────────────────────────────────────────
-- Only rows carrying an EIN: without one there is no key, and inventing one
-- would create a company that does not exist. A profile with no EIN was never
-- a usable prefill source anyway, because the EIN is required on every return.
insert into public.company_profiles (
  user_id, ein,
  llc_name, state_of_formation, date_of_incorporation, mailing_address,
  entity_business_activity, entity_business_code, entity_principal_country,
  naics_code, naics_description,
  owner_full_name, owner_country, owner_primary_country,
  owner_country_residence, owner_country_citizenship,
  owner_foreign_tax_id, owner_us_tin, owner_reference_id, owner_ref_number,
  owner_address, owner_business_activity, owner_business_code,
  owner_naics_code, signer_title, related_parties
)
select
  p.user_id, regexp_replace(p.ein, '\D', '', 'g'),
  p.llc_name, p.state_of_formation, p.date_of_incorporation, p.mailing_address,
  p.entity_business_activity, p.entity_business_code, p.entity_principal_country,
  p.naics_code, p.naics_description,
  p.owner_full_name, p.owner_country, p.owner_primary_country,
  p.owner_country_residence, p.owner_country_citizenship,
  p.owner_foreign_tax_id, p.owner_us_tin, p.owner_reference_id, p.owner_ref_number,
  p.owner_address, p.owner_business_activity, p.owner_business_code,
  p.owner_naics_code, p.signer_title, p.related_parties
from public.user_profiles p
where p.ein is not null
  and regexp_replace(p.ein, '\D', '', 'g') ~ '^[0-9]{9}$'
on conflict (user_id, ein) do nothing;

-- Every company the user has actually filed for, whether or not a profile row
-- ever existed for it. A filer whose profile was overwritten by their second
-- LLC still has the first one in `filings`, and that is where it is recovered
-- from. Existing rows win: a profile is more current than an old filing.
insert into public.company_profiles (user_id, ein, llc_name, state_of_formation, date_of_incorporation, last_filed_tax_year)
select distinct on (f.user_id, regexp_replace(f.ein, '\D', '', 'g'))
       f.user_id, regexp_replace(f.ein, '\D', '', 'g'),
       f.llc_name, f.state_of_formation, f.date_of_incorporation, f.tax_year
  from public.filings f
 where f.ein is not null
   and regexp_replace(f.ein, '\D', '', 'g') ~ '^[0-9]{9}$'
 order by f.user_id, regexp_replace(f.ein, '\D', '', 'g'), f.updated_at desc nulls last
on conflict (user_id, ein) do nothing;

notify pgrst, 'reload schema';
