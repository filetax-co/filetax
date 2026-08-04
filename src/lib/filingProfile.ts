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

// EINs are stored digits-only, so "99-9999999" and "999999999" are one company
// rather than two. Every read and write below goes through `normalizeEin`.
//
// Both helpers live in `./ein`, which imports nothing, so the regressions can
// assert them without loading the Supabase client this module depends on.
// Re-exported here because this is where callers expect to find them.
import { normalizeEin, formatEin } from './ein';

export { normalizeEin, formatEin };

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
  /**
   * Tax years the filer told us are filed somewhere else, so the dashboard
   * stops offering them. Absent on a database that has not had
   * `20260805_years_filed_elsewhere` applied yet; treat undefined as [].
   */
  years_filed_elsewhere?: string[] | null;
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

/**
 * Every company this user has saved, newest first.
 *
 * Returns [] rather than null when there are none, so the caller can treat
 * "no saved companies" and "not signed in" the same way: show a blank form.
 *
 * SELECTS `*`, NOT the column list, and that is deliberate. Migrations here are
 * applied by hand, so the deployed app can be ahead of the schema, and PostgREST
 * rejects a select that NAMES a column the table does not have. Naming
 * `years_filed_elsewhere` before its migration ran would fail this read
 * entirely, so a filer would lose the whole saved-companies list, and their
 * intake prefill, over a feature they had not noticed was missing. `*` returns
 * whatever exists; the reader treats the column as absent when it is.
 *
 * The explicit list is still the source of truth for WRITES, which is where
 * drift actually costs something.
 */
export async function listCompanies(
  userId: string | null | undefined,
): Promise<FilingProfile[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('company_profiles')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data as unknown as FilingProfile[];
}

/**
 * Record that the filer says these years are filed somewhere else.
 *
 * Replaces the list rather than appending, so the undo is the same call with
 * fewer years and there is no separate removal path to keep in step.
 *
 * Returns `'unsupported'` when the column does not exist yet, which is a real
 * state on a hand-migrated database and NOT an error to show as one. The caller
 * hides the control rather than offering a button that silently does nothing:
 * a dismissal that appears to work and comes back on reload is worse than no
 * dismissal at all.
 */
export async function setYearsFiledElsewhere(
  userId: string | null | undefined,
  ein: string | null | undefined,
  years: string[],
): Promise<'ok' | 'unsupported' | 'error'> {
  const key = normalizeEin(ein);
  if (!userId || !key) return 'error';
  // Sorted and de-duplicated, so the stored value does not depend on the order
  // the filer happened to click, and two dismissals of the same year cannot
  // grow the array without bound.
  const clean = [...new Set(years.map((y) => String(y).trim()).filter(Boolean))].sort();
  const { error } = await supabase
    .from('company_profiles')
    .update({ years_filed_elsewhere: clean })
    .eq('user_id', userId)
    .eq('ein', key);
  if (!error) return 'ok';
  // 42703 is undefined_column. PostgREST also reports it in the message on
  // some versions, so both are checked rather than trusting one shape.
  if (error.code === '42703' || /years_filed_elsewhere/.test(error.message ?? '')) {
    return 'unsupported';
  }
  return 'error';
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
  // `*` for the same reason as listCompanies: naming a column the schema does
  // not have yet fails the whole read, and this one feeds intake prefill.
  const { data, error } = await supabase
    .from('company_profiles')
    .select('*')
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
 * The outcome of an edit, so the caller can say WHICH thing went wrong.
 *
 * A bare false would collapse three different problems into one message, and
 * the one that actually happens, a filer correcting an EIN to one they already
 * have saved, needs its own sentence or it reads as a broken button.
 */
export type CompanyEditResult =
  | { ok: true; ein: string }
  | { ok: false; reason: 'invalid_ein' | 'duplicate' | 'not_found' | 'error'; message: string };

/**
 * Edit a saved company's name and, if needed, its EIN.
 *
 * NOTHING HERE TOUCHES A FILING. `company_profiles` is prefill only: it decides
 * what the next filing is offered, not what any past return says. That matters
 * most for the EIN, because a filer correcting a typo will reasonably assume
 * they are fixing the return it went onto, and they are not. Any UI calling
 * this has to say so. A return that was filed with the wrong EIN is an amended
 * return, which §7 of the handoff records as deferred.
 *
 * The EIN is the second half of the primary key, so changing it RE-KEYS the row.
 * This is an UPDATE rather than a delete and re-insert, so every other saved
 * column survives the correction: a filer fixing one transposed digit does not
 * lose the address, the owner details and the related parties along with it.
 *
 * The `(user_id, ein)` unique constraint is what makes a collision safe. It is
 * checked first for a decent message, but the constraint is the guarantee, since
 * two tabs can pass the check and only one can win the write.
 */
export async function updateCompany(
  userId: string | null | undefined,
  currentEin: string | null | undefined,
  patch: { llc_name?: string | null; ein?: string | null },
): Promise<CompanyEditResult> {
  const key = normalizeEin(currentEin);
  if (!userId || !key) {
    return { ok: false, reason: 'not_found', message: 'That company could not be found.' };
  }

  const fields: Record<string, unknown> = {};
  if (patch.llc_name !== undefined) fields.llc_name = patch.llc_name?.trim() || null;

  let nextEin = key;
  if (patch.ein !== undefined && patch.ein !== null) {
    const proposed = normalizeEin(patch.ein);
    if (!proposed) {
      return {
        ok: false,
        reason: 'invalid_ein',
        message: 'An EIN is nine digits, for example 12-3456789.',
      };
    }
    if (proposed !== key) {
      const existing = await loadCompany(userId, proposed);
      if (existing) {
        return {
          ok: false,
          reason: 'duplicate',
          message: `You already have a company saved under EIN ${formatEin(proposed)}`
            + `${existing.llc_name ? `, ${existing.llc_name}` : ''}. `
            + 'Two saved companies cannot share an EIN, so delete one before moving the other onto it.',
        };
      }
      fields.ein = proposed;
      nextEin = proposed;
    }
  }

  if (Object.keys(fields).length === 0) return { ok: true, ein: key };

  const { data, error } = await supabase
    .from('company_profiles')
    .update(fields)
    .eq('user_id', userId)
    .eq('ein', key)
    .select('ein');

  if (error) {
    // 23505 is the unique violation. Reachable when two tabs edit at once, past
    // the check above, so it gets the same sentence rather than a raw DB error.
    const duplicate = error.code === '23505';
    return {
      ok: false,
      reason: duplicate ? 'duplicate' : 'error',
      message: duplicate
        ? 'You already have a company saved under that EIN.'
        : error.message,
    };
  }
  // Zero rows back is a failure, not a success: the same lesson the filings
  // delete learned when RLS filtered it to nothing and the UI called it done.
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'That company could not be found.' };
  }
  return { ok: true, ein: nextEin };
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
