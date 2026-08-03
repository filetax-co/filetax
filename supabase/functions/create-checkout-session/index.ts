// supabase/functions/create-checkout-session/index.ts
//
// Creates a Stripe Checkout Session for a filing and returns the hosted URL.
//
// SECURITY CONTRACT
//   - Only the authenticated owner of the filing may create a session.
//   - The price / product is defined server-side using STRIPE_PRICE_ID.
//     The browser never passes an amount or price - it only sends filing_id.
//   - The session ID is stored on the filing row so verify-payment can look
//     it up without trusting anything the browser returns.
//
// REQUIRED ENV VARS (set in Supabase Dashboard → Edge Functions → Secrets)
//   STRIPE_SECRET_KEY   - sk_live_… or sk_test_…
//   STRIPE_PRICE_ID     - price_… (the $XXX Form 5472 product in your Stripe dashboard)
//   PUBLIC_SITE_URL     - https://yoursite.com  (no trailing slash)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14?target=deno';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY   = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_PRICE_ID     = Deno.env.get('STRIPE_PRICE_ID')!;
const PUBLIC_SITE_URL     = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://form5472.com';

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Authenticate caller.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    // 2. Validate filing ownership.
    const { filing_id } = await req.json() as { filing_id: string };
    if (!filing_id) return json({ error: 'filing_id is required' }, 400);

    const { data: filing, error: filingErr } = await supabase
      .from('filings')
      .select('id, status, llc_name, tax_year, user_id')
      .eq('id', filing_id)
      .eq('user_id', user.id)
      .single();

    if (filingErr || !filing) return json({ error: 'Filing not found' }, 404);

    // Already paid - return a sentinel so the client can skip checkout.
    if (filing.status === 'paid' || filing.status === 'completed') {
      return json({ already_paid: true });
    }

    // 3. Create Stripe Checkout Session.
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: filing_id,
      metadata: {
        filing_id,
        user_id: user.id,
        llc_name: filing.llc_name ?? '',
        tax_year: filing.tax_year ?? '',
      },
      success_url: `${PUBLIC_SITE_URL}/wizard/${filing_id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${PUBLIC_SITE_URL}/wizard/${filing_id}?payment=cancelled`,
    });

    // 4. Persist the session ID so verify-payment can retrieve it without
    //    trusting the browser-returned value.
    await supabase
      .from('filings')
      .update({ payment_id: session.id, updated_at: new Date().toISOString() })
      .eq('id', filing_id);

    return json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[create-checkout-session]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
