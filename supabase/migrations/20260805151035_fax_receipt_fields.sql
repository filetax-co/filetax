-- ============================================================================
-- 2026-08-05  The three fields a fax transmission receipt needs and the row
--             did not carry.
-- ============================================================================
--
-- A receipt is evidence. It is the document a filer puts in front of the IRS in
-- a penalty dispute under IRC 6038A, so every fact on it has to come from a
-- record made at the time, not reconstructed later from a config value that may
-- since have changed.
--
-- sender_fax        Who sent it. Lived only in the SINCH_FAX_NUMBER secret,
--                   which the browser cannot read and which changes without
--                   leaving a trace on past transmissions. Written by
--                   dispatch-irs-fax at SUBMIT time, not from the delivery
--                   callback, so a receipt is complete the moment the fax is
--                   delivered rather than depending on which fields Sinch chose
--                   to echo back.
--
-- pages_sent        Sinch reports numberOfPages AND pagesSentSuccessfully, and
--                   they are not the same number. A partial transmission is the
--                   single most important thing a receipt could tell a filer,
--                   and collapsing the two into one "pages" figure is how that
--                   fact gets lost. Kept separate from page_count deliberately.
--
-- provider_error_code  Sinch's own error code on a FAILURE. failure_reason is
--                   our prose; this is their identifier, which is what support
--                   would quote back to them.
--
-- Idempotent; safe to run / re-run.
-- ============================================================================

alter table public.fax_transmissions
  add column if not exists sender_fax          text,
  add column if not exists pages_sent          integer,
  add column if not exists provider_error_code text;

comment on column public.fax_transmissions.sender_fax is
  'The sending fax number, recorded at submit time. Not read from config when a '
  'receipt is rendered: the secret can change, a transmission record cannot.';

comment on column public.fax_transmissions.pages_sent is
  'Sinch pagesSentSuccessfully: pages the far end actually received. Differs '
  'from page_count (pages transmitted) on a partial send.';

comment on column public.fax_transmissions.provider_error_code is
  'Sinch errorCode on a failed transmission. Their identifier, not our prose.';

notify pgrst, 'reload schema';
