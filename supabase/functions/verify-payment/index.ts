// supabase/functions/verify-payment/index.ts
//
// Server-side verification of a payment for a filing.
//
// SECURITY CONTRACT
//   1. The client may NEVER write status='paid' directly. Only this function
//      (and the webhook below) may flip a filing to 'paid'.
//   2. The webhook is the source of truth. This function is a polite "did the
//      webhook land yet?" check after the user returns from hosted checkout.
//   3. Never trust amount_cents, payment_id, or status passed in from the
//      browser - always re-read them from the PSP using a server secret.
//
// IMPLEMENTATION NOTES
//   - Pick a PSP (Stripe is the obvious default). Plug the SDK in below where
//     the TODO marker is. Use PSP_SECRET_KEY from Deno.env, never a key the
//     browser has seen.
//   - Idempotency: a filing already in status='paid' or 'completed' is a no-op.
//   - This function uses the service-role key so it can write to filings
//     regardless of RLS. Keep it private.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// const PSP_SECRET_KEY = Deno.env.get('PSP_SECRET_KEY')!; // e.g. Stripe

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Authenticate caller - they must own this filing.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { filing_id, payment_id } = await req.json();
    if (!filing_id || !payment_id) return json({ error: 'filing_id and payment_id required' }, 400);

    const { data: filing, error: filingErr } = await supabase
      .from('filings').select('*').eq('id', filing_id).eq('user_id', user.id).single();
    if (filingErr || !filing) return json({ error: 'Filing not found' }, 404);

    // Already paid -> idempotent success.
    if (filing.status === 'paid' || filing.status === 'completed') {
      return json({ status: 'paid', payment_id: filing.payment_id });
    }

    // 2. TODO(payments): replace this block with a real PSP lookup.
    //
    //    const stripe = new Stripe(PSP_SECRET_KEY);
    //    const session = await stripe.checkout.sessions.retrieve(payment_id);
    //    if (session.payment_status !== 'paid') {
    //      return json({ status: session.payment_status }, 402);
    //    }
    //    const amount = session.amount_total ?? 0;
    //    const pspPaymentId = session.payment_intent as string;
    //
    //    Until that wiring is live, fail closed - refuse to mark anything paid.
    return json({
      error: 'verify-payment is not wired to a PSP yet. Configure PSP_SECRET_KEY and the TODO block in supabase/functions/verify-payment/index.ts.',
    }, 501);

    // 3. (after PSP wiring) mark the filing paid.
    // const now = new Date().toISOString();
    // const { error: updateErr } = await supabase.from('filings').update({
    //   status: 'paid', paid_at: now, payment_id: pspPaymentId,
    //   payment_amount_cents: amount, forms_generated_at: now,
    // }).eq('id', filing_id);
    // if (updateErr) return json({ error: updateErr.message }, 500);
    // return json({ status: 'paid', payment_id: pspPaymentId });
  } catch (err) {
    console.error('[verify-payment]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
