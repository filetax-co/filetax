/**
 * Single source of truth for portal pricing.
 *
 *   • Base filing:             USD 99 per year (Form 5472 + pro forma 1120)
 *   • Reasonable-cause letter: USD 199 per JOB (one letter covers every year)
 *   • Additional related party: USD 25 per additional Form 5472, per year
 *   • IRS fax delivery:        USD 9 per JOB (opt-in; covers every transmission)
 *
 * These rates apply everywhere — the marketing pricing page, the eligibility
 * estimator, the dashboard, and the filing/checkout flow. Nothing should
 * hardcode a dollar figure; import from here so prices cannot drift again.
 *
 * Returning customers: the next two filings after the first are guaranteed at
 * the same USD 99 base. Counted in filings, not calendar years.
 *
 * NOTE: this file is duplicated in the product app repo (CNL 5472/5472) because
 * the two repos share no package. The copies must stay identical — if you change
 * a price here, change it there in the same commit.
 */

export const PRICE_PER_YEAR = 99;
/** One reasonable-cause letter covers every year in a job — charged once. */
export const PRICE_RCL = 199;
/** Each ADDITIONAL related party (each extra Form 5472), charged per year. */
export const PRICE_ADDITIONAL_PARTY = 25;
/** Opt-in IRS fax delivery, charged once per job however many years are sent. */
export const PRICE_FAX = 9;

/** Number of subsequent filings guaranteed at the same base price. */
export const RENEWAL_GUARANTEE_FILINGS = 2;

/** Cost of the additional Form 5472s beyond the first, for a single year. */
export function additionalPartiesCost(totalForms: number): number {
  const additional = Math.max(0, totalForms - 1);
  return additional * PRICE_ADDITIONAL_PARTY;
}

/**
 * Total price for a filing job.
 * @param years      number of tax years being filed
 * @param includeRCL whether a reasonable-cause letter is included (one per job)
 * @param totalForms total number of Forms 5472 per year (1 owner + related parties)
 * @param includeFax whether IRS fax delivery is added (one fee per job)
 */
export function computeTotal(
  years: number,
  includeRCL: boolean,
  totalForms = 1,
  includeFax = false,
): number {
  const base = years * PRICE_PER_YEAR;
  // One letter covers every year in the job, so it is never multiplied by years.
  const rcl = includeRCL ? PRICE_RCL : 0;
  // The additional-party add-on applies once per additional party, per year.
  const parties = years * additionalPartiesCost(totalForms);
  // Fax is a single delivery fee for the whole job, not per transmission.
  const fax = includeFax ? PRICE_FAX : 0;
  return base + rcl + parties + fax;
}

/** Human-readable breakdown for the additional-party add-on, for one year. */
export function additionalPartiesBreakdown(totalForms: number): string {
  const additional = Math.max(0, totalForms - 1);
  if (additional === 0) return '';
  const cost = additionalPartiesCost(totalForms);
  return `${additional} additional related part${additional > 1 ? 'ies' : 'y'} at $${PRICE_ADDITIONAL_PARTY} each per year = +$${cost} per year.`;
}

/** Total additional-party cost across every year in a job. */
export function additionalPartiesTotal(totalForms: number, years: number): number {
  return years * additionalPartiesCost(totalForms);
}
