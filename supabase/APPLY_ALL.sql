-- ============================================================================
-- FileTax — APPLY ALL CHANGES
--
-- Paste this entire file into the Supabase SQL editor (New query → Run).
-- It is idempotent: safe to run on your existing database and safe to re-run.
-- It folds together every schema change the current app needs:
--   • filing_jobs table (multi-year catch-up; one shared reasonable-cause letter)
--   • all new columns on filings / reportable_transactions / user_profiles
--   • payment-integrity triggers (identity freeze + 2-edit correction budget)
--
-- Ordered so dependencies resolve (filing_jobs exists before filings.job_id
-- references it; helper functions exist before the triggers that use them).
-- ============================================================================

-- ── 0. Shared helper (normally already created by the base schema) ──────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. filing_jobs — groups the year-filings of a multi-year catch-up so a
--    SINGLE reasonable-cause letter can cover every year.
-- ============================================================================
create table if not exists public.filing_jobs (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  tax_years     int[]       not null default '{}',
  include_rcl   boolean     not null default false,
  rcl_narrative text,
  delivery      text        not null default 'self_mail'
                check (delivery in ('self_mail','fax')),
  status        text        not null default 'draft'
);

alter table public.filing_jobs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'filing_jobs'
      and policyname = 'Users manage own filing jobs'
  ) then
    execute $p$ create policy "Users manage own filing jobs" on public.filing_jobs
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id) $p$;
  end if;
end $$;

drop trigger if exists filing_jobs_set_updated_at on public.filing_jobs;
create trigger filing_jobs_set_updated_at
  before update on public.filing_jobs
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- 2. filings — every column the wizard + PDF generator read/write.
-- ============================================================================
alter table public.filings
  -- wizard step 1 (entity)
  add column if not exists entity_date_of_incorporation  text,
  add column if not exists entity_principal_country      text,
  add column if not exists entity_business_activity      text,
  add column if not exists entity_business_code          text,
  add column if not exists mailing_address               jsonb,
  -- canonical entity columns the PDF generator reads
  add column if not exists date_of_incorporation         date,
  add column if not exists naics_code                    text,
  add column if not exists naics_description             text,
  -- wizard step 1b (late filing)
  add column if not exists extension_filed               boolean,
  add column if not exists include_reasonable_cause      boolean,
  add column if not exists reasonable_cause_reasons      text[],
  -- wizard step 2 (owner)
  add column if not exists owner_country                 text,
  add column if not exists owner_ssn                     text,
  add column if not exists owner_ref_number              text,
  add column if not exists owner_address                 jsonb,
  add column if not exists owner_business_activity       text,
  add column if not exists owner_business_code           text,
  -- canonical owner columns the PDF generator reads
  add column if not exists owner_primary_country         text,
  add column if not exists owner_country_citizenship     text,
  add column if not exists owner_us_tin                  text,
  add column if not exists owner_reference_id            text,
  add column if not exists owner_naics_code              text,
  -- wizard step 3 (related parties) + step 4
  add column if not exists related_parties               jsonb not null default '[]'::jsonb,
  add column if not exists no_transactions_confirmed     boolean not null default false,
  add column if not exists part_vi_managerial            boolean not null default true,
  -- final / fiscal year
  add column if not exists final_return                  boolean not null default false,
  add column if not exists is_fiscal_year                boolean not null default false,
  add column if not exists tax_period_begin              date,
  add column if not exists tax_period_end                date,
  -- multi-year job link
  add column if not exists job_id                        uuid references public.filing_jobs(id) on delete set null,
  -- post-payment correction budget (payment integrity)
  add column if not exists post_payment_edits            int not null default 0,
  -- signer
  add column if not exists signer_title                  text;

create index if not exists filings_job_id_idx on public.filings(job_id);

-- ============================================================================
-- 3. reportable_transactions — new per-row columns + canonical type CHECK.
-- ============================================================================
alter table public.reportable_transactions
  add column if not exists related_party_index int     not null default 0,
  add column if not exists loan_begin_usd      numeric,
  add column if not exists is_royalty          boolean;

do $$
begin
  alter table public.reportable_transactions
    drop constraint if exists reportable_transactions_transaction_type_check;
  alter table public.reportable_transactions
    add constraint reportable_transactions_transaction_type_check
    check (transaction_type in (
      'sales','service_payment','rent_royalty','loan_to_llc','loan_from_llc',
      'interest','insurance','dividend','commission','intangible','other',
      'capital_contribution','distribution','formation_costs','property_transfer',
      'tangible_property','loan_guarantee','nonmonetary_other'
    ));
exception when others then
  raise notice 'Could not re-assert transaction_type check: %', sqlerrm;
end $$;

-- ============================================================================
-- 4. user_profiles — prefill surface (year-2+ auto-fill for review).
--    Created here if missing (it lives in migration 20260621, which may or may
--    not have been applied), then expanded with the full prefill column set.
-- ============================================================================
create table if not exists public.user_profiles (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid references auth.users(id) on delete cascade unique,
  llc_name                 text,
  ein                      text,
  state_of_formation       text,
  country_of_incorporation text,
  date_of_incorporation    date,
  llc_us_address           jsonb,
  owner_full_name          text,
  owner_country_residence  text,
  owner_foreign_tax_id     text,
  owner_foreign_address    jsonb,
  updated_at               timestamptz default now()
);

alter table public.user_profiles enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
      and policyname = 'Users manage own profile'
  ) then
    execute $p$ create policy "Users manage own profile" on public.user_profiles
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id) $p$;
  end if;
end $$;

alter table public.user_profiles
  add column if not exists mailing_address            jsonb,
  add column if not exists entity_business_activity   text,
  add column if not exists entity_business_code       text,
  add column if not exists naics_code                 text,
  add column if not exists naics_description          text,
  add column if not exists owner_full_name            text,
  add column if not exists owner_country              text,
  add column if not exists owner_primary_country      text,
  add column if not exists owner_country_residence    text,
  add column if not exists owner_country_citizenship  text,
  add column if not exists owner_foreign_tax_id       text,
  add column if not exists owner_us_tin               text,
  add column if not exists owner_reference_id         text,
  add column if not exists owner_ref_number           text,
  add column if not exists owner_address              jsonb,
  add column if not exists owner_business_activity    text,
  add column if not exists owner_business_code        text,
  add column if not exists owner_naics_code           text,
  add column if not exists signer_title               text,
  add column if not exists related_parties            jsonb not null default '[]'::jsonb;

-- ============================================================================
-- 5. Payment integrity — identity freeze + correction budget.
--    One payment must produce ONE company's filing. Identity columns are
--    frozen once paid; other fields are correctable up to 2 edits; transactions
--    lock once the budget is exhausted. Service-role (edge functions) bypasses.
-- ============================================================================
create or replace function public.jsonb_arr_len(v jsonb)
returns int language sql immutable as $$
  select coalesce(jsonb_array_length(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end), 0)
$$;

create or replace function public.filings_freeze_when_paid()
returns trigger language plpgsql security definer as $$
declare
  identity_changed boolean;
  correctable_changed boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status in ('paid','completed') then

    identity_changed :=
         new.ein                  is distinct from old.ein
      or new.llc_name             is distinct from old.llc_name
      or new.tax_year             is distinct from old.tax_year
      or new.owner_full_name      is distinct from old.owner_full_name
      or new.owner_foreign_tax_id is distinct from old.owner_foreign_tax_id
      or new.date_of_incorporation is distinct from old.date_of_incorporation;

    if identity_changed then
      raise exception 'This filing is paid. Its identity (EIN, LLC name, tax year, owner name & tax ID, incorporation date) is locked. Start a new filing to file for a different company, owner, or year.'
        using errcode = '42501';
    end if;

    if public.jsonb_arr_len(new.related_parties) < public.jsonb_arr_len(old.related_parties) then
      raise exception 'A related party that was already filed cannot be removed after payment. Contact support if this was filed in error.'
        using errcode = '42501';
    end if;

    correctable_changed :=
         new.state_of_formation        is distinct from old.state_of_formation
      or new.total_assets              is distinct from old.total_assets
      or new.mailing_address           is distinct from old.mailing_address
      or new.naics_code                is distinct from old.naics_code
      or new.naics_description         is distinct from old.naics_description
      or new.owner_us_tin              is distinct from old.owner_us_tin
      or new.owner_reference_id        is distinct from old.owner_reference_id
      or new.owner_country             is distinct from old.owner_country
      or new.owner_primary_country     is distinct from old.owner_primary_country
      or new.owner_country_residence   is distinct from old.owner_country_residence
      or new.owner_country_citizenship is distinct from old.owner_country_citizenship
      or new.owner_address             is distinct from old.owner_address
      or new.final_return              is distinct from old.final_return
      or new.is_fiscal_year            is distinct from old.is_fiscal_year
      or new.tax_period_begin          is distinct from old.tax_period_begin
      or new.tax_period_end            is distinct from old.tax_period_end
      or new.part_vi_managerial        is distinct from old.part_vi_managerial;

    if correctable_changed and old.post_payment_edits >= 2 then
      raise exception 'You have used all available post-payment edits for this filing. Please contact support@filetax.co for further changes. (You can still re-download the current version.)'
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

create or replace function public.txn_block_when_filing_paid()
returns trigger language plpgsql security definer as $$
declare
  v_filing_id uuid;
  v_status    text;
  v_edits     int;
begin
  if auth.role() = 'service_role' then
    return coalesce(new, old);
  end if;

  v_filing_id := coalesce(new.filing_id, old.filing_id);
  select status, post_payment_edits into v_status, v_edits
    from public.filings where id = v_filing_id;

  if v_status in ('paid','completed') and coalesce(v_edits, 0) >= 2 then
    raise exception 'This filing has used all available post-payment edits; its transactions are locked. Contact support@filetax.co for further changes.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists txn_block_when_filing_paid on public.reportable_transactions;
create trigger txn_block_when_filing_paid
  before insert or update or delete on public.reportable_transactions
  for each row execute procedure public.txn_block_when_filing_paid();

-- ============================================================================
-- Done. Your schema now matches the application code.
-- ============================================================================
