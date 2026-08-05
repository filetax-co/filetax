// Receives Sinch's FAX_COMPLETED callback and moves a fax_transmissions row
// from `submitted` to `delivered` (or `failed`).
//
// WHY THIS EXISTS
// `dispatch-irs-fax` learns only that Sinch ACCEPTED the fax for transmission.
// Acceptance is not delivery: the far end can be busy, out of paper, or not a
// fax machine at all, and none of that is known when the POST returns. Without
// this endpoint `fax_transmissions.status` could never leave `submitted`, so
// nothing in the product could honestly tell a filer their return reached
// Ogden, and there was nothing to build a delivery receipt on.
//
// PUBLIC ENDPOINT. Deploy with `verify_jwt = false`: Sinch has no Supabase JWT.
// That makes the shared secret below the ONLY thing standing between a stranger
// and the ability to mark someone's filing delivered.
//
// Required Supabase secrets:
//   SINCH_WEBHOOK_TOKEN   long random string, also embedded in the callbackUrl
//                         that dispatch-irs-fax registers with each fax
//
// WHAT THIS DELIBERATELY THROWS AWAY
// Sinch attaches the transmitted PDF to the callback (as a multipart part, or
// base64 in JSON). We never store it. The whole fax path was built so the
// document is relayed without ever being written to Supabase Storage, which is
// what makes the "we do not store your documents" claim true. Receiving a copy
// here does not change that: it is read off the wire and dropped.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_TOKEN = Deno.env.get('SINCH_WEBHOOK_TOKEN');

/**
 * Sinch's own notification IPs, published in their docs. Logged, never
 * enforced: an allowlist that silently drops a real delivery notice is worse
 * than no allowlist, and these can change without us noticing. The token is the
 * control that actually gates the write.
 */
const SINCH_NOTIFICATION_IPS = ['34.232.249.173', '44.226.9.173'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Length-independent constant-time compare, so the token cannot be probed. */
function secretsMatch(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/**
 * Sinch sends multipart/form-data by default and JSON when the fax was created
 * with callbackUrlContentType=application/json. Accept both: the content type
 * is set per fax, and a fax created before that setting existed would still be
 * in flight and still deserve to be recorded.
 */
async function readEvent(req: Request): Promise<Record<string, unknown> | null> {
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      return await req.json() as Record<string, unknown>;
    }
    if (contentType.includes('multipart/form-data') || contentType.includes('x-www-form-urlencoded')) {
      const form = await req.formData();
      // The 'file' part is the transmitted PDF. Never read, never stored.
      const event = form.get('event');
      const eventTime = form.get('eventTime');
      const fax = form.get('fax');
      return {
        event: typeof event === 'string' ? event : undefined,
        eventTime: typeof eventTime === 'string' ? eventTime : undefined,
        // In multipart, `fax` arrives as a JSON string part.
        fax: typeof fax === 'string' ? JSON.parse(fax) : fax,
      };
    }
    // Unknown content type: try JSON rather than refuse, since refusing costs
    // us a delivery record and Sinch 16 retries.
    return await req.json() as Record<string, unknown>;
  } catch (err) {
    console.error('[sinch-fax-webhook] unparseable body', contentType, err);
    return null;
  }
}

/**
 * Sinch terminal statuses. Only COMPLETED counts as delivered, which is the
 * rule the owner settled on 1 August: anything else is unconfirmed and the $9
 * is refundable. Recorded verbatim in provider_status either way, because the
 * distinction between BUSY and NO_ANSWER matters to whoever handles the refund.
 */
const DELIVERED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'DELIVERED']);

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!WEBHOOK_TOKEN) {
      // Fail CLOSED. An unset secret must never mean "accept anything".
      console.error('[sinch-fax-webhook] SINCH_WEBHOOK_TOKEN is not set');
      return json({ error: 'Webhook is not configured.' }, 503);
    }

    // The token travels in the callback URL, which is the only channel Sinch
    // offers for a per-fax callback. Also accept it as a Basic password, since
    // Sinch's webhook auth is Basic and a service-level webhook would send it
    // that way.
    const url = new URL(req.url);
    let presented = url.searchParams.get('token') ?? '';
    if (!presented) {
      const auth = req.headers.get('authorization') ?? '';
      if (auth.startsWith('Basic ')) {
        try {
          presented = atob(auth.slice(6)).split(':').slice(1).join(':');
        } catch { /* malformed header: presented stays empty and we 401 */ }
      }
    }
    if (!secretsMatch(presented, WEBHOOK_TOKEN)) {
      console.warn('[sinch-fax-webhook] rejected callback',
        req.headers.get('x-forwarded-for') ?? 'unknown ip');
      return json({ error: 'Unauthorized' }, 401);
    }

    const sourceIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (sourceIp && !SINCH_NOTIFICATION_IPS.includes(sourceIp)) {
      console.warn('[sinch-fax-webhook] token accepted from unlisted ip', sourceIp);
    }

    const body = await readEvent(req);
    if (!body) return json({ error: 'Unparseable body' }, 400);

    const fax = (body.fax ?? {}) as Record<string, unknown>;
    const faxId = typeof fax.id === 'string' ? fax.id : null;
    if (!faxId) {
      console.error('[sinch-fax-webhook] callback with no fax id', body.event);
      // 200, not 400. There is nothing to retry into: a body with no fax id
      // will still have no fax id in six hours, and 16 retries of it is noise.
      return json({ ignored: 'no fax id' });
    }

    const providerStatus = typeof fax.status === 'string' ? fax.status.toUpperCase() : null;
    const pages = Number(fax.numberOfPages);
    const completedTime = typeof fax.completedTime === 'string' ? fax.completedTime : null;
    const eventTime = typeof body.eventTime === 'string' ? body.eventTime : null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Match on the provider's own id, which is unique on this table and is what
    // dispatch-irs-fax wrote when Sinch accepted the fax. Never trust anything
    // else in the payload to identify the row: `labels` are echoed back from
    // what we sent, but a forged callback could carry any label it liked, and
    // the id is the one field Sinch alone can mint.
    const { data: row, error: findErr } = await supabase
      .from('fax_transmissions')
      .select('id, status, filing_id, delivered_at')
      .eq('provider_fax_id', faxId)
      .maybeSingle();

    if (findErr) {
      console.error('[sinch-fax-webhook] lookup failed', faxId, findErr);
      // 500 so Sinch retries: this one IS worth retrying, the row exists and we
      // simply could not read it.
      return json({ error: 'Lookup failed' }, 500);
    }
    if (!row) {
      // Not ours, or a fax sent by hand from the Sinch dashboard. 200, because
      // it will never become ours.
      console.warn('[sinch-fax-webhook] no transmission for fax', faxId);
      return json({ ignored: 'unknown fax id' });
    }

    const delivered = providerStatus != null && DELIVERED_STATUSES.has(providerStatus);

    // Terminal and already recorded. Sinch retries a failed webhook up to 16
    // times over ~3 days, so a duplicate delivery notice is expected, not an
    // anomaly, and re-writing delivered_at would move a timestamp the filer may
    // already have on a receipt.
    if (row.status === 'delivered' && delivered) {
      return json({ ok: true, unchanged: true });
    }
    // Never walk a delivered fax backwards. If a late or out-of-order callback
    // reports a non-delivered status after we have already recorded delivery,
    // the delivery is the fact that matters and the filer has been told it.
    if (row.status === 'delivered' && !delivered) {
      console.warn('[sinch-fax-webhook] late non-delivered callback for delivered fax',
        faxId, providerStatus);
      return json({ ok: true, unchanged: true });
    }

    const patch: Record<string, unknown> = {
      status: delivered ? 'delivered' : 'failed',
      provider_status: providerStatus,
      updated_at: new Date().toISOString(),
    };
    if (Number.isFinite(pages) && pages > 0) patch.page_count = Math.trunc(pages);
    if (delivered) {
      // Sinch's own completion time, not ours. This timestamp is what a filer
      // would put in front of the IRS in a penalty dispute, so it should be the
      // provider's record of when the fax completed, not when our function
      // happened to run. Fall back only if Sinch omits it.
      patch.delivered_at = completedTime ?? eventTime ?? new Date().toISOString();
      patch.failure_reason = null;
    } else {
      patch.failure_reason =
        `Sinch reported ${providerStatus ?? 'an unknown status'} on completion.`;
    }

    const { error: updateErr } = await supabase
      .from('fax_transmissions')
      .update(patch)
      .eq('id', row.id);

    if (updateErr) {
      console.error('[sinch-fax-webhook] update failed', row.id, updateErr);
      return json({ error: 'Update failed' }, 500);
    }

    console.log('[sinch-fax-webhook]', faxId, row.status, '->', patch.status, providerStatus);
    return json({ ok: true, status: patch.status });
  } catch (err) {
    console.error('[sinch-fax-webhook]', err);
    // 500 so Sinch retries. An unhandled error here is exactly the case where a
    // retry is likely to succeed.
    return json({ error: 'Internal server error' }, 500);
  }
});
