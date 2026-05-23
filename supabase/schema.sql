-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. intake_submissions — saves every portal signup
create table if not exists public.intake_submissions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  user_id      uuid references auth.users(id) on delete set null,
  full_name    text not null,
  email        text not null,
  llc_name     text,
  ein          text,
  tax_year     text,
  years_param  text,
  sections_param text,
  parties_param  int,
  rcl_param    boolean,
  status       text not null default 'pending' check (status in ('pending','in_progress','completed'))
);

alter table public.intake_submissions enable row level security;

create policy "Users can read own submissions" on public.intake_submissions
  for select using (auth.uid() = user_id);

create policy "Anyone can insert intake" on public.intake_submissions
  for insert with check (true);


-- 2. filings — core filing table
create table if not exists public.filings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  tax_year    text not null,
  -- Tax period begin/end (ISO date: YYYY-MM-DD).
  -- Collected from the user during the wizard.
  -- For a standard calendar-year LLC: '2024-01-01' / '2024-12-31'.
  -- For a fiscal-year LLC the user enters their actual dates.
  -- Used to fill the four header fields on Form 5472 (f1_1–f1_4)
  -- and the equivalent fields on Pro Forma 1120.
  tax_period_begin  date,
  tax_period_end    date,
  form_type   text not null default 'Form 5472 + Pro Forma 1120',
  status      text not null default 'pending' check (status in ('pending','in_progress','completed')),
  notes       text,
  file_path   text,
  -- Auto-derived checkbox: true when the LLC was incorporated in tax_year - 1.
  -- Maps to the "Initial return" checkbox on Form 5472 (top of page 1)
  -- and the equivalent checkbox on the Pro Forma 1120 cover sheet.
  -- Never manually set by users — always written by the wizard rules engine.
  initial_return boolean not null default false
);

alter table public.filings enable row level security;

create policy "Users can read own filings" on public.filings
  for select using (auth.uid() = user_id);

create policy "Users can update own filings" on public.filings
  for update using (auth.uid() = user_id);


-- 3. Storage bucket for completed filing PDFs
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


-- =============================================================================
-- MIGRATIONS — safe to run on an existing database (idempotent)
-- =============================================================================

-- Migration: add initial_return (if upgrading from schema before this column)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'filings'
      and column_name  = 'initial_return'
  ) then
    alter table public.filings
      add column initial_return boolean not null default false;
  end if;
end;
$$;

-- Migration: add tax_period_begin and tax_period_end (dynamic tax year header)
-- These replace the previously hardcoded 'January 1' / 'December 31' values.
-- Collecting exact dates from the user supports fiscal-year LLCs and ensures
-- the four header fields on Form 5472 (f1_1–f1_4) are always correct.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'filings'
      and column_name  = 'tax_period_begin'
  ) then
    alter table public.filings add column tax_period_begin date;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'filings'
      and column_name  = 'tax_period_end'
  ) then
    alter table public.filings add column tax_period_end date;
  end if;
end;
$$;
