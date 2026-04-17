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
  file_path   text
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
