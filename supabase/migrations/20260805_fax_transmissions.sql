-- Persist fax delivery metadata without storing the customer's tax return.
-- The PDF moves browser -> edge function -> Sinch and is never written to
-- Supabase Storage. One row per filing makes dispatch idempotent.

create table if not exists public.fax_transmissions (
  id                  uuid primary key default gen_random_uuid(),
  filing_id           uuid not null references public.filings(id) on delete restrict,
  job_id              uuid references public.filing_jobs(id) on delete restrict,
  dispatch_key        text not null unique,
  user_id             uuid not null references auth.users(id) on delete cascade,
  provider             text not null default 'sinch' check (provider = 'sinch'),
  provider_fax_id      text unique,
  destination          text not null,
  status               text not null default 'dispatching'
                       check (status in ('dispatching','submitted','delivered','failed')),
  attempts             integer not null default 1 check (attempts between 1 and 3),
  page_count           integer,
  provider_status      text,
  failure_reason       text,
  submitted_at         timestamptz,
  delivered_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.fax_transmissions enable row level security;

drop policy if exists "Users read own fax transmissions" on public.fax_transmissions;
create policy "Users read own fax transmissions"
  on public.fax_transmissions for select
  using (auth.uid() = user_id);

-- Inserts and updates are deliberately service-role only. The edge function
-- independently verifies ownership, paid status, and the purchased add-on.

create index if not exists fax_transmissions_user_id_idx
  on public.fax_transmissions(user_id);

notify pgrst, 'reload schema';
