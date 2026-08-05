// Creates a Dodo Payments checkout for one filing or one multi-year filing job.
//
// The browser supplies only a filing ID. Product IDs, quantities, customer
// identity, and filing ownership are all resolved here so prices cannot be
// changed from developer tools.
//
// Required Supabase secrets:
//   DODO_PAYMENTS_TEST_API_KEY
//   DODO_PAYMENTS_LIVE_API_KEY
//
// Optional secrets:
//   DODO_PAYMENTS_ENVIRONMENT = live_mode | test_mode (defaults to test_mode)
//   PUBLIC_SITE_URL = https://filetax.co

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DODO_ENVIRONMENT = Deno.env.get('DODO_PAYMENTS_ENVIRONMENT') ?? 'test_mode';
const DODO_API_KEY = DODO_ENVIRONMENT === 'test_mode'
  ? Deno.env.get('DODO_PAYMENTS_TEST_API_KEY')
  : Deno.env.get('DODO_PAYMENTS_LIVE_API_KEY');
const PUBLIC_SITE_URL = (Deno.env.get('PUBLIC_SITE_URL') ?? 'https://filetax.co').replace(/\/$/, '');

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

    const { filing_id } = await req.json() as { filing_id?: string };
    if (!filing_id) return json({ error: 'filing_id is required' }, 400);

    const { data: anchor, error: anchorErr } = await supabase
      .from('filings')
      .select('id, job_id, status, llc_name, tax_year, user_id, include_rcl, include_irs_fax, related_parties, paid_related_party_count')
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
            .select('id, job_id, status, llc_name, tax_year, user_id, include_rcl, include_irs_fax, related_parties, paid_related_party_count')
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

    const supplemental = filings.every(
      (filing) => filing.status === 'paid' || filing.status === 'completed',
    );
    if (!supplemental && filings.some(
      (filing) => filing.status === 'paid' || filing.status === 'completed',
    )) {
      return json({ error: 'This filing job has mixed payment states.' }, 409);
    }

    const includeRcl = job?.include_rcl === true || filings.some((filing) => filing.include_rcl === true);
    // `filings.include_irs_fax` is the ONLY source of the fax entitlement.
    // `filing_jobs.delivery` was a second one, and nothing has ever written it:
    // intake sets the per-filing flag and MultiYearStart never touches delivery,
    // so it sat at its 'self_mail' default forever. A second source that only
    // ever reads false is not redundancy, it is a way for checkout and
    // `dispatch-irs-fax` to disagree about what the customer bought. The
    // dispatcher reads the filing rows, so this does too.
    const includeFax = filings.some((filing) => filing.include_irs_fax === true);
    const additionalParties = filings.reduce(
      (total, filing) => total + relatedPartyCount(filing.related_parties),
      0,
    );
    const paidAdditionalParties = filings.reduce(
      (total, filing) => total + Number(filing.paid_related_party_count ?? 0),
      0,
    );
    const additionalPartyDelta = Math.max(0, additionalParties - paidAdditionalParties);

    const productCart = supplemental
      ? (additionalPartyDelta > 0
        ? [{ product_id: PRODUCTS.additionalParty, quantity: additionalPartyDelta }]
        : [])
      : [
          { product_id: PRODUCTS.filing, quantity: filings.length },
          ...(includeRcl ? [{ product_id: PRODUCTS.reasonableCause, quantity: 1 }] : []),
          ...(additionalParties > 0
            ? [{ product_id: PRODUCTS.additionalParty, quantity: additionalParties }]
            : []),
          ...(includeFax ? [{ product_id: PRODUCTS.fax, quantity: 1 }] : []),
        ];
    if (productCart.length === 0) return json({ already_paid: true });

    const response = await fetch(`${dodoBaseUrl()}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DODO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_cart: productCart,
        customer: {
          email: user.email,
          name: anchor.llc_name || user.email || 'FileTax customer',
        },
        return_url: `${PUBLIC_SITE_URL}/filing/${filing_id}?payment=return`,
        cancel_url: `${PUBLIC_SITE_URL}/filing/${filing_id}?payment=cancelled`,
        metadata: {
          filing_id,
          filing_job_id: anchor.job_id ?? '',
          user_id: user.id,
          checkout_type: supplemental ? 'additional_party' : 'initial',
        },
      }),
    });

    const dodo = await response.json();
    if (!response.ok || !dodo.checkout_url || !dodo.session_id) {
      console.error('[create-checkout-session] Dodo response', response.status, dodo);
      return json({ error: 'Unable to start checkout. Please try again.' }, 502);
    }

    const filingIds = filings.map((filing) => filing.id);
    const { error: saveErr } = await supabase
      .from('filings')
      .update({ payment_id: dodo.session_id, updated_at: new Date().toISOString() })
      .in('id', filingIds);
    if (saveErr) {
      console.error('[create-checkout-session] save session', saveErr);
      return json({ error: 'Unable to save checkout. Please try again.' }, 500);
    }

    return json({ url: dodo.checkout_url, session_id: dodo.session_id });
  } catch (err) {
    console.error('[create-checkout-session]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
