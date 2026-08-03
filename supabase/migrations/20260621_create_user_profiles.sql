-- User profiles: stores LLC + owner defaults so new filings are pre-filled
create table if not exists user_profiles (
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

alter table user_profiles enable row level security;

create policy "Users manage own profile"
  on user_profiles for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
