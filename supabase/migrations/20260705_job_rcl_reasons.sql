-- Multi-year catch-up: collect the reasonable-cause REASONS once, at the job
-- level, instead of per year. One letter (and one set of reasons) covers every
-- year in the job.
alter table public.filing_jobs
  add column if not exists reasonable_cause_reasons text[] default '{}';
