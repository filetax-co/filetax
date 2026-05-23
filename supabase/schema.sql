-- ============================================================================
-- FileTax.co — Supabase schema
-- Run in: Dashboard → SQL Editor → New query
-- Safe to re-run on an existing database (all migrations are idempotent)
-- ============================================================================


-- ============================================================================
-- TABLE: intake_submissions
-- Stores every portal signup / eligibility-check submission.
-- linked_filing_id is set once the user converts a submission into a filing.
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
  -- Set once the intake is converted into a filing row
  linked_filing_id  uuid        references public.filings(id) on delete set null
);

alter table public.intake_submissions enable row level security;

create policy "Users can read own submissions" on public.intake_submissions
  for select using (auth.uid() = user_id);

create policy "Anyone can insert intake" on public.intake_submissions
  for insert with check (true);

create policy "Users can update own submissions" on public.intake_submissions
  for update using (auth.uid() = user_id);


-- ============================================================================
-- TABLE: filings
-- Core filing record. One row per filing per user per tax year.
-- ============================================================================
create table if not exists public.filings (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  user_id     uuid        not null references auth.users(id) on delete cascade,

  -- ── Service & status ─────────────────────────────────────────────────────
  service_type  text not null default 'current_year'
                check (service_type in ('current_year','past_year','tax_classification')),
  status        text not null default 'draft'
                check (status in ('draft','in_progress','payment_failed','paid','completed','submitted')),
  current_step  int  not null default 1,

  -- ── Tax year / period ─────────────────────────────────────────────────────
  -- tax_year: the four-digit year string, e.g. '2024'
  -- tax_period_begin / tax_period_end: exact ISO dates for the Form 5472 header
  -- (supports fiscal-year LLCs; calendar-year default: Jan 1 – Dec 31)
  tax_year          text,
  tax_period_begin  date,
  tax_period_end    date,

  -- ── Entity ────────────────────────────────────────────────────────────────
  llc_name            text,
  ein                 text,
  state_of_formation  text,
  mailing_address     jsonb,

  -- ── Form 5472 / Pro Forma 1120 fields ────────────────────────────────────
  total_assets            numeric,
  naics_code              text,
  naics_description       text,
  date_of_incorporation   date,
  date_of_closure         date,
  -- "Initial return" checkbox on Form 5472 + Pro Forma 1120 cover.
  -- Never set manually — derived by the wizard rules engine.
  initial_return    boolean not null default false,
  name_change       boolean,
  address_change    boolean,

  -- ── Foreign owner / related party ────────────────────────────────────────
  owner_full_name           text,
  owner_country_residence   text,
  owner_country_citizenship text,
  owner_resident_country    text,
  owner_passport_number     text,
  owner_foreign_tax_id      text,
  owner_address             jsonb,
  owner_primary_country     text,
  owner_us_tin              text,
  owner_reference_id        text,
  owner_naics_code          text,
  owner_naics_description   text,

  -- Part III 8e relationship checkboxes
  -- false/null = related party IS the 25% shareholder (default SMLLC)
  -- true       = related party is ONLY related to the 25% shareholder
  rp_is_related_only  boolean,
  -- true = tick "both 25% shareholder AND related to another 25% shareholder"
  rp_is_both          boolean,

  -- ── Filing options ────────────────────────────────────────────────────────
  include_irs_fax   boolean not null default false,
  include_rcl       boolean not null default false,
  notes             text,
  parties_count     int     not null default 1,
  complex_sections  text[]  not null default '{}',

  -- ── Payment ───────────────────────────────────────────────────────────────
  paid_at               timestamptz,
  payment_id            text,
  payment_amount_cents  int,

  -- ── Output ───────────────────────────────────────────────────────────────
  forms_generated_at  timestamptz,
  download_count      int not null default 0,
  file_path           text
);

alter table public.filings enable row level security;

create policy "Users can read own filings" on public.filings
  for select using (auth.uid() = user_id);

create policy "Users can insert own filings" on public.filings
  for insert with check (auth.uid() = user_id);

create policy "Users can update own filings" on public.filings
  for update using (auth.uid() = user_id);

-- Auto-update updated_at on every row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists filings_set_updated_at on public.filings;
create trigger filings_set_updated_at
  before update on public.filings
  for each row execute procedure public.set_updated_at();


-- ============================================================================
-- TABLE: reportable_transactions
-- One row per transaction per filing. Used by pdfGenerator and wizard.
-- ============================================================================
create table if not exists public.reportable_transactions (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz default now(),
  filing_id        uuid        not null references public.filings(id) on delete cascade,
  transaction_type text        not null
                   check (transaction_type in (
                     'sales','service_payment','rent_royalty',
                     'loan_to_llc','loan_from_llc','interest',
                     'insurance','dividend','commission','intangible',
                     'other','capital_contribution','distribution',
                     'formation_costs','property_transfer'
                   )),
  direction        text        not null check (direction in ('paid','received')),
  amount_usd       numeric,
  transaction_date date,
  description      text
);

alter table public.reportable_transactions enable row level security;

create policy "Users can read own transactions" on public.reportable_transactions
  for select using (
    exists (
      select 1 from public.filings f
      where f.id = filing_id and f.user_id = auth.uid()
    )
  );

create policy "Users can insert own transactions" on public.reportable_transactions
  for insert with check (
    exists (
      select 1 from public.filings f
      where f.id = filing_id and f.user_id = auth.uid()
    )
  );

create policy "Users can update own transactions" on public.reportable_transactions
  for update using (
    exists (
      select 1 from public.filings f
      where f.id = filing_id and f.user_id = auth.uid()
    )
  );

create policy "Users can delete own transactions" on public.reportable_transactions
  for delete using (
    exists (
      select 1 from public.filings f
      where f.id = filing_id and f.user_id = auth.uid()
    )
  );


-- ============================================================================
-- STORAGE: filings bucket (private, user-scoped)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('filings', 'filings', false)
on conflict do nothing;

create policy "Users upload own filings" on storage.objects
  for insert with check (
    bucket_id = 'filings' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users read own filings" on storage.objects
  for select using (
    bucket_id = 'filings' and
    auth.uid()::text = (storage.foldername(name))[1]
  );


-- ============================================================================
-- MIGRATIONS — idempotent, safe to run on existing databases
-- ============================================================================

-- linked_filing_id on intake_submissions
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'intake_submissions'
      and column_name = 'linked_filing_id'
  ) then
    alter table public.intake_submissions
      add column linked_filing_id uuid references public.filings(id) on delete set null;
  end if;
end; $$;

-- intake_submissions UPDATE policy
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'intake_submissions'
      and policyname = 'Users can update own submissions'
  ) then
    execute $p$ create policy "Users can update own submissions"
      on public.intake_submissions for update
      using (auth.uid() = user_id) $p$;
  end if;
end; $$;

-- filings: updated_at column
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'filings'
      and column_name = 'updated_at'
  ) then
    alter table public.filings add column updated_at timestamptz default now();
  end if;
end; $$;

-- filings: service_type column
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'filings'
      and column_name = 'service_type'
  ) then
    alter table public.filings
      add column service_type text not null default 'current_year'
      check (service_type in ('current_year','past_year','tax_classification'));
  end if;
end; $$;

-- filings: current_step column
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'filings'
      and column_name = 'current_step'
  ) then
    alter table public.filings add column current_step int not null default 1;
  end if;
end; $$;

-- filings: status check constraint (expand to full set)
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'filings'
      and column_name = 'status'
  ) then
    alter table public.filings drop constraint if exists filings_status_check;
    alter table public.filings
      add constraint filings_status_check
      check (status in ('draft','in_progress','payment_failed','paid','completed','submitted'));
  end if;
end; $$;

-- filings: initial_return column
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'filings'
      and column_name = 'initial_return'
  ) then
    alter table public.filings add column initial_return boolean not null default false;
  end if;
end; $$;

-- filings: tax_period_begin / tax_period_end
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'filings'
      and column_name = 'tax_period_begin'
  ) then
    alter table public.filings add column tax_period_begin date;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'filings'
      and column_name = 'tax_period_end'
  ) then
    alter table public.filings add column tax_period_end date;
  end if;
end; $$;

-- filings: owner / related-party columns
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_full_name') then alter table public.filings add column owner_full_name text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_country_residence') then alter table public.filings add column owner_country_residence text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_country_citizenship') then alter table public.filings add column owner_country_citizenship text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_resident_country') then alter table public.filings add column owner_resident_country text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_passport_number') then alter table public.filings add column owner_passport_number text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_foreign_tax_id') then alter table public.filings add column owner_foreign_tax_id text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_address') then alter table public.filings add column owner_address jsonb; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_primary_country') then alter table public.filings add column owner_primary_country text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_us_tin') then alter table public.filings add column owner_us_tin text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_reference_id') then alter table public.filings add column owner_reference_id text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_naics_code') then alter table public.filings add column owner_naics_code text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='owner_naics_description') then alter table public.filings add column owner_naics_description text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='rp_is_related_only') then alter table public.filings add column rp_is_related_only boolean; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='rp_is_both') then alter table public.filings add column rp_is_both boolean; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='include_irs_fax') then alter table public.filings add column include_irs_fax boolean not null default false; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='include_rcl') then alter table public.filings add column include_rcl boolean not null default false; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='parties_count') then alter table public.filings add column parties_count int not null default 1; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='complex_sections') then alter table public.filings add column complex_sections text[] not null default '{}'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='paid_at') then alter table public.filings add column paid_at timestamptz; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='payment_id') then alter table public.filings add column payment_id text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='payment_amount_cents') then alter table public.filings add column payment_amount_cents int; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='forms_generated_at') then alter table public.filings add column forms_generated_at timestamptz; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='download_count') then alter table public.filings add column download_count int not null default 0; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='mailing_address') then alter table public.filings add column mailing_address jsonb; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='state_of_formation') then alter table public.filings add column state_of_formation text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='total_assets') then alter table public.filings add column total_assets numeric; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='naics_code') then alter table public.filings add column naics_code text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='naics_description') then alter table public.filings add column naics_description text; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='date_of_incorporation') then alter table public.filings add column date_of_incorporation date; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='date_of_closure') then alter table public.filings add column date_of_closure date; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='name_change') then alter table public.filings add column name_change boolean; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='filings' and column_name='address_change') then alter table public.filings add column address_change boolean; end if;
end; $$;

-- reportable_transactions table (if upgrading from schema without it)
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

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can read own transactions') then
    execute $p$ create policy "Users can read own transactions" on public.reportable_transactions for select using (exists (select 1 from public.filings f where f.id = filing_id and f.user_id = auth.uid())) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can insert own transactions') then
    execute $p$ create policy "Users can insert own transactions" on public.reportable_transactions for insert with check (exists (select 1 from public.filings f where f.id = filing_id and f.user_id = auth.uid())) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can update own transactions') then
    execute $p$ create policy "Users can update own transactions" on public.reportable_transactions for update using (exists (select 1 from public.filings f where f.id = filing_id and f.user_id = auth.uid())) $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reportable_transactions' and policyname='Users can delete own transactions') then
    execute $p$ create policy "Users can delete own transactions" on public.reportable_transactions for delete using (exists (select 1 from public.filings f where f.id = filing_id and f.user_id = auth.uid())) $p$;
  end if;
end; $$;

alter table if exists public.reportable_transactions enable row level security;
