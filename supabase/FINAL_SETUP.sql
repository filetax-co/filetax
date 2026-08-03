-- ============================================================================
-- FileTax - FINAL consolidated Supabase setup
--
-- Run this ONE file in the Supabase SQL editor (New query → Run). It is fully
-- idempotent and self-contained: safe on an empty project AND on an existing
-- one. It creates/updates every table, column, constraint, RLS policy, and
-- trigger the application needs - including every fix from the full build
-- (multi-year, payment integrity, Form 7004 include_7004, owner_ref_number,
-- tax_year NOT NULL) - and reloads the PostgREST schema cache at the end.
--
-- After running: the API immediately sees the new columns (no manual reload).
-- ============================================================================

-- ── 0. Shared helper ─────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. intake_submissions - eligibility-check / signup captures
-- ============================================================================
create table if not exists public.intake_submissions (
  id                uuid        primary key default gen_random_uuid(),
  created_at        timestamptz default now(),
  user_id           uuid        references auth.users(id) on delete set null,
  full_name         text        not null,
  email             text        not null,
  llc_name          text,
  ein               text,
  tax_year          text,
  years_param       text,
  sections_param    text,
  parties_param     int,
  rcl_param         boolean,
  status            text        not null default 'pending'
                    check (status in ('pending','in_progress','completed')),
  linked_filing_id  uuid
);
alter table public.intake_submissions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='intake_submissions' and policyname='Users can read own submissions') then
    execute $p$ create policy "Users can read own submissions" on public.intake_submissions for select using (auth.uid() = user_id) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='intake_submissions' and policyname='Anyone can insert intake') then
    execute $p$ create policy "Anyone can insert intake" on public.intake_submissions for insert with check (
      (auth.uid() is null and user_id is null and linked_filing_id is null)
      or (auth.uid() is not null and auth.uid() = user_id)) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='intake_submissions' and policyname='Users can update own submissions') then
    execute $p$ create policy "Users can update own submissions" on public.intake_submissions for update using (auth.uid() = user_id) $p$;
  end if;
end $$;

-- ============================================================================
-- 2. filing_jobs - multi-year catch-up groups (one shared RCL)
-- ============================================================================
create table if not exists public.filing_jobs (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  tax_years     int[]       not null default '{}',
  include_rcl   boolean     not null default false,
  rcl_narrative text,
  reasonable_cause_reasons text[] default '{}',
  delivery      text        not null default 'self_mail' check (delivery in ('self_mail','fax')),
  status        text        not null default 'draft'
);
alter table public.filing_jobs enable row level security;
-- Reasonable-cause reasons are collected ONCE for the whole multi-year job.
alter table public.filing_jobs
  add column if not exists reasonable_cause_reasons text[] default '{}';

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='filing_jobs' and policyname='Users manage own filing jobs') then
    execute $p$ create policy "Users manage own filing jobs" on public.filing_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id) $p$;
  end if;
end $$;

drop trigger if exists filing_jobs_set_updated_at on public.filing_jobs;
create trigger filing_jobs_set_updated_at before update on public.filing_jobs
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- 3. filings - core filing record (create base, then ensure every column)
-- ============================================================================
create table if not exists public.filings (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  service_type text not null default 'current_year'
              check (service_type in ('current_year','past_year','tax_classification')),
  status      text not null default 'draft'
              check (status in ('draft','in_progress','payment_failed','paid','completed','submitted')),
  current_step int not null default 1,
  tax_year    text not null default to_char(now(), 'YYYY')
);

-- Ensure every column the app reads/writes exists (idempotent).
alter table public.filings
  add column if not exists tax_period_begin              date,
  add column if not exists tax_period_end                date,
  add column if not exists llc_name                      text,
  add column if not exists ein                           text,
  add column if not exists state_of_formation            text,
  add column if not exists mailing_address               jsonb,
  add column if not exists total_assets                  numeric,
  add column if not exists naics_code                    text,
  add column if not exists naics_description             text,
  add column if not exists date_of_incorporation         date,
  add column if not exists date_of_closure               date,
  add column if not exists initial_return                boolean not null default false,
  add column if not exists name_change                   boolean,
  add column if not exists address_change                boolean,
  add column if not exists final_return                  boolean not null default false,
  add column if not exists is_fiscal_year                boolean not null default false,
  -- entity (wizard step 1 names + canonical)
  add column if not exists entity_date_of_incorporation  text,
  add column if not exists entity_principal_country      text,
  add column if not exists entity_business_activity      text,
  add column if not exists entity_business_code          text,
  -- late filing / extension
  add column if not exists extension_filed               boolean,
  add column if not exists include_7004                  boolean,
  add column if not exists include_reasonable_cause      boolean,
  add column if not exists reasonable_cause_reasons      text[],
  -- owner
  add column if not exists owner_full_name               text,
  add column if not exists owner_country                 text,
  add column if not exists owner_country_residence       text,
  add column if not exists owner_country_citizenship     text,
  add column if not exists owner_resident_country        text,
  add column if not exists owner_passport_number         text,
  add column if not exists owner_ssn                     text,
  add column if not exists owner_foreign_tax_id          text,
  add column if not exists owner_ref_number              text,
  add column if not exists owner_address                 jsonb,
  add column if not exists owner_foreign_address         jsonb,
  add column if not exists owner_business_activity       text,
  add column if not exists owner_business_code           text,
  add column if not exists owner_primary_country         text,
  add column if not exists owner_us_tin                  text,
  add column if not exists owner_reference_id            text,
  add column if not exists owner_naics_code              text,
  add column if not exists owner_naics_description       text,
  -- related parties + transactions step
  add column if not exists related_parties               jsonb not null default '[]'::jsonb,
  add column if not exists no_transactions_confirmed     boolean not null default false,
  add column if not exists part_vi_managerial            boolean not null default true,
  add column if not exists rp_is_related_only            boolean,
  add column if not exists rp_is_both                    boolean,
  -- filing options
  add column if not exists include_irs_fax               boolean not null default false,
  add column if not exists include_rcl                   boolean not null default false,
  add column if not exists notes                         text,
  add column if not exists parties_count                 int not null default 1,
  add column if not exists complex_sections              text[] not null default '{}',
  -- multi-year + signer
  add column if not exists job_id                        uuid references public.filing_jobs(id) on delete set null,
  add column if not exists signer_title                  text,
  -- payment
  add column if not exists paid_at                       timestamptz,
  add column if not exists payment_id                    text,
  add column if not exists payment_amount_cents          int,
  add column if not exists forms_generated_at            timestamptz,
  add column if not exists download_count                int not null default 0,
  add column if not exists file_path                     text,
  add column if not exists form_type                     text,
  -- payment integrity
  add column if not exists post_payment_edits            int not null default 0;

-- tax_year must be NOT NULL (the app always seeds it; this catches regressions).
update public.filings set tax_year = to_char(now(),'YYYY') where tax_year is null;
do $$ begin
  alter table public.filings alter column tax_year set not null;
exception when others then null; end $$;

create index if not exists filings_job_id_idx on public.filings(job_id);
alter table public.filings enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='filings' and policyname='Users can read own filings') then
    execute $p$ create policy "Users can read own filings" on public.filings for select using (auth.uid() = user_id) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='filings' and policyname='Users can insert own filings') then
    execute $p$ create policy "Users can insert own filings" on public.filings for insert with check (auth.uid() = user_id) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='filings' and policyname='Users can update own filings') then
    execute $p$ create policy "Users can update own filings" on public.filings for update using (auth.uid() = user_id) $p$;
  end if;
end $$;

drop trigger if exists filings_set_updated_at on public.filings;
create trigger filings_set_updated_at before update on public.filings
  for each row execute procedure public.set_updated_at();

-- ── Payment guards (status/payment columns server-only) ──────────────────────
create or replace function public.filings_block_payment_writes()
returns trigger language plpgsql security definer as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.status is distinct from old.status then
    if new.status = 'paid' then
      raise exception 'filings.status cannot be set to paid from the client' using errcode='42501';
    end if;
    if new.status = 'completed' and (old.status is null or old.status not in ('paid','completed')) then
      raise exception 'filings.status cannot be set to completed until status=paid' using errcode='42501';
    end if;
  end if;
  if new.paid_at is distinct from old.paid_at
  or new.payment_id is distinct from old.payment_id
  or new.payment_amount_cents is distinct from old.payment_amount_cents
  or new.forms_generated_at is distinct from old.forms_generated_at then
    raise exception 'payment columns are server-managed' using errcode='42501';
  end if;
  return new;
end;
$$;
drop trigger if exists filings_block_payment_writes on public.filings;
create trigger filings_block_payment_writes before insert or update on public.filings
  for each row execute procedure public.filings_block_payment_writes();

-- ── Payment integrity: freeze identity once paid; 2-edit correction budget ───
create or replace function public.jsonb_arr_len(v jsonb)
returns int language sql immutable as $$
  select coalesce(jsonb_array_length(case when jsonb_typeof(v)='array' then v else '[]'::jsonb end),0)
$$;

create or replace function public.filings_freeze_when_paid()
returns trigger language plpgsql security definer as $$
declare identity_changed boolean; correctable_changed boolean;
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op='UPDATE' and old.status in ('paid','completed') then
    identity_changed :=
         new.ein is distinct from old.ein
      or new.llc_name is distinct from old.llc_name
      or new.tax_year is distinct from old.tax_year
      or new.owner_full_name is distinct from old.owner_full_name
      or new.owner_foreign_tax_id is distinct from old.owner_foreign_tax_id
      or new.date_of_incorporation is distinct from old.date_of_incorporation;
    if identity_changed then
      raise exception 'This filing is paid. Its identity (EIN, LLC name, tax year, owner name & tax ID, incorporation date) is locked. Start a new filing for a different company, owner, or year.' using errcode='42501';
    end if;
    if public.jsonb_arr_len(new.related_parties) < public.jsonb_arr_len(old.related_parties) then
      raise exception 'A related party that was already filed cannot be removed after payment.' using errcode='42501';
    end if;
    correctable_changed :=
         new.state_of_formation is distinct from old.state_of_formation
      or new.total_assets is distinct from old.total_assets
      or new.mailing_address is distinct from old.mailing_address
      or new.naics_code is distinct from old.naics_code
      or new.naics_description is distinct from old.naics_description
      or new.owner_us_tin is distinct from old.owner_us_tin
      or new.owner_reference_id is distinct from old.owner_reference_id
      or new.owner_country is distinct from old.owner_country
      or new.owner_primary_country is distinct from old.owner_primary_country
      or new.owner_country_residence is distinct from old.owner_country_residence
      or new.owner_country_citizenship is distinct from old.owner_country_citizenship
      or new.owner_address is distinct from old.owner_address
      or new.final_return is distinct from old.final_return
      or new.is_fiscal_year is distinct from old.is_fiscal_year
      or new.tax_period_begin is distinct from old.tax_period_begin
      or new.tax_period_end is distinct from old.tax_period_end
      or new.part_vi_managerial is distinct from old.part_vi_managerial;
    if correctable_changed and old.post_payment_edits >= 2 then
      raise exception 'You have used all available post-payment edits for this filing. Contact support@filetax.co for further changes.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists filings_freeze_when_paid on public.filings;
create trigger filings_freeze_when_paid before update on public.filings
  for each row execute procedure public.filings_freeze_when_paid();

-- ============================================================================
-- 4. reportable_transactions
-- ============================================================================
create table if not exists public.reportable_transactions (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  filing_id        uuid        not null references public.filings(id) on delete cascade,
  transaction_type text        not null,
  direction        text        not null check (direction in ('paid','received')),
  amount_usd       numeric,
  transaction_date date,
  description      text
);
alter table public.reportable_transactions
  add column if not exists is_royalty          boolean,
  add column if not exists related_party_index int not null default 0,
  add column if not exists related_party_naics text,
  add column if not exists loan_begin_usd      numeric;

-- transaction_type CHECK = the full canonical set the generator understands.
do $$ begin
  alter table public.reportable_transactions drop constraint if exists reportable_transactions_transaction_type_check;
  alter table public.reportable_transactions add constraint reportable_transactions_transaction_type_check
    check (transaction_type in (
      'sales','service_payment','rent_royalty','loan_to_llc','loan_from_llc',
      'interest','insurance','dividend','commission','intangible','other',
      'capital_contribution','distribution','formation_costs','property_transfer',
      'tangible_property','loan_guarantee','nonmonetary_other'));
exception when others then raise notice 'tx_type check skipped: %', sqlerrm; end $$;

alter table public.reportable_transactions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can read own transactions') then
    execute $p$ create policy "Users can read own transactions" on public.reportable_transactions for select using (exists (select 1 from public.filings f where f.id=filing_id and f.user_id=auth.uid())) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can insert own transactions') then
    execute $p$ create policy "Users can insert own transactions" on public.reportable_transactions for insert with check (exists (select 1 from public.filings f where f.id=filing_id and f.user_id=auth.uid())) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can update own transactions') then
    execute $p$ create policy "Users can update own transactions" on public.reportable_transactions for update using (exists (select 1 from public.filings f where f.id=filing_id and f.user_id=auth.uid())) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can delete own transactions') then
    execute $p$ create policy "Users can delete own transactions" on public.reportable_transactions for delete using (exists (select 1 from public.filings f where f.id=filing_id and f.user_id=auth.uid())) $p$;
  end if;
end $$;

-- Lock transactions once the parent filing's edit budget is spent.
create or replace function public.txn_block_when_filing_paid()
returns trigger language plpgsql security definer as $$
declare v_status text; v_edits int;
begin
  if auth.role()='service_role' then return coalesce(new,old); end if;
  select status, post_payment_edits into v_status, v_edits from public.filings where id = coalesce(new.filing_id, old.filing_id);
  if v_status in ('paid','completed') and coalesce(v_edits,0) >= 2 then
    raise exception 'This filing has used all available post-payment edits; its transactions are locked.' using errcode='42501';
  end if;
  return coalesce(new,old);
end;
$$;
drop trigger if exists txn_block_when_filing_paid on public.reportable_transactions;
create trigger txn_block_when_filing_paid before insert or update or delete on public.reportable_transactions
  for each row execute procedure public.txn_block_when_filing_paid();

-- ============================================================================
-- 5. user_profiles - prefill source (year-2+ auto-fill)
-- ============================================================================
create table if not exists public.user_profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade unique,
  updated_at timestamptz default now()
);
alter table public.user_profiles
  add column if not exists llc_name                  text,
  add column if not exists ein                       text,
  add column if not exists state_of_formation        text,
  add column if not exists country_of_incorporation  text,
  add column if not exists date_of_incorporation     date,
  add column if not exists llc_us_address            jsonb,
  add column if not exists mailing_address           jsonb,
  add column if not exists entity_business_activity  text,
  add column if not exists entity_business_code      text,
  add column if not exists naics_code                text,
  add column if not exists naics_description         text,
  add column if not exists owner_full_name           text,
  add column if not exists owner_country             text,
  add column if not exists owner_primary_country     text,
  add column if not exists owner_country_residence   text,
  add column if not exists owner_country_citizenship text,
  add column if not exists owner_foreign_tax_id      text,
  add column if not exists owner_foreign_address     jsonb,
  add column if not exists owner_us_tin              text,
  add column if not exists owner_reference_id        text,
  add column if not exists owner_ref_number          text,
  add column if not exists owner_address             jsonb,
  add column if not exists owner_business_activity   text,
  add column if not exists owner_business_code       text,
  add column if not exists owner_naics_code          text,
  add column if not exists signer_title              text,
  add column if not exists related_parties           jsonb not null default '[]'::jsonb;

alter table public.user_profiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='Users manage own profile') then
    execute $p$ create policy "Users manage own profile" on public.user_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id) $p$;
  end if;
end $$;

-- ============================================================================
-- 6. Refresh PostgREST's schema cache so the API sees everything immediately.
-- ============================================================================
notify pgrst, 'reload schema';

-- Done. Schema now matches the application code.
