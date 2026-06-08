// supabase/functions/generate-forms/index.ts
//
// Server-side renderer for Form 5472. Loads the blank PDF from the
// `irs-forms` storage bucket, fills it using the SAME simple AcroForm field
// names that src/lib/form5472Fields.ts defines (NOT the XFA dot-paths the
// previous version used — those silently no-op'd and shipped users a blank
// template), uploads the filled PDF to the `filled-forms` bucket, and hands
// back a 1-hour signed URL.
//
// Keep the field name list here aligned with src/lib/form5472Fields.ts. If
// they drift, the saved PDF is missing fields with no error. There is a
// `tests/edge_function_field_parity.spec.ts` placeholder for a CI check that
// hashes the two lists; wire it up before adding new fields.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const IRS_BUCKET = Deno.env.get('F5472_BUCKET') ?? 'irs-forms'
const FILLED_BUCKET = Deno.env.get('FILLED_BUCKET') ?? 'filled-forms'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function fmtEin(ein: string | null | undefined): string {
  if (!ein) return ''
  const digits = ein.replace(/\D/g, '')
  if (digits.length !== 9) return ein
  return `${digits.slice(0, 2)}-${digits.slice(2)}`
}

function fmtCityStateZip(addr: Record<string, string> | null): string {
  if (!addr) return ''
  return [addr.city, addr.region, addr.postal_code].filter(Boolean).join(', ')
}

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

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { filing_id } = await req.json()
    if (!filing_id) return json({ error: 'filing_id is required' }, 400)

    const { data: filing, error: filingError } = await supabase
      .from('filings').select('*').eq('id', filing_id).eq('user_id', user.id).single()

    if (filingError || !filing) return json({ error: 'Filing not found' }, 404)
    if (filing.status !== 'paid' && filing.status !== 'completed') {
      return json({ error: 'Payment required before generating forms' }, 402)
    }

    const { data: pdfData, error: pdfError } = await supabase.storage
      .from(IRS_BUCKET).download('f5472.pdf')
    if (pdfError || !pdfData) return json({ error: 'Could not load source PDF' }, 500)

    const pdfBytes = await pdfData.arrayBuffer()
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const form = pdfDoc.getForm()

    function setField(name: string, value: string | null | undefined) {
      try {
        form.getTextField(name).setText(value ?? '')
      } catch {
        // Field doesn't exist in this PDF version — skip silently.
      }
    }

    // ── Part I: Reporting Corporation ────────────────────────────────────
    // Field names match src/lib/form5472Fields.ts. Keep in sync.
    setField('CorporationName',  filing.llc_name)
    setField('EIN',              fmtEin(filing.ein))
    setField('TotalAssets',      filing.total_assets != null ? String(filing.total_assets) : '')
    setField('CorpBusinessActivity',  filing.naics_description)
    setField('CorpBusActivityCode',   filing.naics_code)

    const addr = filing.mailing_address as Record<string, string> | null
    setField('StreetAddress',  addr?.line1)
    setField('CityStateZIP',   fmtCityStateZip(addr))

    setField('CorpIncorpCountry',  'United States')
    setField('CorpResCountry',     'United States')
    setField('CorpBusCountry',     'United States')

    // ── Part II: 25% Foreign Shareholder ─────────────────────────────────
    const ownerAddr = filing.owner_address as Record<string, string> | null
    const shareholderBlock = [
      filing.owner_full_name,
      ownerAddr?.line1,
      fmtCityStateZip(ownerAddr),
      ownerAddr?.country,
    ].filter(Boolean).join('\n')

    setField('ShareholderNameAddress',     shareholderBlock)
    setField('ShareholderEINSSN',          filing.owner_us_tin)
    setField('ShareholderRefID',           filing.owner_reference_id)
    setField('ShareholderFTIN',            filing.owner_foreign_tax_id)
    setField('ShareholderBusCountry',      filing.owner_country_residence)  // line 4c
    setField('ShareholderCitizenCountry',  filing.owner_country_citizenship)
    setField('ShareholderResidentCountry', filing.owner_country_residence)

    // ── Part III: Related Party (same person as shareholder for SMLLC) ───
    setField('RPNameAddress',           shareholderBlock)
    setField('RPUSTIN',                 filing.owner_us_tin)
    setField('Text Field0',             filing.owner_reference_id)
    setField('RPFTIN',                  filing.owner_foreign_tax_id)
    setField('RPBusinessActivity',      filing.naics_description)
    setField('RPBusinessActivityCode',  filing.naics_code)
    setField('RPBusinessCountry',       filing.owner_country_residence)
    setField('RPResCountry',            filing.owner_country_residence)

    form.flatten()
    const filledBytes = await pdfDoc.save()

    const filledPath = `${user.id}/${filing_id}/f5472-filled.pdf`
    const { error: uploadError } = await supabase.storage
      .from(FILLED_BUCKET)
      .upload(filledPath, filledBytes, { contentType: 'application/pdf', upsert: true })
    if (uploadError) {
      return json({ error: `Could not save filled PDF: ${uploadError.message}` }, 500)
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(FILLED_BUCKET)
      .createSignedUrl(filledPath, 3600)
    if (signedError || !signedData) return json({ error: 'Could not create download URL' }, 500)

    // Idempotent completion: never decrement download_count; only flip status
    // forward (paid -> completed). If it's already completed, just hand back
    // the new signed URL.
    if (filing.status === 'paid') {
      await supabase.from('filings').update({
        status: 'completed',
        forms_generated_at: new Date().toISOString(),
        download_count: (filing.download_count ?? 0) + 1,
        file_path: filledPath,
      }).eq('id', filing_id)
    } else {
      await supabase.from('filings').update({
        download_count: (filing.download_count ?? 0) + 1,
        file_path: filledPath,
      }).eq('id', filing_id)
    }

    return json({ url: signedData.signedUrl })
  } catch (err) {
    console.error('[generate-forms]', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
