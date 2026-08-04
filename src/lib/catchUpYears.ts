/**
 * Which tax years a company has no filing for here.
 *
 * Pure, and deliberately in its own module with no Supabase import, so the
 * regressions can assert it. That matters more than usual: this arithmetic is
 * what a prompt telling someone they may owe four returns is built on, and an
 * off-by-one at either end invents an obligation or hides a real gap. Both are
 * worse than showing nothing.
 *
 * What it is NOT: a statement that these years must be filed. Whether a given
 * year requires a return turns on whether the company had a reportable
 * transaction that year, which nothing here knows. The result is "we have no
 * filing for this year", which is a fact about our own records, and the UI is
 * worded as a question for exactly that reason.
 */

import { EARLIEST_TAX_YEAR } from '../app/pages/intake/constants';

/**
 * The most recent year a return can be filed for: last year, always.
 *
 * A tax year is filed after it ends, so 2026 is not filable during 2026.
 * Derived from a passed-in date rather than read from the clock inside the
 * loop, so a test can pin it and so one render cannot straddle midnight on
 * 1 January and produce two different answers.
 */
export function mostRecentFilableYear(now: Date = new Date()): number {
  return now.getUTCFullYear() - 1;
}

export interface MissingYearsInput {
  /** ISO date the LLC was formed, from the company profile or any of its filings. */
  formationDate?: string | null;
  /** Tax years that already have a filing here, any status. Strings, as stored. */
  filedYears: Array<string | null | undefined>;
  /** Years the filer told us are filed somewhere else. */
  dismissedYears?: Array<string | null | undefined>;
  now?: Date;
}

/**
 * Years with no filing here, newest first.
 *
 * Returns [] rather than guessing when the formation date is unknown. A company
 * whose formation date we do not hold could have been formed in 2019 or last
 * month, and the difference is six years of prompting someone about returns
 * they may never have owed. Silence is the only safe answer.
 *
 * Both ends are inclusive and both are real limits:
 *
 *   floor   the later of EARLIEST_TAX_YEAR and the formation year. A company
 *           formed in 2016 is never asked about 2018, because we would refuse
 *           to prepare it; a company formed in 2023 is never asked about 2022,
 *           because it did not exist.
 *   ceiling the most recent filable year. Asking about the current year would
 *           be asking for a return that cannot be filed yet.
 *
 * A DRAFT counts as filed for this purpose. The year is already on the
 * dashboard as its own card, so listing it again as missing would show the same
 * year twice with two different stories.
 */
export function missingTaxYears(input: MissingYearsInput): number[] {
  const formationYear = yearOf(input.formationDate);
  if (formationYear === null) return [];

  const floor = Math.max(EARLIEST_TAX_YEAR, formationYear);
  const ceiling = mostRecentFilableYear(input.now);
  if (floor > ceiling) return [];

  const covered = new Set<number>();
  for (const y of input.filedYears) {
    const n = Number(y);
    if (Number.isFinite(n)) covered.add(n);
  }
  for (const y of input.dismissedYears ?? []) {
    const n = Number(y);
    if (Number.isFinite(n)) covered.add(n);
  }

  const out: number[] = [];
  for (let y = ceiling; y >= floor; y--) if (!covered.has(y)) out.push(y);
  return out;
}

/**
 * The year from an ISO date, or null.
 *
 * Parsed off the string rather than through `new Date`, which reads a bare
 * "2021-03-04" as UTC midnight and can hand back the previous year to anyone
 * west of Greenwich. A formation date one year earlier than the truth adds a
 * whole year to the prompt.
 */
function yearOf(iso: string | null | undefined): number | null {
  const m = /^(\d{4})/.exec((iso ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y > 1900 ? y : null;
}

/**
 * "2021 to 2024", "2021 and 2022", or "2021".
 *
 * Ranges only collapse when the years are genuinely consecutive: a filer
 * missing 2021 and 2024 must not be told "2021 to 2024", which names two years
 * they already filed.
 */
export function describeYears(years: number[]): string {
  if (years.length === 0) return '';
  const asc = [...years].sort((a, b) => a - b);
  if (asc.length === 1) return String(asc[0]);
  const consecutive = asc.every((y, i) => i === 0 || y === asc[i - 1] + 1);
  if (consecutive) return `${asc[0]} to ${asc[asc.length - 1]}`;
  if (asc.length === 2) return `${asc[0]} and ${asc[1]}`;
  return `${asc.slice(0, -1).join(', ')} and ${asc[asc.length - 1]}`;
}
