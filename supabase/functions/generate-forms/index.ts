import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const IRS_BUCKET = Deno.env.get('F5472_BUCKET') ?? 'irs-forms'
const FILLED_BUCKET = 'filled-forms'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Auth check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { filing_id } = await req.json()
    if (!filing_id) return json({ error: 'filing_id is required' }, 400)

    // Load filing
    const { data: filing, error: filingError } = await supabase
      .from('filings')
      .select('*')
      .eq('id', filing_id)
      .eq('user_id', user.id)
      .single()

    if (filingError || !filing) return json({ error: 'Filing not found' }, 404)
    if (filing.status !== 'paid' && filing.status !== 'completed') {
      return json({ error: 'Payment required before generating forms' }, 402)
    }

    // Download blank f5472.pdf from irs-forms bucket
    const { data: pdfData, error: pdfError } = await supabase.storage
      .from(IRS_BUCKET)
      .download('f5472.pdf')

    if (pdfError || !pdfData) return json({ error: 'Could not load source PDF' }, 500)

    const pdfBytes = await pdfData.arrayBuffer()
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const form = pdfDoc.getForm()

    // Helper to safely set a text field
    function setField(name: string, value: string | null | undefined) {
      try {
        const field = form.getTextField(name)
        field.setText(value ?? '')
      } catch (_) {
        // Field doesn't exist in this PDF version — skip silently
      }
    }

    // Part I — Reporting Corporation
    setField('topmostSubform[0].Page1[0].f1_1[0]', filing.llc_name ?? '')
    setField('topmostSubform[0].Page1[0].f1_2[0]', filing.ein ?? '')
    setField('topmostSubform[0].Page1[0].f1_3[0]', filing.tax_year ?? '')
    setField('topmostSubform[0].Page1[0].f1_4[0]', filing.state_of_formation ?? '')
    setField('topmostSubform[0].Page1[0].f1_5[0]', filing.naics_code ?? '')
    setField('topmostSubform[0].Page1[0].f1_6[0]', filing.total_assets ? String(filing.total_assets) : '')

    // Mailing address
    const addr = filing.mailing_address as Record<string, string> | null
    if (addr) {
      setField('topmostSubform[0].Page1[0].f1_7[0]', addr.line1 ?? '')
      setField('topmostSubform[0].Page1[0].f1_8[0]', [addr.city, addr.region, addr.postal_code].filter(Boolean).join(', '))
      setField('topmostSubform[0].Page1[0].f1_9[0]', addr.country ?? '')
    }

    // Part II — Foreign Owner
    setField('topmostSubform[0].Page1[0].f1_10[0]', filing.owner_full_name ?? '')
    setField('topmostSubform[0].Page1[0].f1_11[0]', filing.owner_country_residence ?? '')
    setField('topmostSubform[0].Page1[0].f1_12[0]', filing.owner_country_citizenship ?? '')
    setField('topmostSubform[0].Page1[0].f1_13[0]', filing.owner_us_tin ?? '')
    setField('topmostSubform[0].Page1[0].f1_14[0]', filing.owner_foreign_tax_id ?? '')
    setField('topmostSubform[0].Page1[0].f1_15[0]', filing.owner_reference_id ?? '')

    const ownerAddr = filing.owner_address as Record<string, string> | null
    if (ownerAddr) {
      setField('topmostSubform[0].Page1[0].f1_16[0]', ownerAddr.line1 ?? '')
      setField('topmostSubform[0].Page1[0].f1_17[0]', [ownerAddr.city, ownerAddr.region, ownerAddr.postal_code].filter(Boolean).join(', '))
      setField('topmostSubform[0].Page1[0].f1_18[0]', ownerAddr.country ?? '')
    }

    form.flatten()

    const filledBytes = await pdfDoc.save()
    const filledPath = `${user.id}/${filing_id}/f5472-filled.pdf`

    const { error: uploadError } = await supabase.storage
      .from(FILLED_BUCKET)
      .upload(filledPath, filledBytes, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) return json({ error: 'Could not save filled PDF' }, 500)

    // Create signed URL (1 hour)
    const { data: signedData, error: signedError } = await supabase.storage
      .from(FILLED_BUCKET)
      .createSignedUrl(filledPath, 3600)

    if (signedError || !signedData) return json({ error: 'Could not create download URL' }, 500)

    // Mark as completed
    await supabase
      .from('filings')
      .update({
        status: 'completed',
        forms_generated_at: new Date().toISOString(),
        download_count: (filing.download_count ?? 0) + 1,
      })
      .eq('id', filing_id)

    return json({ url: signedData.signedUrl })
  } catch (err) {
    console.error(err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
