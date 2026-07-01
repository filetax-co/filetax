/**
 * Single source of truth for portal pricing.
 *
 *   • Base filing:            USD 150 per year (Form 5472 + pro forma 1120)
 *   • Reasonable-cause letter: USD 200 for one letter (covers all years in a job)
 *   • Additional related party: USD 50 per additional Form 5472 (flat add-on)
 *
 * These rates apply everywhere — the marketing pricing page, the eligibility
 * estimator, the dashboard, and the filing/checkout flow.
 */

export const PRICE_PER_YEAR = 150;
/** One reasonable-cause letter covers every year in a multi-year job. */
export const PRICE_RCL = 200;
/** Flat add-on for each ADDITIONAL related party (each extra Form 5472). */
export const PRICE_ADDITIONAL_PARTY = 50;

/** Cost of the additional Form 5472s beyond the first (flat $50 each). */
export function additionalPartiesCost(totalForms: number): number {
  const additional = Math.max(0, totalForms - 1);
  return additional * PRICE_ADDITIONAL_PARTY;
}

/**
 * Total price for a filing job.
 * @param years    number of tax years being filed
 * @param includeRCL whether one reasonable-cause letter is included
 * @param totalForms total number of Forms 5472 per year (1 owner + related parties)
 */
export function computeTotal(years: number, includeRCL: boolean, totalForms = 1): number {
  const base = years * PRICE_PER_YEAR;
  const rcl = includeRCL ? PRICE_RCL : 0;
  // The additional-party add-on applies once per additional party, per year.
  const parties = years * additionalPartiesCost(totalForms);
  return base + rcl + parties;
}

/** Human-readable breakdown for the additional-party add-on. */
export function additionalPartiesBreakdown(totalForms: number): string {
  const additional = Math.max(0, totalForms - 1);
  if (additional === 0) return '';
  const cost = additionalPartiesCost(totalForms);
  return `${additional} additional related part${additional > 1 ? 'ies' : 'y'} at $${PRICE_ADDITIONAL_PARTY} each = +$${cost}.`;
}
