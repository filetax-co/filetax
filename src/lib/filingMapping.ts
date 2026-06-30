/**
 * Canonical mapping layer — the single source of truth that reconciles the
 * three vocabularies that exist across the app:
 *
 *   1. Intake UI       (src/app/pages/intake/constants.ts + Intake.tsx)
 *   2. Database        (supabase/schema.sql column names + CHECK constraints)
 *   3. PDF generator   (src/lib/pdfGenerator.ts — the only generator the app
 *                       actually invokes; the generate-forms edge function is
 *                       dead code, see its header note)
 *
 * Historically these drifted: the intake form emitted ~30 transaction-type
 * codes and an address shape `{line1, region, postal_code}`, while the
 * generator understood ~18 canonical codes and read `{street, state, zip}`
 * from differently-named columns. The result was silent data loss — rows that
 * never reached the form, fields that printed blank.
 *
 * This module is the seam. Intake calls `toCanonicalTxType` at persist time so
 * every row satisfies the DB CHECK constraint and is understood by the
 * generator. The generator calls `normalizeFiling` so it reads canonical
 * fields regardless of which column name the wizard happened to write.
 */

import type { Filing, Address, Transaction } from './supabase';

// ───────────────────────────────────────────────────────────────────────────
// Transaction-type translation (Intake UI code  →  canonical DB/generator code)
// ───────────────────────────────────────────────────────────────────────────
//
// The canonical set is exactly what `reportable_transactions.transaction_type`
// CHECK allows AND what `aggregateTransactions` in pdfGenerator.ts switches on:
//
//   sales, service_payment, rent_royalty, loan_to_llc, loan_from_llc,
//   interest, insurance, dividend, commission, intangible, other,
//   capital_contribution, distribution, formation_costs, property_transfer,
//   tangible_property, loan_guarantee, nonmonetary_other
//
// Some UI codes carry extra meaning that the canonical code alone can't hold
// (e.g. `royalty` vs `rent` both map to `rent_royalty`, distinguished by the
// `is_royalty` flag). `mapTransactionForPersist` handles that.

export type CanonicalTxType = Transaction['transaction_type'];

const UI_TO_CANONICAL: Record<string, CanonicalTxType> = {
  // ── Part IV — goods & property ──────────────────────────────────────────
  tangible_purchase: 'tangible_property',
  tangible_sale:     'tangible_property',
  sales:             'sales',

  // ── Part IV — services ──────────────────────────────────────────────────
  service_payment: 'service_payment',
  tech_services:   'service_payment',
  commission:      'commission',

  // ── Part IV — rent, royalty, interest ───────────────────────────────────
  rent:     'rent_royalty', // is_royalty = false
  royalty:  'rent_royalty', // is_royalty = true
  interest: 'interest',

  // ── Part IV — loans ─────────────────────────────────────────────────────
  loan_to_llc:   'loan_to_llc',
  loan_from_llc: 'loan_from_llc',

  // ── Part IV — complex / CPA-level ───────────────────────────────────────
  intangible:            'intangible',
  // The 5472 has dedicated platform-contribution / cost-sharing lines
  // (11/12/25/26) but the generator does not expose them yet, so these are
  // disclosed under "other amount" (line 21/35) until those lines are wired.
  platform_contribution: 'other',
  cost_sharing:          'other',
  insurance:             'insurance',
  loan_guarantee_fee:    'loan_guarantee',
  other:                 'other',

  // ── Part V — contributions, distributions & entity events ───────────────
  capital_contribution: 'capital_contribution',
  distribution:         'distribution',
  dividend:             'dividend',
  formation_costs:      'formation_costs',
  // Structural events map to the nearest monetary Part V concept; the Part V
  // statement narrates the specifics from the description.
  formation_tx:         'capital_contribution',
  dissolution_tx:       'distribution',
  acquisition_tx:       'capital_contribution',
  disposition_tx:       'distribution',
  other_part_v:         'capital_contribution',

  // ── Part VI — nonmonetary / less-than-FMV ───────────────────────────────
  nonmonetary_transfer:  'property_transfer',
  less_than_fmv:         'property_transfer',
  property_transfer_fmv: 'property_transfer',
  other_part_vi:         'nonmonetary_other',
};

/**
 * Translate a single Intake UI transaction-type code into the canonical code
 * understood by the DB and the PDF generator. Falls back to 'other' for any
 * unrecognized code so a row is never silently rejected by the DB CHECK.
 */
export function toCanonicalTxType(uiType: string): CanonicalTxType {
  return UI_TO_CANONICAL[uiType] ?? 'other';
}

/** UI codes that mean a royalty (sets is_royalty = true on the canonical row). */
const ROYALTY_UI_TYPES = new Set(['royalty']);

/**
 * Build the canonical row to persist into `reportable_transactions` from an
 * Intake transaction draft. Centralises the type translation + the is_royalty
 * derivation so Intake.tsx never has to know the canonical vocabulary.
 */
export function mapTransactionForPersist(row: {
  transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: number | null;
  loan_begin_usd?: number | null;
  description?: string | null;
  transaction_date?: string | null;
}): {
  transaction_type: CanonicalTxType;
  direction: 'paid' | 'received';
  amount_usd: number | null;
  loan_begin_usd: number | null;
  is_royalty: boolean | null;
  description: string | null;
  transaction_date: string | null;
} {
  const canonical = toCanonicalTxType(row.transaction_type);
  const isRoyalty =
    canonical === 'rent_royalty' ? ROYALTY_UI_TYPES.has(row.transaction_type) : null;

  return {
    transaction_type: canonical,
    direction: row.direction,
    amount_usd: row.amount_usd ?? null,
    loan_begin_usd: row.loan_begin_usd ?? null,
    is_royalty: isRoyalty,
    description: row.description?.trim() || null,
    transaction_date: row.transaction_date || null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Address normalization (Intake `{line1, region, postal_code}`  →  canonical
// `{street, state, zip}` that the generator reads)
// ───────────────────────────────────────────────────────────────────────────

type IntakeAddress = {
  line1?: string;
  street?: string;
  city?: string;
  region?: string;
  state?: string;
  postal_code?: string;
  zip?: string;
  country?: string;
} | null | undefined;

/** Convert whichever address shape the wizard wrote into the canonical Address. */
export function normalizeAddress(addr: IntakeAddress): Address | null {
  if (!addr) return null;
  const street = addr.street ?? addr.line1 ?? '';
  const state = addr.state ?? addr.region ?? '';
  const zip = addr.zip ?? addr.postal_code ?? '';
  const city = addr.city ?? '';
  const country = addr.country ?? '';
  if (!street && !city && !state && !zip && !country) return null;
  return { street, city, state, zip, country };
}

// ───────────────────────────────────────────────────────────────────────────
// Related-party normalization
// ───────────────────────────────────────────────────────────────────────────

/** A related party as the generator wants to consume it (canonical names). */
export interface NormalizedParty {
  /** 0 = the primary owner; 1..n = additional related parties. */
  index: number;
  full_name: string;
  reference_id: string;
  /** Country where this party conducts business. */
  country_business: string;
  /** Country of residence / tax residence. */
  country_residence: string;
  /** Country of citizenship (individual) / formation (entity). */
  country_citizenship: string;
  foreign_tax_id: string;
  us_tin: string;
  business_activity: string;
  business_code: string;
  address: Address | null;
  /**
   * Owner always provides managerial services (FMV not determinable) → Part VI
   * statement + checkbox always apply to the owner's 5472. For additional
   * related parties, Part VI applies only when they actually have a Part VI
   * transaction (decided per filing).
   */
  is_owner: boolean;
}

/** Raw related-party JSON shape stored on `filings.related_parties`. */
type RawRelatedParty = {
  id?: string;
  name?: string;
  ref_number?: string;
  country?: string;
  country_residence?: string;
  country_citizenship?: string;
  us_tin?: string;
  foreign_tax_id?: string;
  address?: IntakeAddress;
  biz_activity?: string;
  biz_code?: string;
};

// ───────────────────────────────────────────────────────────────────────────
// Filing normalization (the generator's entry adapter)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The canonical, generator-ready view of a filing. It resolves every field the
 * generator needs from whichever column the wizard actually wrote, so the
 * generator never reads a wizard-specific column name directly.
 */
export interface NormalizedFiling extends Filing {
  /** Canonical LLC US address (already shape-normalized). */
  llc_us_address: Address | null;
  /** The owner as the first normalized party. */
  owner: NormalizedParty;
  /** Owner + any additional related parties, in order (index 0..n). */
  parties: NormalizedParty[];
}

function pick<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) if (v != null && v !== ('' as unknown)) return v as T;
  return undefined;
}

/**
 * Normalize a raw `filings` row (as written by the Intake wizard) into the
 * canonical shape the PDF generator consumes. This is the seam that absorbs
 * all historical column-name and address-shape drift.
 */
export function normalizeFiling(raw: Filing & Record<string, unknown>): NormalizedFiling {
  // ── Entity-level reconciliation ──────────────────────────────────────────
  const date_of_incorporation =
    pick<string>(
      raw.date_of_incorporation as string,
      raw['entity_date_of_incorporation'] as string,
    ) ?? null;

  const country_of_incorporation =
    pick<string>(
      raw.country_of_incorporation as string,
      // The LLC is US-formed; its "country of incorporation" is the US.
      'United States',
    ) ?? 'United States';

  const naics_code =
    pick<string>(raw.naics_code as string, raw['entity_business_code'] as string) ?? null;
  const naics_description =
    pick<string>(
      raw.naics_description as string,
      raw['entity_business_activity'] as string,
    ) ?? null;

  const llc_us_address = normalizeAddress(
    pick<IntakeAddress>(
      raw.llc_us_address as IntakeAddress,
      raw.mailing_address as IntakeAddress,
    ),
  );

  // ── Owner (primary related party) reconciliation ─────────────────────────
  const owner: NormalizedParty = {
    index: 0,
    is_owner: true,
    full_name: pick<string>(raw.owner_full_name as string) ?? '',
    reference_id:
      pick<string>(
        raw.owner_reference_id as string,
        raw['owner_ref_number'] as string,
      ) ?? '',
    // "Country where you do business" (Intake step 2) — literal user answer.
    country_business:
      pick<string>(
        raw['owner_country'] as string,
        raw.owner_primary_country as string,
      ) ?? '',
    // "Country where you pay taxes" — residence / tax residence.
    country_residence:
      pick<string>(
        raw.owner_country_residence as string,
        raw.owner_resident_country as string,
      ) ?? '',
    // Citizenship (individual) — newly collected; falls back to residence.
    country_citizenship:
      pick<string>(
        raw.owner_country_citizenship as string,
        raw.owner_country_residence as string,
      ) ?? '',
    foreign_tax_id: pick<string>(raw.owner_foreign_tax_id as string) ?? '',
    us_tin: pick<string>(raw.owner_us_tin as string, raw['owner_ssn'] as string) ?? '',
    business_activity:
      pick<string>(
        raw.owner_business_activity as string,
        naics_description ?? undefined,
      ) ?? '',
    business_code:
      pick<string>(
        raw.owner_naics_code as string,
        raw['owner_business_code'] as string,
        naics_code ?? undefined,
      ) ?? '',
    address: normalizeAddress(
      pick<IntakeAddress>(
        raw.owner_foreign_address as IntakeAddress,
        raw.owner_address as IntakeAddress,
      ),
    ),
  };

  // ── Additional related parties ───────────────────────────────────────────
  const rawParties = (raw['related_parties'] as RawRelatedParty[] | null | undefined) ?? [];
  const additional: NormalizedParty[] = rawParties.map((rp, i) => ({
    index: i + 1,
    is_owner: false,
    full_name: rp.name ?? '',
    reference_id: rp.ref_number ?? '',
    country_business: rp.country ?? '',
    country_residence: rp.country_residence ?? '',
    country_citizenship: rp.country_citizenship ?? rp.country ?? '',
    foreign_tax_id: rp.foreign_tax_id ?? '',
    us_tin: rp.us_tin ?? '',
    business_activity: rp.biz_activity ?? '',
    business_code: rp.biz_code ?? '',
    address: normalizeAddress(rp.address),
  }));

  return {
    ...raw,
    date_of_incorporation,
    country_of_incorporation,
    naics_code,
    naics_description,
    llc_us_address,
    owner,
    parties: [owner, ...additional],
  };
}
