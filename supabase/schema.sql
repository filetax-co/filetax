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

-- SECURITY: anonymous visitors may submit intake (user_id must be null);
-- authenticated users may only insert rows with their own user_id. Without
-- this clamp, any logged-in user could attach an intake to another user's
-- account by spoofing user_id or linked_filing_id.
create policy "Anyone can insert intake" on public.intake_submissions
  for insert with check (
    (auth.uid() is null and user_id is null and linked_filing_id is null)
    or (auth.uid() is not null and auth.uid() = user_id)
  );

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

  -- ── Signer / activity ─────────────────────────────────────────────────────
  -- signer_title: printed on the Form 1120 signature line (default "Owner")
  -- owner_business_activity: principal business activity description
  signer_title              text,
  owner_business_activity   text,

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

-- SECURITY: prevent authenticated clients from self-marking a filing as paid.
-- Only service-role (edge functions like verify-payment) may write the payment
-- columns or flip status to 'paid' / 'completed'. RLS lacks column-level WITH
-- CHECK, so we enforce this with a trigger.
--
-- Covers both INSERT and UPDATE so a client cannot bypass the check by
-- inserting a new row already marked status='paid'.
create or replace function public.filings_block_payment_writes()
returns trigger language plpgsql security definer as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Block the client from setting status='paid' under any circumstance.
  -- Allow paid -> completed (the user clicking Download), but only when the
  -- filing is already in a paid state.
  -- On INSERT old is null, so `is distinct from` correctly fires for any
  -- non-default value the client tries to sneak in.
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
  or new.forms_generated_at   is distinct from old.forms_generated_at then
    raise exception 'payment columns are server-managed and cannot be written from the client'
      using errcode = '42501';
  end if;

  return new;
 end;
$$;

drop trigger if exists filings_block_payment_writes on public.filings;
create trigger filings_block_payment_writes
  before insert or update on public.filings
  for each row execute procedure public.filings_block_payment_writes();


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
                     'formation_costs','property_transfer',
                     -- Used by pdfGenerator.aggregateTransactions:
                     'tangible_property','loan_guarantee','nonmonetary_other'
                   )),
  direction        text        not null check (direction in ('paid','received')),
  amount_usd       numeric,
  transaction_date date,
  description      text,
  -- Only meaningful when transaction_type = 'rent_royalty'. true means the
  -- amount maps to royalties_* lines (13b / 27b); false (or null) means rents
  -- (13a / 27a).
  is_royalty       boolean
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
-- STORAGE: filled-forms bucket (private, user-scoped)
-- Used by the generate-forms edge function. Path layout: <user_id>/<filing_id>/...
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('filled-forms', 'filled-forms', false)
on conflict do nothing;

create policy "Users read own filled forms" on storage.objects
  for select using (
    bucket_id = 'filled-forms' and
    auth.uid()::text = (storage.foldername(name))[1]
  );
-- Note: writes go through the edge function which uses the service-role key,
-- so we deliberately do NOT add an INSERT policy for authenticated users.


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

-- filings: signer_title + owner_business_activity (Fix 3d)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='filings' and column_name='signer_title'
  ) then
    alter table public.filings add column signer_title text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='filings' and column_name='owner_business_activity'
  ) then
    alter table public.filings add column owner_business_activity text;
  end if;
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

-- Idempotent: ensure transaction_type CHECK matches the code-side union.
-- Drop-and-recreate is safe because existing rows can only contain values
-- that previously passed the constraint.
do $$ begin
  alter table public.reportable_transactions
    drop constraint if exists reportable_transactions_transaction_type_check;
  alter table public.reportable_transactions
    add constraint reportable_transactions_transaction_type_check
    check (transaction_type in (
      'sales','service_payment','rent_royalty',
      'loan_to_llc','loan_from_llc','interest',
      'insurance','dividend','commission','intangible',
      'other','capital_contribution','distribution',
      'formation_costs','property_transfer',
      'tangible_property','loan_guarantee','nonmonetary_other'
    ));
end; $$;

-- Optional: backfill is_royalty column on older databases.
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='reportable_transactions'
      and column_name='is_royalty'
  ) then
    alter table public.reportable_transactions add column is_royalty boolean;
  end if;
end; $$;

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
