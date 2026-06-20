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
    // (/5472/) — without this, recovery/confirmation redirects are silently
    // ignored and the user is never signed in.
    detectSessionInUrl: true,
  },
});

export type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
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
  mailing_address?: Address | null;

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
  owner_address?: Address | null;
  /**
   * Used by pdfGenerator for Part III field RP_ACTIVITY.
   * Defaults to naics_description if not set.
   */
  owner_business_activity?: string | null;

  /**
   * Part III 8e — which relationship checkbox to tick.
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

  // ── Filing options ───────────────────────────────────────────────────────
  include_irs_fax: boolean;
  include_rcl: boolean;
  notes?: string | null;
  parties_count: number;
  complex_sections: string[];

  // ── Payment ─────────────────────────────────────────────────────────────
  paid_at?: string | null;
  payment_id?: string | null;
  payment_amount_cents?: number | null;

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
 * Transaction — canonical type used by pdfGenerator and DownloadPackageButton.
 * Maps to the reportable_transactions table in Supabase.
 */
export type Transaction = {
  id: string;
  filing_id: string;
  created_at?: string | null;
  transaction_type:
    | 'sales'
    | 'service_payment'
    | 'rent_royalty'
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
    | 'property_transfer'
    // Handled in aggregateTransactions; kept in sync with the DB CHECK
    // constraint on reportable_transactions.transaction_type so inserts of
    // any value the code can produce are accepted by Postgres.
    | 'tangible_property'
    | 'loan_guarantee'
    | 'nonmonetary_other';
  direction: 'paid' | 'received';
  amount_usd?: number | null;
  transaction_date?: string | null;
  description?: string | null;
  is_royalty?: boolean | null;
};
