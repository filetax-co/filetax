/**
 * EIN identity, as two pure functions.
 *
 * These live apart from `filingProfile.ts`, which owns the saved-company reads
 * and writes, for one reason: that module imports the Supabase client, and the
 * client cannot be loaded by the Node runner behind `verify:logic` (nor should
 * it be, since it throws without env vars). Anything the regressions need to
 * assert has to be reachable without it.
 *
 * The rule they encode is the one `company_profiles` is keyed on: an EIN is
 * NINE DIGITS, stored digits only, so "12-3456789" and "123456789" are one
 * company rather than two. Every read and write of that key goes through
 * `normalizeEin`; the dash exists for people, not for storage.
 */

/**
 * The storage form: nine digits, or null if it is not an EIN.
 *
 * Null rather than a partial string, deliberately. A value that is not a valid
 * EIN cannot identify a company, and returning the digits anyway would let a
 * seven-digit typo become a saved company of its own.
 */
export function normalizeEin(ein: string | null | undefined): string | null {
  const digits = (ein ?? '').replace(/\D/g, '');
  return digits.length === 9 ? digits : null;
}

/** The display form, "12-3456789". Returns the input unchanged if it is not an EIN. */
export function formatEin(ein: string | null | undefined): string {
  const digits = (ein ?? '').replace(/\D/g, '');
  if (digits.length !== 9) return ein ?? '';
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}
