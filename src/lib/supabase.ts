import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hlpzsqxmazzlndzzejfs.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhscHpzcXhtYXp6bG5kenplamZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1OTgwNzksImV4cCI6MjA5NDE3NDA3OX0.VF3MylJ7Jd2q5F5SwaWHhpQSGu5H3lLI2V25lFjImfY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  tax_year?: string | null;
  llc_name?: string | null;
  ein?: string | null;
  state_of_formation?: string | null;
  mailing_address?: Address | null;
  // ── new Form 5472 fields (10) ──────────────────────────────
  total_assets?: number | null;             // Line 1c
  naics_code?: string | null;              // Line 1e
  naics_description?: string | null;       // Line 1d
  date_of_incorporation?: string | null;   // Line 1m  (ISO date)
  date_of_closure?: string | null;         // tax year end when closed
  owner_primary_country?: string | null;   // Line 4c
  owner_us_tin?: string | null;            // Lines 4b-1, 8b-1
  owner_reference_id?: string | null;      // Lines 4b-2, 8b-2
  owner_naics_code?: string | null;        // Line 8d
  owner_naics_description?: string | null; // Line 8c
  // ─────────────────────────────────────────────────────────
  owner_full_name?: string | null;
  owner_country_residence?: string | null;
  owner_country_citizenship?: string | null;
  owner_passport_number?: string | null;
  owner_foreign_tax_id?: string | null;
  owner_address?: Address | null;
  include_irs_fax: boolean;
  include_rcl: boolean;
  notes?: string | null;
  parties_count: number;
  complex_sections: string[];
  paid_at?: string | null;
  payment_id?: string | null;
  payment_amount_cents?: number | null;
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
};
