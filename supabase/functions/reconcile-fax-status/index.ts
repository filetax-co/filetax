// Asks Sinch what actually happened to a fax, and records it.
//
// WHY THIS EXISTS
// `sinch-fax-webhook` is the fast path and it is not a reliable one. On
// 5 August 2026 a fax that the receiving end DID get never reached `delivered`,
// because Sinch could not complete the callback: their alert said "could not
// connect", and Supabase logged a 503 after 160 seconds with no function id,
// so our code never ran. Separately the callback token had drifted out of sync,
// which would have rejected the notice even if it had arrived. Three of three
// rows in the table were stuck at `submitted`, for three different reasons.
//
// A receipt that exists only when a callback arrives is a receipt that
// sometimes does not exist, and this one is evidence a filer may need in a
// penalty dispute. So the delivery record is also PULLED: the callback stays
// the fast path, this is the one that cannot silently not happen.
//
// Deliberately the same write rules as the webhook, and they are the reason
// this is not a thin proxy:
//   - only COMPLETED counts as delivered
//   - `delivered_at` is Sinch's completedTime, never our clock
//   - a delivered row is never rewritten, so a timestamp a filer already has on
//     a receipt cannot move, and a later non-delivered status cannot walk a
//     delivered fax backwards
//   - numberOfPages and pagesSentSuccessfully stay two separate numbers
//
// Authenticated (`verify_jwt: true`): unlike the webhook, the caller here is
// the filer's own browser, so it has a session and ownership is checked.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Read per request, never at module load. See the note in dispatch-irs-fax:
// a module-scope read pins the value to whenever the isolate booted.
const sinch = () => ({
  projectId: Deno.env.get('SINCH_PROJECT_ID'),
  key: Deno.env.get('SINCH_ACCESS_KEY'),
  secret: Deno.env.get('SINCH_ACCESS_SECRET'),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

const DELIVERED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'DELIVERED']);

/**
 * Advance the filing(s) this transmission covers to `submitted`.
 *
 * A COPY of the same function in `sinch-fax-webhook`, and it has to be: the two
 * functions deploy separately, and this one exists precisely for the case where
 * the webhook never ran. If a delivery only ever becomes known through this
 * path, this is the only chance the filing has to learn it. Change one, change
 * the other. See the long note there for why the filing carries the status at
 * all rather than every surface querying fax_transmissions for a second chip.
 *
 * Job-scoped when the filing belongs to a catch-up: one $9 transmission covers
 * every year in the job. Only forward, and only from `paid` / `completed`, so a
 * repeated reconcile is a no-op and no draft can be dragged into `submitted`.
 */
async function markFilingsSubmitted(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  filing: { id: string; job_id: string | null },
): Promise<void> {
  const query = supabase
    .from('filings')
    .update({ status: 'submitted', updated_at: new Date().toISOString() })
    .in('status', ['paid', 'completed']);
  const { error } = filing.job_id
    ? await query.eq('job_id', filing.job_id)
    : await query.eq('id', filing.id);
  if (error) console.error('[reconcile-fax-status] filings -> submitted', filing.id, error);
}
// Sinch's own terminal set. QUEUED and IN_PROGRESS are not outcomes: recording
// either as `failed` would tell a filer their filing failed while it is still
// on its way.
const TERMINAL_STATUSES = new Set([...DELIVERED_STATUSES, 'FAILURE', 'FAILED', 'EXPIRED']);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { projectId, key, secret } = sinch();
    if (!projectId || !key || !secret) {
      return json({ error: 'Fax delivery is not configured.' }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { filing_id } = await req.json() as { filing_id?: string };
    if (!filing_id) return json({ error: 'filing_id is required' }, 400);

    // Scoped to the caller's own rows. RLS is not in play here (service role),
    // so ownership is checked explicitly, exactly as dispatch-irs-fax does.
    const { data: filing } = await supabase
      .from('filings').select('id, job_id, user_id').eq('id', filing_id).eq('user_id', user.id).single();
    if (!filing) return json({ error: 'Filing not found.' }, 404);

    const dispatchKey = filing.job_id ? `job:${filing.job_id}` : `filing:${filing.id}`;
    const { data: row } = await supabase
      .from('fax_transmissions')
      .select('id, status, provider_fax_id, delivered_at')
      .eq('dispatch_key', dispatchKey)
      .maybeSingle();

    if (!row) return json({ error: 'No fax has been sent for this filing.' }, 404);
    if (!row.provider_fax_id) {
      // Claimed but never accepted by Sinch. There is nothing to ask about.
      return json({ status: row.status, checked: false });
    }
    // Already settled. Asking again could only overwrite a timestamp the filer
    // may already be holding on a receipt.
    if (row.status === 'delivered') {
      // Nothing to ask Sinch, but the filing still gets a nudge: this is the
      // repair path for a delivery that was recorded before `submitted` had a
      // writer, or where the status update failed after the transmission wrote.
      await markFilingsSubmitted(supabase, filing);
      return json({ status: 'delivered', unchanged: true });
    }

    const basic = btoa(`${key}:${secret}`);
    const response = await fetch(
      `https://fax.api.sinch.com/v3/projects/${encodeURIComponent(projectId)}/faxes/${encodeURIComponent(row.provider_fax_id)}`,
      { headers: { Authorization: `Basic ${basic}` } },
    );
    if (!response.ok) {
      console.error('[reconcile-fax-status] Sinch lookup', response.status, await response.text());
      return json({ error: 'The fax provider could not be reached. Please try again shortly.' }, 502);
    }
    const fax = await response.json() as Record<string, unknown>;

    const providerStatus = typeof fax.status === 'string' ? fax.status.toUpperCase() : null;
    if (!providerStatus || !TERMINAL_STATUSES.has(providerStatus)) {
      // Still in flight. Report it and write nothing: `submitted` is already
      // the honest description of a fax Sinch has not finished sending.
      return json({ status: row.status, provider_status: providerStatus, pending: true });
    }

    const delivered = DELIVERED_STATUSES.has(providerStatus);
    const pages = Number(fax.numberOfPages);
    const pagesSent = Number(fax.pagesSentSuccessfully);
    const completedTime = typeof fax.completedTime === 'string' ? fax.completedTime : null;

    const patch: Record<string, unknown> = {
      status: delivered ? 'delivered' : 'failed',
      provider_status: providerStatus,
      updated_at: new Date().toISOString(),
    };
    if (Number.isFinite(pages) && pages > 0) patch.page_count = Math.trunc(pages);
    if (Number.isFinite(pagesSent) && pagesSent >= 0) patch.pages_sent = Math.trunc(pagesSent);
    if (fax.errorCode != null && fax.errorCode !== '') {
      patch.provider_error_code = String(fax.errorCode).slice(0, 100);
    }
    if (delivered) {
      // Sinch's completion time, not ours, and not the time we got around to
      // asking. This is the timestamp that goes in front of the IRS.
      patch.delivered_at = completedTime ?? new Date().toISOString();
      patch.failure_reason = null;
    } else {
      patch.failure_reason = `Sinch reported ${providerStatus} on completion.`;
    }

    const { error: updateErr } = await supabase
      .from('fax_transmissions').update(patch).eq('id', row.id);
    if (updateErr) {
      console.error('[reconcile-fax-status] update failed', row.id, updateErr);
      return json({ error: 'The delivery record could not be saved.' }, 500);
    }

    // After the transmission write. Same ordering rule as the webhook: the
    // receipt is the source of truth, the filing status is a projection of it.
    if (delivered) await markFilingsSubmitted(supabase, filing);

    console.log('[reconcile-fax-status]', row.provider_fax_id, row.status, '->', patch.status, providerStatus);
    return json({ status: patch.status, provider_status: providerStatus, checked: true });
  } catch (err) {
    console.error('[reconcile-fax-status]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
