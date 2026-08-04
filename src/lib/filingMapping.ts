/**
 * Canonical mapping layer, the single source of truth that reconciles the
 * three vocabularies that exist across the app:
 *
 *   1. Intake UI       (src/app/pages/intake/constants.ts + Intake.tsx)
 *   2. Database        (supabase/schema.sql column names + CHECK constraints)
 *   3. PDF generator   (src/lib/pdfGenerator.ts, the only generator the app
 *                       actually invokes; the generate-forms edge function is
 *                       dead code, see its header note)
 *
 * Historically these drifted: the intake form emitted ~30 transaction-type
 * codes and an address shape `{line1, region, postal_code}`, while the
 * generator understood ~18 canonical codes and read `{street, state, zip}`
 * from differently-named columns. The result was silent data loss, rows that
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
//   sales, service_payment, rent, royalty, loan_to_llc, loan_from_llc,
//   interest, insurance, dividend, commission, intangible, other,
//   capital_contribution, distribution, formation_costs, structural_event,
//   property_transfer, tangible_property, loan_guarantee, nonmonetary_other
//
// The mapping is still many-to-one in places (tech_services and service_payment
// share a code; five UI codes share `other`), but it no longer needs a
// side-channel column to reach the right line. `rent` and `royalty` used to be
// one code plus an `is_royalty` boolean, which meant a nullable column decided
// whether an amount printed on line 13a or 13b, and null and false had to mean
// the same thing. They are separate codes now and the flag is gone.

export type CanonicalTxType = Transaction['transaction_type'];

const UI_TO_CANONICAL: Record<string, CanonicalTxType> = {
  // ── Part IV, goods & property ──────────────────────────────────────────
  tangible_purchase: 'tangible_property',
  tangible_sale:     'tangible_property',
  sales:             'sales',

  // ── Part IV, services ──────────────────────────────────────────────────
  service_payment: 'service_payment',
  tech_services:   'service_payment',
  commission:      'commission',

  // ── Part IV, rent, royalty, interest ───────────────────────────────────
  rent:     'rent',     // lines 13a / 27a
  royalty:  'royalty',  // lines 13b / 27b
  interest: 'interest',

  // ── Part IV, loans ─────────────────────────────────────────────────────
  loan_to_llc:   'loan_to_llc',
  loan_from_llc: 'loan_from_llc',

  // ── Part IV, complex / CPA-level ───────────────────────────────────────
  intangible:            'intangible',
  // The 5472 has dedicated platform-contribution / cost-sharing lines
  // (11/12/25/26) but the generator does not expose them yet, so these are
  // disclosed under "other amount" (line 21/35) until those lines are wired.
  platform_contribution: 'other',
  cost_sharing:          'other',
  // Form 5472 has no digital-asset line. The amount is disclosed under "other
  // amount" (line 21/35) so it is reported and the line 22/36 totals still
  // foot, the same treatment the absent loan-guarantee lines already get.
  digital_asset:         'other',
  insurance:             'insurance',
  loan_guarantee_fee:    'loan_guarantee',
  other:                 'other',

  // ── Part V, contributions, distributions & entity events ───────────────
  capital_contribution: 'capital_contribution',
  distribution:         'distribution',
  dividend:             'dividend',
  formation_costs:      'formation_costs',
  // Money the owner puts in at formation IS a capital contribution, so this one
  // genuinely belongs on that code.
  formation_tx:         'capital_contribution',
  // An acquisition, a disposal or another entity-level event is disclosed in
  // the Part V statement under its own name. These used to map onto
  // `capital_contribution` and `distribution`, which printed "Capital
  // Contribution by Owner" on a filed statement describing the purchase of a
  // third company, and rolled the amount into the contributions subtotal and
  // therefore into line 1f. `structural_event` carries no amount onto any line
  // and into no subtotal; the statement narrates it from the description.
  acquisition_tx:       'structural_event',
  disposition_tx:       'structural_event',
  other_part_v:         'structural_event',
  // dissolution_tx is party-dependent and is resolved in toCanonicalTxType,
  // not here. Against the owner it is a liquidating distribution (Part V);
  // against any other related party it is a Part IV "other amount".
  dissolution_tx:       'other',

  // ── Part VI, nonmonetary / less-than-FMV ───────────────────────────────
  nonmonetary_transfer:  'property_transfer',
  less_than_fmv:         'property_transfer',
  property_transfer_fmv: 'property_transfer',
  other_part_vi:         'nonmonetary_other',
};

/**
 * Translate a single Intake UI transaction-type code into the canonical code
 * understood by the DB and the PDF generator. Falls back to 'other' for any
 * unrecognized code so a row is never silently rejected by the DB CHECK.
 *
 * `isOwner` matters for exactly one code today. A wind-down against the owner
 * is a liquidating distribution and belongs in the Part V statement, which is
 * generated for the owner alone. The same event against another related party
 * has no statement to sit in, so it is reported as a Part IV "other amount" on
 * that party's own Form 5472. Passing the wrong flag does not lose the row, it
 * files it in the wrong place, so callers that know the party must say.
 */
export function toCanonicalTxType(uiType: string, isOwner = true): CanonicalTxType {
  if (uiType === 'dissolution_tx') return isOwner ? 'distribution' : 'other';
  return UI_TO_CANONICAL[uiType] ?? 'other';
}

// ───────────────────────────────────────────────────────────────────────────
// Transaction money summary (drives the "reportable total" + buckets in the UI)
// ───────────────────────────────────────────────────────────────────────────
//
// Mirrors how pdfGenerator.aggregateTransactions + totalReceived/totalPaid map
// transactions onto Form 5472, so the figures shown to the user reconcile with
// the generated form:
//   • formGross   = Form 5472 gross payments (line 1f / 1h): Part IV flows plus
//                   the ending loan balances (17b/31b) and the monetary Part V
//                   contributions/distributions/dividends.
//   • totalEntered= every reportable amount the user entered, any type, shown
//                   alongside formGross so nothing looks "missing".
//   • buckets     = friendly Money in / Money out / Other split.

// ── Money in / Money out ──────────────────────────────────────────────────
//
// Every monetary transaction is money entering the LLC or money leaving it.
// Only Part VI is neither: those are non-cash and below-FMV disclosures, which
// frequently carry no amount at all, and that is what "Other dealings" means.
//
// This used to be two hand-written sets covering Part V and loans, with an
// `else` that swept EVERY Part IV type into Other. That made the third tile a
// dumping ground for the ordinary trading transactions most filings consist of,
// while the signal that answers the question, `direction`, was sitting unread
// on every row. Part IV rows are now classified by their direction; the fixed
// types keep an explicit answer because their direction is a property of the
// transaction rather than something the filer chooses.

/** Part VI UI codes: non-cash / below-FMV, the only genuine "other". */
const PART_VI_UI = new Set([
  'nonmonetary_transfer', 'less_than_fmv', 'property_transfer_fmv', 'other_part_vi',
]);

/** UI codes whose in/out sense is fixed by what the transaction IS. */
const MONEY_IN_UI = new Set([
  'capital_contribution', 'formation_costs', 'formation_tx',
  'loan_to_llc', 'disposition_tx',
]);
const MONEY_OUT_UI = new Set([
  'distribution', 'dividend', 'loan_from_llc',
  'dissolution_tx', 'acquisition_tx',
]);

export type TxBucket = 'in' | 'out' | 'other';

/**
 * Which summary tile a transaction belongs to.
 *
 * Takes the UI code and the stored direction. `other_part_v` is deliberately
 * absent from both fixed sets: a structural event with no stated direction has
 * no in/out sense, so it follows its direction like a Part IV row.
 */
export function bucketForTx(uiType: string, direction: 'paid' | 'received'): TxBucket {
  if (PART_VI_UI.has(uiType)) return 'other';
  if (MONEY_IN_UI.has(uiType)) return 'in';
  if (MONEY_OUT_UI.has(uiType)) return 'out';
  return direction === 'received' ? 'in' : 'out';
}

// Canonical types that contribute to Form 5472 gross payments (line 1f / 1h).
// Mirrors grossPaymentsForLines1f1h in pdfGenerator.ts, which sums:
//   totalReceived + totalPaid            → the Part IV flows and the ending loan
//                                          balances (17b/31b, which roll into
//                                          the line 22/36 totals)
//   + distributions_paid                 → Part V distributions and dividends
//   + contributions_received             → Part V capital contributions
//   + formation_costs_paid               → Part V formation / start-up costs the
//                                          owner paid on behalf of the LLC
//   + part_vi_amount                     → any monetary amount recorded against a
//                                          Part VI property / nonmonetary item
// Loan rows carry the closing balance in amount_usd, which summarizeTransactions
// already reads. Every term above must be represented here or the "On Form 5472
// (gross payments)" figure shown in the wizard undercounts what the generated
// form actually reports.
// `structural_event` is absent by design: it reaches no Part IV line and is
// excluded from the Part V monetary subtotals, so counting it here would make
// the wizard promise a line 1f the generated form does not print.
const GROSS_PAYMENT_CANONICAL = new Set<CanonicalTxType>([
  'sales', 'tangible_property', 'rent', 'royalty', 'intangible', 'service_payment',
  'commission', 'interest', 'insurance', 'loan_guarantee', 'other',
  'loan_to_llc', 'loan_from_llc',
  'distribution', 'dividend', 'capital_contribution',
  // Part V, owner-paid formation / start-up costs (feeds formation_costs_paid).
  'formation_costs',
  // Part VI, property transfers and other nonmonetary items carry an amount
  // only when the filer recorded consideration; that amount feeds part_vi_amount.
  'property_transfer', 'nonmonetary_other',
]);

/**
 * The canonical transaction types that produce a Part V statement.
 *
 * Lives here rather than in pdfGenerator.ts because two places need it and only
 * one of them may load the generator: pdfGenerator pulls in pdf-lib and is
 * deliberately behind a dynamic import, so a screen that merely wants to say
 * whether Part V will exist cannot import from it without dragging the whole PDF
 * chunk into the main bundle. This module is the vocabulary layer and is
 * type-only at runtime, so it is the right home.
 *
 * Both `hasPartV` in FilingWizard and `PART_V_TYPES` in the generator read this,
 * so what the card promises and what the package contains cannot drift.
 *
 * Note these are CANONICAL codes. Intake's wider vocabulary reaches them through
 * toCanonicalTxType (formation_tx lands on capital_contribution; acquisition_tx,
 * disposition_tx and other_part_v land on structural_event; dissolution_tx lands
 * on distribution when it is against the owner), and only canonical codes are
 * ever persisted.
 *
 * `structural_event` is here and NOT in GROSS_PAYMENT_CANONICAL on purpose: it
 * produces a statement entry but contributes to no subtotal and no line.
 *
 * This set and PART_V_TYPES in intake/constants.ts must agree on what promises a
 * Part V. They drifted once, when dissolution_tx sat in the intake set while
 * mapping to canonical `other`, so a filing whose only structural row was a
 * dissolution promised a statement and shipped none. The invariant to preserve:
 * every member of intake's PART_V_TYPES must reach a canonical code in this set
 * through toCanonicalTxType, for at least the party it can be recorded against.
 * dissolution_tx satisfies it via the owner branch, which is the only party its
 * Part V card is offered for.
 */
export const PART_V_TX_TYPES = new Set<CanonicalTxType>([
  'distribution', 'dividend', 'capital_contribution', 'formation_costs',
  'structural_event',
]);

export interface TxMoneySummary {
  /** Sum of every reportable amount entered (any type). */
  totalEntered: number;
  /** Form 5472 gross payments (1f/1h), Part IV flows + loan balances + Part V. */
  formGross: number;
  bucketIn: { count: number; total: number };
  bucketOut: { count: number; total: number };
  bucketOther: { count: number; total: number };
}

/**
 * Compute the money summary from raw wizard transaction rows (UI-vocabulary
 * transaction_type + string/number amount). Loan rows use the closing balance
 * (amount) for the "entered"/bucket figures, matching what the user sees.
 */
export function summarizeTransactions(
  rows: {
    transaction_type: string;
    direction?: 'paid' | 'received' | null;
    amount_usd: number | string | null | undefined;
  }[],
): TxMoneySummary {
  const amt = (v: number | string | null | undefined): number => {
    const n = typeof v === 'string' ? Number(v) : (v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const s: TxMoneySummary = {
    totalEntered: 0,
    formGross: 0,
    bucketIn: { count: 0, total: 0 },
    bucketOut: { count: 0, total: 0 },
    bucketOther: { count: 0, total: 0 },
  };

  for (const r of rows) {
    const a = amt(r.amount_usd);
    s.totalEntered += a;

    const bucket = bucketForTx(r.transaction_type, r.direction ?? 'received');
    if (bucket === 'in') {
      s.bucketIn.count++; s.bucketIn.total += a;
    } else if (bucket === 'out') {
      s.bucketOut.count++; s.bucketOut.total += a;
    } else {
      s.bucketOther.count++; s.bucketOther.total += a;
    }

    // Form gross (1f/1h), Part IV flows + ending loan balances + monetary Part V.
    if (GROSS_PAYMENT_CANONICAL.has(toCanonicalTxType(r.transaction_type))) {
      s.formGross += a;
    }
  }

  return s;
}

/**
 * Build the canonical row to persist into `reportable_transactions` from an
 * Intake transaction draft, so Intake.tsx never has to know the canonical
 * vocabulary.
 *
 * `isOwner` says whether this row is recorded against the owner (related-party
 * index 0). It only changes `dissolution_tx` today, but it changes where that
 * row is reported, so callers pass the real answer rather than letting the
 * default stand.
 *
 * There is no is_royalty derivation any more: `rent` and `royalty` are separate
 * canonical codes.
 */
export function mapTransactionForPersist(row: {
  transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: number | null;
  loan_begin_usd?: number | null;
  description?: string | null;
  transaction_date?: string | null;
}, isOwner = true): {
  transaction_type: CanonicalTxType;
  ui_transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: number | null;
  loan_begin_usd: number | null;
  description: string | null;
  transaction_date: string | null;
} {
  return {
    transaction_type: toCanonicalTxType(row.transaction_type, isOwner),
    // The exact code the filer picked, kept alongside the canonical one so a
    // reopened filing shows what they chose rather than a best guess. The
    // canonical value above is still the only thing the generator reads.
    ui_transaction_type: row.transaction_type,
    direction: row.direction,
    amount_usd: row.amount_usd ?? null,
    loan_begin_usd: row.loan_begin_usd ?? null,
    description: row.description?.trim() || null,
    transaction_date: row.transaction_date || null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Canonical  →  UI  (reading a saved filing back into Intake)
// ───────────────────────────────────────────────────────────────────────────
//
// UI_TO_CANONICAL is deliberately MANY-TO-ONE: five UI codes collapse onto
// `other`, two onto `tangible_property`, two onto `service_payment`. So a saved
// row cannot always be turned back into the exact code the filer picked.
//
// Until 1 Aug 2026 nothing tried. Intake loaded `transaction_type` straight from
// the row into UI state, where TX_TYPES has no entry for a canonical code, with
// three consequences on every reopened filing:
//   - the list printed the raw code, which is what "rent_royalty" on screen was
//   - the type card rendered as nothing selected, so an Edit silently offered to
//     re-pick a type that had in fact been chosen
//   - rent vs royalty was lost even though `is_royalty` was sitting in the row
//
// This resolves what CAN be resolved, from the canonical code plus `direction`.
// It is a best-effort read path for rows written before `ui_transaction_type`
// existed; new rows carry the exact code and should prefer that. See
// `resolveUiTxType` for the precedence.
//
// `is_royalty` is gone: rent and royalty are separate canonical codes and map
// straight back.

const CANONICAL_TO_UI: Record<string, string> = {
  sales:                'sales',
  rent:                 'rent',
  royalty:              'royalty',
  service_payment:      'service_payment',
  commission:           'commission',
  interest:             'interest',
  loan_to_llc:          'loan_to_llc',
  loan_from_llc:        'loan_from_llc',
  intangible:           'intangible',
  insurance:            'insurance',
  loan_guarantee:       'loan_guarantee_fee',
  capital_contribution: 'capital_contribution',
  distribution:         'distribution',
  dividend:             'dividend',
  formation_costs:      'formation_costs',
  // structural_event is genuinely many-to-one (acquisition / disposal / other).
  // Rows carry ui_transaction_type, so this only decides what a pre-column row
  // shows; "other structural transaction" is the honest one of the three.
  structural_event:     'other_part_v',
  property_transfer:    'nonmonetary_transfer',
  nonmonetary_other:    'other_part_vi',
  other:                'other',
};

/**
 * Best-effort canonical code to UI code.
 *
 * `direction` splits tangible_property into the purchase and sale cards, which
 * is now reliable: purchases are stored 'paid' and sales 'received', instead of
 * every non-direction type being written 'received' unconditionally, which used
 * to make every tangible row read back as a sale. Everything else is a straight
 * lookup, and anything unrecognized falls back to 'other' so the UI always has a
 * valid selection rather than an empty one.
 */
export function canonicalToUiTxType(
  canonical: string,
  hints: { direction?: 'paid' | 'received' | null } = {},
): string {
  if (canonical === 'tangible_property') {
    return hints.direction === 'paid' ? 'tangible_purchase' : 'tangible_sale';
  }
  return CANONICAL_TO_UI[canonical] ?? 'other';
}

/**
 * The UI code to show for a saved row.
 *
 * Prefers the exact code the filer picked when the row carries one, and falls
 * back to deriving it. New rows always carry it; rows written before the column
 * existed never do, and those are the ones that need the derivation.
 */
export function resolveUiTxType(row: {
  transaction_type: string;
  ui_transaction_type?: string | null;
  direction?: 'paid' | 'received' | null;
}): string {
  if (row.ui_transaction_type) return row.ui_transaction_type;
  return canonicalToUiTxType(row.transaction_type, { direction: row.direction });
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
    // "Country where you do business" (Intake step 2), literal user answer.
    country_business:
      pick<string>(
        raw['owner_country'] as string,
        raw.owner_primary_country as string,
      ) ?? '',
    // "Country where you pay taxes", residence / tax residence.
    country_residence:
      pick<string>(
        raw.owner_country_residence as string,
        raw.owner_resident_country as string,
      ) ?? '',
    // Citizenship (individual), newly collected; falls back to residence.
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
