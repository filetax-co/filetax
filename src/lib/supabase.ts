import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env.local and fill in your project credentials.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // PKCE is required for reliable password-reset and email-confirmation
    // flows in SPAs (no server-side callback). Supabase exchanges the code
    // verifier stored in sessionStorage with the `code` param in the URL.
    flowType: 'pkce',
    // Explicitly tell the client to parse tokens from the URL on page load.
    // Critical on GitHub Pages where the app is served from a sub-path
    // (/5472/), without this, recovery/confirmation redirects are silently
    // ignored and the user is never signed in.
    detectSessionInUrl: true,
  },
});

// Dev only. The end-to-end run drives the real wizard in a browser and then has
// to check that what was saved matches what was typed; without a handle it can
// only inspect the rendered page, which is the thing under test. Reading goes
// through the same anon key and the same row-level security as the app, so this
// exposes nothing the signed-in tab could not already reach. Stripped from any
// build: import.meta.env.DEV is false there.
if (import.meta.env.DEV) {
  (window as unknown as { __supabase?: typeof supabase }).__supabase = supabase;
}

export type Address = {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type IntakeSubmission = {
  id?: string;
  created_at?: string;
  user_id?: string | null;
  full_name: string;
  email: string;
  llc_name?: string;
  ein?: string;
  tax_year?: string;
  years_param?: string;
  sections_param?: string;
  parties_param?: number;
  rcl_param?: boolean;
  status?: 'pending' | 'in_progress' | 'completed';
};

export type FilingStatus =
  | 'draft'
  | 'in_progress'
  | 'payment_failed'
  | 'paid'
  | 'completed'
  | 'submitted';

export type ServiceType = 'current_year' | 'past_year' | 'tax_classification';

export type Filing = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  status: FilingStatus;
  current_step: number;
  service_type: ServiceType;

  // ── Tax period ──────────────────────────────────────────────────────────
  tax_year?: string | null;
  tax_period_begin?: string | null;
  tax_period_end?: string | null;

  // ── Entity ──────────────────────────────────────────────────────────────
  llc_name?: string | null;
  ein?: string | null;
  state_of_formation?: string | null;
  country_of_incorporation?: string | null;
  /** US mailing address of the LLC / corporation */
  llc_us_address?: Address | null;
  /** Mailing address as collected in Step 1 of the intake wizard */
  mailing_address?: Record<string, string> | null;
  /** Business activity description for the LLC (Step 1 intake) */
  entity_business_activity?: string | null;
  /** NAICS / activity code for the LLC (Step 1 intake) */
  entity_business_code?: string | null;

  // ── Form 5472 / Pro Forma 1120 fields ───────────────────────────────────
  total_assets?: number | null;
  naics_code?: string | null;
  naics_description?: string | null;
  date_of_incorporation?: string | null;
  date_of_closure?: string | null;
  initial_return?: boolean | null;
  /** Pro Forma 1120 header checkboxes */
  name_change?: boolean | null;
  address_change?: boolean | null;
  /** 1120 item E "Final return", LLC dissolved/closed this tax year. */
  final_return?: boolean | null;
  /** Non-calendar (fiscal-year) filer, drives the review notice. */
  is_fiscal_year?: boolean | null;
  /**
   * Owner managerial-services Part VI disclosure toggle.
   * Default true: the owner of a foreign-owned DE necessarily provides
   * managerial services whose FMV cannot be determined. If the user opts out
   * (false), the Part VI box is NOT ticked and no Part VI statement is
   * generated (unless an actual non-monetary transaction exists).
   */
  part_vi_managerial?: boolean | null;
  /** Multi-year catch-up job this filing belongs to (one RCL across years). */
  job_id?: string | null;
  /**
   * Number of correcting edits made AFTER payment. Identity fields are frozen
   * regardless; other fields may be corrected up to a cap (2). Enforced by the
   * filings_freeze_when_paid DB trigger.
   */
  post_payment_edits?: number | null;
  owner_primary_country?: string | null;
  owner_us_tin?: string | null;
  owner_reference_id?: string | null;
  owner_naics_code?: string | null;
  owner_naics_description?: string | null;

  // ── Foreign owner / related party ───────────────────────────────────────
  owner_full_name?: string | null;
  owner_country_residence?: string | null;
  owner_country_citizenship?: string | null;
  owner_resident_country?: string | null;
  owner_passport_number?: string | null;
  owner_foreign_tax_id?: string | null;
  /** Foreign address of the owner / related party */
  owner_foreign_address?: Address | null;
  /** Owner's mailing/contact address (Step 2 intake) */
  owner_address?: Record<string, string> | null;
  /** Owner reference / client ID number (Step 2 intake) */
  owner_ref_number?: string | null;
  /** Owner date of incorporation if owner is a company (Step 2 intake) */
  owner_date_of_incorporation?: string | null;
  /** Owner's primary country (Step 2 intake) */
  owner_country?: string | null;
  /** Owner's NAICS / activity code (Step 2 intake) */
  owner_business_code?: string | null;
  /**
   * Used by pdfGenerator for Part III field RP_ACTIVITY.
   * Defaults to naics_description if not set.
   */
  owner_business_activity?: string | null;
  related_parties?: Array<Record<string, unknown>> | null;

  /**
   * Part III 8e, which relationship checkbox to tick.
   * true  = related party is ONLY related to the 25% shareholder (not the shareholder itself)
   * false / undefined = related party IS the 25% shareholder (default for SMLLC)
   */
  rp_is_related_only?: boolean | null;
  /**
   * true = tick the third box: "both 25% shareholder AND related to another 25% shareholder"
   */
  rp_is_both?: boolean | null;

  // ── Signature block ──────────────────────────────────────────────────────
  /**
   * Title of the person signing the return (e.g. "Managing Member", "President").
   * Collected from the user during intake; written into the Title field on
   * Pro Forma 1120 and Form 5472 signature blocks.
   */
  signer_title?: string | null;

  /**
   * Date the owner signs the return (ISO YYYY-MM-DD). Printed on the Form 1120
   * signature "Date" line for every year so the package is ready to print and
   * mail without hand-dating.
   */
  signature_date?: string | null;

  // ── Filing options ───────────────────────────────────────────────────────
  include_irs_fax: boolean;
  include_rcl: boolean;
  /** True if the user told us Form 7004 (extension) was filed for this year. */
  extension_filed?: boolean | null;
  /** True to generate Form 7004 (extension) for this filing / as a standalone. */
  include_7004?: boolean | null;
  notes?: string | null;
  parties_count: number;
  complex_sections: string[];

  // ── Payment ─────────────────────────────────────────────────────────────
  paid_at?: string | null;
  payment_id?: string | null;
  payment_amount_cents?: number | null;
  /**
   * ISO-4217 code for `payment_amount_cents`. Null on filings paid before the
   * column existed, and null when a filing was topped up in a second currency,
   * because two currencies cannot be summed into one integer. Read them as a
   * pair: an amount without a currency is not a price.
   */
  payment_currency?: string | null;
  /** Related parties already covered by verified Dodo payments. */
  paid_related_party_count?: number | null;

  // ── Output ──────────────────────────────────────────────────────────────
  forms_generated_at?: string | null;
  download_count: number;
};

export type FilingTransactionCategory =
  | 'capital_contribution'
  | 'distribution'
  | 'loan_to_llc'
  | 'loan_from_llc'
  | 'service_payment'
  | 'rent_royalty'
  | 'other';

/**
 * @deprecated Use Transaction (maps to reportable_transactions table) instead.
 * This type is retained for backwards compatibility only and must not be used
 * in new code or wired into any UI component.
 */
export type FilingTransaction = {
  id: string;
  filing_id: string;
  created_at: string;
  category: FilingTransactionCategory;
  direction: 'to_llc' | 'from_llc';
  amount: number;
  currency: string;
  transaction_date?: string | null;
  description?: string | null;
  /**
   * Only relevant when category === 'rent_royalty'.
   * true  → maps to royalties_* fields on Form 5472 (lines 13b / 27b)
   * false → maps to rents_*    fields on Form 5472 (lines 13a / 27a)
   */
  is_royalty?: boolean | null;
};

/**
 * Transaction, canonical type used by pdfGenerator and DownloadPackageButton.
 * Maps to the reportable_transactions table in Supabase.
 */
export type Transaction = {
  id: string;
  filing_id: string;
  created_at?: string | null;
  /**
   * Which related party this transaction is with.
   * 0 = the primary foreign owner; 1..n = additional related parties
   * (index into filings.related_parties). Drives one Form 5472 per party.
   */
  related_party_index?: number | null;
  transaction_type:
    | 'sales'
    | 'service_payment'
    // Rent and royalty are separate codes because they are separate lines
    // (13a/27a against 13b/27b). They were one code plus an `is_royalty`
    // boolean, which made a nullable column the only thing standing between a
    // rent and the royalty line.
    | 'rent'
    | 'royalty'
    | 'loan_to_llc'
    | 'loan_from_llc'
    | 'interest'
    | 'insurance'
    | 'dividend'
    | 'commission'
    | 'intangible'
    | 'other'
    | 'capital_contribution'
    | 'distribution'
    | 'formation_costs'
    // A structural event disclosed in the Part V statement: an acquisition, a
    // disposal, or another entity-level event. It carries no amount onto any
    // Part IV line and is deliberately NOT folded into the contributions or
    // distributions subtotals, because an acquisition of a third company is
    // neither a contribution by the owner nor a distribution to them.
    | 'structural_event'
    | 'property_transfer'
    // Handled in aggregateTransactions; kept in sync with the DB CHECK
    // constraint on reportable_transactions.transaction_type so inserts of
    // any value the code can produce are accepted by Postgres.
    | 'tangible_property'
    | 'loan_guarantee'
    | 'nonmonetary_other';
  direction: 'paid' | 'received';
  amount_usd?: number | null;
  /**
   * Beginning-of-year balance for loan_to_llc / loan_from_llc rows.
   * Form 5472 lines 17a (borrowed) / 31a (loaned). amount_usd holds the
   * end-of-year closing balance (lines 17b / 31b).
   */
  loan_begin_usd?: number | null;
  transaction_date?: string | null;
  description?: string | null;
  /**
   * The intake UI code the filer actually selected, e.g. 'royalty',
   * 'digital_asset', 'tangible_purchase'.
   *
   * `transaction_type` above is many-to-one: five UI codes collapse onto
   * 'other' alone, so it cannot say whether an 'other' row was crypto, a
   * cost-sharing payment or something else. This preserves that.
   *
   * DISPLAY AND ROUND-TRIP ONLY. Nothing that decides what goes on a form may
   * read this; the generator switches on `transaction_type` and must continue
   * to. Absent on rows written before 20260801_ui_transaction_type.
   */
  ui_transaction_type?: string | null;
};
