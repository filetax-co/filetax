import { supabase } from './supabase';

/**
 * Reading the transmission record back.
 *
 * `fax_transmissions` was written by `dispatch-irs-fax` and updated by
 * `sinch-fax-webhook`, and read by nothing at all: not the dashboard, not the
 * filing page, not an email. A filer who paid $9 for delivery had one line of
 * transient React state as their only evidence, gone on refresh. This module is
 * the read side, and it is deliberately the ONLY place in the app that queries
 * the table, so the receipt and the on-screen status can never disagree about
 * which row they are describing.
 *
 * RLS permits select on your own rows and nothing else; inserts and updates
 * stay service-role only.
 */

export type FaxStatus = 'dispatching' | 'submitted' | 'delivered' | 'failed';

export interface FaxTransmission {
  id: string;
  filing_id: string;
  job_id: string | null;
  dispatch_key: string;
  provider: string;
  provider_fax_id: string | null;
  destination: string;
  /** Recorded at submit time, not read from config. See the migration comment. */
  sender_fax: string | null;
  status: FaxStatus;
  attempts: number;
  /** Sinch numberOfPages: pages transmitted. */
  page_count: number | null;
  /** Sinch pagesSentSuccessfully: pages the far end confirmed. */
  pages_sent: number | null;
  provider_status: string | null;
  provider_error_code: string | null;
  failure_reason: string | null;
  submitted_at: string | null;
  /** Sinch completedTime. The date a filer puts in front of the IRS. */
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The key `dispatch-irs-fax` writes. Job-scoped when the filing belongs to a
 * catch-up, because the $9 fee and the idempotency guard are job-scoped too:
 * one transmission covers every year, and looking it up per filing would find
 * nothing on every year but the one the filer happened to generate from.
 */
export const dispatchKeyFor = (filing: { id: string; job_id?: string | null }): string =>
  filing.job_id ? `job:${filing.job_id}` : `filing:${filing.id}`;

/** The transmission for this filing, or null if none has ever been dispatched. */
export async function loadFaxTransmission(
  filing: { id: string; job_id?: string | null },
): Promise<FaxTransmission | null> {
  const { data, error } = await supabase
    .from('fax_transmissions')
    .select('*')
    .eq('dispatch_key', dispatchKeyFor(filing))
    .maybeSingle();
  if (error) {
    console.error('[loadFaxTransmission]', error.message);
    return null;
  }
  return (data as FaxTransmission | null) ?? null;
}

/**
 * Settled either way. `dispatching` and `submitted` are both waiting states:
 * Sinch has not said COMPLETED or FAILURE yet, so there is nothing to confirm.
 */
export const isSettled = (t: FaxTransmission | null): boolean =>
  t?.status === 'delivered' || t?.status === 'failed';

/**
 * Whether a receipt can be produced. Only a delivered transmission has the
 * provider's completedTime, and a receipt without it would be describing a fax
 * that may still fail.
 */
export const canConfirm = (t: FaxTransmission | null): t is FaxTransmission =>
  t?.status === 'delivered';

/** Whether the filer may dispatch (or re-dispatch). Three attempts, per the row's own check. */
export const canDispatch = (t: FaxTransmission | null): boolean =>
  !t || (t.status === 'failed' && Number(t.attempts) < 3);

/**
 * One sentence about where the transmission stands, in the filer's terms.
 *
 * Each state says what it is rather than collapsing into "submitted". A filer
 * whose three attempts are spent needs to know the $9 is refundable, not that
 * something is still in progress.
 */
export function faxStatusLine(t: FaxTransmission | null): string {
  if (!t) return 'Not sent yet.';
  switch (t.status) {
    case 'dispatching':
      return 'Submitting your package to the fax provider.';
    case 'submitted':
      return 'Sent to the fax provider. Waiting for confirmation that the IRS line answered.';
    case 'delivered':
      return 'Delivered. Your transmission confirmation is ready to download.';
    case 'failed':
      return Number(t.attempts) >= 3
        ? `Delivery failed after ${t.attempts} attempts. Email support@filetax.co and we will refund the $9 fax fee.`
        : `Delivery failed${t.failure_reason ? `: ${t.failure_reason}` : '.'} You can try again.`;
  }
}

/**
 * Poll until the transmission settles.
 *
 * Sinch's callback arrives seconds to minutes after submission, and the row it
 * writes is the whole point of the fax page, so the filer should not have to
 * refresh to see it. Polling rather than Realtime: this runs on exactly one
 * screen, for at most a few minutes, and a subscription would be a second
 * transport to keep working for no gain.
 *
 * Returns a cancel function. Callers MUST call it on unmount, otherwise a
 * setState lands on a dead component every 5 seconds for ten minutes.
 */
export function pollFaxTransmission(
  filing: { id: string; job_id?: string | null },
  onUpdate: (t: FaxTransmission) => void,
  opts?: { intervalMs?: number; timeoutMs?: number },
): () => void {
  const intervalMs = opts?.intervalMs ?? 5_000;
  // Ten minutes. Long enough for a queued fax and a couple of Sinch retries,
  // short enough that a tab left open overnight is not still polling at dawn.
  const timeoutMs = opts?.timeoutMs ?? 10 * 60_000;
  const startedAt = Date.now();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (cancelled) return;
    const row = await loadFaxTransmission(filing);
    if (cancelled) return;
    if (row) onUpdate(row);
    if (isSettled(row) || Date.now() - startedAt > timeoutMs) return;
    timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
