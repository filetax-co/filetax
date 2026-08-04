/**
 * Per-COMPANY entity + owner profile.
 *
 * The LLC's details and the owner's details almost never change between years,
 * so we remember them and offer them when a new filing starts. Edits apply to
 * future filings only: editing a filing does not retroactively change other
 * filings, and a profile is refreshed only when a filing is submitted.
 *
 * This is the same carry-forward mechanism the multi-year catch-up flow uses to
 * reuse entity/owner data across years (the user only re-enters transactions
 * per year).
 *
 * WAS PER USER, AND THAT WAS THE BUG. `user_profiles` held one row keyed on
 * user_id, so a filer with two LLCs had the second overwrite the first, and
 * their next filing was prefilled with the wrong company's name and EIN. Since
 * `filings_freeze_when_paid` locks `ein`, `llc_name` and `owner_full_name` the
 * moment a filing is paid, a filer who did not catch it had no way back.
 * Profiles are now keyed on (user_id, ein) in `company_profiles`, and intake
 * ASKS which company rather than filling one in silently.
 *
 * `user_profiles` still exists and is no longer read. Do not add a read of it.
 */

import { supabase } from './supabase';

/**
 * EINs are stored digits-only, so "99-9999999" and "999999999" are one company
 * rather than two. Every read and write goes through this; the display form is
 * whatever the filer typed on the filing itself.
 */
export function normalizeEin(ein: string | null | undefined): string | null {
  const digits = (ein ?? '').replace(/\D/g, '');
  return digits.length === 9 ? digits : null;
}

/** Shape mirrors the prefillable columns on `company_profiles`. */
export interface FilingProfile {
  /** Digits only. Present on every saved company; absent only on a draft shape. */
  ein?: string | null;
  /** Most recent tax year filed for this company, for the picker's subtitle. */
  last_filed_tax_year?: string | null;
  // Entity
  llc_name?: string | null;
  state_of_formation?: string | null;
  date_of_incorporation?: string | null;
  mailing_address?: Record<string, unknown> | null;
  entity_business_activity?: string | null;
  entity_business_code?: string | null;
  entity_principal_country?: string | null;
  naics_code?: string | null;
  naics_description?: string | null;
  // Owner
  owner_full_name?: string | null;
  owner_country?: string | null;
  owner_primary_country?: string | null;
  owner_country_residence?: string | null;
  owner_country_citizenship?: string | null;
  owner_foreign_tax_id?: string | null;
  owner_us_tin?: string | null;
  owner_reference_id?: string | null;
  owner_ref_number?: string | null;
  owner_address?: Record<string, unknown> | null;
  owner_business_activity?: string | null;
  owner_business_code?: string | null;
  owner_naics_code?: string | null;
  signer_title?: string | null;
  related_parties?: unknown[] | null;
}

/** The columns we read/write for prefill. Kept in one place to avoid drift. */
const PROFILE_COLUMNS = [
  'llc_name', 'state_of_formation', 'date_of_incorporation',
  'mailing_address', 'entity_business_activity', 'entity_business_code',
  'entity_principal_country', 'naics_code', 'naics_description',
  'owner_full_name', 'owner_country', 'owner_primary_country',
  'owner_country_residence', 'owner_country_citizenship',
  'owner_foreign_tax_id', 'owner_us_tin', 'owner_reference_id', 'owner_ref_number',
  'owner_address', 'owner_business_activity', 'owner_business_code',
  'owner_naics_code', 'signer_title', 'related_parties',
] as const;

/** Everything the picker reads, including the two key columns. */
const COMPANY_COLUMNS = ['ein', 'last_filed_tax_year', ...PROFILE_COLUMNS] as const;

/**
 * Every company this user has saved, newest first.
 *
 * Returns [] rather than null when there are none, so the caller can treat
 * "no saved companies" and "not signed in" the same way: show a blank form.
 */
export async function listCompanies(
  userId: string | null | undefined,
): Promise<FilingProfile[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('company_profiles')
    .select(COMPANY_COLUMNS.join(','))
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data as unknown as FilingProfile[];
}

/**
 * One saved company by EIN, or null.
 *
 * The EIN is normalised here rather than at the call site, so a caller holding
 * the display form ("99-9999999") does not have to know how it is stored.
 */
export async function loadCompany(
  userId: string | null | undefined,
  ein: string | null | undefined,
): Promise<FilingProfile | null> {
  const key = normalizeEin(ein);
  if (!userId || !key) return null;
  const { data, error } = await supabase
    .from('company_profiles')
    .select(COMPANY_COLUMNS.join(','))
    .eq('user_id', userId)
    .eq('ein', key)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as FilingProfile;
}

/**
 * Forget a saved company. The filings themselves are untouched: this removes
 * the prefill entry, not the returns that were filed for it.
 */
export async function deleteCompany(
  userId: string | null | undefined,
  ein: string | null | undefined,
): Promise<boolean> {
  const key = normalizeEin(ein);
  if (!userId || !key) return false;
  const { data, error } = await supabase
    .from('company_profiles')
    .delete()
    .eq('user_id', userId)
    .eq('ein', key)
    .select('id');
  return !error && !!data && data.length > 0;
}

/**
 * Upsert the entity + owner fields of a just-submitted filing against ITS OWN
 * company, so the next filing for that company can offer them. Only non-empty
 * values are written, so a sparse filing never wipes good saved data.
 *
 * A filing with no usable EIN saves nothing. That is deliberate: the EIN is the
 * company's identity here, and a row without one could only be stored against
 * some other key, which is precisely the per-user clobbering this replaced.
 */
export async function saveProfileFromFiling(
  userId: string | null | undefined,
  filing: Record<string, unknown>,
): Promise<void> {
  const key = normalizeEin(filing.ein as string | null | undefined);
  if (!userId || !key) return;

  const patch: Record<string, unknown> = { user_id: userId, ein: key };
  for (const col of PROFILE_COLUMNS) {
    const v = filing[col];
    if (v !== undefined && v !== null && v !== '') patch[col] = v;
  }
  const year = filing.tax_year;
  if (year !== undefined && year !== null && year !== '') patch.last_filed_tax_year = year;

  const { error } = await supabase
    .from('company_profiles')
    .upsert(patch, { onConflict: 'user_id,ein' });
  if (error) console.error('[saveProfileFromFiling]', error.message);
}
