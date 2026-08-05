// Accepts the final, signed PDF from the authenticated browser and relays it
// directly to Sinch. The document is never persisted by FileTax.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SINCH_PROJECT_ID = Deno.env.get('SINCH_PROJECT_ID');
const SINCH_ACCESS_KEY = Deno.env.get('SINCH_ACCESS_KEY');
const SINCH_ACCESS_SECRET = Deno.env.get('SINCH_ACCESS_SECRET');
const SINCH_FAX_SERVICE_ID = Deno.env.get('SINCH_FAX_SERVICE_ID');
const SINCH_FAX_NUMBER = Deno.env.get('SINCH_FAX_NUMBER');
// Shared secret embedded in the per-fax delivery callback URL. Deliberately not
// in the required-config check below: a missing callback degrades the delivery
// RECORD, it does not make the fax wrong, and a filer facing a penalty should
// not be blocked from filing because our reporting plumbing is unconfigured.
// READ PER REQUEST, not at module load. `Deno.env.get` at module scope is
// evaluated once when the isolate boots and then kept for the isolate's whole
// life, which can be hours. Rotate the secret and this function keeps embedding
// the OLD token in every callback URL while `sinch-fax-webhook`, booted later,
// compares the NEW one: every delivery notice is then rejected 401 and no fax
// can ever be recorded as delivered. That is exactly what happened on
// 5 August 2026, and nothing in either function's code could show it.
const webhookToken = () => Deno.env.get('SINCH_WEBHOOK_TOKEN');

/**
 * Signs one transmission id with the shared secret, so the callback URL can
 * carry proof instead of carrying the secret.
 *
 * WHY, and it is not theoretical. The token used to travel as `?token=<secret>`.
 * A per-fax callback URL is the only channel Sinch offers, so the secret was in
 * a URL, and Supabase logs the request URL of every edge function call in full.
 * Anyone who could read the project's logs could read the secret that gates
 * delivery writes, and rotating it did not help: the new one was logged on the
 * next fax. Sinch stores the callbackUrl against each fax record too, so it sat
 * in their system as well.
 *
 * What a leaked signature is worth now: one fax, whose callback is idempotent
 * anyway. It authorises nothing else, because it is bound to a transmission id
 * the webhook checks against the row the fax id resolves to.
 *
 * Hex, not base64url, because it survives a URL with no encoding questions.
 */
async function signTransmission(secret: string, transmissionId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(transmissionId));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Sinch's documented no-charge outbound test destination. Keep this hardcoded
// until the production destination is deliberately enabled in a later change.
const TEST_DESTINATION = '+19898989898';
const MAX_PDF_BYTES = 20 * 1024 * 1024;

// How long a row may sit in `dispatching` before another attempt may claim it.
// A run that dies between the insert and the Sinch response (network drop, wall
// clock or CPU limit, a crashed isolate) leaves the row claimed by nobody. With
// no reclaim, every later attempt sees a live dispatch, returns `duplicate`, and
// the paid fax can never be sent again. Comfortably longer than the worst
// observed Sinch call, so this cannot overlap a request still in flight.
const STALE_DISPATCH_MS = 5 * 60 * 1000;

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Set once a transmission row is claimed by this request. Everything before
  // that point owns no row and has nothing to release.
  let releaseClaim: ((reason: string) => Promise<void>) | null = null;

  try {
    if (
      !SINCH_PROJECT_ID || !SINCH_ACCESS_KEY || !SINCH_ACCESS_SECRET ||
      !SINCH_FAX_SERVICE_ID || !SINCH_FAX_NUMBER
    ) {
      return json({ error: 'Fax delivery is not configured.' }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const input = await req.formData();
    const filingId = input.get('filing_id');
    const file = input.get('file');
    if (typeof filingId !== 'string' || !(file instanceof File)) {
      return json({ error: 'filing_id and a PDF file are required.' }, 400);
    }
    if (file.type !== 'application/pdf' || file.size < 5 || file.size > MAX_PDF_BYTES) {
      return json({ error: 'The fax must be a PDF no larger than 20 MB.' }, 400);
    }
    const magic = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (new TextDecoder().decode(magic) !== '%PDF-') {
      return json({ error: 'The uploaded file is not a PDF.' }, 400);
    }

    const { data: filing, error: filingErr } = await supabase
      .from('filings')
      .select('id, user_id, status, include_irs_fax, job_id')
      .eq('id', filingId)
      .eq('user_id', user.id)
      .single();
    if (filingErr || !filing) return json({ error: 'Filing not found.' }, 404);
    if (!['paid', 'completed'].includes(filing.status)) {
      return json({ error: 'This filing does not have paid IRS fax delivery.' }, 403);
    }

    // Entitlement is JOB-WIDE, because the fee is. `create-checkout-session`
    // charges one $9 fax if ANY filing in the job has the flag, and
    // `verify-payment` re-derives the same cart. Reading only the row the filer
    // happens to be standing on contradicted both: on a catch-up the flag lives
    // on whichever year's intake screen the filer ticked it, nothing mirrors it
    // to the sibling years, and the bundle can be generated from any year's
    // screen. Paying from the 2022 screen and generating from the 2024 one
    // bought a transmission that was then refused here, silently, with the $9
    // already taken. The idempotency key is job-scoped, so the entitlement has
    // to be too.
    let entitled = filing.include_irs_fax === true;
    if (!entitled && filing.job_id) {
      const { data: siblings } = await supabase
        .from('filings')
        .select('include_irs_fax')
        .eq('job_id', filing.job_id)
        .eq('user_id', user.id);
      entitled = (siblings ?? []).some((row) => row.include_irs_fax === true);
    }
    if (!entitled) {
      return json({ error: 'This filing does not have paid IRS fax delivery.' }, 403);
    }
    const dispatchKey = filing.job_id ? `job:${filing.job_id}` : `filing:${filing.id}`;

    const { data: existing } = await supabase
      .from('fax_transmissions')
      .select('id, status, provider_fax_id, attempts, updated_at')
      .eq('dispatch_key', dispatchKey)
      .maybeSingle();

    // An abandoned claim is not a live one. Only `dispatching` can go stale:
    // `submitted` and `delivered` are settled, and `failed` is already claimable.
    const stale = !!existing
      && existing.status === 'dispatching'
      && Date.now() - new Date(existing.updated_at).getTime() > STALE_DISPATCH_MS;

    if (existing && existing.status !== 'failed' && !stale) {
      return json({
        status: existing.status,
        fax_id: existing.provider_fax_id,
        duplicate: true,
      }, existing.status === 'dispatching' ? 202 : 200);
    }
    if (existing && Number(existing.attempts) >= 3) {
      return json({ error: 'Fax delivery failed after three attempts. Contact support for a refund.' }, 409);
    }

    let transmissionId: string;
    let attempts: number;
    if (existing) {
      attempts = Number(existing.attempts) + 1;
      // Claim on the state we read, and on `updated_at` being untouched since we
      // read it. Two racing attempts on the same stale row both see the same
      // timestamp; the first update changes it, so the second matches no row and
      // backs off rather than dispatching a second fax.
      const { data: claimed, error: claimErr } = await supabase
        .from('fax_transmissions')
        .update({
          status: 'dispatching',
          attempts,
          failure_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('status', existing.status)
        .eq('updated_at', existing.updated_at)
        .select('id')
        .single();
      if (claimErr || !claimed) return json({ status: 'dispatching', duplicate: true }, 202);
      transmissionId = claimed.id;
    } else {
      attempts = 1;
      const { data: created, error: createErr } = await supabase
        .from('fax_transmissions')
        .insert({
          filing_id: filing.id,
          job_id: filing.job_id,
          dispatch_key: dispatchKey,
          user_id: user.id,
          destination: TEST_DESTINATION,
          status: 'dispatching',
          attempts,
        })
        .select('id')
        .single();
      if (createErr || !created) {
        const { data: raced } = await supabase
          .from('fax_transmissions')
          .select('status, provider_fax_id')
          .eq('dispatch_key', dispatchKey)
          .maybeSingle();
        return json({
          status: raced?.status ?? 'dispatching',
          fax_id: raced?.provider_fax_id,
          duplicate: true,
        }, 202);
      }
      transmissionId = created.id;
    }

    const outbound = new FormData();
    outbound.set('to', TEST_DESTINATION);
    outbound.set('file', file, `filetax-${filing.id}.pdf`);
    outbound.set('serviceId', SINCH_FAX_SERVICE_ID);
    outbound.set('from', SINCH_FAX_NUMBER);
    outbound.set('maxRetries', '2');
    outbound.set('retryDelaySeconds', '60');
    // SUPERFINE, not FINE. The Instructions for Form 5472 ask for "300 DPI or
    // higher" on the fax line. No Group 3 fax reaches 300 horizontally: T.4
    // fixes that axis at 203 in every mode, and only the vertical changes
    // (standard 98, fine 196, superfine 391). Superfine is therefore the
    // closest the medium can come, clearing 300 on one axis instead of neither.
    //
    // This value OVERRIDES the resolution configured on the Sinch service, so
    // changing it in the Sinch dashboard does nothing while this line exists.
    // That surprised us once already.
    outbound.set('resolution', 'SUPERFINE');
    outbound.set('headerPageNumbers', 'true');
    outbound.set('labels[filingId]', filing.id);
    outbound.set('labels[transmissionId]', transmissionId);

    // Where Sinch reports COMPLETED (or not). Without this the row can only
    // ever reach `submitted`: the POST below tells us the fax was ACCEPTED, and
    // acceptance is not delivery. Per-fax, because Sinch only offers a
    // service-level callback for INCOMING faxes; a completion callback has to
    // be registered on the send itself.
    //
    // What travels is a SIGNATURE over this transmission id, never the secret
    // itself. See signTransmission above for why. `sinch-fax-webhook` recomputes
    // it, compares in constant time, and then checks the signed id is the row
    // the fax id resolves to, so a signature lifted from a log line cannot be
    // pointed at a different fax.
    const SINCH_WEBHOOK_TOKEN = webhookToken();
    if (SINCH_WEBHOOK_TOKEN) {
      const sig = await signTransmission(SINCH_WEBHOOK_TOKEN, transmissionId);
      const callbackUrl = `${SUPABASE_URL}/functions/v1/sinch-fax-webhook` +
        `?t=${encodeURIComponent(transmissionId)}&sig=${sig}`;
      outbound.set('callbackUrl', callbackUrl);
      // JSON rather than the multipart default, so the receiver parses one
      // shape. Both carry a copy of the transmitted PDF; neither is stored.
      outbound.set('callbackUrlContentType', 'application/json');
    } else {
      // Send anyway. A missing callback costs us the delivery record, which is
      // recoverable by looking the fax up in Sinch; refusing to send costs the
      // filer their filing, which is not.
      console.error('[dispatch-irs-fax] SINCH_WEBHOOK_TOKEN unset, sending with no delivery callback');
    }

    // Release the claim on ANY outcome that is not a submitted fax, so the row
    // never outlives the request that owns it. A throw here used to fall through
    // to the outer catch, which logged and returned 500 with the row still
    // saying `dispatching`: the attempt counter never advanced, no reason was
    // recorded, and the filer was left paid, unsent and unable to retry.
    const markFailed = async (reason: string, providerStatus: string | null = null) => {
      const { error } = await supabase.from('fax_transmissions').update({
        status: 'failed',
        provider_status: providerStatus,
        failure_reason: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', transmissionId);
      if (error) console.error('[dispatch-irs-fax] release claim', transmissionId, error);
    };
    // Also reachable from the outer catch, for anything that throws between here
    // and the `submitted` write.
    releaseClaim = markFailed;

    const basic = btoa(`${SINCH_ACCESS_KEY}:${SINCH_ACCESS_SECRET}`);
    let response: Response;
    try {
      response = await fetch(
        `https://fax.api.sinch.com/v3/projects/${encodeURIComponent(SINCH_PROJECT_ID)}/faxes`,
        { method: 'POST', headers: { Authorization: `Basic ${basic}` }, body: outbound },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Sinch could not be reached.';
      await markFailed(`Transport error: ${reason}`);
      console.error('[dispatch-irs-fax] Sinch transport', err);
      return json({ error: 'Sinch could not be reached. Please try again.' }, 502);
    }
    const result = await response.json().catch(() => ({}));

    if (!response.ok || typeof result.id !== 'string') {
      const reason = typeof result.message === 'string'
        ? result.message
        : `Sinch returned HTTP ${response.status}`;
      await markFailed(reason, typeof result.status === 'string' ? result.status : null);
      console.error('[dispatch-irs-fax] Sinch response', response.status, result);
      return json({ error: 'Sinch could not accept the fax. Please try again.' }, 502);
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase.from('fax_transmissions').update({
      status: 'submitted',
      provider_fax_id: result.id,
      provider_status: typeof result.status === 'string' ? result.status : 'IN_PROGRESS',
      // Recorded here, not read from config when a receipt is rendered. The
      // secret can be changed (it was, on 5 Aug, to a Fax-capable sender); a
      // transmission record must keep saying who actually sent that fax.
      sender_fax: SINCH_FAX_NUMBER,
      submitted_at: now,
      updated_at: now,
    }).eq('id', transmissionId);
    if (updateErr) console.error('[dispatch-irs-fax] metadata update', updateErr);

    releaseClaim = null;
    return json({ status: 'submitted', fax_id: result.id, destination: TEST_DESTINATION });
  } catch (err) {
    console.error('[dispatch-irs-fax]', err);
    if (releaseClaim) {
      await releaseClaim(
        `Unhandled error before submission: ${err instanceof Error ? err.message : String(err)}`,
      ).catch((releaseErr) => console.error('[dispatch-irs-fax] release on throw', releaseErr));
    }
    return json({ error: 'Internal server error' }, 500);
  }
});
