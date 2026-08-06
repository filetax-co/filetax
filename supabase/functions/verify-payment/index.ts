// Verifies a Dodo payment after hosted checkout returns to FileTax.
//
// The payment status, metadata, and complete cart are fetched directly from
// Dodo. Redirect query parameters are never trusted as proof of payment.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DODO_ENVIRONMENT = Deno.env.get('DODO_PAYMENTS_ENVIRONMENT') ?? 'test_mode';
const DODO_API_KEY = DODO_ENVIRONMENT === 'test_mode'
  ? Deno.env.get('DODO_PAYMENTS_TEST_API_KEY')
  : Deno.env.get('DODO_PAYMENTS_LIVE_API_KEY');

const PRODUCT_CATALOGS = {
  live_mode: {
    filing: 'pdt_0NkbymdZXflcy52PnnDFt',
    reasonableCause: 'pdt_0Nkc1CVoar2Ifl5OnmNCf',
    additionalParty: 'pdt_0Nkc1CDY969p41ETXScAy',
    fax: 'pdt_0Nkc1BrfJkYWO9DLBQGJM',
  },
  test_mode: {
    filing: 'pdt_0Nkbxx2xSSs7jLmJQmosC',
    reasonableCause: 'pdt_0Nkc0poiJMr11hpCS3HEn',
    additionalParty: 'pdt_0Nkc0ybQ8bH5AtobUGp8Q',
    fax: 'pdt_0Nkc18kU619ajN7l9LMuB',
  },
} as const;
const PRODUCTS =
  PRODUCT_CATALOGS[DODO_ENVIRONMENT === 'test_mode' ? 'test_mode' : 'live_mode'];

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

function dodoBaseUrl() {
  return DODO_ENVIRONMENT === 'test_mode'
    ? 'https://test.dodopayments.com'
    : 'https://live.dodopayments.com';
}

function relatedPartyCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function canonicalCart(cart: Array<{ product_id: string; quantity: number }>) {
  return cart
    .map((item) => `${item.product_id}:${item.quantity}`)
    .sort()
    .join('|');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!['test_mode', 'live_mode'].includes(DODO_ENVIRONMENT)) {
      return json({ error: 'Invalid Dodo Payments environment.' }, 503);
    }
    if (!DODO_API_KEY) return json({ error: 'Dodo Payments is not configured.' }, 503);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { filing_id, payment_id } = await req.json() as {
      filing_id?: string;
      payment_id?: string;
    };
    if (!filing_id || !payment_id) {
      return json({ error: 'filing_id and payment_id are required' }, 400);
    }

    const { data: anchor, error: anchorErr } = await supabase
      .from('filings')
      .select('id, job_id, status, user_id, include_rcl, include_irs_fax, related_parties, payment_id, paid_related_party_count, payment_amount_cents, payment_currency')
      .eq('id', filing_id)
      .eq('user_id', user.id)
      .single();
    if (anchorErr || !anchor) return json({ error: 'Filing not found' }, 404);

    let filings = [anchor];
    let job: { include_rcl?: boolean } | null = null;
    if (anchor.job_id) {
      const [{ data: jobFilings, error: filingsErr }, { data: jobData, error: jobErr }] =
        await Promise.all([
          supabase
            .from('filings')
            .select('id, job_id, status, user_id, include_rcl, include_irs_fax, related_parties, payment_id, paid_related_party_count, payment_amount_cents, payment_currency')
            .eq('job_id', anchor.job_id)
            .eq('user_id', user.id),
          supabase
            .from('filing_jobs')
            .select('include_rcl')
            .eq('id', anchor.job_id)
            .eq('user_id', user.id)
            .single(),
        ]);
      if (filingsErr || !jobFilings?.length || jobErr || !jobData) {
        return json({ error: 'Filing job not found' }, 404);
      }
      filings = jobFilings;
      job = jobData;
    }

    const response = await fetch(
      `${dodoBaseUrl()}/payments/${encodeURIComponent(payment_id)}`,
      { headers: { Authorization: `Bearer ${DODO_API_KEY}` } },
    );
    const payment = await response.json();
    if (!response.ok) {
      console.error('[verify-payment] Dodo response', response.status, payment);
      return json({ error: 'Unable to verify payment. Please try again.' }, 502);
    }
    if (payment.status !== 'succeeded') {
      return json({ status: payment.status ?? 'processing' }, 402);
    }

    if (
      payment.metadata?.filing_id !== filing_id ||
      payment.metadata?.user_id !== user.id
    ) {
      return json({ error: 'Payment does not belong to this filing.' }, 403);
    }

    const includeRcl = job?.include_rcl === true || filings.some((filing) => filing.include_rcl === true);
    // One source for the fax entitlement, matching create-checkout-session and
    // dispatch-irs-fax. See the note there: `filing_jobs.delivery` was a second
    // source that nothing ever wrote, and the price re-derived here has to be
    // computed from exactly what the cart was built from.
    const includeFax = filings.some((filing) => filing.include_irs_fax === true);
    const additionalParties = filings.reduce(
      (total, filing) => total + relatedPartyCount(filing.related_parties),
      0,
    );
    const paidAdditionalParties = filings.reduce(
      (total, filing) => total + Number(filing.paid_related_party_count ?? 0),
      0,
    );
    const supplemental = payment.metadata?.checkout_type === 'additional_party';
    // The $9 fax bought against an already-paid filing. Its expected cart is a
    // CONSTANT, not a re-derivation: this handler runs again on every refresh of
    // the return URL, and by the second run the entitlement it granted is
    // already true, so anything derived from `includeFax` would stop matching
    // the cart Dodo holds and start answering 409 to a filer who paid.
    const faxAddon = payment.metadata?.checkout_type === 'fax_addon';
    const additionalPartyDelta = Math.max(0, additionalParties - paidAdditionalParties);
    const expectedCart = faxAddon
      ? [{ product_id: PRODUCTS.fax, quantity: 1 }]
      : supplemental
      ? [{ product_id: PRODUCTS.additionalParty, quantity: additionalPartyDelta }]
      : [
          { product_id: PRODUCTS.filing, quantity: filings.length },
          ...(includeRcl ? [{ product_id: PRODUCTS.reasonableCause, quantity: 1 }] : []),
          ...(additionalParties > 0
            ? [{ product_id: PRODUCTS.additionalParty, quantity: additionalParties }]
            : []),
          ...(includeFax ? [{ product_id: PRODUCTS.fax, quantity: 1 }] : []),
        ];

    if (
      !Array.isArray(payment.product_cart) ||
      canonicalCart(payment.product_cart) !== canonicalCart(expectedCart)
    ) {
      return json({ error: 'Payment items do not match this filing.' }, 409);
    }

    const now = new Date().toISOString();

    // The amount is recorded whatever the settlement currency, and the currency
    // is recorded beside it. This used to be gated on `settlement_currency ===
    // 'USD'`, so a settlement in anything else marked the filing paid and left
    // payment_amount_cents holding the PREVIOUS total: a paid row whose
    // recorded amount was quietly lower than what the customer was charged.
    // Only a non-integer amount is unrecordable now, and that is a malformed
    // response rather than a currency we did not expect.
    const amount = Number.isInteger(payment.settlement_amount)
      ? payment.settlement_amount
      : null;
    const currency: string | null =
      typeof payment.settlement_currency === 'string' && payment.settlement_currency
        ? payment.settlement_currency.toUpperCase()
        : null;

    for (const filing of filings) {
      // Amounts in two different currencies cannot be added. A filing can be
      // topped up (the additional-party add-on is a second checkout), so the
      // running total is only meaningful while the currency holds. When it
      // changes, the total is set to null rather than to a sum that is not a
      // quantity of anything: null reads as "ask the payment provider", a wrong
      // integer reads as an answer. This is logged because it should not happen
      // and, if it does, reconciliation needs to know which filing to look at.
      const priorCurrency = filing.payment_currency ?? null;
      const currencyChanged =
        priorCurrency !== null && currency !== null && priorCurrency !== currency;

      if (currencyChanged) {
        console.error(
          `[verify-payment] settlement currency changed for filing ${filing.id}: `
          + `${priorCurrency} -> ${currency}. Running total cleared; reconcile against `
          + `payment ${payment.payment_id}.`,
        );
      }

      const nextAmount = currencyChanged
        ? null
        : amount === null
          ? filing.payment_amount_cents
          : Number(filing.payment_amount_cents ?? 0) + amount;

      const { error: updateErr } = await supabase
        .from('filings')
        .update({
          // Never walk a COMPLETED filing back to `paid`. A supplemental
          // checkout (a party, or now the fax) is usually bought AFTER the
          // package has been generated, and this line used to demote the row on
          // every one of them: the dashboard card flipped from "Downloaded"
          // back to "Ready to download" because a filer paid us more money.
          //
          // `submitted` is on the same list for the same reason and a stronger
          // one: it means a fax reached Ogden, and demoting that to "Ready to
          // download" because the filer later bought another related party
          // would un-file a filed return on the dashboard.
          status: filing.status === 'completed' || filing.status === 'submitted'
            ? filing.status
            : 'paid',
          paid_at: filing.status === 'paid' || filing.status === 'completed' || filing.status === 'submitted'
            ? undefined
            : now,
          payment_id: payment.payment_id,
          payment_amount_cents: nextAmount,
          payment_currency: currencyChanged ? null : (currency ?? priorCurrency),
          // Only advanced when the cart actually paid for the parties. A fax
          // add-on cart contains one $9 item and nothing else, so marking the
          // current party count as paid here would hand the filer every party
          // they had added since their last payment for free, and the delta
          // that `create-checkout-session` bills from would be gone.
          paid_related_party_count: faxAddon
            ? filing.paid_related_party_count
            : relatedPartyCount(filing.related_parties),
          // What the $9 actually buys. Written here rather than at intake
          // because this is the only moment we know it was paid for.
          //
          // This UPDATE is what `filings_freeze_when_paid()` exists to stop,
          // and it gets through because the trigger exempts `service_role` on
          // its first line and this client holds the service key. That is the
          // sanctioned route and the only one: the guard still refuses the
          // browser, the SQL editor and anything else without that role.
          ...(faxAddon ? { include_irs_fax: true } : {}),
        })
        .eq('id', filing.id);
      if (updateErr) {
        console.error('[verify-payment] update filing', updateErr);
        return json({ error: 'Payment was verified but the filing could not be updated.' }, 500);
      }
    }

    // `added` tells the page what this particular checkout bought, so it can say
    // so. Without it the return screen thanked a filer who had just bought fax
    // delivery by inviting them to sign and download a package they generated
    // days ago.
    return json({
      status: 'paid',
      payment_id: payment.payment_id,
      ...(faxAddon ? { added: 'fax' } : {}),
    });
  } catch (err) {
    console.error('[verify-payment]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
