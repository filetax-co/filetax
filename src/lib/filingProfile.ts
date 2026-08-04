/**
 * Per-user entity + owner profile.
 *
 * The LLC's details and the owner's details almost never change between years,
 * so we remember them in `user_profiles` and prefill each NEW filing from the
 * profile for the user to review/edit. "Edits apply to future filings only", * editing a filing does not retroactively change other filings; the profile is
 * refreshed only when a filing is submitted.
 *
 * This is the same carry-forward mechanism the multi-year catch-up flow uses to
 * reuse entity/owner data across years (the user only re-enters transactions
 * per year).
 */

import { supabase } from './supabase';

/** Shape mirrors the prefillable columns added in 20260701_*.sql. */
export interface FilingProfile {
  // Entity
  llc_name?: string | null;
  ein?: string | null;
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

/**
 * Columns added after the profile table shipped, whose migration may not have
 * been run yet on a given database.
 *
 * Migrations here are applied by hand, so the deployed app can be ahead of the
 * schema. PostgREST rejects a SELECT naming an unknown column outright, and
 * loadProfile treats any error as "no profile", so one missing column would
 * silently turn off ALL prefill rather than that one field. loadProfile retries
 * without these when the first attempt fails.
 */
const RECENT_PROFILE_COLUMNS = ['entity_principal_country'] as const;

/** The columns we read/write for prefill. Kept in one place to avoid drift. */
const PROFILE_COLUMNS = [
  'llc_name', 'ein', 'state_of_formation', 'date_of_incorporation',
  'mailing_address', 'entity_business_activity', 'entity_business_code',
  'entity_principal_country', 'naics_code', 'naics_description',
  'owner_full_name', 'owner_country', 'owner_primary_country',
  'owner_country_residence', 'owner_country_citizenship',
  'owner_foreign_tax_id', 'owner_us_tin', 'owner_reference_id', 'owner_ref_number',
  'owner_address', 'owner_business_activity', 'owner_business_code',
  'owner_naics_code', 'signer_title', 'related_parties',
] as const;

/** Load the signed-in user's saved profile, or null if none / not signed in. */
export async function loadProfile(userId: string | null | undefined): Promise<FilingProfile | null> {
  if (!userId) return null;
  const read = async (columns: readonly string[]) =>
    supabase
      .from('user_profiles')
      .select(columns.join(','))
      .eq('user_id', userId)
      .maybeSingle();

  let { data, error } = await read(PROFILE_COLUMNS);
  if (error) {
    // See RECENT_PROFILE_COLUMNS: losing one field is a much smaller failure
    // than losing every prefilled field.
    const older = PROFILE_COLUMNS.filter(
      (c) => !(RECENT_PROFILE_COLUMNS as readonly string[]).includes(c),
    );
    ({ data, error } = await read(older));
  }
  if (error || !data) return null;
  return data as unknown as FilingProfile;
}

/**
 * Upsert the entity + owner fields of a just-submitted filing into the user's
 * profile, so the next new filing prefills from it. Only writes non-empty
 * values so a sparse filing never wipes good profile data.
 */
export async function saveProfileFromFiling(
  userId: string | null | undefined,
  filing: Record<string, unknown>,
): Promise<void> {
  if (!userId) return;
  const patch: Record<string, unknown> = { user_id: userId };
  for (const col of PROFILE_COLUMNS) {
    const v = filing[col];
    if (v !== undefined && v !== null && v !== '') patch[col] = v;
  }
  // Nothing meaningful to save beyond the key.
  if (Object.keys(patch).length <= 1) return;
  const { error } = await supabase.from('user_profiles').upsert(patch, { onConflict: 'user_id' });
  if (!error) return;
  // Same reasoning as loadProfile: a column whose migration has not been run
  // must not take the whole profile write down with it.
  for (const col of RECENT_PROFILE_COLUMNS) delete patch[col];
  if (Object.keys(patch).length <= 1) return;
  await supabase.from('user_profiles').upsert(patch, { onConflict: 'user_id' });
}
