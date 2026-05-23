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

-- Enable RLS
alter table public.intake_submissions enable row level security;

-- Policy: users can read their own submissions
create policy "Users can read own submissions" on public.intake_submissions
  for select using (auth.uid() = user_id);

-- Policy: anyone (anon) can insert (signup from portal)
create policy "Anyone can insert intake" on public.intake_submissions
  for insert with check (true);


-- 2. filings — CPA updates status here; users read their own
create table if not exists public.filings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  tax_year    text not null,
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

-- Policy: users can read their own filings
create policy "Users can read own filings" on public.filings
  for select using (auth.uid() = user_id);

-- Policy: users can update their own filings (for file_path after upload)
create policy "Users can update own filings" on public.filings
  for update using (auth.uid() = user_id);


-- 3. Storage bucket for completed filing PDFs
insert into storage.buckets (id, name, public)
values ('filings', 'filings', false)
on conflict do nothing;

-- Storage policy: users can upload to their own folder
create policy "Users upload own filings" on storage.objects
  for insert with check (
    bucket_id = 'filings' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage policy: users can read their own files
create policy "Users read own filings" on storage.objects
  for select using (
    bucket_id = 'filings' and
    auth.uid()::text = (storage.foldername(name))[1]
  );


-- =============================================================================
-- MIGRATION: add initial_return to existing filings table
-- Run this block ONLY if your filings table already exists in production.
-- Safe to run multiple times (checks column existence before adding).
-- =============================================================================
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
