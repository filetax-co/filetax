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
    fax: 'pdt_0Nkc18kU619ajN7I9LMuB',
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
      .select('id, job_id, status, user_id, include_rcl, include_irs_fax, related_parties, payment_id, paid_related_party_count, payment_amount_cents')
      .eq('id', filing_id)
      .eq('user_id', user.id)
      .single();
    if (anchorErr || !anchor) return json({ error: 'Filing not found' }, 404);

    let filings = [anchor];
    let job: { include_rcl?: boolean; delivery?: string } | null = null;
    if (anchor.job_id) {
      const [{ data: jobFilings, error: filingsErr }, { data: jobData, error: jobErr }] =
        await Promise.all([
          supabase
            .from('filings')
            .select('id, job_id, status, user_id, include_rcl, include_irs_fax, related_parties, payment_id, paid_related_party_count, payment_amount_cents')
            .eq('job_id', anchor.job_id)
            .eq('user_id', user.id),
          supabase
            .from('filing_jobs')
            .select('include_rcl, delivery')
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
    const includeFax = job?.delivery === 'fax' || filings.some((filing) => filing.include_irs_fax === true);
    const additionalParties = filings.reduce(
      (total, filing) => total + relatedPartyCount(filing.related_parties),
      0,
    );
    const paidAdditionalParties = filings.reduce(
      (total, filing) => total + Number(filing.paid_related_party_count ?? 0),
      0,
    );
    const supplemental = payment.metadata?.checkout_type === 'additional_party';
    const additionalPartyDelta = Math.max(0, additionalParties - paidAdditionalParties);
    const expectedCart = supplemental
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
    const amount =
      payment.settlement_currency === 'USD' && Number.isInteger(payment.settlement_amount)
        ? payment.settlement_amount
        : null;
    for (const filing of filings) {
      const { error: updateErr } = await supabase
        .from('filings')
        .update({
          status: 'paid',
          paid_at: filing.status === 'paid' || filing.status === 'completed' ? undefined : now,
          payment_id: payment.payment_id,
          payment_amount_cents: amount === null
            ? filing.payment_amount_cents
            : Number(filing.payment_amount_cents ?? 0) + amount,
          paid_related_party_count: relatedPartyCount(filing.related_parties),
        })
        .eq('id', filing.id);
      if (updateErr) {
        console.error('[verify-payment] update filing', updateErr);
        return json({ error: 'Payment was verified but the filing could not be updated.' }, 500);
      }
    }

    return json({ status: 'paid', payment_id: payment.payment_id });
  } catch (err) {
    console.error('[verify-payment]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
