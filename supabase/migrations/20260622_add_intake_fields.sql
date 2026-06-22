-- Add missing intake wizard columns to the filings table
-- These columns were written by patchFromCurrentStep() in Intake.tsx
-- but were absent from the table, causing selects to return null on refresh.
alter table filings
  add column if not exists mailing_address            jsonb,
  add column if not exists entity_business_activity   text,
  add column if not exists entity_business_code       text,
  add column if not exists owner_address              jsonb,
  add column if not exists owner_ref_number           text,
  add column if not exists owner_date_of_incorporation text,
  add column if not exists owner_country              text,
  add column if not exists owner_business_code        text;
