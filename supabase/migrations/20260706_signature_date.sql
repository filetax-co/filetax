-- Signature date printed on the pro forma Form 1120.
--
-- Collected once in intake (with the owner's details) and printed on the Form
-- 1120 "Date" line for every year, so the package is ready to print and mail
-- without hand-dating each return.
alter table public.filings
  add column if not exists signature_date date;
