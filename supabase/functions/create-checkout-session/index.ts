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

// ─── Billing address prefill ──────────────────────────────────────────────────
//
// The address sent to Dodo is the OWNER'S FOREIGN address, not the LLC's US
// one. The filing is about the entity, but the checkout is about whoever is
// holding the card, and our filers are non-US persons by definition: their card
// is issued abroad and its billing address is their own. Prefilling a Wyoming
// registered-agent address would fail AVS at the one moment in the funnel where
// a decline costs the whole sale, and it would misstate the buyer's country to
// Dodo, who are merchant of record and determine tax from it.
//
// Every field is left editable (allow_customer_editing_*). The payer is not
// guaranteed to be the owner at all: an accountant, an agent or a family member
// may be paying, in which case no address on the filing is theirs. A prefill
// that cannot be corrected would be worse than no prefill.

/** Country name (as intake stores it) → ISO 3166-1 alpha-2, or null. */
let alpha2ByName: Map<string, string> | null = null;
function alpha2For(country: unknown): string | null {
  const raw = typeof country === 'string' ? country.trim() : '';
  if (!raw) return null;
  // Already a code.
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();

  // Built by reversing Intl's own country list rather than shipping a table:
  // intake stores full English names ("Singapore", "United Arab Emirates") and
  // a hand-maintained map would drift from the intake country list, which has
  // drifted before. Unknown names return null and the address is omitted
  // entirely, because `country` is REQUIRED in a Dodo billing_address and a
  // wrong or missing one fails the whole checkout, not just the prefill.
  if (!alpha2ByName) {
    alpha2ByName = new Map();
    try {
      const names = new Intl.DisplayNames(['en'], { type: 'region' });
      for (let a = 65; a <= 90; a++) {
        for (let b = 65; b <= 90; b++) {
          const code = String.fromCharCode(a, b);
          const name = names.of(code);
          // FIRST code wins. Several names have more than one code that
          // resolves to them and only one is ISO 3166-1: "United Kingdom" is
          // both GB and the ICU alias UK, and last-wins would send Dodo "UK",
          // which is not a valid alpha-2.
          const key = name?.toLowerCase();
          if (key && name !== code && !alpha2ByName.has(key)) alpha2ByName.set(key, code);
        }
      }
    } catch {
      /* no ICU: every lookup below misses and the prefill is skipped */
    }
    // Names our intake uses that ICU spells differently, and the handful ICU
    // resolves to a WRONG code. These OVERRIDE the derived map: "Vietnam"
    // otherwise lands on VD, the withdrawn North Vietnam code, because VD
    // sorts before VN and first-wins keeps it.
    for (const [alias, code] of [
      ['united states of america', 'US'], ['usa', 'US'], ['u.s.a.', 'US'],
      ['uk', 'GB'], ['united kingdom of great britain and northern ireland', 'GB'],
      ['vietnam', 'VN'], ['viet nam', 'VN'],
      ['hong kong', 'HK'], ['macau', 'MO'], ['macao', 'MO'], ['taiwan', 'TW'],
      ['south korea', 'KR'], ['north korea', 'KP'], ['russia', 'RU'],
      ['uae', 'AE'], ['ivory coast', 'CI'], ['czech republic', 'CZ'],
      ['turkey', 'TR'], ['syria', 'SY'], ['laos', 'LA'],
      ['cape verde', 'CV'], ['east timor', 'TL'], ['swaziland', 'SZ'],
      ['moldova', 'MD'], ['bolivia', 'BO'], ['tanzania', 'TZ'],
      ['venezuela', 'VE'], ['brunei', 'BN'], ['palestine', 'PS'],
      ['cabo verde', 'CV'], ['myanmar', 'MM'], ['burma', 'MM'],
      ['congo (democratic republic)', 'CD'], ['congo (republic)', 'CG'],
      ['sao tome and principe', 'ST'],
      // ICU abbreviates these to "St. ..."; our list writes them out.
      ['saint kitts and nevis', 'KN'], ['saint lucia', 'LC'],
      ['saint vincent and the grenadines', 'VC'],
    ] as const) {
      alpha2ByName.set(alias, code);
    }
  }

  const key = raw.toLowerCase();
  // Our list spells conjunctions out ("Antigua and Barbuda"); ICU uses "&".
  return alpha2ByName.get(key)
    ?? alpha2ByName.get(key.replace(/ and /g, ' & '))
    ?? null;
}

/** One string from whichever address shape the wizard happened to write. */
function addressField(address: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = address[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * The owner's address as a Dodo `billing_address`, or null if we cannot resolve
 * a country code. Handles both address shapes the wizard has written over time
 * ({street, city, state, zip} and {line1, region, postal_code}).
 */
function ownerBillingAddress(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const address = raw as Record<string, unknown>;
  const country = alpha2For(address.country);
  if (!country) return null;
  const out: Record<string, string> = { country };
  const street = addressField(address, 'street', 'line1', 'address_line1');
  const city = addressField(address, 'city');
  const state = addressField(address, 'state', 'region', 'province');
  const zipcode = addressField(address, 'zip', 'postal_code', 'zipcode');
  if (street) out.street = street;
  if (city) out.city = city;
  if (state) out.state = state;
  if (zipcode) out.zipcode = zipcode;
  return out;
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

    const { filing_id, addon } = await req.json() as {
      filing_id?: string;
      addon?: string;
    };
    if (!filing_id) return json({ error: 'filing_id is required' }, 400);
    if (addon !== undefined && addon !== 'fax') {
      return json({ error: 'Unknown add-on.' }, 400);
    }
    const faxAddon = addon === 'fax';

    const { data: anchor, error: anchorErr } = await supabase
      .from('filings')
      .select('id, job_id, status, llc_name, tax_year, user_id, include_rcl, include_irs_fax, related_parties, paid_related_party_count, owner_full_name, owner_foreign_address, owner_address')
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

    // ─── The fax bought after the filing was paid ────────────────────────────
    //
    // The entitlement is set on the intake screen and then FROZEN by
    // `filings_freeze_when_paid()`, so a filer who skipped the tick had no route
    // to the $9 at all: not a second checkout, not the filing page, nothing but
    // an email to support. This is that route, and it is deliberately a cart of
    // exactly one item rather than a re-derivation of the whole order, so it
    // cannot re-charge for the filing, the letter or a party.
    //
    // Still not a standalone product. It is only offered against a filing that
    // is already paid, which is what keeps "fax cannot be bought on its own"
    // true on Home, Pricing and Services.
    if (faxAddon) {
      if (!supplemental) {
        return json({ error: 'Pay for the filing first, then fax delivery can be added.' }, 409);
      }
      // One $9 covers the whole job however many years it holds, so an
      // entitlement anywhere in the job means there is nothing to sell. A
      // sentence rather than `already_paid: true`, which the browser renders as
      // the generic "Unable to start checkout": the likely cause is a stale tab
      // offering something a second tab already bought, and that filer needs to
      // be told to refresh, not told to try again.
      if (includeFax) {
        return json({ error: 'Fax delivery is already on this filing. Refresh the page to send it.' }, 409);
      }
    }

    const productCart = faxAddon
      ? [{ product_id: PRODUCTS.fax, quantity: 1 }]
      : supplemental
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

    const billingAddress =
      ownerBillingAddress(anchor.owner_foreign_address) ??
      ownerBillingAddress(anchor.owner_address);

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
          // The person paying, with the entity named after them, rather than
          // the entity alone: the card and the receipt belong to a human.
          name: anchor.owner_full_name
            ? (anchor.llc_name ? `${anchor.owner_full_name} (${anchor.llc_name})` : anchor.owner_full_name)
            : anchor.llc_name || user.email || 'FileTax customer',
        },
        ...(billingAddress
          ? {
              billing_address: billingAddress,
              feature_flags: {
                allow_customer_editing_country: true,
                allow_customer_editing_city: true,
                allow_customer_editing_state: true,
                allow_customer_editing_street: true,
                allow_customer_editing_zipcode: true,
              },
            }
          : {}),
        return_url: `${PUBLIC_SITE_URL}/filing/${filing_id}?payment=return`,
        cancel_url: `${PUBLIC_SITE_URL}/filing/${filing_id}?payment=cancelled`,
        metadata: {
          filing_id,
          filing_job_id: anchor.job_id ?? '',
          user_id: user.id,
          checkout_type: faxAddon
            ? 'fax_addon'
            : supplemental ? 'additional_party' : 'initial',
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
