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
// That makes the signature check below the ONLY thing standing between a
// stranger and the ability to mark someone's filing delivered.
//
// Required Supabase secrets:
//   SINCH_WEBHOOK_TOKEN   long random string. NOT sent in the callback URL any
//                         more: it is the HMAC key, and what dispatch-irs-fax
//                         puts in the URL is a signature over that one fax's
//                         transmission id. Supabase logs request URLs in full,
//                         so anything in a callback URL should be assumed
//                         readable by everyone with log access
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
// Read per request. See the matching note in dispatch-irs-fax: a module-scope
// read pins the value to whenever this isolate happened to boot, so a rotated
// secret silently splits the sender from the receiver until both restart.
const webhookToken = () => Deno.env.get('SINCH_WEBHOOK_TOKEN');

/**
 * Sinch's own notification IPs, published in their docs. Logged, never
 * enforced: an allowlist that silently drops a real delivery notice is worse
 * than no allowlist, and these can change without us noticing. The signature is
 * the control that actually gates the write.
 */
const SINCH_NOTIFICATION_IPS = ['34.232.249.173', '44.226.9.173'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Recomputes the signature dispatch-irs-fax put in the callback URL. Must stay
 * byte-identical to the copy there: same secret, same message (the transmission
 * id alone), same hex encoding. See the long note in that file for why the
 * secret itself no longer travels.
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

/**
 * Advance the filing(s) this transmission covers to `submitted`.
 *
 * A delivered fax is the only thing in the product that makes a return FILED,
 * and until now that fact lived only in `fax_transmissions`. Every surface that
 * wanted to say so had to run its own query against that table and render its
 * own chip beside the real status pill, which is how the dashboard ended up
 * showing "Downloaded" and "Faxed to the IRS" side by side: two pills, one
 * fact, two independent reads that could disagree. The filing row now carries
 * it, and `filings.status = 'submitted'` finally has a writer.
 *
 * JOB-SCOPED WHEN THERE IS A JOB. The $9 fax is one transmission covering every
 * year in a catch-up, so `dispatch_key` is `job:<job_id>` for those, and all of
 * that job's filings were in the envelope that reached Ogden.
 *
 * ONLY FORWARD, AND ONLY FROM A PAID STATE. `paid` and `completed` are the only
 * statuses a fax can have been sent from, so the `in` filter both prevents a
 * draft from being dragged into `submitted` by a stray callback and makes a
 * duplicate delivery notice a no-op rather than a rewrite.
 *
 * Never fatal. The transmission record is the receipt and it is already
 * written; failing the callback here would only earn 16 Sinch retries against a
 * row that is already correct.
 *
 * `reconcile-fax-status` carries a copy of this. The two functions deploy
 * separately, so it is duplicated on purpose: change one, change the other.
 */
async function markFilingsSubmitted(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  dispatchKey: string | null,
  filingId: string | null,
): Promise<void> {
  const query = supabase
    .from('filings')
    .update({ status: 'submitted', updated_at: new Date().toISOString() })
    .in('status', ['paid', 'completed']);

  if (dispatchKey?.startsWith('job:')) {
    const jobId = dispatchKey.slice(4);
    if (!jobId) return;
    const { error } = await query.eq('job_id', jobId);
    if (error) console.error('[sinch-fax-webhook] filings -> submitted (job)', jobId, error);
    return;
  }

  // `filing:<id>`, or an older row with no dispatch_key at all, where filing_id
  // is the only handle we have.
  const id = dispatchKey?.startsWith('filing:') ? dispatchKey.slice(7) : filingId;
  if (!id) return;
  const { error } = await query.eq('id', id);
  if (error) console.error('[sinch-fax-webhook] filings -> submitted', id, error);
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const WEBHOOK_TOKEN = webhookToken();
    if (!WEBHOOK_TOKEN) {
      // Fail CLOSED. An unset secret must never mean "accept anything".
      console.error('[sinch-fax-webhook] SINCH_WEBHOOK_TOKEN is not set');
      return json({ error: 'Webhook is not configured.' }, 503);
    }

    // PREFERRED: a signature over one transmission id, `?t=<id>&sig=<hmac>`.
    // The URL is the only channel a per-fax callback has, and Supabase logs
    // request URLs in full, so what goes in the URL is effectively published to
    // anyone who can read the project's logs. A signature published that way is
    // worth one fax; the secret published that way was worth all of them.
    const url = new URL(req.url);
    const signedId = url.searchParams.get('t') ?? '';
    const presentedSig = url.searchParams.get('sig') ?? '';

    // A signature, or nothing. The `?token=<secret>` branch that used to sit
    // here was deleted on 7 August 2026: it existed only so that callbacks for
    // faxes sent before the signed URL shipped could still be retried, and the
    // owner confirmed every one of those faxes was a test, so there was no real
    // delivery record left to lose by closing it early. While it stood, the
    // secret logged by those old callbacks was still a working key to this
    // endpoint, and this endpoint writes the delivery facts a filer's proof of
    // filing is printed from.
    const authorised = Boolean(signedId) && Boolean(presentedSig)
      && secretsMatch(presentedSig, await signTransmission(WEBHOOK_TOKEN, signedId));

    if (!authorised) {
      console.warn('[sinch-fax-webhook] rejected callback',
        req.headers.get('x-forwarded-for') ?? 'unknown ip');
      return json({ error: 'Unauthorized' }, 401);
    }

    const sourceIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (sourceIp && !SINCH_NOTIFICATION_IPS.includes(sourceIp)) {
      console.warn('[sinch-fax-webhook] signature accepted from unlisted ip', sourceIp);
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
    // Sinch reports these as two different numbers and they are not the same
    // fact: numberOfPages is what we sent, pagesSentSuccessfully is what the
    // far end took. On a partial transmission the gap between them is the most
    // important thing a receipt can say, so never collapse them into one.
    const pagesSent = Number(fax.pagesSentSuccessfully);
    const errorCode = fax.errorCode ?? (fax as Record<string, unknown>).error_code;
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
      .select('id, status, filing_id, dispatch_key, delivered_at')
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

    // The signature authorises ONE transmission. Without this check a signature
    // read out of a log line could be replayed against any other fax by
    // changing the fax id in the body, which would put the whole exposure back.
    // Not a 200-and-ignore: this is the shape a forged callback takes, so it
    // deserves the same refusal as a bad signature.
    if (signedId && row.id !== signedId) {
      console.warn('[sinch-fax-webhook] signature is for another transmission',
        faxId, signedId, req.headers.get('x-forwarded-for') ?? 'unknown ip');
      return json({ error: 'Unauthorized' }, 401);
    }

    const delivered = providerStatus != null && DELIVERED_STATUSES.has(providerStatus);

    // Terminal and already recorded. Sinch retries a failed webhook up to 16
    // times over ~3 days, so a duplicate delivery notice is expected, not an
    // anomaly, and re-writing delivered_at would move a timestamp the filer may
    // already have on a receipt.
    if (row.status === 'delivered' && delivered) {
      // The transmission is untouched, but the filing still gets a nudge: if
      // the first notice recorded delivery and then failed on the filings
      // write, this retry is the thing that repairs it. Idempotent, since the
      // update only matches `paid` / `completed`.
      await markFilingsSubmitted(supabase, row.dispatch_key, row.filing_id);
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
    if (Number.isFinite(pagesSent) && pagesSent >= 0) patch.pages_sent = Math.trunc(pagesSent);
    if (errorCode != null && errorCode !== '') patch.provider_error_code = String(errorCode).slice(0, 100);
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

    // After the transmission write, never before it. The transmission row is
    // the receipt and the source of truth; the filing status is a projection of
    // it, and a projection must not exist for a delivery we failed to record.
    if (delivered) await markFilingsSubmitted(supabase, row.dispatch_key, row.filing_id);

    console.log('[sinch-fax-webhook]', faxId, row.status, '->', patch.status, providerStatus);
    return json({ ok: true, status: patch.status });
  } catch (err) {
    console.error('[sinch-fax-webhook]', err);
    // 500 so Sinch retries. An unhandled error here is exactly the case where a
    // retry is likely to succeed.
    return json({ error: 'Internal server error' }, 500);
  }
});
