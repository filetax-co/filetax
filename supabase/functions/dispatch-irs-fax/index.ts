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

// Sinch's documented no-charge outbound test destination. Keep this hardcoded
// until the production destination is deliberately enabled in a later change.
const TEST_DESTINATION = '+19898989898';
const MAX_PDF_BYTES = 20 * 1024 * 1024;

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
    if (!['paid', 'completed'].includes(filing.status) || filing.include_irs_fax !== true) {
      return json({ error: 'This filing does not have paid IRS fax delivery.' }, 403);
    }
    const dispatchKey = filing.job_id ? `job:${filing.job_id}` : `filing:${filing.id}`;

    const { data: existing } = await supabase
      .from('fax_transmissions')
      .select('id, status, provider_fax_id, attempts')
      .eq('dispatch_key', dispatchKey)
      .maybeSingle();
    if (existing && existing.status !== 'failed') {
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
      const { data: claimed, error: claimErr } = await supabase
        .from('fax_transmissions')
        .update({
          status: 'dispatching',
          attempts,
          failure_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('status', 'failed')
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
    outbound.set('resolution', 'FINE');
    outbound.set('headerPageNumbers', 'true');
    outbound.set('labels[filingId]', filing.id);
    outbound.set('labels[transmissionId]', transmissionId);

    const basic = btoa(`${SINCH_ACCESS_KEY}:${SINCH_ACCESS_SECRET}`);
    const response = await fetch(
      `https://fax.api.sinch.com/v3/projects/${encodeURIComponent(SINCH_PROJECT_ID)}/faxes`,
      { method: 'POST', headers: { Authorization: `Basic ${basic}` }, body: outbound },
    );
    const result = await response.json().catch(() => ({}));

    if (!response.ok || typeof result.id !== 'string') {
      const reason = typeof result.message === 'string'
        ? result.message.slice(0, 500)
        : `Sinch returned HTTP ${response.status}`;
      await supabase.from('fax_transmissions').update({
        status: 'failed',
        provider_status: typeof result.status === 'string' ? result.status : null,
        failure_reason: reason,
        updated_at: new Date().toISOString(),
      }).eq('id', transmissionId);
      console.error('[dispatch-irs-fax] Sinch response', response.status, result);
      return json({ error: 'Sinch could not accept the fax. Please try again.' }, 502);
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase.from('fax_transmissions').update({
      status: 'submitted',
      provider_fax_id: result.id,
      provider_status: typeof result.status === 'string' ? result.status : 'IN_PROGRESS',
      submitted_at: now,
      updated_at: now,
    }).eq('id', transmissionId);
    if (updateErr) console.error('[dispatch-irs-fax] metadata update', updateErr);

    return json({ status: 'submitted', fax_id: result.id, destination: TEST_DESTINATION });
  } catch (err) {
    console.error('[dispatch-irs-fax]', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
