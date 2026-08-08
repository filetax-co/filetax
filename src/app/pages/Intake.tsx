// src/app/pages/Intake.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import { mapTransactionForPersist, summarizeTransactions, resolveUiTxType } from '../../lib/filingMapping';
import { listCompanies, loadCompany, saveProfileFromFiling, normalizeEin, type FilingProfile } from '../../lib/filingProfile';
import { startCheckout } from '../../lib/checkout';
import { loadFaxTransmission } from '../../lib/faxTransmissions';
import { DraftPreviewModal, type DraftDoc } from '../../components/DraftPreviewModal';
import {
  asksDirection,
  BIZ_ACTIVITIES,
  COUNTRIES,
  defaultDirectionFor,
  filingDueDates,
  LOAN_TYPES,
  OWNER_ONLY_TX_TYPES,
  NON_OWNER_BLOCKED_TX_TYPES,
  PART_V_TYPES,
  PART_VI_TYPES,
  type QuickTx,
  REASONABLE_CAUSE_REASONS,
  RELATED_PARTY_TX,
  RP_NAICS,
  resolveBizPreset,
  SIMPLE_TX,
  STEP_LABELS,
  TAX_YEARS,
  TX_CATEGORIES,
  TX_TYPES,
  type IntakeStep,
  US_STATES,
} from './intake/constants';
import {
  GENERIC_TAX_ID,
  taxIdInfoFor,
  taxIdPlaceholder,
  taxIdTooltip,
  taxIdWarning,
} from './intake/countryTaxIds';
import { PRICE_PER_YEAR, PRICE_RCL, PRICE_FAX, PRICE_ADDITIONAL_PARTY, billablePartyCount, checkoutLines } from '../../lib/pricing';
import { formatAmount, formatUsd } from '../../lib/money';
import { usePageMeta } from '../hooks/usePageMeta';
import { DevScenarioLoader } from './intake/DevScenarioLoader';

type Address = {
  line1?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

type RelatedParty = {
  id?: string;
  name: string;
  ref_number: string;
  country: string;
  country_residence: string;
  us_tin?: string;
  foreign_tax_id: string;
  address: Address;
  biz_activity: string;
  biz_code: string;
};

type TransactionRow = {
  id?: string;
  related_party_index: number;
  transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: string;
  /** Beginning-of-year balance for loan rows (Form 5472 lines 17a / 31a). */
  loan_begin_usd?: string;
  description: string;
  transaction_date: string;
};

function formatEIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * What is wrong with this EIN, or null when nothing is.
 *
 * Returns the specific problem rather than a boolean, so the filer is told which
 * rule they broke instead of being handed one message for every kind of typo.
 * An EIN is nine digits written XX-XXXXXXX: a two-digit prefix recording which
 * IRS campus (or the online assignment system) issued it, then a seven-digit
 * serial.
 *
 * The rules below are the structural ones, which hold regardless of which
 * prefixes the IRS currently has in service. A prefix allowlist is deliberately
 * NOT applied: the assigned set changes as campuses open and close, and a stale
 * list would reject a real, currently issued EIN. That is a worse failure than
 * accepting a well-formed but unissued one, because the filer has no way around
 * it. See the handoff before adding one.
 */
/** "999999999" → "99-9999999", the form the filer types and the IRS prints. */
function formatEinDigits(digits: string | null | undefined): string {
  const d = (digits ?? '').replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : '';
}

function einProblem(val: string): string | null {
  const raw = val.trim();
  if (!raw) return 'Enter your EIN.';
  const digits = raw.replace(/\D/g, '');
  if (!/^\d{2}-\d{7}$/.test(raw)) {
    if (digits.length !== 9) {
      return `An EIN has 9 digits, written XX-XXXXXXX. You entered ${digits.length} ${digits.length === 1 ? 'digit' : 'digits'}.`;
    }
    return 'Write the EIN as XX-XXXXXXX, with a hyphen after the first two digits.';
  }
  if (!/[1-9]/.test(digits)) return 'An EIN cannot be all zeroes.';
  if (digits.slice(0, 2) === '00') return 'An EIN cannot begin with 00. The first two digits identify the IRS office that issued it.';
  if (digits.slice(2) === '0000000') return 'The seven digits after the hyphen cannot all be zero.';
  return null;
}

function isValidEIN(val: string): boolean {
  return einProblem(val) === null;
}

/**
 * What is wrong with a money field, or null when nothing is.
 *
 * Every amount on this return is US dollars and cents, so more than two decimal
 * places is not a rounding question, it is a value the filer did not mean. The
 * exponent check matters because Number('5e3') is 5000: JavaScript accepts a
 * notation no filer types, and it would reach the return as a different-looking
 * number than what was entered.
 */
function amountProblem(raw: string, what: string): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (/e/i.test(v)) return `${what} cannot be written in exponent notation. Enter the number in full.`;
  if (!/^-?\d*(\.\d+)?$/.test(v)) return `${what} must be a plain number. Remove any currency symbols, spaces or thousands separators.`;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${what} is not a number.`;
  if (n < 0) return `${what} cannot be negative.`;
  const dot = v.indexOf('.');
  if (dot !== -1 && v.length - dot - 1 > 2) return `${what} cannot have more than two decimal places, US dollars and cents.`;
  return null;
}

/** NAICS codes are exactly six digits. */
function naicsProblem(raw: string, what: string): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (!/^\d+$/.test(v)) return `${what} must be digits only.`;
  if (v.length !== 6) return `${what} must be exactly 6 digits. You entered ${v.length}.`;
  return null;
}

/** Today as YYYY-MM-DD, for comparing against date inputs. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * An initial (first-ever) return is one where the LLC was formed during the
 * tax year being filed. Drives the Form 5472 / 1120 "Initial return" checkbox
 * and the short-year begin date.
 */
// True when the entity was formed WITHIN the filing period. For a calendar-year
// filer that's simply "formed in the tax year". For a fiscal-year filer the
// period can span two calendar years, so we test membership in the derived
// [begin, end] window.
function isInitialReturn(
  doiISO: string,
  taxYear: string,
  fiscalEndMonth?: number | '',
): boolean {
  if (!doiISO) return false;
  if (fiscalEndMonth && fiscalEndMonth !== 12) {
    const { begin, end } = deriveFiscalPeriod(taxYear, fiscalEndMonth);
    return doiISO >= begin && doiISO <= end;
  }
  const y = Number(doiISO.slice(0, 4));
  return y > 0 && y === Number(taxYear);
}

function isUSCountry(value?: string | null): boolean {
  return value === 'US' || value === 'United States';
}

function buildOwnerRef(name: string): string {
  const prefix = name.trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  return prefix ? `${prefix}001` : '';
}

function buildRelatedPartyRef(name: string, index: number): string {
  const prefix = name.trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const suffix = String(index + 2).padStart(3, '0');
  return prefix ? `${prefix}${suffix}` : '';
}

function resolveBizActivityLabel(activity: string): string {
  if (!activity || activity === 'other') return '';
  return activity;
}

// ── Money formatting ────────────────────────────────────────────────────────
// Amount fields display with thousands separators (1,000,000) while storing a
// plain numeric string in state. Only dollar amounts are formatted, never
// EIN / TIN / reference IDs, which stay raw.

/** Strip everything except digits and a single decimal point. */
function stripMoney(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  // keep only the first decimal point
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

// ── Fiscal period derivation ────────────────────────────────────────────────
// A fiscal tax year is DESIGNATED by the calendar year in which it BEGINS, // the IRS convention. So "tax year Y" begins on the first day of month (M+1) in
// year Y and ends on the last day of month M in the FOLLOWING year (Y+1).
// e.g. fiscal year ending March, tax year 2025 → April 1, 2025 through
// March 31, 2026 (filed on the 2025 form). A December end (M=12) is the plain
// calendar year Y.
function deriveFiscalPeriod(taxYear: string, endMonth: number): { begin: string; end: string } {
  const y = Number(taxYear);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (endMonth === 12) {
    return { begin: `${y}-01-01`, end: `${y}-12-31` };
  }
  const begin = `${y}-${pad(endMonth + 1)}-01`;
  const endYear = y + 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate(); // last day of endMonth in Y+1
  const end = `${endYear}-${pad(endMonth)}-${pad(lastDay)}`;
  return { begin, end };
}

/**
 * The filing period for a tax year, whichever basis the filer is on.
 *
 * Calendar filers get Jan 1 – Dec 31 of the tax year. Fiscal filers get the
 * derived window, which for a non-December year-end runs into the FOLLOWING
 * calendar year: FY ending March, tax year 2025 → 2025-04-01 through
 * 2026-03-31. A fiscal filer who has not yet picked a year-end falls back to
 * the calendar year, which is what the rest of the form assumes until the
 * month is chosen.
 */
function taxPeriodWindow(
  taxYear: string,
  isFiscalYear: boolean,
  fiscalEndMonth: number | '',
): { begin: string; end: string } {
  if (isFiscalYear && fiscalEndMonth !== '') {
    return deriveFiscalPeriod(taxYear, fiscalEndMonth);
  }
  return { begin: `${taxYear}-01-01`, end: `${taxYear}-12-31` };
}

/**
 * The period the entity actually existed within the nominal calendar/fiscal
 * window, so the dates shown during intake are the dates that get printed.
 *
 * This has to agree with pdfGenerator.resolvePeriod EXACTLY, including the
 * comparison operators. Both ends are gated the same way there:
 *
 *   begin  short-year start for an initial return, gated on the same
 *          isInitialReturn() this page persists as initial_return, and taken
 *          only when the formation date is strictly LATER than the nominal
 *          start (resolvePeriod uses `incorpISO > nominalBegin`)
 *   end    short-year end for a final return, taken only when the dissolution
 *          date falls strictly inside the period (`> begin && < nominalEnd`),
 *          so a closure on the first or last day leaves the period unchanged
 *          rather than printing a one-day year
 *
 * There is no initial-return checkbox: it is derived from the formation date,
 * which is why begin needs no user answer.
 */
function effectiveTaxPeriodWindow(
  taxYear: string,
  isFiscalYear: boolean,
  fiscalEndMonth: number | '',
  incorporationDate: string,
  finalReturn: boolean,
  dissolutionDate: string,
): { begin: string; end: string } {
  const nominal = taxPeriodWindow(taxYear, isFiscalYear, fiscalEndMonth);
  const initial = isInitialReturn(incorporationDate, taxYear, isFiscalYear ? fiscalEndMonth : '');
  const begin =
    initial && incorporationDate && incorporationDate > nominal.begin
      ? incorporationDate
      : nominal.begin;
  const end =
    finalReturn
    && dissolutionDate
    && dissolutionDate > begin
    && dissolutionDate < nominal.end
      ? dissolutionDate
      : nominal.end;
  return { begin, end };
}

/** Display an ISO date (YYYY-MM-DD) as MM/DD/YYYY. */
function formatDateMMDDYYYY(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
}

/** Unambiguous date for an international audience: "March 01, 2025". */
function formatDateLong(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[m - 1]} ${String(d).padStart(2, '0')}, ${y}`;
}

/** Format a numeric string with thousands separators for display. */
function formatMoney(value: string): string {
  if (!value) return '';
  const [intPart, decPart] = value.split('.');
  const withCommas = intPart ? Number(intPart).toLocaleString('en-US') : '';
  if (value.endsWith('.')) return `${withCommas}.`;
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

/**
 * Where this filing stands against its own deadlines.
 *
 * Takes the PERIOD END rather than the tax year, because the deadline follows
 * the period, not the label on it: the return is due the 15th day of the 4th
 * month after the period ends, plus 6 months with a timely Form 7004. A fiscal
 * filer measured against the calendar-year date was told they were inside the
 * extension window months after it had closed, which suppressed step 1b and
 * with it the reasonable cause letter. See filingDueDates() in constants.ts.
 *
 * Compared as ISO strings. `new Date('2026-04-15') > today` parses the ISO date
 * as UTC midnight while `today` is local, so on the due date itself the two
 * disagree by up to a day depending on the filer's timezone; comparing
 * YYYY-MM-DD lexically is exact and timezone-free.
 */
function getFilingTimingStatus(
  periodEndISO: string,
  today: Date,
): { status: 'on_time' | 'within_extension' | 'delayed'; originalPassed: boolean; extendedPassed: boolean } {
  const dates = filingDueDates(periodEndISO);
  const todayISOLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const originalPassed = todayISOLocal > dates.original;
  const extendedPassed = todayISOLocal > dates.extended;
  if (!originalPassed) return { status: 'on_time', originalPassed, extendedPassed };
  if (!extendedPassed) return { status: 'within_extension', originalPassed, extendedPassed };
  return { status: 'delayed', originalPassed, extendedPassed };
}

/**
 * The readable reason behind a thrown error, for showing to the filer.
 *
 * These catch blocks used to show "Something went wrong saving your filing" and
 * put the real cause in console.error, where nobody sees it. A filer who hits a
 * constraint violation or an RLS denial then has nothing to act on and nothing
 * useful to quote to support. Supabase errors carry `message`, and often a
 * `details`/`hint` pair that says considerably more than the message does.
 */
function describeError(e: unknown): string {
  const err = e as { message?: string; details?: string; hint?: string; code?: string } | null;
  const parts = [err?.message, err?.details, err?.hint]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const seen = new Set<string>();
  const text = parts.filter((p) => !seen.has(p) && seen.add(p)).join('. ');
  if (!text) return typeof e === 'string' && e.trim() ? e.trim() : 'No further detail was returned.';
  return err?.code ? `${text} (code ${err.code})` : text;
}

/**
 * Fold a country name to the form the exemption set is keyed on: lowercased,
 * trimmed, and stripped of diacritics.
 *
 * The diacritic stripping is what keeps this in step with CountrySelect. That
 * list spells the entries the IRS does - "Cote d'Ivoire" carries a circumflex,
 * "Curacao" a cedilla - and a plain lowercase comparison against an unaccented
 * key silently fails to match, which is precisely the bug this set exists to
 * prevent. Folding both sides means the set can be written in plain ASCII and
 * still match whichever spelling reaches it, including values typed into the
 * "Other, not listed" box.
 */
const foldCountry = (value?: string): string => {
  // NFD splits an accented letter into base + combining mark; dropping the
  // marks (U+0300-U+036F) leaves the ASCII base letter. Written as a code-point
  // test rather than a regex range so the source stays pure ASCII and cannot be
  // corrupted by a tool that mangles the file encoding.
  let out = '';
  for (const ch of (value ?? '').trim().toLowerCase().normalize('NFD')) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x0300 || cp > 0x036f) out += ch;
  }
  return out;
};

/**
 * Countries and territories that operate no postal code system at all, so an
 * address there is complete without one.
 *
 * Keyed on foldCountry() of the CountrySelect display name, because the country
 * field carries display names rather than ISO codes. A country missing from this
 * list only means its filers are still asked for a postal code, which is the
 * safe direction to be wrong in: adding one is a one-line change, while wrongly
 * exempting a country loses a real piece of the address.
 *
 * Entries must match a name in COUNTRIES, or they are dead. Two were: the set
 * said "congo" and "democratic republic of the congo" while the dropdown offers
 * "Congo (Republic)" and "Congo (Democratic Republic)", so neither Congo was
 * ever exempted. The legacy spellings below are kept only because filings saved
 * before the list was corrected still hold them.
 */
const NO_POSTAL_CODE_COUNTRIES = new Set([
  'hong kong', 'macau', 'united arab emirates', 'panama',
  'ireland', 'qatar', 'kuwait', 'bahrain', 'oman', 'yemen', 'syria', 'libya',
  'angola', 'aruba', 'belize', 'bolivia', 'botswana', 'burkina faso', 'burundi',
  'cameroon', 'central african republic', 'chad', 'comoros',
  'congo (republic)', 'congo (democratic republic)', "cote d'ivoire",
  'cook islands', 'curacao', 'djibouti',
  'dominica', 'equatorial guinea', 'eritrea', 'fiji', 'gambia', 'ghana',
  'grenada', 'guyana', 'north korea', 'malawi', 'mali', 'mauritania',
  'namibia', 'nauru', 'niue', 'rwanda', 'saint kitts and nevis',
  'saint lucia', 'samoa', 'sao tome and principe', 'seychelles',
  'sierra leone', 'sint maarten', 'solomon islands', 'somalia', 'suriname',
  'timor-leste', 'togo', 'tokelau', 'tonga', 'trinidad and tobago', 'tuvalu',
  'uganda', 'vanuatu', 'zimbabwe',
  // Legacy spellings, still present on filings saved before the names above
  // were aligned with the dropdown. Harmless to keep, wrong to remove.
  'macao', 'uae', 'congo', 'democratic republic of the congo', 'ivory coast',
  'east timor',
]);

const countryUsesPostalCode = (country?: string): boolean =>
  !NO_POSTAL_CODE_COUNTRIES.has(foldCountry(country));

function isAddressComplete(address: Address, forceUS?: boolean): boolean {
  if (!address.line1?.trim()) return false;
  if (!address.city?.trim()) return false;
  // State / region is required only for US addresses. Many countries (e.g.
  // Singapore and other city-states) have no state or province, so a foreign
  // address without a region is still complete.
  const isUS = forceUS || isUSCountry(address.country);
  if (isUS && !address.region?.trim()) return false;
  // Same reasoning, applied to the postal code. It had been required of every
  // country, which left filers in Hong Kong, the UAE, Panama and much of
  // Ireland unable to complete an address they had entered correctly.
  if ((isUS || countryUsesPostalCode(address.country)) && !address.postal_code?.trim()) return false;
  if (!forceUS && !address.country?.trim()) return false;
  return true;
}


/**
 * The number written to filings.current_step for a step.
 *
 * 1b is part of step 1 as far as the column is concerned: it is an extra
 * section, not a sixth step, and the dashboard counts "of 5".
 */
function stepNumberOf(s: IntakeStep): number {
  return s === '1b' ? 1 : Number(s);
}

/** "2022 and 2023", "2019, 2020 and 2021". Ascending, as the tabs are. */
function joinYears(years: string[]): string {
  const ys = [...years].sort();
  if (ys.length <= 1) return ys[0] ?? '';
  return `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`;
}

/** A sibling year of the same catch-up job, as this page reads it. */
type JobYear = {
  id: string;
  tax_year: string;
  status: string;
  current_step: number;
  /** Billable additional parties in THIS year, for pricing the whole job. */
  billable_parties: number;
};

/**
 * The year to open after finishing `currentTaxYear`, or null when the next stop
 * is payment.
 *
 * THE YEAR AHEAD, whatever state it is in. Two wrong answers were tried here
 * first and both came from asking whether the next year was already "done":
 *
 * - `status`, which is `draft` on every year until the JOB is paid, so "the
 *   earliest remaining draft year" kept choosing a year the filer had already
 *   filled in: 2022 → 2023 → 2022 → 2023, with no route to checkout at all.
 * - `current_step >= 5`, which is the furthest step the year has ever REACHED,
 *   not a record of submitting it. Opening 2023's review section writes 5, so
 *   2022 then decided 2023 was finished and offered payment from the FIRST year
 *   of a two-year catch-up.
 *
 * There is no column that means "this year is finished", and inventing one from
 * whatever is nearby is what produced both bugs. A catch-up is filed oldest to
 * newest, so the year after this one is the answer, and the most recent year is
 * where the job pays. Revisiting a year is what the tab strip is for.
 *
 * The one exception is a year that has never reached review, which is not a
 * revisit but an unfinished year the filer left behind. Those are picked up
 * before payment rather than being paid for half-answered. `years` is sorted
 * ascending.
 */
function nextOpenYear<T extends Pick<JobYear, 'id' | 'tax_year' | 'status' | 'current_step'>>(
  years: T[],
  currentId: string | null,
  currentTaxYear: string | number,
): T | null {
  const others = years.filter((y) => y.id !== currentId);
  const ahead = others.filter((y) => Number(y.tax_year) > Number(currentTaxYear));
  if (ahead[0]) return ahead[0];
  return others.find((y) => y.status === 'draft' && Number(y.current_step ?? 1) < 5) ?? null;
}

function getStepOrder(show1b: boolean): IntakeStep[] {
  if (show1b) return [1, '1b', 2, 3, 4, 5];
  return [1, 2, 3, 4, 5];
}

/**
 * The step named by `?step=`, or null when the URL asks for nothing.
 *
 * The param carries the INTERNAL step number, the same 1 to 5 that
 * `filings.current_step` stores and that the dashboard card counts "of 5". It is
 * NOT the number the accordion prints on screen: 1b is an extra section inside
 * step 1, so from the reasonable-cause section onward the printed number runs
 * one ahead of this one. That divergence is deliberate and must stay, because
 * the dashboard's resume link feeds `current_step` straight back into this
 * param; renumbering here to match the screen would desync the two.
 *
 * Out of range CLAMPS rather than resetting. `?step=6` is the number the review
 * section prints on itself, and it used to land the filer on step 1, at the top
 * of a form they had already filled in, which reads as the wizard having thrown
 * their work away. Anything past the end means the end.
 */
function stepFromParam(raw: string | null): IntakeStep | null {
  if (raw === '1b') return '1b';
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.floor(n) as IntakeStep;
}

/**
 * Risk tier for a transaction type against a particular counterparty.
 *
 * The tier is not a property of the type alone. A domestic disregarded entity
 * and its sole owner are the same taxpayer: their dealings are not recognised
 * for income tax and are reportable only because 26 CFR 301.7701-2(c)(2)(vi)
 * makes the LLC a corporation for section 6038A. So an owner loan is a
 * bookkeeping entry, while the identical type against a non-owner related
 * party is a real loan carrying interest and sourcing consequences. Tiering by
 * type alone over-warns the common case and under-warns the dangerous one.
 *
 * `isOwner` is true for related party index 0, which is always the filer.
 */
function getCategoryForTxType(txType: string, isOwner = false): 1 | 2 | 3 | null {
  const found = TX_TYPES.find((t) => t.value === txType);
  if (!found) return null;
  return isOwner ? found.ownerCategory ?? found.category : found.category;
}

/**
 * Accessible info tooltip, a small "i" the user can hover OR click/focus to
 * reveal a plain-language hint. Click/focus toggles it so it works on touch and
 * for keyboard users (not hover-only). Uses --tf-* tokens so it adapts to dark
 * mode. The popover is a sibling positioned relative to the trigger.
 */
/**
 * Last-resort label for a transaction type with no TX_TYPES entry.
 *
 * Every code should resolve through TX_TYPES now that saved rows are mapped
 * back to the intake vocabulary on load. This exists so that if one ever does
 * not, the filer sees "Rent royalty" rather than `rent_royalty`. A raw
 * identifier on screen reads as a bug to the filer and tells them nothing about
 * what they entered.
 */
function humanizeTxType(code: string): string {
  if (!code) return 'Transaction';
  return code
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function InfoTooltip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; below: boolean } | null>(null);

  // The tooltip is positioned FIXED rather than absolute. Both `.acc-section`
  // and `groupedCardStyle` set `overflow: hidden` (they need it to clip their
  // rounded corners), which was slicing the popover off mid-sentence wherever
  // it reached a section edge. A fixed layer is outside their clipping context,
  // so the text always shows in full, and we clamp to the viewport so a field
  // near the right edge does not push it off-screen either.
  React.useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const measure = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
      // Flip below the icon when there is not enough room above it.
      const below = r.top < 120;
      setBox({ left, top: below ? r.bottom + 6 : r.top - 6, width, below });
    };
    measure();
    // A fixed popover does not travel with the page, so dismiss it on scroll
    // or resize instead of leaving it stranded beside the wrong field.
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        ref={btnRef}
        aria-label={label ?? 'More information'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        style={{
          // The outlined lucide Info icon, matching the eligibility check and
          // the pricing page so the affordance reads as one thing across the
          // product. This replaces a small filled accent circle, which itself
          // existed because an EARLIER outlined "i" was hard to find. The risk
          // is therefore known, and this answers it with a real 16px icon
          // rather than a 14px circle holding a 9.5px letter. If it proves hard
          // to spot again, raise the contrast rather than going back to a dot.
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--tf-muted)',
          padding: '2px',
          display: 'inline-flex',
          alignItems: 'center',
          marginLeft: '0.3rem',
          flexShrink: 0,
        }}
      >
        <Info size={16} />
      </button>
      {open && box && (
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            left: box.left,
            top: box.top,
            transform: box.below ? 'none' : 'translateY(-100%)',
            width: box.width, zIndex: 100,
            background: 'var(--tf-text)', color: 'var(--tf-surface)',
            fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.5,
            padding: '0.5rem 0.625rem', borderRadius: '0.375rem',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)', textTransform: 'none', letterSpacing: 'normal',
            whiteSpace: 'normal', overflowWrap: 'break-word', pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

function Field({
  label,
  hint,
  children,
  style,
  required,
  tooltip,
  status,
  locked,
  anchor,
}: {
  label: string;
  /** Deprecated: longer guidance. Routed into the (i) tooltip, never shown inline. */
  hint?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  required?: boolean;
  /** Guidance shown behind a clickable (i) icon (the single helper per field). */
  tooltip?: string;
  /** Short always-visible status suffix, e.g. "optional" or "locked". */
  status?: string;
  /**
   * Frozen by payment. Draws a padlock instead of the words "locked after
   * payment", which sat next to six of the densest labels on the page and read
   * as clutter on every one of them. The meaning survives: the glyph carries a
   * title and an accessible label, and the field is disabled anyway, so the
   * lock explains a control the filer has already found they cannot type in.
   */
  locked?: boolean;
  /**
   * Target for a clicked error message. Matches the `field` given to `at()` in
   * the validators. Purely an addressing handle: it changes nothing visually
   * and a field without one simply cannot be jumped to.
   */
  anchor?: string;
}) {
  // Exactly one helper per field: the (i) tooltip carries all guidance. Any
  // legacy `hint` becomes tooltip text (so nothing is duplicated or lost).
  // `status` is the only thing shown inline, for short state words like
  // "optional", not guidance.
  const tip = tooltip ?? hint;
  return (
    <div data-anchor={anchor} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-muted)' }}>
        {label}
        {required && <span style={{ color: 'var(--tf-error)', marginLeft: '0.2rem' }}>*</span>}
        {status && <span style={{ fontWeight: 400, marginLeft: '0.25rem', fontStyle: 'italic' }}>{status}</span>}
        {tip && <InfoTooltip text={tip} label={`About ${label}`} />}
      </label>
      {/* The padlock sits INSIDE the control, at its right edge, where a select
          draws its chevron. It used to follow the label, which on a narrow
          column (EIN, Tax year) pushed itself and the (i) onto their own lines
          under a two-word label and read as three stacked icons attached to
          nothing. In the control it is beside the thing it describes, and on a
          locked select it replaces the chevron, which was promising a dropdown
          that cannot open. */}
      <div className={`field-control${locked ? ' is-locked' : ''}`}>
        {children}
        {locked && <LockGlyph />}
      </div>
    </div>
  );
}

/**
 * The padlock that replaced the words "locked after payment".
 *
 * Inline SVG rather than the emoji: 🔒 renders as a different picture on every
 * platform and is coloured by the font, where this inherits the label's colour
 * and stays the same shape everywhere. `currentColor` is what makes it work in
 * both themes without a second rule.
 */
function LockGlyph() {
  return (
    <svg
      role="img"
      aria-label="Locked after payment"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="field-lock"
    >
      <title>Locked after payment</title>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/**
 * One collapsible section of the vertical intake accordion. The trigger shows
 * the step number, its label, and a progress dot (complete vs still-needed);
 * the body renders only when open. Styled with the page's --tf-* tokens.
 */
function AccordionSection({
  numberLabel,
  label,
  open,
  complete,
  onToggle,
  anchorRef,
  frozen,
  liveFooter,
  children,
}: {
  numberLabel: string;
  label: string;
  open: boolean;
  complete: boolean;
  onToggle: () => void;
  anchorRef?: (el: HTMLDivElement | null) => void;
  /**
   * Freeze every control in the body, for a filing whose pages are already at
   * the IRS. A fieldset rather than a `disabled` prop on each input: the fields
   * the fax lock needs to stop are mostly the ones payment never froze, so they
   * carry no `disabled` prop to extend, and the set would drift every time a
   * field was added. The trigger stays outside it, so a frozen filing can still
   * be opened and read.
   */
  frozen?: boolean;
  /**
   * Controls that must keep working on a frozen section, rendered inside the
   * body but OUTSIDE the fieldset.
   *
   * `disabled` on a fieldset disables every descendant button, not just the
   * inputs, so a link out of a read-only filing placed in `children` is dead on
   * arrival: it looks like a button, it is styled like a button, and it cannot
   * be clicked. That is how the first "Go to downloads" shipped. Anything that
   * NAVIGATES rather than edits belongs here.
   */
  liveFooter?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="acc-section" ref={anchorRef}>
      <button
        type="button"
        className="acc-trigger"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={`acc-progress-dot${complete ? ' is-complete' : ''}`} aria-hidden="true">
          {complete ? '✓' : ''}
        </span>
        <span className="acc-trigger-label">{numberLabel}{label}</span>
        <span className={`acc-trigger-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="currentColor" width={18} height={18}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="acc-body">
          {frozen ? (
            // minInlineSize:auto undoes the UA default that stops a fieldset
            // shrinking inside flex/grid, which would otherwise widen every
            // frozen section.
            <fieldset disabled style={{ border: 0, margin: 0, padding: 0, minInlineSize: 'auto' }}>
              {children}
            </fieldset>
          ) : children}
          {liveFooter}
        </div>
      )}
    </section>
  );
}

function AddressFields({
  value,
  onChange,
  forceUS,
  anchor,
}: {
  value: Address;
  onChange: (a: Address) => void;
  forceUS?: boolean;
  /** Jump target for "Complete your address." The block is one error, so it is
   *  one anchor: the jump lands on the street line, which is where a filer with
   *  an incomplete address starts reading anyway. */
  anchor?: string;
}) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  const effectiveCountry = forceUS ? 'US' : value.country;
  const isUS = isUSCountry(effectiveCountry);
  // State / region is required only for US addresses. Many countries have no
  // state or province, so it is optional (and clearly labeled so) for the rest.
  const regionRequired = isUS;

  // Two-column rows: row 1 = street (full width), row 2 = city + postal code,
  // row 3 = country + state/region. Country comes first because it determines
  // whether the region is a required US state or an optional foreign region.
  //
  // minmax(0, 1fr), not 1fr. A grid track's automatic minimum is its content's
  // min-content size, and for a <select> that is its LONGEST OPTION: the
  // country list contains names long enough to blow past half a 390px phone,
  // so `1fr 1fr` here was what pushed the whole intake page sideways.
  const rows: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1.25rem' };

  return (
    <div data-anchor={anchor} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Row 1, street */}
      <Field label="Street address" required>
        <input placeholder="Street address" value={value.line1 ?? ''} onChange={(e) => set('line1', e.target.value)} />
      </Field>

      {/* Row 2, city + postal code */}
      <div style={rows}>
        <Field label="City" required>
          <input placeholder="City" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Postal code" required>
          <input placeholder="Postal code" value={value.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
        </Field>
      </div>

      {/* Row 3, country + state/region */}
      <div style={rows}>
        {forceUS ? (
          <Field label="Country" required>
            <input value="United States" disabled />
          </Field>
        ) : (
          <Field label="Country" required>
            <select
              value={value.country ?? ''}
              onChange={(e) => {
                const nextCountry = e.target.value;
                const wasUS = isUSCountry(value.country);
                const nextIsUS = isUSCountry(nextCountry);
                onChange({ ...value, country: nextCountry, region: wasUS !== nextIsUS ? '' : value.region });
              }}
            >
              <option value="">Select country</option>
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label={isUS ? 'State' : 'State or region'}
          required={regionRequired}
          status={regionRequired ? undefined : 'optional'}
        >
          {isUS ? (
            <select value={value.region ?? ''} onChange={(e) => set('region', e.target.value)}>
              <option value="">Select state</option>
              {US_STATES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          ) : (
            <input placeholder="Leave blank if your country has none" value={value.region ?? ''} onChange={(e) => set('region', e.target.value)} />
          )}
        </Field>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 500, color: value ? 'var(--tf-text)' : 'var(--tf-muted)' }}>
        {value || 'Not provided'}
      </div>
    </div>
  );
}

/**
 * A money figure for the summary panel.
 *
 * It used to be `Math.round(n)`, and rounding each figure INDEPENDENTLY made
 * the panel fail to add up: money in $1,312,768 plus money out $21,601 came to
 * $1,334,369 under a headline reading $1,334,368. Every number was right, the
 * true sum being $1,334,368.39, but three separate roundings cannot be made to
 * agree and a filer checking their own books reads the difference as our error.
 *
 * So cents are shown when there are cents, and not when there are not: a whole
 * figure still prints as "$1,312,768" rather than "$1,312,768.00", and only the
 * filings that actually had the mismatch look any different.
 */
const usd = (n: number) => `$${formatAmount(n)}`;

/** One-line readable address from the intake address shape, or null if empty. */
function formatAddress(a?: { line1?: string; city?: string; region?: string; postal_code?: string; country?: string } | null): string | null {
  if (!a) return null;
  const parts = [a.line1, a.city, a.region, a.postal_code, a.country].map((p) => (p ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Reportable-total + money-bucket panel. Shows what the user entered AND the
 * true Form 5472 gross-payments figure (line 1f/1h, Part IV flows, closing loan
 * balances, Part V contributions/distributions/formation costs and any Part VI
 * amount), so the form number is honest while nothing looks missing. Reused on
 * the transaction step (live) and the review step (static).
 */
function TxSummaryPanel({ summary, count }: { summary: ReturnType<typeof summarizeTransactions>; count: number }) {
  if (count === 0) return null;
  // `countOnly` is for the non-cash tile. Those disclosures often carry no
  // amount at all, so a bold "$0" beside them reads as a figure that failed to
  // add up rather than as a transaction that legitimately has no dollar value.
  const bucket = (
    label: string,
    b: { count: number; total: number },
    color: string,
    countOnly = false,
  ) => (
    <div style={{ background: 'var(--tf-offset)', borderRadius: '0.5rem', padding: '0.7rem 0.85rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)' }}>{label}{b.count ? ` · ${b.count}` : ''}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color }}>
        {countOnly && b.total === 0
          ? (b.count === 1 ? '1 item' : `${b.count} items`)
          : usd(b.total)}
      </div>
    </div>
  );
  return (
    <div style={{ ...groupedCardStyle, padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
      {/* The two figures are EQUAL in every case except one: a loan with an
          opening balance, where only the closing balance reaches line 1f/1h.
          Showing both unconditionally meant the same number was printed twice,
          under two different labels, on almost every filing, which reads as an
          error and invites the filer to hunt for a difference that is not
          there. So the second figure appears only when it actually differs,
          and the long explanation comes with it rather than standing whether
          or not there is anything to explain. */}
      {(() => {
        const differs = summary.formGross !== summary.totalEntered;
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tf-muted)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  {differs ? 'Total you’ve entered' : 'Total reported on Form 5472'}
                  {!differs && (
                    <InfoTooltip
                      text="This is the gross payments figure on Form 5472 line 1f/1h: your Part IV dealings, money you put in or took out, closing loan balances, formation costs you paid for the LLC, and any amount recorded against a property transfer. Every amount you entered is counted."
                      label="How this total is worked out"
                    />
                  )}
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--tf-text)', lineHeight: 1.1 }}>{usd(summary.totalEntered)}</div>
              </div>
              {differs && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tf-muted)' }}>On Form 5472 (gross payments)</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--tf-text)' }}>{usd(summary.formGross)}</div>
                </div>
              )}
            </div>
            {differs && (
              <p style={{ fontSize: '0.78rem', color: 'var(--tf-muted)', margin: '0.5rem 0 0.85rem', lineHeight: 1.5 }}>
                The “gross payments” figure (Form 5472 line 1f/1h) is the total of everything
                reported on the form. It sits below the amount you entered because a loan’s
                opening balance is not counted, only the closing balance is, so the same loan is
                not reported twice. That is expected.
              </p>
            )}
          </>
        );
      })()}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginTop: '0.85rem' }}>
        {bucket('Money in', summary.bucketIn, 'var(--tf-success)')}
        {bucket('Money out', summary.bucketOut, 'var(--tf-accent)')}
        {/* Only Part VI reaches this tile now: non-cash and below-market
            disclosures, the one kind of dealing that is genuinely neither money
            in nor money out. Every Part IV row is bucketed by its direction,
            which is what it was for. */}
        {bucket('Other dealings (non-cash)', summary.bucketOther, 'var(--tf-text)', true)}
      </div>
    </div>
  );
}

const stepHeadingStyle: React.CSSProperties = { fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' };
const stepSubheadStyle: React.CSSProperties = { fontSize: '0.9rem', color: 'var(--tf-muted)', marginBottom: '1.75rem', lineHeight: 1.55 };
const sectionStyle: React.CSSProperties = { marginBottom: '2.5rem' };
const sectionLabelStyle: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 700, color: 'var(--tf-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem' };
// Two columns, deliberately. The accordion body is ~590px wide, so a 220px
// minimum let a third column squeeze in and values started wrapping mid-word
// (dates broke across lines). A 260px floor caps it at two and matches the
// paired layout of the underlying form.
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', columnGap: '1.25rem', rowGap: '1.25rem' };
const reviewGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', columnGap: '1.5rem', rowGap: '1.125rem', background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem', padding: '1.375rem 1.5rem' };
const primaryBtnStyle: React.CSSProperties = { padding: '0.6rem 1.5rem', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', border: 'none', borderRadius: '0.5rem', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' };
const secondaryBtnStyle: React.CSSProperties = { padding: '0.6rem 1.25rem', background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer' };
const addBtnStyle: React.CSSProperties = { marginTop: '0.75rem', alignSelf: 'flex-start', padding: '0.4375rem 1rem', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', border: 'none', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' };
const infoBoxStyle: React.CSSProperties = { background: 'var(--tf-offset)', border: '1px solid var(--tf-border)', borderRadius: '0.375rem', padding: '0.625rem 0.875rem', fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.75rem' };
// The priced-lines card. Same chrome as reviewGridStyle deliberately: it sits
// among the review panels and is one of them, so it takes the surface, border,
// radius and padding they all share rather than inventing a card of its own.
const payCardStyle: React.CSSProperties = { background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem', padding: '1.375rem 1.5rem' };
const payLineStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1.5rem', fontSize: '0.95rem', color: 'var(--tf-text)', marginBottom: '0.625rem' };
const payTotalStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1.5rem', paddingTop: '0.875rem', marginTop: '0.25rem', borderTop: '1px solid var(--tf-border)', fontSize: '1.0625rem', fontWeight: 700, color: 'var(--tf-text)' };
const errorSummaryStyle: React.CSSProperties = { background: 'var(--tf-error-bg)', color: 'var(--tf-error-text)', border: '1px solid var(--tf-error-border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' };
const groupedCardStyle: React.CSSProperties = { border: '1px solid var(--tf-border)', borderRadius: '0.625rem', background: 'var(--tf-surface)', overflow: 'hidden' };
// A clickable error message. It has to look like the sentence it is, so it
// carries no button chrome at all: transparent, no padding, inheriting the
// summary's colour and size, left-aligned because a multi-line message in a
// button centres itself otherwise.
const errorLinkStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, margin: 0,
  font: 'inherit', color: 'inherit', textAlign: 'left',
  textDecoration: 'underline', textUnderlineOffset: '0.15em', cursor: 'pointer',
};

/**
 * A validation message, optionally anchored to the field it is about.
 *
 * A plain string still works and renders exactly as it always did, which is
 * what keeps this incremental: a message only becomes clickable once somebody
 * has both given it a target and put a matching `data-anchor` on screen. An
 * anchored message that cannot find its field falls back to being ordinary
 * text rather than a button that does nothing, see `jumpToField`.
 */
type StepError = string | { msg: string; section: string; field: string };

/**
 * Anchor a message to a field. `section` is the accordion key ('1', '1b', '2',
 * '3', '4'), because the field may be inside a collapsed section and the jump
 * has to open it first; `field` matches a `data-anchor` in the markup.
 */
const at = (section: string, field: string, msg: string): StepError => ({ msg, section, field });

const errText = (e: StepError): string => (typeof e === 'string' ? e : e.msg);

/**
 * What to focus inside an anchored wrapper, in order of preference.
 *
 * The data entry control comes FIRST and this is not cosmetic. A `Field` puts
 * its (i) tooltip inside the `<label>`, so the tooltip's trigger button precedes
 * the input in document order: a single "first focusable" query put the cursor
 * on the help icon of every field that has one, which is most of the dense ones.
 * Buttons are still worth having as a fallback, because some targets are a
 * Yes/No pair or a card with an Edit button and no input at all.
 */
const FOCUS_PREFERENCE = [
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
];
const FOCUSABLE = FOCUS_PREFERENCE.join(', ');

/** The control a filer should land on inside `el`, or `el` itself if it is one. */
function focusTarget(el: HTMLElement): HTMLElement | null {
  if (el.matches(FOCUSABLE)) return el;
  for (const sel of FOCUS_PREFERENCE) {
    const hit = el.querySelector<HTMLElement>(sel);
    if (hit) return hit;
  }
  return null;
}

export function Intake() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [localFilingId, setLocalFilingId] = useState<string | null>(params.get('filing_id'));
  const filingId = localFilingId ?? params.get('filing_id');

  const [taxYear, setTaxYear] = useState('2024');
  const today = new Date();

  const [step, setStep] = useState<IntakeStep>(() => stepFromParam(params.get('step')) ?? 1);

  // The intake set no page meta at all, so every step kept whichever title the
  // previous route had left behind: all five reported "Check Your Eligibility"
  // to the browser and to analytics, which made every funnel step log
  // identically and hid where filers actually drop out. noindex because the
  // intake is a signed-in route.
  usePageMeta({
    title: `${STEP_LABELS[String(step)] ?? 'Filing details'} | Form 5472 filing | FileTax.co`,
    description: 'Enter the details for your Form 5472 and pro forma 1120 filing.',
    noindex: true,
  });

  // Vertical-accordion model: open only the requested section. Later sections
  // are unlocked as earlier required sections become valid.
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set<string>([String(step)]),
  );

  const [loadingFiling, setLoadingFiling] = useState(!!params.get('filing_id'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [einErr, setEinErr] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<StepError[]>([]);
  const [rpErrors, setRpErrors] = useState<string[]>([]);
  const [txErrors, setTxErrors] = useState<string[]>([]);

  // Anchors for scroll management. On Continue/Back we jump to the top of the
  // step; when validation fails we jump straight to the error summary so the
  // user is never left guessing why the form did not advance.
  const stepTopRef = useRef<HTMLDivElement | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const transactionDetailsRef = useRef<HTMLElement | null>(null);
  /**
   * The top of the transactions step: the running total, then the blank Add
   * form beside the list. Adding a transaction leaves the page scrolled to
   * wherever the amount and date fields were, several screens down, with a form
   * that has just been cleared. The filer's next move is either to add another
   * one or to check the total, and both live up here, so that is where they are
   * put back.
   */
  const transactionsTopRef = useRef<HTMLDivElement | null>(null);
  // Per-accordion-section anchors, keyed by step ('1','1b','2','3','4','5'),
  // so "Save & continue" can scroll to the next section.
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Step 1
  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [totalAssets, setTotalAssets] = useState('');
  const [entityDOI, setEntityDOI] = useState('');
  // Defaults to the United States, changeable. The reporting corporation IS a
  // US company, so it is the answer for most filers and the one they can accept
  // without stopping to think; the alternative was a blank required select in
  // the middle of step 1. Every other writer below preserves a saved value, so
  // this only ever fills an empty field.
  const [entityPrincipalCountry, setEntityPrincipalCountry] = useState('United States');
  const [mailing, setMailing] = useState<Address>({ country: 'US' });
  const [entityBizActivity, setEntityBizActivity] = useState('');
  const [entityBizCode, setEntityBizCode] = useState('');
  // Single-year multi-year nudge: when filing the latest year and the LLC was
  // incorporated earlier, we ask whether earlier returns were already filed.
  // null = not answered, true = already filed (no nudge), false = not filed
  // (offer multi-year).
  const [earlierReturnsFiled, setEarlierReturnsFiled] = useState<boolean | null>(null);
  // Does this database have the earlier_returns_filed column yet?
  //
  // Migrations here are applied by hand, so the deployed app can be ahead of
  // the schema for a while. PostgREST rejects an UPDATE naming a column that
  // does not exist, and it rejects the WHOLE patch, so sending it blindly would
  // break every save on the page rather than losing one answer. The loaded row
  // is the probe: select('*') returns the key when the column exists.
  const [supportsEarlierReturns, setSupportsEarlierReturns] = useState(false);
  /**
   * IRS fax delivery, the $9 add-on.
   *
   * `include_irs_fax` has existed on `filings` since the schema was written, and
   * BOTH edge functions already read it: `create-checkout-session` adds the fee
   * and `verify-payment` re-derives the same total. The generator has supported
   * it just as long, through `generateFilingPackage(..., { fax: true })`. The
   * only missing link was intake, which never set the column, so the flag was
   * false on every filing ever made and the add-on could not be bought.
   *
   * Charged ONCE PER JOB, not per year, which is why the label says so on a
   * catch-up: the fee covers the transmission, and a catch-up is transmitted
   * together.
   */
  const [includeIrsFax, setIncludeIrsFax] = useState(false);
  // Final return + fiscal-year (non-calendar) filing
  const [finalReturn, setFinalReturn] = useState(false);
  // Date the LLC was dissolved with its state of formation. This is what ends
  // the tax period on a final return: resolvePeriod truncates endISO to it, the
  // mirror of the way an initial return begins on the formation date. Before
  // this was collected, an LLC dissolved in June still printed a period running
  // to 31 December on both the Form 5472 header and the pro forma 1120.
  const [dateOfClosure, setDateOfClosure] = useState('');
  // Form 1120 item E, boxes 3 and 4. Both columns and both checkBox() calls in
  // fill1120 already existed; nothing in the UI ever set them, so neither box
  // has ever been checked on a generated packet.
  //
  // "Changed" means changed from what the IRS holds, which comes from the SS-4
  // EIN application as well as from any previous return. So these apply on a
  // first-ever return too: forming an LLC, getting the EIN, then renaming or
  // moving before the first filing is a common sequence for this audience.
  const [nameChange, setNameChange] = useState(false);
  const [addressChange, setAddressChange] = useState(false);
  const [isFiscalYear, setIsFiscalYear] = useState(false);
  // For a fiscal-year filer we only collect the fiscal YEAR-END MONTH (1–12).
  // The period is then derived deterministically from the tax year, so the user
  // can no longer pick a year that conflicts with the filing year.
  const [fiscalEndMonth, setFiscalEndMonth] = useState<number | ''>('');
  const nominalTaxPeriod = taxPeriodWindow(taxYear, isFiscalYear, fiscalEndMonth);
  const effectiveTaxPeriod = effectiveTaxPeriodWindow(
    taxYear,
    isFiscalYear,
    fiscalEndMonth,
    entityDOI,
    finalReturn,
    dateOfClosure,
  );
  const dissolutionDateError =
    finalReturn && dateOfClosure && entityDOI && dateOfClosure < entityDOI
      ? `The dissolution date (${formatDateMMDDYYYY(dateOfClosure)}) cannot be before the LLC was formed (${formatDateMMDDYYYY(entityDOI)}).`
      : null;
  // Floor for the dissolution picker: the formation date when the LLC was
  // formed part way through this period, otherwise the period start. Clamped
  // to the period end so a formation date entered outside this year (a common
  // catch-up typo) cannot produce min > max, which leaves the whole picker
  // unusable with nothing on screen to explain why. Validation still catches
  // the bad formation date on submit.
  const dissolutionMin =
    entityDOI && entityDOI > nominalTaxPeriod.begin && entityDOI <= nominalTaxPeriod.end
      ? entityDOI
      : nominalTaxPeriod.begin;

  // Lateness is measured against THIS filing's period end, so it has to be
  // derived after the fiscal-year answers above rather than beside taxYear.
  // show1b gates the whole reasonable-cause step, so a wrong period end here
  // silently removes the filer's only route to a penalty defence.
  const filingTiming = getFilingTimingStatus(
    effectiveTaxPeriod.end,
    today,
  );
  const show1b = filingTiming.originalPassed;
  const stepOrder = getStepOrder(show1b);

  // Eligibility re-confirmation (Step 1). The checker is a first-visit screen:
  // a returning filer goes Dashboard -> startFiling -> here and never sees it
  // again. But Form 5472 is an annual obligation, and what the checker screens
  // for changes between years. Asked once per filing, not six questions again.
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false);
  const [hasUsActivity, setHasUsActivity] = useState<boolean | null>(null);

  // Step 1b
  const [extensionFiled, setExtensionFiled] = useState<boolean | null>(null);
  const [includeReasonableCause, setIncludeReasonableCause] = useState(false);
  const [reasonableCauseReasons, setReasonableCauseReasons] = useState<string[]>([]);

  // Whether THIS year's return is late for reasonable-cause purposes. The check
  // is year-specific (each tax year has its own deadlines):
  //   • no extension  → late once the ORIGINAL deadline has passed
  //   • extension filed → late once the EXTENDED deadline has passed too
  //     (a 7004 only buys until the extended date; past that the return is late)
  // While the extension is still valid (within_extension) the filing is on time,
  // so no reasonable-cause letter, and no "not required" message, is shown.
  const isLateForRcl =
    extensionFiled === true
      ? filingTiming.extendedPassed
      : extensionFiled === false
        ? filingTiming.originalPassed
        : false;
  const onTimeViaExtension =
    extensionFiled === true && filingTiming.originalPassed && !filingTiming.extendedPassed;

  // The timing label the review page shows. `filingTiming` only knows the
  // dates, not whether a 7004 was filed, so reading its status straight out
  // told a 2025 filer who had answered "No, I didn't file an extension" that
  // they were "Within the extension period" while the line directly beneath
  // said no 7004 was filed and the dashboard badged the filing past due. There
  // is no extension period without a 7004: once the original deadline passes
  // the return is simply late.
  const filingTimingLabel = (() => {
    if (!filingTiming.originalPassed) return 'On time';
    if (extensionFiled !== true) return 'Late, past the filing deadline';
    return filingTiming.extendedPassed ? 'Past the extended deadline' : 'Within the extension period';
  })();

  // Step 2
  const [ownerName, setOwnerName] = useState('');
  const [ownerCountry, setOwnerCountry] = useState('');
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCitizenship, setOwnerCountryCitizenship] = useState('');
  const [ownerSSN, setOwnerSSN] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerRefNumber, setOwnerRefNumber] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});
  const [ownerBizActivity, setOwnerBizActivity] = useState('');
  const [ownerBizCode, setOwnerBizCode] = useState('');
  // Signing title (goes on the 1120 signature block + RCL). Defaults to
  // "Managing Member", the usual role for a single-member LLC owner.
  const [signerTitle, setSignerTitle] = useState('Managing Member');
  // Date the owner signs, printed on the Form 1120 "Date" line (all years) so
  // the package prints ready to mail. ISO YYYY-MM-DD.
  // Today, in the FILER'S timezone, changeable. `todayISO` is deliberate here:
  // toISOString would give the UTC date, which is yesterday for anyone west of
  // Greenwich for part of their day, and this date is the one printed as the
  // date of signature. A saved date always wins over it.
  const [signatureDate, setSignatureDate] = useState(todayISO());

  // Step 3
  const [relatedParties, setRelatedParties] = useState<RelatedParty[]>([]);
  const [rpDraft, setRpDraft] = useState<RelatedParty>({
    name: '',
    ref_number: '',
    country: '',
    country_residence: '',
    us_tin: '',
    foreign_tax_id: '',
    address: {},
    biz_activity: '',
    biz_code: '',
  });
  const [showRpForm, setShowRpForm] = useState(false);
  const [editingRpIdx, setEditingRpIdx] = useState<number | null>(null);
  // When editing an existing transaction from the list, this holds its index so
  // the left-hand form saves back into that row instead of appending a new one.
  const [editingTxIdx, setEditingTxIdx] = useState<number | null>(null);

  // Step 4
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [noTransactionsConfirmed, setNoTransactionsConfirmed] = useState(false);
  // Owner managerial-services Part VI disclosure. Pre-selected (true): the owner
  // of a foreign-owned DE provides managerial services with no determinable FMV.
  // If the owner deselects it, the Part VI box is not ticked and no statement is
  // generated (unless an actual non-monetary transaction exists).
  const [partViManagerial, setPartViManagerial] = useState(true);
  // True once we auto-fill entity/owner data from the saved profile, so we can
  // show a "we pre-filled this, please review" banner on a returning user.
  const [prefilledFromProfile, setPrefilledFromProfile] = useState(false);
  // Saved companies offered at the top of a brand-new filing, and whether the
  // chooser is still up. Nothing is written into the form until one is picked
  // or the filer chooses to start blank.
  const [savedCompanies, setSavedCompanies] = useState<FilingProfile[]>([]);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  // FALSE, so the checkbox is the opt-in `importCompany` says it is. Defaulted
  // true, it copied last year's related parties into a new year silently, and
  // the section then ticked itself before the filer had seen who was on it.
  // Bringing a party across is one click; noticing an obsolete one that arrived
  // under a tick is not.
  const [importRelatedParties, setImportRelatedParties] = useState(false);
  // Set when this filing is part of a multi-year catch-up job; drives "next
  // year" routing after each year's intake is submitted.
  const [jobId, setJobId] = useState<string | null>(null);
  // Sibling year filings in the same catch-up job, drives the year tab strip,
  // the submit button's label and where submitting this year goes next.
  //
  // `hasNextDraftYear` used to be tracked separately and answered a different
  // question from the one the label asked: it was true whenever ANY other year
  // was still `draft`, which is every year of an unpaid job including the ones
  // already filled in. Derived from this one list now, through nextOpenYear, so
  // the label and the navigation cannot disagree.
  const [jobYears, setJobYears] = useState<JobYear[]>([]);
  // Once a filing has been completed at least once (submitted / paid), every
  // step is freely navigable, from step 1 the user can jump straight to step 5.
  const [completedOnce, setCompletedOnce] = useState(false);
  // Has the filer passed through Related Parties? An empty list is valid, so
  // this is the only way to tell "nothing to add" apart from "not looked at
  // yet". Seeded true for a filing already saved past step 3, so reopening a
  // finished filing does not show that section as unreviewed.
  const [relatedPartiesReviewed, setRelatedPartiesReviewed] = useState(false);
  // Same idea as relatedPartiesReviewed, for the owner section. A returning
  // filer has their owner details prefilled from their saved profile, which
  // makes the section VALID the instant the page loads and used to tick it
  // before the filer had looked at it once. A tick is a claim that the filer
  // has checked something; prefilled data is a claim that WE have. Sticky, so
  // scrolling back up does not un-tick it.
  const [ownerReviewed, setOwnerReviewed] = useState(false);
  // Furthest step this filing has been saved at, mirroring filings.current_step
  // so progress survives a reload. It only ever moves forward: editing step 1
  // on a filing that reached review does not un-progress it.
  const [furthestStep, setFurthestStep] = useState(1);
  // Payment-integrity state: a paid filing locks only the identity fields that
  // define what was purchased. Genuine corrections remain unlimited.
  const [isPaidLocked, setIsPaidLocked] = useState(false);
  /**
   * The pages have gone to the IRS, so nothing here may change any more.
   *
   * Payment freezes IDENTITY and leaves corrections open, which is right while
   * the filer still holds the package: they have bought a filing for one
   * company and one year, but the numbers on it are theirs to fix. A fax ends
   * that. Once a transmission exists, the document the IRS holds and the
   * document this page would regenerate can no longer be the same one, and a
   * filer editing a transaction after the fact quietly produces a second,
   * different return that was never sent. Editing is refused outright rather
   * than merged, because there is nothing to merge into.
   *
   * A FAILED transmission does not lock. Nothing was received, the row itself
   * allows re-dispatch, and the correction the filer needs to make may be the
   * reason it failed.
   *
   * The SIGNATURE stays open, which is the one deliberate exception: it is
   * drawn on the filing page after payment, does not run through this page's
   * write path, and a filer re-signing does not change what was transmitted.
   */
  const [isFaxLocked, setIsFaxLocked] = useState(false);
  // Pre-payment draft preview. The rendered docs are held here rather than in
  // the modal so closing it throws the raster away: these are the filer's own
  // forms and there is no reason to keep them in memory afterwards.
  const [draftDocs, setDraftDocs] = useState<DraftDoc[] | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [paidRelatedPartyCount, setPaidRelatedPartyCount] = useState(0);
  // What the filer is actually charged for: a related party only produces a
  // Form 5472 in a year where it has a transaction, so a party added with
  // nothing to report costs nothing and must not be announced as owing $25.
  const billableRelatedPartyCount = billablePartyCount(
    relatedParties.length,
    transactions.map((t) => t.related_party_index),
  );

  // Foreign tax ID guidance, driven by the country of TAX RESIDENCE (not
  // citizenship). Cheap enough to recompute each render; no memo needed.
  const ownerTaxIdInfo = taxIdInfoFor(ownerCountryRes);
  const ownerTaxIdWarning = taxIdWarning(ownerCountryRes, ownerForeignTaxId);
  // A related party, unlike the owner, may be a company: the eligibility gate
  // admits only non-U.S. INDIVIDUALS as owners, but it says nothing about who
  // the LLC transacted with. So the country's PERSONAL number cannot be used
  // as this field's label. A Swedish aktiebolag was being asked for its
  // "Personnummer", which is a personal identity number no company has; its
  // number is an organisationsnummer. The label is therefore neutral, and the
  // country's personal number is named in the tooltip, where it reads as the
  // help it is rather than as an assertion about this party.
  const rpTaxIdInfo = taxIdInfoFor(rpDraft.country_residence);
  const rpTaxIdTooltip = (() => {
    const base =
      'The tax identification number their country of residence issues them. For a company that is ' +
      'its company or business tax registration number.';
    const personal =
      rpDraft.country_residence && rpTaxIdInfo !== GENERIC_TAX_ID && rpTaxIdInfo.issues !== false
        ? ` If they are an individual resident in ${rpDraft.country_residence}, that is their ${rpTaxIdInfo.label}.`
        : '';
    return `${base}${personal} Do not write "None": the box cannot be left without an identifier.`;
  })();
  const [txRelatedPartyIdx, setTxRelatedPartyIdx] = useState(0);
  // The form now KEEPS the chosen party between adds (see clearTxForm), so the
  // index has to survive the party list changing under it. Deleting the related
  // party you were entering rows for would otherwise leave the form pointing at
  // a party that no longer exists, and the next add would be written against
  // whatever index that is. Fall back to the owner, who always exists at 0.
  useEffect(() => {
    if (txRelatedPartyIdx > relatedParties.length) setTxRelatedPartyIdx(0);
  }, [relatedParties.length, txRelatedPartyIdx]);
  const [txType, setTxType] = useState('');
  const [txDir, setTxDir] = useState<'paid' | 'received'>('received');
  const [txAmt, setTxAmt] = useState('');
  const [txLoanBegin, setTxLoanBegin] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState('');
  const [cat3Acknowledged, setCat3Acknowledged] = useState(false);
  // Two-tier transaction entry: the detailed category accordion is hidden until
  // the user asks for it (the quick list covers the common ~90%).
  const [showDetailedTx, setShowDetailedTx] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  // Free-text search for the "What happened?" combo box, filters across ALL
  // transaction types by label/plain-English sentence.
  const [txSearch, setTxSearch] = useState('');

  const allPartyLabels = [
    ownerName || 'Primary owner',
    ...relatedParties.map((rp, i) => rp.name || `Related party ${i + 1}`),
  ];

  const selectedTxMeta = TX_TYPES.find((t) => t.value === txType);

  /**
   * The display number for a section, taken from its position in `stepOrder`.
   *
   * The page title and the accordion headers used to number independently, so
   * with step 1b present the title read "3. Owner Details" while that very
   * section's header read "2. Owner Details", and 1b was numbered in one place
   * but not the other. Both now derive from the same array, so the numbering
   * holds together, and it shifts correctly for an on-time filer, who has no
   * step 1b at all.
   */
  const stepNumber = (key: IntakeStep): string => {
    const i = stepOrder.indexOf(key);
    return i >= 0 ? `${i + 1}. ` : '';
  };
  // Index 0 is always the filer, so a transaction against it is owner-to-DE.
  const scrollToTransactionDetails = () => {
    requestAnimationFrame(() => {
      transactionDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const scrollToTransactionsTop = () => {
    requestAnimationFrame(() => {
      transactionsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const txCategory = getCategoryForTxType(txType, txRelatedPartyIdx === 0);
  const txMeta = TX_TYPES.find((t) => t.value === txType);
  // Live money summary (reconciles with the generator's 1f/1h gross).
  const txSummary = summarizeTransactions(transactions);

  useEffect(() => {
    if (step === '1b' && !show1b) setStep(1);
  }, [show1b, step]);

  // Continue/Back: land at the TOP of the new step, not wherever the previous
  // step was scrolled to. Intake changes steps via a query param (?step=N), so
  // the router's pathname-based ScrollToTop does not fire here, we do it.
  useEffect(() => {
    if (loadingFiling) return;
    // Let the new step render before scrolling to it.
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      stepTopRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }, [step, loadingFiling]);

  // The "have you already filed for earlier years?" prompt appears when the
  // incorporation date turns out to precede the tax year being filed. It is
  // rendered further down step 1, so typing a 2019 date into the date field
  // could open a question the filer never saw, leaving them looking at a form
  // that seemingly did nothing. Scroll to it the first time it appears.
  //
  // Only on APPEARANCE, and never on load: a saved filing that already has an
  // early incorporation date renders the prompt on mount, and hijacking the
  // scroll position of a page someone has just reopened is its own annoyance.
  const earlierYearsRef = useRef<HTMLDivElement | null>(null);
  const earlierYearsSeen = useRef(false);
  const earlierYearsShown =
    !jobId && !isPaidLocked && !!entityDOI && !!taxYear &&
    Number(entityDOI.slice(0, 4)) < Number(taxYear) &&
    Number(taxYear) === new Date().getUTCFullYear() - 1;
  const earlierYearsHydrated = useRef(false);
  useEffect(() => {
    if (loadingFiling) return;
    // First settle after the filing loads: record whether the prompt is
    // already on screen, and scroll for neither case.
    if (!earlierYearsHydrated.current) {
      earlierYearsHydrated.current = true;
      earlierYearsSeen.current = earlierYearsShown;
      return;
    }
    if (!earlierYearsShown) { earlierYearsSeen.current = false; return; }
    if (earlierYearsSeen.current) return;
    earlierYearsSeen.current = true;
    requestAnimationFrame(() => {
      earlierYearsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [earlierYearsShown, loadingFiling]);

  /**
   * Take the filer from an error message to the field it is about.
   *
   * The summary scroll below gets them to the LIST; this gets them to the
   * field, which is the part that was missing. Three things make it more than
   * a `scrollIntoView`:
   *
   * - **The section is opened first.** An error can name a field inside a
   *   collapsed accordion section, and on the review step every section is
   *   collapsed, so without this the jump would find nothing on the most
   *   common path. `setOpenSections` is used directly rather than
   *   `toggleSection`, whose gate exists to stop a filer opening a LATER
   *   section early; every target here is at or behind where they already are.
   * - **The lookup retries.** The section's body mounts on the next render, so
   *   the element does not exist in the frame the click happened in.
   * - **It fails silently and visibly.** If the field is genuinely not on
   *   screen (a conditional block the filer has since turned off), nothing
   *   moves and the message stays readable where it is, which is no worse than
   *   before this existed.
   */
  const jumpToField = (section: string, field: string) => {
    setOpenSections((prev) => (prev.has(section) ? prev : new Set(prev).add(section)));
    let tries = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-anchor="${field}"]`);
      if (!el) {
        tries += 1;
        if (tries < 12) requestAnimationFrame(find);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // The ring is on the wrapper, the focus is on the control: a filer who
      // clicked the message is looking at the label as much as the input, and
      // focusing without marking the surround leaves a cursor in a box that
      // looks like every other box on the page.
      el.classList.add('tf-field-target');
      window.setTimeout(() => el.classList.remove('tf-field-target'), 2200);
      // preventScroll, or the browser's own focus scroll fights the smooth one
      // above and lands the field under the sticky header.
      focusTarget(el)?.focus({ preventScroll: true });
    };
    requestAnimationFrame(find);
  };

  // When validation fails, jump straight to the error summary so the user sees
  // exactly what needs fixing instead of a form that silently did not advance.
  useEffect(() => {
    if (stepErrors.length === 0 && !error && !einErr) return;
    requestAnimationFrame(() => {
      errorSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [stepErrors, error, einErr]);

  // When the filing turns out to be late (deadline passed, for a 7004 filer,
  // the EXTENDED deadline), OFFER the reasonable-cause letter. It is never
  // pre-selected: it used to default ON, which turned a $99 order into a $298
  // one with no interaction on the checkbox, and then blocked the step until a
  // reason was picked. The $9 fax add-on is the pattern to follow, it is
  // offered unticked. If the extension is still valid, ensure it is off.
  const rclSectionShown = !jobId && isLateForRcl;
  useEffect(() => {
    if (!rclSectionShown && includeReasonableCause) {
      setIncludeReasonableCause(false);
      setReasonableCauseReasons([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rclSectionShown]);

  useEffect(() => {
    const newParams = new URLSearchParams(params.toString());
    newParams.set('step', String(step));
    if (filingId) newParams.set('filing_id', filingId);
    navigate(`?${newParams.toString()}`, { replace: true });
  }, [step, filingId, navigate, params]);

  useEffect(() => {
    if (!filingId) { setLoadingFiling(false); return; }
    setLoadingFiling(true);
    (async () => {
      const { data: f, error: err } = await supabase.from('filings').select('*').eq('id', filingId).single();
      if (err || !f) { setLoadingFiling(false); return; }

      // Payment integrity: once paid, a filing's IDENTITY (EIN, LLC name, tax
      // year, owner identity, incorporation date) is permanently frozen so one
      // payment can't be re-skinned into a different company's forms. Genuine
      // corrections to other fields (addresses, transactions) are still allowed,
      // while all genuine corrections remain unlimited. Surface the identity
      // lock in the UI rather than blocking the whole filing.
      setIsPaidLocked(f.status === 'paid' || f.status === 'completed');
      // A dispatched fax locks this filing harder than payment does. Read after
      // the row rather than beside it, because the dispatch key is job-scoped
      // when the filing belongs to a catch-up: one transmission covers every
      // year in the job, so every year in it locks together. Best-effort, and
      // deliberately so: loadFaxTransmission returns null on error, and a lock
      // that fails open leaves a filer editing a sent filing, which is why the
      // write path checks the flag rather than assuming this ran.
      const tx = await loadFaxTransmission({ id: f.id as string, job_id: (f as any).job_id ?? null });
      if (tx && tx.status !== 'failed') {
        setIsFaxLocked(true);
        // Everything the paid lock disables, a sent filing disables too, so the
        // fields inherit it instead of every `disabled` prop growing a second
        // condition. The banner below tells the two apart.
        setIsPaidLocked(true);
      }
      setPaidRelatedPartyCount(Number((f as any).paid_related_party_count ?? 0));
      // A filing that has moved past 'draft' has been through every step once,
      // so allow free step navigation on return visits.
      setCompletedOnce(f.status === 'in_progress' || f.status === 'paid' || f.status === 'completed');
      // Anything saved past step 3, or any filing that has already been through
      // the whole wizard, has had Related Parties in front of the filer.
      const savedStep = Number((f as any).current_step ?? 1) || 1;
      setFurthestStep(savedStep);
      setRelatedPartiesReviewed(f.status !== 'draft' || savedStep > 3);
      setOwnerReviewed(f.status !== 'draft' || savedStep > 2);

      setLlcName(f.llc_name ?? '');
      setEin(f.ein ?? '');
      setStateOfFormation(f.state_of_formation ?? '');
      setTaxYear(String(f.tax_year ?? '2024'));
      setTotalAssets(String((f as any).total_assets ?? ''));
      setEntityDOI((f as any).entity_date_of_incorporation ?? (f as any).date_of_incorporation ?? '');
      // `||`, not `??`. A filing saved before this field existed holds '' as
      // readily as null, and both mean "never answered", which takes the default.
      setEntityPrincipalCountry((f as any).entity_principal_country || 'United States');
      setMailing((f.mailing_address as Address) ?? { country: 'US' });
      setEntityBizActivity((f as any).entity_business_activity ?? (f as any).naics_description ?? '');
      setEntityBizCode((f as any).entity_business_code ?? '');
      setSupportsEarlierReturns(Object.prototype.hasOwnProperty.call(f, 'earlier_returns_filed'));
      setEarlierReturnsFiled((f as any).earlier_returns_filed ?? null);
      setExtensionFiled((f as any).extension_filed ?? null);
      // Read BOTH columns. include_reasonable_cause is what intake writes;
      // include_rcl is what the multi-year setup writes when a catch-up job is
      // created, and it is the column the generator reads. Reading only the
      // first meant a job created WITH the letter opened here with the box
      // unticked, and the next save wrote that back over the filer's choice.
      setIncludeReasonableCause(
        ((f as any).include_reasonable_cause ?? (f as any).include_rcl) === true,
      );
      setReasonableCauseReasons((f as any).reasonable_cause_reasons ?? []);
      setIncludeIrsFax((f as any).include_irs_fax === true);
      setOwnerName(f.owner_full_name ?? '');
      setOwnerCountry((f as any).owner_country ?? f.owner_primary_country ?? '');
      setOwnerCountryRes(f.owner_country_residence ?? '');
      setOwnerCountryCitizenship(f.owner_country_citizenship ?? '');
      setOwnerSSN((f as any).owner_ssn ?? f.owner_us_tin ?? '');
      setOwnerForeignTaxId(f.owner_foreign_tax_id ?? '');
      setOwnerRefNumber((f as any).owner_ref_number ?? '');
      setOwnerAddress((f.owner_address as Address) ?? {});
      // Backfill a blank activity from a recognised code so the dropdown shows
      // the preset AND the "type of business" validation can still be satisfied.
      const loadedBizCode = (f as any).owner_business_code ?? '';
      const loadedBizPreset = resolveBizPreset(f.owner_business_activity, loadedBizCode);
      setOwnerBizActivity(f.owner_business_activity?.trim() || loadedBizPreset?.label || '');
      setOwnerBizCode(loadedBizCode);
      setSignerTitle((f as any).signer_title ?? 'Managing Member');
      setSignatureDate((f as any).signature_date || todayISO());
      if ((f as any).related_parties) setRelatedParties((f as any).related_parties as RelatedParty[]);
      setNoTransactionsConfirmed((f as any).no_transactions_confirmed ?? false);
      setPartViManagerial((f as any).part_vi_managerial ?? true);
      setJobId((f as any).job_id ?? null);
      // Every year of this job, sorted ascending. Drives the tab strip, the
      // submit label and the next-year routing, all from this one list.
      const thisJobId = (f as any).job_id ?? null;
      if (thisJobId) {
        const { data: sibs } = await supabase
          .from('filings')
          .select('id, tax_year, status, current_step, related_parties')
          .eq('job_id', thisJobId);
        const sibRows = sibs ?? [];
        // Billable parties for EVERY year of the job, not just the open one.
        // The review screen prices the whole catch-up, and a party is charged
        // per year it actually produces a Form 5472 in, so a total built from
        // this year's parties alone would be wrong for any job whose years
        // differ. One query for every sibling's transactions rather than one
        // per year: the party index is all that is needed to price them.
        const sibIds = sibRows.map((s: any) => s.id as string);
        const { data: sibTxns } = sibIds.length
          ? await supabase
              .from('reportable_transactions')
              .select('filing_id, related_party_index')
              .in('filing_id', sibIds)
          : { data: [] as any[] };
        const txnsByFiling = new Map<string, (number | null)[]>();
        for (const t of (sibTxns ?? []) as any[]) {
          const key = t.filing_id as string;
          if (!txnsByFiling.has(key)) txnsByFiling.set(key, []);
          txnsByFiling.get(key)!.push(t.related_party_index ?? null);
        }
        setJobYears(
          sibRows
            .map((s: any) => ({
              id: s.id as string,
              tax_year: String(s.tax_year),
              status: s.status as string,
              current_step: Number(s.current_step ?? 1) || 1,
              billable_parties: billablePartyCount(
                Array.isArray(s.related_parties) ? s.related_parties.length : 0,
                txnsByFiling.get(s.id as string) ?? [],
              ),
            }))
            .sort((a, b) => Number(a.tax_year) - Number(b.tax_year)),
        );
      } else {
        setJobYears([]);
      }
      setFinalReturn((f as any).final_return ?? false);
      setDateOfClosure((f as any).date_of_closure ?? '');
      setNameChange((f as any).name_change ?? false);
      setAddressChange((f as any).address_change ?? false);
      setEligibilityConfirmed((f as any).eligibility_confirmed ?? false);
      setHasUsActivity((f as any).has_us_activity ?? null);
      setIsFiscalYear((f as any).is_fiscal_year ?? false);
      const storedEnd = (f as any).tax_period_end as string | null | undefined;
      setFiscalEndMonth(storedEnd ? Number(storedEnd.split('-')[1]) : '');

      const { data: txns } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId)
        .order('created_at', { ascending: true });

      if (txns) {
        setTransactions(txns.map((t: any) => ({
          id: t.id,
          related_party_index: t.related_party_index ?? 0,
          // The row stores the CANONICAL code, which intake has no card for.
          // Loading it raw is what printed "rent_royalty" in the list and left
          // the type cards showing nothing selected on an Edit. Resolve back to
          // the intake vocabulary: the exact saved code when the row has one,
          // otherwise derived from the canonical code plus direction.
          transaction_type: resolveUiTxType(t),
          direction: t.direction,
          amount_usd: String(t.amount_usd ?? ''),
          loan_begin_usd: String(t.loan_begin_usd ?? ''),
          description: t.description ?? '',
          transaction_date: t.transaction_date ?? '',
        })));
      }

      // Backfill entity/owner identity from the saved profile for any field the
      // filing row itself left empty. This matters for multi-year jobs, where a
      // per-year row may have been seeded before the profile existed, e.g. the
      // owner's country should carry across every year, not be re-selected each
      // time. Only empty fields are filled; nothing the row already has is touched.
      //
      // Keyed on THIS FILING'S EIN, not on the user. The old per-user profile
      // meant a filing for the second LLC was backfilled from the first one,
      // quietly replacing blank fields with another company's answers. A row
      // with no EIN yet is left alone: there is no way to tell which company it
      // belongs to, and guessing is the failure this replaced.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const profile = user ? await loadCompany(user.id, f.ein) : null;
        if (profile) {
          const bf = (val: string | null | undefined) => (setter: (u: (c: string) => string) => void) => {
            if (val) setter((c) => (c && c.trim() ? c : (val ?? '')));
          };
          bf(profile.owner_country ?? profile.owner_primary_country)(setOwnerCountry);
          bf(profile.owner_country_residence)(setOwnerCountryRes);
          bf(profile.owner_country_citizenship)(setOwnerCountryCitizenship);
          bf(profile.owner_full_name)(setOwnerName);
          bf(profile.llc_name)(setLlcName);
          bf(profile.state_of_formation)(setStateOfFormation);
          // The entity's own identity carries across years exactly like the
          // owner's does. These were missing, so a returning filer re-typed
          // their EIN, incorporation date and business type on every filing:
          // the profile prefill above (for filings with no id yet) covered
          // them, but intake creates the row first and then loads it, so in
          // practice this backfill is the path every filing takes.
          bf(profile.date_of_incorporation)(setEntityDOI);
          bf(profile.entity_business_activity ?? profile.naics_description)(setEntityBizActivity);
          bf(profile.entity_business_code ?? profile.naics_code)(setEntityBizCode);
          bf(profile.entity_principal_country)(setEntityPrincipalCountry);
        }
      } catch { /* profile backfill is best-effort */ }

      // Honor the step requested in the URL for this filing. When the multi-year
      // walk sends the user to the next year at ?step=3, the component does not
      // remount (same route, new query), so sync the step here after load.
      const requested = stepFromParam(params.get('step'));
      if (requested !== null) setStep(requested);

      setLoadingFiling(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filingId]);

  // Offer the user's saved companies on a BRAND-NEW filing (no filing_id).
  //
  // This used to load the single per-user profile and fill the form in
  // immediately, announcing it afterwards with a banner. A filer with a second
  // LLC therefore got their FIRST company's name and EIN written into the new
  // filing without being asked, and `filings_freeze_when_paid` locks both the
  // moment they pay. Nothing is filled now until the filer picks a company.
  // GATED ON THE FILING BEING BLANK, not on there being no filing row.
  //
  // It used to return early whenever `filing_id` was present, which meant the
  // picker never appeared for anyone: the Dashboard's "Start filing" INSERTS
  // the row first and then navigates to /intake?filing_id=..., so every real
  // filer arrived with an id and a blank form and was never offered their own
  // saved companies. Only typing /intake by hand reached it, which is why it
  // looked fine when tested that way.
  //
  // What has to be protected is a filing that already HAS company details, not
  // a row that merely exists. A draft created two seconds ago has nothing worth
  // protecting, and re-keying an EIN that is already saved is the exact error
  // this feature exists to prevent, since payment freezes it.
  const filingIsBlank = !llcName.trim() && !ein.trim();
  useEffect(() => {
    if (loadingFiling) return;      // wait for an existing filing to hydrate
    if (!filingIsBlank) return;     // it has details of its own; leave them alone
    if (prefilledFromProfile) return; // already answered
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const saved = await listCompanies(user.id);
      if (cancelled || saved.length === 0) return;
      setSavedCompanies(saved);
      setShowCompanyPicker(true);
    })();
    return () => { cancelled = true; };
  // Deliberately not re-running on every keystroke: `filingIsBlank` flips false
  // on the first character typed and the picker is dismissed by then anyway.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingFiling]);

  // ── Already filed: one company, one tax year, once ────────────────────────
  //
  // The dashboard was showing the same company and year twice, both Downloaded
  // and Faxed, with nothing saying whether the second was an amendment. Nothing
  // stopped a filer paying twice for the same return.
  //
  // The bar is PAYMENT, not the existence of a draft. Drafts are how people
  // work: someone abandons one, starts again, and must not be locked out of
  // their own year by their own half-finished attempt. A filing with `paid_at`
  // set is a return we have delivered, and that year is done.
  //
  // This only applies to filings the SAME user paid for. It is not a claim
  // about what was filed elsewhere; we never know that. Amendments, when they
  // are built, will need their own route past this, see §7 of the handoff.
  const [paidYearsByEin, setPaidYearsByEin] = useState<Record<string, number[]>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const { data } = await supabase
        .from('filings')
        .select('id, ein, tax_year, paid_at')
        .eq('user_id', user.id)
        .not('paid_at', 'is', null);
      if (cancelled || !data) return;
      const map: Record<string, number[]> = {};
      for (const row of data as { id: string; ein: string | null; tax_year: string | number | null }[]) {
        // The filing being edited never blocks itself.
        if (filingId && row.id === filingId) continue;
        const key = normalizeEin(row.ein ?? '');
        const year = Number(row.tax_year);
        if (!key || !year) continue;
        (map[key] ??= []).push(year);
      }
      setPaidYearsByEin(map);
    })();
    return () => { cancelled = true; };
  }, [filingId]);

  /** Years already paid for THIS EIN. Empty until an EIN has been typed. */
  const paidYearsForThisEin = paidYearsByEin[normalizeEin(ein) ?? ''] ?? [];
  const yearAlreadyFiled = (y: number | string) => paidYearsForThisEin.includes(Number(y));

  /** Copy a chosen saved company into the form. Empty fields only. */
  const importCompany = (profile: FilingProfile, withRelatedParties: boolean) => {
    {
      const fill = (cur: string, val?: string | null) => (cur ? cur : (val ?? ''));
      setEin((c) => fill(c, formatEinDigits(profile.ein)));
      setLlcName((c) => fill(c, profile.llc_name));
      setStateOfFormation((c) => fill(c, profile.state_of_formation));
      setEntityDOI((c) => fill(c, profile.date_of_incorporation));
      setEntityBizActivity((c) => fill(c, profile.entity_business_activity ?? profile.naics_description));
      setEntityBizCode((c) => fill(c, profile.entity_business_code ?? profile.naics_code));
      setEntityPrincipalCountry((c) => fill(c, profile.entity_principal_country));
      setMailing((c) => (c && c.line1 ? c : ((profile.mailing_address as Address) ?? { country: 'US' })));

      setOwnerName((c) => fill(c, profile.owner_full_name));
      setOwnerCountry((c) => fill(c, profile.owner_country ?? profile.owner_primary_country));
      setOwnerCountryRes((c) => fill(c, profile.owner_country_residence));
      setOwnerCountryCitizenship((c) => fill(c, profile.owner_country_citizenship));
      setOwnerForeignTaxId((c) => fill(c, profile.owner_foreign_tax_id));
      setOwnerSSN((c) => fill(c, profile.owner_us_tin));
      setOwnerRefNumber((c) => fill(c, profile.owner_reference_id ?? profile.owner_ref_number));
      setOwnerBizActivity((c) => fill(c, profile.owner_business_activity));
      setOwnerBizCode((c) => fill(c, profile.owner_business_code ?? profile.owner_naics_code));
      setSignerTitle((c) => (c && c !== 'Managing Member' ? c : (profile.signer_title || 'Managing Member')));
      setOwnerAddress((c) => (c && c.line1 ? c : ((profile.owner_address as Address) ?? {})));
      // Related parties are opt-in. They go stale between years far more often
      // than an address does, and a stale related party is a wrong Form 5472
      // for a taxpayer who may no longer be related at all.
      if (withRelatedParties && profile.related_parties && Array.isArray(profile.related_parties)) {
        setRelatedParties((c) => (c.length ? c : (profile.related_parties as RelatedParty[])));
      }
      setPrefilledFromProfile(true);
    }
    setShowCompanyPicker(false);
  };

  // Auto-generate the owner reference code whenever we have an owner name but no
  // reference code yet, covers the case where the name was prefilled from the
  // database/profile (not typed), so the user never triggered the onChange path.
  useEffect(() => {
    if (ownerName.trim() && !ownerRefNumber.trim()) {
      setOwnerRefNumber(buildOwnerRef(ownerName));
    }
  }, [ownerName, ownerRefNumber]);

  // Fields that are SPECIFIC to a single tax year and must never be copied to
  // sibling year-rows in a multi-year job. Everything else in a Step-1/2 patch
  // is company/owner identity that is shared across every year.
  const YEAR_SPECIFIC_FIELDS = new Set<string>([
    'tax_year', 'total_assets', 'initial_return', 'final_return', 'date_of_closure',
    // Item E boxes 3 and 4. Year-specific because in a multi-year job the flag
    // belongs on ONE year, the earliest, not carried across all of them.
    'name_change', 'address_change',
    'is_fiscal_year', 'tax_period_begin', 'tax_period_end',
    'extension_filed', 'include_rcl', 'include_reasonable_cause',
    'reasonable_cause_reasons',
    // Attested per tax year: circumstances change between years, which is the
    // whole reason the question is asked again rather than carried forward.
    'eligibility_confirmed', 'has_us_activity',
  ]);

  /** Strip year-specific fields so only shared company/owner data propagates. */
  function sharedJobPatch(
    patch: Partial<Filing> & Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(patch).filter(([k]) => !YEAR_SPECIFIC_FIELDS.has(k)),
    );
  }

  // The whole-form patch, the union of every step's fields. In the accordion
  // model all field state is in memory at once, so we persist everything on
  // section-collapse and at submit instead of one step at a time.
  function patchAll(): Partial<Filing> & Record<string, unknown> {
    const rclApplies = includeReasonableCause && isLateForRcl;
    return {
      // Step 1, LLC
      llc_name: llcName.trim() || null,
      ein: ein.trim() || null,
      state_of_formation: stateOfFormation.trim() || null,
      tax_year: taxYear,
      // The two step-1 attestations. patchAll omitted them, and since every
      // "Save & continue" in the accordion saves through here, both columns
      // were null on every filing ever written, including submitted ones that
      // generated PDFs. Saving them means a filer who resumes THIS year's draft
      // is not asked to confirm again.
      //
      // They are listed in YEAR_SPECIFIC_FIELDS, which is what keeps them off
      // the other years of a multi-year job: a new year must be attested on its
      // own facts and must never inherit last year's answer.
      eligibility_confirmed: eligibilityConfirmed,
      has_us_activity: hasUsActivity,
      total_assets: totalAssets ? Number(totalAssets) : null,
      entity_date_of_incorporation: entityDOI.trim() || null,
      entity_principal_country: entityPrincipalCountry.trim() || null,
      mailing_address: mailing,
      entity_business_activity: entityBizActivity.trim() || null,
      entity_business_code: entityBizCode.trim() || null,
      date_of_incorporation: entityDOI.trim() || null,
      naics_code: entityBizCode.trim() || null,
      naics_description: entityBizActivity.trim() || null,
      initial_return: isInitialReturn(entityDOI, taxYear, isFiscalYear ? fiscalEndMonth : ''),
      final_return: finalReturn,
      date_of_closure: finalReturn ? (dateOfClosure.trim() || null) : null,
      name_change: nameChange,
      address_change: addressChange,
      is_fiscal_year: isFiscalYear,
      tax_period_begin: isFiscalYear && fiscalEndMonth ? deriveFiscalPeriod(taxYear, fiscalEndMonth).begin : null,
      tax_period_end: isFiscalYear && fiscalEndMonth ? deriveFiscalPeriod(taxYear, fiscalEndMonth).end : null,
      // The filer's own statement about years we did not file for them. Sent
      // only once the column is known to exist; see supportsEarlierReturns.
      ...(supportsEarlierReturns ? { earlier_returns_filed: earlierReturnsFiled } : {}),
      // Step 1b, filing status
      extension_filed: extensionFiled,
      include_reasonable_cause: rclApplies,
      reasonable_cause_reasons: rclApplies ? reasonableCauseReasons : [],
      include_rcl: rclApplies,
      // Step 5, delivery. Read by create-checkout-session and re-derived by
      // verify-payment, so this one boolean is what the filer is charged for.
      include_irs_fax: includeIrsFax,
      // Step 2, owner
      owner_full_name: ownerName.trim() || null,
      owner_country: ownerCountry.trim() || null,
      owner_country_residence: ownerCountryRes.trim() || null,
      owner_ssn: ownerSSN.trim() || null,
      owner_foreign_tax_id: ownerForeignTaxId.trim() || null,
      owner_ref_number: ownerRefNumber.trim() || null,
      owner_address: ownerAddress,
      owner_business_activity: ownerBizActivity.trim() || null,
      owner_business_code: ownerBizCode.trim() || null,
      owner_primary_country: ownerCountry.trim() || null,
      owner_country_citizenship: ownerCountryCitizenship.trim() || null,
      owner_us_tin: ownerSSN.trim() || null,
      owner_reference_id: ownerRefNumber.trim() || null,
      owner_naics_code: ownerBizCode.trim() || null,
      signer_title: signerTitle.trim() || null,
      signature_date: signatureDate || null,
      // Step 3, related parties
      related_parties: relatedParties,
      // Step 4, transactions meta
      no_transactions_confirmed: noTransactionsConfirmed,
      part_vi_managerial: partViManagerial,
    };
  }

  // Validation status of one accordion section, used for the progress dot.
  function sectionProgress(s: IntakeStep): 'complete' | 'incomplete' {
    let errs: StepError[] = [];
    if (s === 1) errs = validateStep1();
    else if (s === '1b') errs = validateStep1b();
    else if (s === 2) {
      errs = validateStep2();
      // Valid because we filled it in, not because the filer confirmed it.
      if (errs.length === 0 && prefilledFromProfile && !ownerReviewed) {
        errs = ['not reviewed'];
      }
    }
    else if (s === 3) {
      errs = showRpForm ? ['open'] : validateStep3();
      // An empty related-party list is valid because the foreign owner is
      // already the first related party on Form 5472. It is not, however,
      // evidence that the user has reviewed this optional section, so the dot
      // stays neutral until they continue past it.
      //
      // "Reviewed" is sticky, not a comparison against the current step. Keyed
      // on `step` it flipped back to incomplete every time the filer scrolled
      // up, and a finished filing reopened from the dashboard (which starts at
      // step 1) showed this section as incomplete.
      //
      // A list PREFILLED from the profile needs the same treatment, and used to
      // escape it because it is non-empty and therefore valid: the section
      // ticked itself the instant a saved company was picked, before the filer
      // had seen the party at all. Same rule as the owner section above, and for
      // the same reason: a tick claims the FILER has checked something. A
      // related party goes stale between years more often than an address does,
      // and a stale one is a wrong Form 5472 for a taxpayer who may no longer be
      // related at all, which is exactly what nobody looks at twice once it is
      // wearing a tick.
      if (errs.length === 0 && !relatedPartiesReviewed
          && (relatedParties.length === 0 || prefilledFromProfile)) {
        errs = ['not reviewed'];
      }
    }
    else if (s === 4) errs = validateStep4();
    return errs.length === 0 ? 'complete' : 'incomplete';
  }

  const handleEinBlur = () => {
    setEinErr(ein ? einProblem(ein) : null);
  };

  function validateStep1(): StepError[] {
    const errs: StepError[] = [];
    if (!eligibilityConfirmed) {
      errs.push(at('1', 'eligibility', 'Please confirm the statements about your LLC before continuing. If any of them is no longer true, this flow is not the right one for this year.'));
    }
    if (hasUsActivity === null) {
      errs.push(at('1', 'hasUsActivity', 'Please answer whether the LLC had U.S. real estate or work performed inside the U.S. this year.'));
    }
    if (!llcName.trim()) errs.push(at('1', 'llcName', 'Enter your LLC or corporation name.'));
    if (!ein.trim()) errs.push(at('1', 'ein', "Enter your LLC's EIN."));
    if (ein.trim()) { const p = einProblem(ein); if (p) errs.push(at('1', 'ein', p)); }
    if (!stateOfFormation) errs.push(at('1', 'stateOfFormation', 'Select the state where your LLC was formed.'));
    if (!taxYear) errs.push(at('1', 'taxYear', "Select the tax year you're filing for."));
    // Total assets is written straight onto the return, so a negative or a
    // non-number must be stopped here rather than printed. Blank is allowed:
    // patchAll already stores null for it.
    if (totalAssets.trim() !== '') {
      const a = amountProblem(totalAssets, 'Total assets');
      if (a) errs.push(at('1', 'totalAssets', a === 'Total assets cannot be negative.'
        ? 'Total assets cannot be negative. Enter 0 if the LLC held no assets at the end of the year.'
        : a));
    }
    // Ticking "fiscal year" without a month leaves the period undefined, and
    // deriveFiscalPeriod is what every date on the return is measured against.
    // Month 0 has to be tested separately from '': it is falsy, so a plain
    // truthiness check reads a real out-of-range value as "not set yet".
    if (isFiscalYear) {
      if (fiscalEndMonth === '') errs.push(at('1', 'fiscalEndMonth', 'Select the month your fiscal year ends, or untick "My tax year is not the calendar year".'));
      else if (!Number.isInteger(Number(fiscalEndMonth)) || Number(fiscalEndMonth) < 1 || Number(fiscalEndMonth) > 12) {
        errs.push(at('1', 'fiscalEndMonth', 'The fiscal year end month must be a month from January to December.'));
      }
    }
    // A year that has not finished cannot be filed. The dropdown only offers
    // TAX_YEARS, but a resumed draft or an imported value can hold anything.
    if (taxYear && !TAX_YEARS.includes(Number(taxYear))) {
      errs.push(at('1', 'taxYear', `${taxYear} is not a tax year you can file here. Choose one of ${TAX_YEARS[TAX_YEARS.length - 1]} to ${TAX_YEARS[0]}.`));
    }
    // The dropdown disables an already-paid year, but the EIN can be typed or
    // changed AFTER the year was chosen, so the pair is checked here too. This
    // is the check that actually holds.
    if (taxYear && yearAlreadyFiled(taxYear)) {
      errs.push(at('1', 'taxYear', `You have already filed and paid for ${taxYear} under EIN ${ein}. Choose a different tax year.`));
    }
    if (!entityDOI) errs.push(at('1', 'entityDOI', 'Enter the date your LLC was formed.'));
    if (entityDOI && taxYear) {
      const doiYear = Number(entityDOI.slice(0, 4));
      const ty = Number(taxYear);
      if (isFiscalYear && fiscalEndMonth && fiscalEndMonth !== 12) {
        // Fiscal filer: the period can run into the following calendar year, so
        // validate against the derived period end rather than the tax-year number.
        const { end } = deriveFiscalPeriod(taxYear, fiscalEndMonth);
        if (entityDOI > end) {
          errs.push(at('1', 'entityDOI', `The date your LLC was formed (${formatDateMMDDYYYY(entityDOI)}) is after the end of the ${ty} fiscal year (${formatDateMMDDYYYY(end)}). An LLC cannot be formed after the period it is filing for. Check the date, the tax year, or the fiscal year-end.`));
        } else if (doiYear < 1900) {
          errs.push(at('1', 'entityDOI', 'Check the date of incorporation. The year does not look right.'));
        }
      } else {
        // Calendar filer: the LLC must exist during the tax year.
        if (doiYear > ty) {
          errs.push(at('1', 'entityDOI', `The date your LLC was formed (${formatDateMMDDYYYY(entityDOI)}) is after the ${ty} tax year. An LLC cannot be formed after the year it is filing for. Check the date or the tax year.`));
        } else if (doiYear < 1900) {
          errs.push(at('1', 'entityDOI', 'Check the date of incorporation. The year does not look right.'));
        }
      }
    }
    // Dissolution date. It ENDS the tax period, so it has to fall inside the
    // period being filed: on or after the first day, on or before the last.
    // Only the input's `max` used to guard this, which nothing read on submit
    // and which was wrong for a fiscal filer anyway, for a March year-end the
    // 2025 period runs to 31 Mar 2026, so a real February 2026 dissolution was
    // refused while a January 2025 one, months before the period opened, was
    // accepted. A date outside the period means the wrong tax year is being
    // filed, and it would print a period the IRS cannot reconcile.
    if (finalReturn) {
      if (!dateOfClosure) {
        errs.push(at('1', 'dateOfClosure', 'Enter the date the LLC was dissolved, or untick "This is my LLC\'s final return".'));
      } else {
        const { begin, end } = taxPeriodWindow(taxYear, isFiscalYear, fiscalEndMonth);
        const periodLabel = `${formatDateMMDDYYYY(begin)} to ${formatDateMMDDYYYY(end)}`;
        if (dateOfClosure < begin) {
          errs.push(at('1', 'dateOfClosure', `The dissolution date (${formatDateMMDDYYYY(dateOfClosure)}) is before the ${taxYear} tax period begins (${periodLabel}). An LLC cannot be dissolved before the period it is filing for. Check the date, or file the final return for the year the LLC actually closed.`));
        } else if (dateOfClosure > end) {
          errs.push(at('1', 'dateOfClosure', `The dissolution date (${formatDateMMDDYYYY(dateOfClosure)}) is after the ${taxYear} tax period ends (${periodLabel}). If the LLC closed after this period, this is not the final return, file the final return for the later year instead.`));
        } else if (dissolutionDateError) {
          // One wording, from one place. The field renders this same string
          // inline as the filer types; pushing a differently-worded version of
          // the same complaint into the summary read as two separate problems.
          errs.push(at('1', 'dateOfClosure', dissolutionDateError));
        }
      }
    }
    if (!entityPrincipalCountry) errs.push(at('1', 'entityPrincipalCountry', 'Select the main country where the LLC does business.'));
    // .trim() matters: picking "Other (enter manually)" parks a single space in
    // the activity to reveal the free-text input, and a space is not an answer.
    if (!entityBizActivity.trim()) errs.push(at('1', 'entityBizActivity', "Select or describe your LLC's type of business."));
    if (!entityBizCode.trim()) errs.push(at('1', 'entityBizCode', "Enter your LLC's business code."));
    else { const n = naicsProblem(entityBizCode, "Your LLC's business code"); if (n) errs.push(at('1', 'entityBizCode', n)); }
    if (!isAddressComplete(mailing)) errs.push(at('1', 'mailing', "Complete your LLC's mailing address."));
    return errs;
  }

  function validateStep1b(): StepError[] {
    const errs: StepError[] = [];
    if (extensionFiled === null) errs.push(at('1b', 'extensionFiled', 'Please confirm whether Form 7004 (extension) was filed.'));
    // Reasons are only collected here for a single-year, genuinely-late filing.
    // Multi-year jobs collect the RCL + reasons once at job setup; a filing still
    // within its extension is on time, so the RCL section is not shown.
    if (rclSectionShown && includeReasonableCause && reasonableCauseReasons.length === 0) {
      errs.push(at('1b', 'rclReasons', 'Select at least one reason for the reasonable cause letter.'));
    }
    return errs;
  }

  function validateStep2(): StepError[] {
    const errs: StepError[] = [];
    if (!ownerName.trim()) errs.push(at('2', 'ownerName', 'Enter your full legal name.'));
    if (!ownerCountry) errs.push(at('2', 'ownerCountry', 'Select the country where you do business.'));
    if (!ownerCountryRes) errs.push(at('2', 'ownerCountryRes', 'Select the country where you pay taxes.'));
    if (!ownerCountryCitizenship) errs.push(at('2', 'ownerCountryCitizenship', 'Select your country of citizenship.'));
    // Still required, but no longer required to be a *tax* ID. Plenty of
    // countries issue none at all, and those owners were stuck on this step
    // with nothing they could truthfully type. A passport number is an
    // identifying number they always have.
    if (!ownerForeignTaxId.trim()) {
      // Name the number the way the filer's own country names it, so the error
      // tells them what to go and find rather than restating the field label.
      errs.push(at('2', 'ownerForeignTaxId',
        ownerTaxIdInfo.issues === false
          ? `${ownerCountryRes} issues no personal tax ID. Enter your ${ownerTaxIdInfo.alt ?? 'passport number'} instead.`
          : `Enter your ${ownerTaxIdInfo.label}. If your country does not issue one, enter your passport number instead.`,
      ));
    }
    if (!ownerRefNumber.trim()) errs.push(at('2', 'ownerRefNumber', 'Enter your reference code.'));
    if (!ownerBizActivity.trim()) errs.push(at('2', 'ownerBizActivity', 'Select or describe your type of business.'));
    if (!ownerBizCode.trim()) errs.push(at('2', 'ownerBizCode', 'Enter your business code.'));
    else { const n = naicsProblem(ownerBizCode, 'Your business code'); if (n) errs.push(at('2', 'ownerBizCode', n)); }
    if (!isAddressComplete(ownerAddress, false)) errs.push(at('2', 'ownerAddress', 'Complete your address.'));
    return errs;
  }

  /**
   * The signature block. The title is printed on the return under the signature
   * and is how the IRS knows the signer had authority, so it cannot be blank,
   * and it must not be quietly defaulted either: patchAll wrote
   * `signerTitle.trim() || 'Managing Member'`, which invents an authority claim
   * the filer never made. The date may be today or any past date, never a
   * future one, because a return cannot be signed before it is signed.
   */
  function validateSignature(): StepError[] {
    const errs: StepError[] = [];
    if (!signerTitle.trim()) errs.push(at('2', 'signerTitle', 'Enter the title you are signing under, for example Managing Member.'));
    if (signatureDate) {
      const today = todayISO();
      if (signatureDate > today) {
        errs.push(at('2', 'signatureDate', `The signature date (${formatDateMMDDYYYY(signatureDate)}) is in the future. Sign with today's date or an earlier one.`));
      }
    }
    return errs;
  }

  /**
   * Step 3, the related parties already added. `validateRelatedPartyDraft`
   * guards the sub-form, but only while a party is being typed: once a row is
   * in `relatedParties` nothing looks at it again. A row that arrived any other
   * way, a resumed draft or a prefill from last year's profile, was never
   * checked at all, and every one of these fields is printed on that party's
   * Form 5472.
   */
  function validateStep3(): StepError[] {
    const errs: StepError[] = [];
    relatedParties.forEach((rp, i) => {
      const who = rp.name?.trim() ? `Related party "${rp.name.trim()}"` : `Related party ${i + 1}`;
      // The anchor is the party's CARD, not the field inside it. A saved party
      // is a summary row until it is opened for editing, so there is no country
      // input on screen to jump to; the card is the thing that exists and the
      // thing the filer has to act on.
      const card = `rp-${i}`;
      if (!rp.name?.trim()) errs.push(at('3', card, `${who} has no legal name. Every related party on Form 5472 has to be named.`));
      if (!rp.country) errs.push(at('3', card, `${who} has no country of business.`));
      if (!rp.country_residence) errs.push(at('3', card, `${who} has no country of tax residence.`));
      if (!rp.biz_activity?.trim()) errs.push(at('3', card, `${who} has no type of business.`));
      if (!rp.biz_code?.trim()) errs.push(at('3', card, `${who} has no business code.`));
      else { const n = naicsProblem(rp.biz_code, `${who}: the business code`); if (n) errs.push(at('3', card, n)); }
      if (!isAddressComplete(rp.address ?? {}, false)) errs.push(at('3', card, `${who} has an incomplete address. It is printed on that party's Form 5472.`));
    });

    // Two parties with the same legal name are almost always one party entered
    // twice, and the cost of that is not cosmetic: each one produces its own
    // Form 5472, so the same amounts are reported to the IRS twice.
    const byName = new Map<string, number>();
    relatedParties.forEach((rp) => {
      const key = (rp.name ?? '').trim().toLowerCase();
      if (key) byName.set(key, (byName.get(key) ?? 0) + 1);
    });
    byName.forEach((count, key) => {
      if (count > 1) {
        const shown = relatedParties.find((rp) => (rp.name ?? '').trim().toLowerCase() === key)?.name?.trim();
        // Jump to the SECOND one. The first is the party they meant to keep, so
        // landing on it invites deleting the wrong row.
        const dupIndex = relatedParties.map((rp) => (rp.name ?? '').trim().toLowerCase()).lastIndexOf(key);
        errs.push(at('3', `rp-${dupIndex}`, `"${shown}" is listed ${count} times. Each related party belongs on the return once, listing one twice reports the same amounts to the IRS twice. Remove the duplicate, or give them different legal names if they really are different parties.`));
      }
    });

    // Reference codes identify a party on the return, so two parties cannot
    // share one.
    const byRef = new Map<string, number>();
    relatedParties.forEach((rp) => {
      const key = (rp.ref_number ?? '').trim().toUpperCase();
      if (key) byRef.set(key, (byRef.get(key) ?? 0) + 1);
    });
    byRef.forEach((count, key) => {
      if (count > 1) {
        const dupIndex = relatedParties.map((rp) => (rp.ref_number ?? '').trim().toUpperCase()).lastIndexOf(key);
        errs.push(at('3', `rp-${dupIndex}`, `Reference code ${key} is used by ${count} related parties. Each party needs its own.`));
      }
    });

    return errs;
  }

  /**
   * Step 4, the transactions section. This had no validator at all: "Save &
   * continue" only checked that the related-party sub-form was closed, so a
   * transaction with no amount, a negative amount, or a party index pointing
   * past the end of the party list went straight through. saveTransactions()
   * then quietly filtered those rows out (and deleted any stored copy), so the
   * filer's data disappeared with nothing on screen to say so and the package
   * generated as though the transaction had never been entered.
   */
  function validateStep4(): StepError[] {
    const errs: StepError[] = [];
    if (transactions.length === 0 && !noTransactionsConfirmed) {
      errs.push(at('4', 'noTransactions', 'Add at least one reportable transaction, or tick the box confirming this LLC had none this year. Form 5472 has to say which it is.'));
    }
    // The confirmation and the list can disagree, and the return can only state
    // one of them. Left alone, the box wins and every listed transaction is
    // dropped from Parts IV to VI without the filer being told.
    if (transactions.length > 0 && noTransactionsConfirmed) {
      // Anchored to the first transaction, not to the tick box: the box only
      // renders while the list is empty, so on this exact error it is not on
      // screen to jump to. The list is what the filer can act on.
      errs.push(at('4', 'tx-0', `You have ticked "no reportable transactions", but ${transactions.length} ${transactions.length === 1 ? 'is' : 'are'} listed below. Untick the box, or remove the transactions.`));
    }
    const { begin: periodBegin, end: periodEnd } = taxPeriodWindow(taxYear, isFiscalYear, fiscalEndMonth);

    transactions.forEach((t, i) => {
      const n = i + 1;
      const known = TX_TYPES.find((x) => x.value === t.transaction_type);
      const label = known?.label ?? humanizeTxType(t.transaction_type);
      const where = `Transaction ${n} (${label})`;
      // Every message about this transaction lands on its own row in the list.
      const row = `tx-${i}`;

      // An unrecognised or blank type has no line on the return to be reported
      // on, so it would be carried to the generator and dropped there instead.
      if (!t.transaction_type?.trim()) {
        errs.push(at('4', row, `Transaction ${n} has no type. Choose what kind of transaction it was.`));
      } else if (!known) {
        errs.push(at('4', row, `Transaction ${n} has a type this form does not recognise ("${t.transaction_type}"). Choose one from the list.`));
      }

      // A date outside the filing period belongs on a different year's return.
      // Only checked when a date was actually entered: the date is optional,
      // and a blank one must keep flowing through untouched.
      if (t.transaction_date && taxYear) {
        if (t.transaction_date < periodBegin || t.transaction_date > periodEnd) {
          errs.push(at('4', row, `${where} is dated ${formatDateMMDDYYYY(t.transaction_date)}, which is outside the tax period being filed (${formatDateMMDDYYYY(periodBegin)} to ${formatDateMMDDYYYY(periodEnd)}). Report it on the return for the year it falls in.`));
        }
      }

      // The party list is [owner, ...relatedParties], so a valid index always
      // addresses a row that exists. A stale index silently became the owner.
      if (!Number.isInteger(t.related_party_index) || t.related_party_index < 0
        || t.related_party_index >= allPartyLabels.length) {
        errs.push(at('4', row, `${where} is attached to a related party that no longer exists. Choose the party it belongs to.`));
      }

      // Part V and Part VI belong to the OWNER's Form 5472 and to no other.
      // The generator builds both statements, and ticks both checkboxes, only
      // for the owner (buildYearDocs / fill5472 in pdfGenerator.ts), so one of
      // these attached to an additional related party reached the IRS on no
      // line, under no checkbox and with no statement, while still counting
      // toward that party's line 1f. Catch it here, where the filer can still
      // say who the transaction really belonged to.
      //
      // OWNER_ONLY_TX_TYPES, not PART_V_TYPES + PART_VI_TYPES: a dissolution is
      // offered on the Part V list but can genuinely involve a non-owner related
      // party, and for that party it is reported as a Part IV amount rather than
      // in a statement. It is the one Part V type this must not reject.
      else if (t.related_party_index !== 0 && OWNER_ONLY_TX_TYPES.has(t.transaction_type)) {
        const label = allPartyLabels[t.related_party_index];
        errs.push(at('4', row,
          `${where} is a transaction between the LLC and its owner, so it belongs to ${allPartyLabels[0]}, `
          + `not to ${label}. Reassign it to the owner, or change its type to the one that describes what `
          + `passed between the LLC and ${label}.`,
        ));
      }

      // Form 5472 Part VII, questions 42a / 42b. A loan with a related party who
      // is not the sole owner forces one of them to Yes, and Part VII has no
      // field to answer it in, so the return would assert a No we know is wrong.
      //
      // The type card is already hidden for a non-owner party, but hiding it is
      // not enough on its own: the party dropdown can be changed AFTER the type
      // was picked, a saved row can predate this rule, and the scenario loader
      // writes rows directly. This is the check that actually holds.
      else if (t.related_party_index !== 0 && NON_OWNER_BLOCKED_TX_TYPES.has(t.transaction_type)) {
        const label = allPartyLabels[t.related_party_index];
        errs.push(at('4', row,
          `${where} is a loan between the LLC and ${label}, who is not the owner. A loan with anyone `
          + `other than the owner has to be answered in Part VII of Form 5472, which we do not prepare, `
          + `and that stays true even if no interest was charged. Reassign it to ${allPartyLabels[0]} if `
          + `the money actually moved between the LLC and its owner, or email support@filetax.co.`,
        ));
      }

      // Part V and Part VI types describe non-monetary events, so they are the
      // only ones allowed to carry no amount.
      const monetary = !PART_V_TYPES.has(t.transaction_type) && !PART_VI_TYPES.has(t.transaction_type);
      const amt = (t.amount_usd ?? '').trim();
      if (monetary && amt === '') {
        errs.push(at('4', row, `${where} needs an amount in US dollars.`));
      } else if (monetary && Number(amt) === 0) {
        // Zero is what saveTransactions drops. It used to pass validation, so a
        // filer could enter 0, watch the row sit in the list through review, and
        // have it silently discarded on the way to the database: the row was
        // never on the return and nothing said so. Refuse it here instead, where
        // it can still be corrected. A genuinely zero transaction has nothing to
        // report on Form 5472 anyway.
        errs.push(at('4', row, `${where} has an amount of 0. Form 5472 reports what actually passed between the LLC and the related party, so enter the real amount, or remove the transaction if nothing did.`));
      } else {
        const a = amountProblem(amt, `${where}: the amount`);
        if (a) {
          errs.push(at('4', row, a.endsWith('cannot be negative.')
            ? `${where}: the amount cannot be negative. Form 5472 reports gross amounts, use the paid/received direction to show which way the money went.`
            : a));
        }
      }

      if (LOAN_TYPES.has(t.transaction_type)) {
        const b = amountProblem(t.loan_begin_usd ?? '', `${where}: the beginning balance`);
        if (b) errs.push(at('4', row, b));
      }
    });
    return errs;
  }

  function validateRelatedPartyDraft(draft: RelatedParty): string[] {
    const errs: string[] = [];
    if (!draft.name.trim()) errs.push("Enter the related party's full legal name.");
    if (!draft.country) errs.push('Select the country where they do business.');
    if (!draft.country_residence) errs.push('Select the country where they pay taxes.');
    if (!draft.foreign_tax_id.trim()) errs.push("Enter the related party's foreign tax ID.");
    if (!draft.ref_number.trim()) errs.push("Enter the related party's reference code.");
    if (!draft.biz_activity.trim()) errs.push("Select or describe the related party's type of business.");
    if (!draft.biz_code.trim()) errs.push("Enter the related party's business code.");
    if (!isAddressComplete(draft.address, false)) errs.push("Complete the related party's address.");
    return errs;
  }

  function validateTransactionDraft(): string[] {
    const errs: string[] = [];
    if (!txType) errs.push('Select a transaction type.');
    const meta = TX_TYPES.find((t) => t.value === txType);
    const isOptionalAmt = meta?.amountOptional || PART_V_TYPES.has(txType) || PART_VI_TYPES.has(txType);
    if (!isOptionalAmt) {
      if (!txAmt || Number(txAmt) <= 0) errs.push('Enter a valid amount in USD.');
    } else if (txAmt && Number(txAmt) < 0) {
      errs.push('Amount cannot be negative.');
    }
    if (LOAN_TYPES.has(txType) && !txAmt) errs.push('Enter the year-end closing balance for the loan.');
    return errs;
  }

  function validationForStep(target: IntakeStep): StepError[] {
    if (target === 1) return validateStep1();
    if (target === '1b') return validateStep1b();
    if (target === 2) return validateStep2();
    if (target === 3) return validateStep3();
    if (target === 4) return validateStep4();
    return [];
  }

  function furthestReachableIndex(): number {
    if (completedOnce) return stepOrder.length - 1;
    for (let i = 0; i < stepOrder.length - 1; i += 1) {
      if (validationForStep(stepOrder[i]).length > 0) return i;
    }
    return stepOrder.length - 1;
  }

  // Treat ?step= as presentation state, never as proof that earlier intake is
  // complete. A manually edited URL is clamped to the first incomplete section.
  useEffect(() => {
    if (loadingFiling) return;
    const requestedIndex = stepOrder.indexOf(step);
    const allowedIndex = furthestReachableIndex();
    const target = requestedIndex < 0 || requestedIndex > allowedIndex
      ? stepOrder[allowedIndex]
      : step;

    setOpenSections(new Set([String(target)]));
    if (target === step) return;

    setStep(target);
    const nextParams = new URLSearchParams(params.toString());
    nextParams.set('step', String(target));
    navigate(`?${nextParams.toString()}`, { replace: true });
  // The guard intentionally runs after a filing is hydrated or the requested
  // URL step changes. Continue buttons already validate live field changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingFiling, step, completedOnce, show1b]);

  /**
   * Everything that must hold before a package is generated, not just the step
   * the filer happens to be looking at. The accordion lets a section be left
   * untouched, so validating only the current step let an invalid step-1 or
   * step-4 value reach the return by way of a submit from the review screen.
   */
  function validateForSubmit(): StepError[] {
    if (showRpForm) return ['Finish or cancel the related party form before continuing.'];
    return [...validateStep1(), ...validateStep1b(), ...validateStep2(), ...validateStep3(),
      ...validateStep4(), ...validateSignature()];
  }

  // Persist a field patch to the current filing (creating the row on first
  // save). When propagateShared is true, company/owner fields are also copied to
  // the job's other draft years. Reached through saveAll / saveDraft.
  const persistPatch = async (
    patch: Partial<Filing> & Record<string, unknown>,
    propagateShared: boolean,
  ): Promise<string | null> => {
    // The one write path, so this is the one place the fax lock has to hold.
    // Refused before `saving` is set: a silent no-op would leave the filer
    // watching a spinner finish and believing the change was kept.
    if (isFaxLocked) {
      setError(
        'This filing has already been faxed to the IRS, so it can no longer be edited. '
        + 'The IRS holds the pages exactly as they were sent. If something on them is wrong, '
        + 'email support@filetax.co: a correction is a new filing, not an edit to this one.',
      );
      // Null, not `filingId`. Callers read a truthy id as "saved": returning the
      // id here let `saveDraft` succeed, so `continueFromSection` advanced the
      // accordion and the filer watched their edit be accepted, then silently
      // discarded. The write was always refused; only the feedback lied.
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      if (!filingId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in');
        if (import.meta.env.DEV) {
          console.log('INSERT PAYLOAD:', JSON.stringify({ ...patch, user_id: user.id }, null, 2));
        }
        const { data, error: err } = await supabase.from('filings').insert({ ...patch, user_id: user.id, status: 'draft' }).select('id').single();
        if (err) throw err;
        const newId = data.id as string;
        setLocalFilingId(newId);
        return newId;
      }
      let finalPatch = patch;
      if (isPaidLocked) {
        // Never attempt to write frozen identity fields on a paid filing (the
        // DB trigger would reject the whole update). Strip them client-side so
        // legitimate corrections to other fields still go through.
        const FROZEN = ['llc_name', 'ein', 'tax_year', 'owner_full_name', 'owner_foreign_tax_id', 'date_of_incorporation', 'entity_date_of_incorporation'];
        finalPatch = Object.fromEntries(
          Object.entries(patch).filter(([k]) => !FROZEN.includes(k)),
        ) as typeof patch;
      }
      const { error: err } = await supabase.from('filings').update(finalPatch).eq('id', filingId);
      if (err) throw err;

      // Multi-year job: company + owner fields are the SAME for every year, so
      // they are copied to every other draft year in the job. Year-specific
      // fields (tax_year, total_assets, initial_return, fiscal period, final
      // return, RCL) are excluded by sharedJobPatch.
      if (jobId && propagateShared) {
        const shared = sharedJobPatch(finalPatch);
        if (Object.keys(shared).length > 0) {
          await supabase
            .from('filings')
            .update(shared)
            .eq('job_id', jobId)
            .neq('id', filingId)
            .eq('status', 'draft');
        }
      }
      return filingId;
    } catch (e: unknown) {
      console.error(e);
      setError(`Your filing could not be saved: ${describeError(e)} Nothing was lost from this screen, try again, and if it keeps happening send that message to support@filetax.co.`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Whole-form save for the accordion: persists every field and propagates the
  // shared company/owner fields to the job's other years.
  const saveAll = (extra?: Record<string, unknown>): Promise<string | null> =>
    persistPatch({ ...patchAll(), ...extra }, jobId != null);

  /**
   * Persist EVERYTHING the filer has entered: the filing row and the
   * transaction rows.
   *
   * Transactions live in their own table, so patchAll cannot carry them. Every
   * "Save & continue" saved the filing and left the transactions in component
   * state only, which meant a filer who added a transaction, continued, and
   * came back later found it gone. Nothing had removed it; it was never
   * written. The same hole swallowed transactions when a section was collapsed
   * and when a catch-up job switched year.
   *
   * Guarded on loadingFiling because saveTransactions reconciles by DELETING
   * rows absent from the current set: called while the list is still empty
   * because the load has not finished, it would clear the filing's saved
   * transactions.
   */
  const saveDraft = async (extra?: Record<string, unknown>): Promise<string | null> => {
    const id = await saveAll(extra);
    if (!id) return null;
    if (loadingFiling) return id;
    return (await saveTransactions(id)) ? id : null;
  };

  /**
   * Persist the transaction list as soon as a transaction is ADDED or REMOVED,
   * instead of waiting for "Save & continue to Review".
   *
   * Three transactions entered and left without completing the step were gone
   * on resume, while steps 1 to 4 persisted perfectly. The list shows a running
   * count and live totals as you add, so it reads as saved, and nothing warned
   * on leaving: someone entering twenty transactions and getting interrupted
   * lost all of them silently.
   *
   * NOT a save on every keystroke. That is a network call per character and it
   * risks persisting a half-written row. An add is already a discrete,
   * complete, validated object, and that is the moment worth writing.
   *
   * Routed through a counter and an effect rather than calling saveDraft inline
   * because `setTransactions` has not applied yet at the end of the handler,
   * and `saveTransactions` reads the list off state: saving inline would write
   * the list as it stood BEFORE the add. The effect runs after the render that
   * applied it.
   */
  const [txSaveRequests, setTxSaveRequests] = useState(0);
  const requestTransactionSave = () => setTxSaveRequests((n) => n + 1);
  useEffect(() => {
    if (txSaveRequests === 0) return;   // nothing added or removed yet
    if (loadingFiling) return;          // saveTransactions would reconcile against an empty list
    if (isFaxLocked || isPaidLocked) return; // the write is refused anyway; do not surface an error
    void saveDraft();
    // saveDraft is redefined every render; the counter is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSaveRequests]);

  // Expand/collapse an accordion section. Collapsing persists the whole form so
  // the draft is saved as the filer moves through the page (unless paid-locked
  // with no edits left, or nothing has been entered yet).
  const toggleSection = (key: string) => {
    const target = key === '1b' ? ('1b' as IntakeStep) : (Number(key) as IntakeStep);
    const targetIndex = stepOrder.indexOf(target);
    if (!completedOnce && (targetIndex < 0 || targetIndex > furthestReachableIndex())) {
      const firstIncomplete = stepOrder[furthestReachableIndex()];
      setStepErrors([`Complete ${STEP_LABELS[firstIncomplete]} before opening a later section.`]);
      setStep(firstIncomplete);
      setOpenSections(new Set([String(firstIncomplete)]));
      const nextParams = new URLSearchParams(params.toString());
      nextParams.set('step', String(firstIncomplete));
      navigate(`?${nextParams.toString()}`, { replace: true });
      return;
    }
    const collapsing = openSections.has(key);
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Collapsing is a save point, and the filer may have added a transaction
    // inside the section being closed. Kept OUT of the state updater: React
    // may call an updater more than once, and a save is not something to run
    // an unpredictable number of times.
    if (collapsing && !saving && (filingId || llcName.trim())) void saveDraft();
  };

  // Switch to another year in the catch-up job: save the current year first,
  // then load that sibling filing (the load effect re-hydrates every field).
  const switchYear = async (siblingId: string) => {
    if (saving || siblingId === filingId) return;
    // The load effect replaces every field with the sibling year's data, so
    // anything unsaved here is gone the moment we navigate.
    if (filingId || llcName.trim()) await saveDraft();
    const newParams = new URLSearchParams(params.toString());
    newParams.set('filing_id', siblingId);
    setLocalFilingId(siblingId);
    navigate(`?${newParams.toString()}`, { replace: true });
  };

  // Opening another YEAR is a new page to the filer and the same route to the
  // browser: only the query string changes, so the scroll position is kept. The
  // button that opened 2023 sat far down 2022's page, and 2023 then rendered
  // with its year tabs, its heading and its "Catch-up filing for tax year 2023"
  // banner all off-screen above, so the click read as having done nothing at
  // all. Not on the first filing this page shows, because that one is either
  // already at the top or was deliberately deep-linked to a step.
  const scrolledForFiling = useRef<string | null>(null);
  useEffect(() => {
    if (!filingId) return;
    const first = scrolledForFiling.current === null;
    if (scrolledForFiling.current === filingId) return;
    scrolledForFiling.current = filingId;
    if (!first) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [filingId]);

  // "Save & continue" inside a section: validate it, save the whole form, then
  // collapse this section and open the next one, scrolling to it.
  const continueFromSection = async (key: string) => {
    const s = key === '1b' ? ('1b' as IntakeStep) : (Number(key) as IntakeStep);
    // Reuse the per-step validators by pointing `step` context at this section.
    let errs: StepError[] = [];
    if (s === 1) errs = validateStep1();
    else if (s === '1b') errs = validateStep1b();
    else if (s === 2) errs = validateStep2();
    else if (s === 3) errs = showRpForm ? ['Finish or cancel the related party form before continuing.'] : validateStep3();
    else if (s === 4) errs = showRpForm ? ['Finish or cancel the related party form before continuing.'] : validateStep4();
    setStepErrors(errs);
    if (errs.length > 0) { errorSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (s === 2) setOwnerReviewed(true);
    if (s === 3) setRelatedPartiesReviewed(true);
    const idx = stepOrder.indexOf(s);
    const nextKey = idx >= 0 && idx + 1 < stepOrder.length ? String(stepOrder[idx + 1]) : null;
    // How far this filing has been taken, persisted so it survives a reload.
    // Nothing had written current_step since the wizard became an accordion, so
    // it sat at its seeded value forever: the dashboard's "Step X of 5" was
    // wrong on every draft, and Related Parties forgot it had been reviewed
    // every time the page was reopened.
    const reached = Math.max(furthestStep, stepNumberOf(nextKey ? stepOrder[idx + 1] : 5));
    if (!saving && (filingId || llcName.trim())) {
      if (!(await saveDraft({ current_step: reached }))) return;
      setFurthestStep(reached);
    }
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.delete(key);
      if (nextKey) next.add(nextKey);
      return next;
    });
    if (nextKey) {
      setStep(stepOrder[idx + 1]);
      requestAnimationFrame(() => sectionRefs.current[nextKey]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  /**
   * True when this filing is the earliest year in its job, or is a single-year
   * filing. Form 1120 item E boxes 3 and 4 are only offered here: a catch-up is
   * filed with the CURRENT name and address on every year, and the change is
   * flagged once, on the return the IRS processes first.
   *
   * `jobYears` is sorted ascending, and is empty for a filing with no job.
   */
  const isEarliestJobYear = jobYears.length === 0 || jobYears[0]?.id === filingId;

  /**
   * The catch-up year the Review button will open next, or null when this is
   * the last year left and the button goes to payment instead.
   *
   * Both the label and handleSubmit call nextOpenYear, so the year named on the
   * button is by construction the year that opens. They were separately written
   * predicates before, and the button read "Save 2023 & continue to 2022" on a
   * year already filed.
   */
  /**
   * What this filer is about to pay, itemised, for the review step.
   *
   * On a catch-up the price is the JOB's, not this year's: one checkout buys
   * every year, so the review of any year in it shows the same figure the
   * button leads to. The open year's parties come from local state rather than
   * `jobYears` so the total answers to edits made on this screen before a save.
   */
  const reviewCart = checkoutLines({
    billablePartiesByYear: jobId && jobYears.length > 0
      ? jobYears.map((y) => (y.id === filingId ? billableRelatedPartyCount : y.billable_parties))
      : [billableRelatedPartyCount],
    includeRCL: includeReasonableCause,
    includeFax: includeIrsFax,
  });

  const nextYear = nextOpenYear(jobYears, filingId, taxYear);
  const nextDraftYear = nextYear?.tax_year ?? null;
  const hasNextDraftYear = nextYear != null;

  /**
   * Label for a section's "continue" button.
   *
   * "Save & continue", bare. Owner's instruction, 8 August 2026, and it REVERSES
   * an earlier decision here, so the reasoning that was overridden is kept
   * rather than deleted: the destination used to be named ("Save & continue to
   * Owner Details") because a bare label never told the filer where they were
   * going, and because on the last section before Review it could read as though
   * it were submitting the return.
   *
   * The section heading the button sits under, and the accordion row it scrolls
   * to next, both still name the destination, so the label was carrying the
   * information a third time. The submit risk is the part that was genuinely
   * traded away: if "Save & continue" under Transactions ever starts reading as
   * "file my return", name that one destination again rather than all of them.
   *
   * "Save" alone on the last section stays. There is nothing after it to
   * continue to, and it is the Review step's own button that submits.
   */
  const continueLabel = (key: string): string => {
    if (saving) return 'Saving…';
    const s = key === '1b' ? ('1b' as IntakeStep) : (Number(key) as IntakeStep);
    const idx = stepOrder.indexOf(s);
    const nextKey = idx >= 0 && idx + 1 < stepOrder.length ? String(stepOrder[idx + 1]) : null;
    if (!nextKey) return 'Save';
    return 'Save & continue →';
  };

  const saveTransactions = async (idOverride?: string): Promise<boolean> => {
    const activeFilingId = idOverride ?? filingId;
    if (!activeFilingId) return false;
    setError(null);
    try {
      const validTxns = transactions.filter(
        (t) => PART_V_TYPES.has(t.transaction_type) || PART_VI_TYPES.has(t.transaction_type) || (t.amount_usd && Number(t.amount_usd) > 0),
      );

      // Reconcile with what is already stored: any DB row whose id is no longer
      // present in the current (valid) set must be DELETED, so an edited filing
      // replaces its transactions rather than accumulating stale ones. This also
      // clears rows that were emptied out or removed in the UI.
      const keptIds = new Set(validTxns.map((t) => t.id).filter(Boolean) as string[]);
      const { data: existing } = await supabase
        .from('reportable_transactions')
        .select('id')
        .eq('filing_id', activeFilingId);
      const toDelete = (existing ?? [])
        .map((r: { id: string }) => r.id)
        .filter((id) => !keptIds.has(id));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('reportable_transactions')
          .delete()
          .in('id', toDelete);
        if (delErr) throw delErr;
      }

      if (validTxns.length === 0) return true;

      // Translate each row from the rich UI vocabulary into the canonical
      // transaction_type the DB CHECK constraint and the PDF generator
      // understand, carrying the loan beginning balance. The party matters:
      // a wind-down against the owner is a Part V liquidating distribution,
      // against anyone else a Part IV "other amount".
      const mapRow = (t: TransactionRow) => {
        const m = mapTransactionForPersist({
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: t.amount_usd ? Number(t.amount_usd) : null,
          loan_begin_usd: t.loan_begin_usd ? Number(t.loan_begin_usd) : null,
          description: t.description,
          transaction_date: t.transaction_date,
        }, t.related_party_index === 0);
        return {
          filing_id: activeFilingId,
          related_party_index: t.related_party_index,
          transaction_type: m.transaction_type,
          ui_transaction_type: m.ui_transaction_type,
          direction: m.direction,
          amount_usd: m.amount_usd,
          loan_begin_usd: m.loan_begin_usd,
          description: m.description,
          transaction_date: m.transaction_date,
        };
      };

      const toInsert = validTxns.filter((t) => !t.id).map(mapRow);
      const toUpsert = validTxns.filter((t) => !!t.id).map((t) => ({
        id: t.id!,
        ...mapRow(t),
      }));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('reportable_transactions').insert(toInsert);
        if (insErr) throw insErr;
      }
      if (toUpsert.length > 0) {
        const { error: upErr } = await supabase.from('reportable_transactions').upsert(toUpsert, { onConflict: 'id' });
        if (upErr) throw upErr;
      }
      return true;
    } catch (e: unknown) {
      console.error(e);
      setError(`Your transactions could not be saved: ${describeError(e)} Nothing was lost from this screen, try again, and if it keeps happening send that message to support@filetax.co.`);
      return false;
    }
  };

  // Switch a single-year filing to the multi-year catch-up. Persist whatever
  // company/owner details have been entered so far to the user's profile so the
  // year picker + each year's intake prefill them, the user doesn't re-type
  // Step 1/2. Best-effort: navigate even if the profile write fails.
  const goToMultiYearWithDetails = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await saveProfileFromFiling(user.id, {
          llc_name: llcName.trim() || null,
          ein: ein.trim() || null,
          state_of_formation: stateOfFormation.trim() || null,
          date_of_incorporation: entityDOI.trim() || null,
          mailing_address: mailing,
          entity_business_activity: entityBizActivity.trim() || null,
          entity_business_code: entityBizCode.trim() || null,
          entity_principal_country: entityPrincipalCountry.trim() || null,
          naics_code: entityBizCode.trim() || null,
          naics_description: entityBizActivity.trim() || null,
          owner_full_name: ownerName.trim() || null,
          owner_country: ownerCountry.trim() || null,
          owner_primary_country: ownerCountry.trim() || null,
          owner_country_residence: ownerCountryRes.trim() || null,
          owner_country_citizenship: ownerCountryCitizenship.trim() || null,
          owner_foreign_tax_id: ownerForeignTaxId.trim() || null,
          owner_us_tin: ownerSSN.trim() || null,
          owner_reference_id: ownerRefNumber.trim() || null,
          owner_address: ownerAddress,
          owner_business_activity: ownerBizActivity.trim() || null,
          owner_business_code: ownerBizCode.trim() || null,
          owner_naics_code: ownerBizCode.trim() || null,
          signer_title: signerTitle.trim() || null,
          related_parties: relatedParties,
        });
      }
    } catch { /* best-effort: still go to the picker */ }
    navigate('/catch-up');
  };

  /**
   * Build the filer's real package and show it as watermarked images, before
   * any money changes hands.
   *
   * It generates from the SAVED ROW, not from component state, and saves first
   * to get there. That costs a round trip, and buys the guarantee that what is
   * previewed is what handleSubmit will produce: both read the same filing and
   * the same transactions through the same generator. A preview built from a
   * second, parallel path would eventually drift from the product, and a
   * preview that disagrees with the delivered forms is worse than none.
   *
   * No drawn signature is passed. Signing happens after payment, on the filing
   * page, and the modal says so.
   */
  const handlePreviewDraft = async () => {
    const errs = validateForSubmit();
    setStepErrors(errs);
    if (errs.length > 0) { errorSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (!filingId) { setPreviewErr('This filing has no id yet. Go back to the dashboard and open it from there.'); return; }
    setPreviewBusy(true);
    setPreviewErr(null);
    try {
      if (!(await saveDraft())) return;

      const { data: fi, error: fiErr } = await supabase
        .from('filings').select('*').eq('id', filingId).single();
      if (fiErr) throw fiErr;
      const { data: txns, error: txErr } = await supabase
        .from('reportable_transactions').select('*').eq('filing_id', filingId);
      if (txErr) throw txErr;

      const { generateFilingPackage, refuseUnsupportedText } = await import('../../lib/pdfGenerator');
      const pkg = await generateFilingPackage(fi, txns ?? [], undefined, { drawnSignature: null });
      // Same refusal as the paid path: a package missing characters must never
      // be shown as though it were fine, or the filer approves a draft that we
      // will then refuse to generate.
      const refusal = refuseUnsupportedText(pkg.unsupportedText);
      if (refusal) throw new Error(refusal);

      const docs: DraftDoc[] = [
        { key: '5472', label: 'Form 5472', bytes: pkg.form5472 },
        { key: '1120', label: 'Pro forma 1120', bytes: pkg.form1120 },
      ];
      // Shown when the package carries one: an extension the filer told us
      // about, or one we are preparing. It is a short form with nothing to
      // withhold, so it is shown complete like the others.
      if (pkg.form7004) {
        docs.push({ key: '7004', label: 'Form 7004', bytes: pkg.form7004 });
      }
      if (pkg.reasonableCauseLetter) {
        docs.push({
          key: 'rcl',
          label: 'Reasonable cause letter',
          bytes: pkg.reasonableCauseLetter,
          // Letterhead, the IRS address block, the RE line and the opening stay
          // sharp. The argument does not: it is the part of this package a
          // filer cannot write for themselves.
          gateArgument: true,
          gateNote: 'Your letter is written and ready. The argument it makes to the IRS is blurred until you submit, because it is the part of this package you are paying us to write. Everything above it is the real letter, addressed to the service centre that will read it.',
        });
      }
      setDraftDocs(docs);
    } catch (e: unknown) {
      console.error(e);
      setPreviewErr(`Your preview could not be prepared: ${describeError(e)} Your answers are saved, so you can try again or carry on and submit.`);
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleSubmit = async () => {
    const errs = validateForSubmit();
    setStepErrors(errs);
    if (errs.length > 0) { errorSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (!filingId) { setError('This filing has no id yet, which usually means the page was opened directly rather than from the dashboard. Go back to the dashboard and open the filing from there.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Persist every intake choice before navigating to checkout. Previously
      // only transactions were guaranteed to save here, so an RCL selected in
      // the open filing-status section could be visible in Review but absent
      // from the database product cart and therefore from the invoice.
      // Persists the filing row AND the transactions, and marks the filing as
      // having reached review.
      const savedFilingId = await saveDraft({ current_step: 5 });
      if (!savedFilingId) return;
      setFurthestStep(5);
      // saveDraft runs persistPatch, whose finally clears `saving`. The submit
      // button is disabled on that flag, so without this it went live again
      // mid-submit and a second tap ran the whole thing twice.
      setSaving(true);

      if (isPaidLocked) {
        // Paid filing: save the correction and return to the download page.
        // Status remains paid/completed and there is no numeric edit limit.
        navigate(`/filing/${filingId}`);
        return;
      }
      
      // Remember entity + owner details so the next year's filing prefills.
      // Best-effort: never block submission on a profile write.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await saveProfileFromFiling(user?.id, {
          llc_name: llcName.trim() || null,
          ein: ein.trim() || null,
          state_of_formation: stateOfFormation.trim() || null,
          date_of_incorporation: entityDOI.trim() || null,
          mailing_address: mailing,
          entity_business_activity: entityBizActivity.trim() || null,
          entity_business_code: entityBizCode.trim() || null,
          entity_principal_country: entityPrincipalCountry.trim() || null,
          naics_code: entityBizCode.trim() || null,
          naics_description: entityBizActivity.trim() || null,
          owner_full_name: ownerName.trim() || null,
          owner_country: ownerCountry.trim() || null,
          owner_primary_country: ownerCountry.trim() || null,
          owner_country_residence: ownerCountryRes.trim() || null,
          owner_country_citizenship: ownerCountryCitizenship.trim() || null,
          owner_foreign_tax_id: ownerForeignTaxId.trim() || null,
          owner_us_tin: ownerSSN.trim() || null,
          owner_reference_id: ownerRefNumber.trim() || null,
          owner_business_activity: ownerBizActivity.trim() || null,
          owner_business_code: ownerBizCode.trim() || null,
          owner_naics_code: ownerBizCode.trim() || null,
          owner_address: ownerAddress,
          signer_title: signerTitle.trim() || null,
          related_parties: relatedParties,
        });
      } catch { /* profile save is non-critical */ }

      // Multi-year catch-up: file chronologically, forwards. After finishing
      // this year, open the next year that has not been through review, so the
      // user walks 2022 → 2023 → 2024 → 2025. Read fresh from the database
      // rather than from `jobYears`, because this year's own current_step was
      // written moments ago, above.
      //
      // When nothing is left, fall through to checkout: the last year of a
      // catch-up pays from here exactly as a single-year filing does. It used to
      // route back to the earliest year that was still `draft`, which is every
      // year of an unpaid job, so a catch-up could not reach payment from
      // intake at all.
      if (jobId) {
        const { data: siblings } = await supabase
          .from('filings')
          .select('id, tax_year, current_step, status')
          .eq('job_id', jobId)
          .order('tax_year', { ascending: true });
        const target = nextOpenYear(
          (siblings ?? []).map((s: any) => ({
            id: s.id as string,
            tax_year: String(s.tax_year),
            status: s.status as string,
            current_step: Number(s.current_step ?? 1) || 1,
          })),
          filingId,
          taxYear,
        );
        if (target) {
          // THE STATE, NOT JUST THE URL. `filingId` is
          // `localFilingId ?? params.get('filing_id')`, and localFilingId holds
          // this year, so it wins over anything the URL says: navigating alone
          // left the page rendering the year it was already on, which is why
          // "Save 2022 & continue to 2023" appeared to do nothing while the year
          // tabs, which set this state, worked. Set before navigate, the same
          // order switchYear uses.
          setLocalFilingId(target.id);
          // Step 1, LLC Details, and not the first section carrying anything
          // year-specific. Owner's instruction, 8 August 2026, replacing a jump
          // to step 3 that reasoned the company and owner had just been
          // propagated so there was nothing to see. There is: the tax period,
          // the final-return question and the filing-status answers all belong
          // to THIS year, and a year that opens half way down its own form asks
          // the filer to trust that the part they were skipped past is right.
          navigate(`/intake?filing_id=${target.id}&step=1`);
          return;
        }
      }

      // Straight to payment. There used to be a "Review and Payment" screen in
      // between, which restated the filing and offered one button; intake's own
      // review section already shows all of that, and the filer has just read
      // it, so the extra stop was a page whose only content was a delay.
      //
      // The filing page is still there. It is where a paid filing signs and
      // downloads, and it is the fallback below if checkout will not start, so
      // a payment provider having a bad day never leaves anyone stranded with
      // no way to pay.
      const failure = await startCheckout(filingId);
      if (failure) {
        setError(`${failure} Your filing is saved. Open it from your dashboard to try the payment again.`);
        navigate(`/filing/${filingId}`);
      }
    } catch (e: unknown) {
      console.error(e);
      setError(`Your filing could not be submitted: ${describeError(e)} Your answers are still saved, try again, and if it keeps happening send that message to support@filetax.co.`);
    } finally {
      setSaving(false);
    }
  };

  const openRpForm = (idx?: number) => {
    setRpErrors([]);
    if (idx !== undefined) {
      setRpDraft({ ...relatedParties[idx] });
      setEditingRpIdx(idx);
    } else {
      setRpDraft({ name: '', ref_number: '', country: '', country_residence: '', us_tin: '', foreign_tax_id: '', address: {}, biz_activity: '', biz_code: '' });
      setEditingRpIdx(null);
    }
    setShowRpForm(true);
  };

  const saveRpDraft = () => {
    const errs = validateRelatedPartyDraft(rpDraft);
    setRpErrors(errs);
    if (errs.length > 0) return;
    const updated = { ...rpDraft };
    if (editingRpIdx !== null) {
      setRelatedParties((prev) => prev.map((rp, i) => (i === editingRpIdx ? updated : rp)));
    } else {
      setRelatedParties((prev) => [...prev, updated]);
    }
    setShowRpForm(false);
    setEditingRpIdx(null);
    setRpErrors([]);
  };

  const removeRp = (i: number) => {
    setRelatedParties((prev) => prev.filter((_, idx) => idx !== i));
    setTransactions((prev) =>
      prev.filter((t) => t.related_party_index !== i + 1)
          .map((t) => ({ ...t, related_party_index: t.related_party_index > i + 1 ? t.related_party_index - 1 : t.related_party_index })),
    );
  };

  // Reset the left-hand transaction form back to a blank "add" state.
  const clearTxForm = () => {
    setTxAmt('');
    setTxLoanBegin('');
    setTxDesc('');
    setTxDate('');
    setTxType('');
    setTxDir('received');
    // The party is DELIBERATELY kept. This used to reset to 0, the owner, after
    // every add, so a filer entering several transactions for one related party
    // had the second and every one after it silently recorded against the owner
    // unless they noticed the dropdown had moved on its own. Someone entering
    // eight rows for one party would have had seven of them misattributed.
    // Keeping it also stops the quick-type list swapping between the owner list
    // and the related-party list under the filer between one add and the next.
    setShowDetailedTx(false);
    setOpenCategory(null);
    setTxSearch('');
    setCat3Acknowledged(false);
    setTxErrors([]);
    setEditingTxIdx(null);
  };

  // Add a new transaction, or save edits back into the row being edited.
  const addTransaction = () => {
    const errs = validateTransactionDraft();
    setTxErrors(errs);
    if (errs.length > 0) return;
    const row = {
      related_party_index: txRelatedPartyIdx,
      transaction_type: txType,
      direction: txDir,
      amount_usd: txAmt,
      loan_begin_usd: LOAN_TYPES.has(txType) ? txLoanBegin : '',
      description: txDesc,
      transaction_date: txDate,
    };
    setTransactions((prev) =>
      editingTxIdx !== null
        ? prev.map((t, i) => (i === editingTxIdx ? row : t))
        : [...prev, row],
    );
    clearTxForm();
    setStepErrors([]);
    setNoTransactionsConfirmed(false);
    requestTransactionSave();
    // Back to the total and the empty form, for an add and for a saved edit
    // alike. Both end with the same cleared form and the same next move.
    scrollToTransactionsTop();
  };

  // Load an existing transaction into the left-hand form for editing.
  const startEditTransaction = (i: number) => {
    const t = transactions[i];
    if (!t) return;
    setEditingTxIdx(i);
    setTxRelatedPartyIdx(t.related_party_index);
    setTxType(t.transaction_type);
    setTxDir(t.direction ?? 'received');
    setTxAmt(t.amount_usd ?? '');
    setTxLoanBegin(t.loan_begin_usd ?? '');
    setTxDesc(t.description ?? '');
    setTxDate(t.transaction_date ?? '');
    setTxSearch('');
    setShowDetailedTx(false);
    setCat3Acknowledged(false);
    setTxErrors([]);
    scrollToTransactionDetails();
  };

  const removeTransaction = (i: number) => {
    setTransactions((prev) => prev.filter((_, idx) => idx !== i));
    // If the row being edited was removed, reset the form back to "add" mode.
    setEditingTxIdx((cur) => (cur === i ? null : cur !== null && cur > i ? cur - 1 : cur));
    requestTransactionSave();
  };

  /**
   * DEV ONLY, drop a test scenario into the form's state.
   *
   * It fills exactly the state the tester's own typing would fill, then stops.
   * Nothing is validated, saved or submitted here: the tester still clicks
   * through every step, so a negative scenario fails where it is supposed to
   * fail rather than being waved through by the loader.
   *
   * A multi-year scenario has no single filing of its own, it carries shared
   * fields plus one entry per year, so we load the shared data and the FIRST
   * year, and say so in the message. The remaining years come from the
   * multi-year start flow, which is the thing that scenario is testing anyway.
   */
  const applyScenario = (s: any): string => {
    const f = s.filing ?? s.shared_filing_fields ?? {};
    const yearOne = s.year_specific_filings?.[0];
    const o = s.owner ?? s.shared_owner_fields ?? {};
    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

    // Step 1, LLC
    setLlcName(str(f.llc_name));
    setEin(str(f.ein));
    setStateOfFormation(str(f.state_of_formation));
    setTaxYear(str(f.tax_year ?? yearOne?.tax_year ?? taxYear));
    setTotalAssets(str(f.total_assets ?? yearOne?.total_assets));
    setEntityDOI(str(f.date_of_incorporation ?? f.entity_date_of_incorporation));
    setEntityPrincipalCountry(str(f.entity_principal_country));
    setMailing((f.mailing_address as Address) ?? { country: 'US' });
    setEntityBizActivity(str(f.naics_description ?? f.entity_business_activity));
    setEntityBizCode(str(f.naics_code ?? f.entity_business_code));
    setFinalReturn(Boolean(f.final_return ?? yearOne?.final_return ?? false));
    setDateOfClosure(str(f.date_of_closure ?? yearOne?.date_of_closure));
    setNameChange(Boolean(f.name_change ?? yearOne?.name_change ?? false));
    setAddressChange(Boolean(f.address_change ?? yearOne?.address_change ?? false));
    setNameChange(Boolean(f.name_change ?? yearOne?.name_change ?? false));
    setAddressChange(Boolean(f.address_change ?? yearOne?.address_change ?? false));
    setIsFiscalYear(Boolean(f.is_fiscal_year));
    setFiscalEndMonth(f.fiscal_end_month ? Number(f.fiscal_end_month) : '');

    // Step 1b, lateness and the reasonable-cause letter
    setExtensionFiled(f.extension_filed ?? null);
    setIncludeReasonableCause(Boolean(f.include_reasonable_cause ?? s.include_rcl ?? false));
    setReasonableCauseReasons(f.reasonable_cause_reasons ?? s.reasonable_cause_reasons ?? []);

    // Step 2, owner. A legacy row may carry a code with a blank activity, so
    // recover the preset the same way the filing loader does.
    setOwnerName(str(o.owner_full_name));
    setOwnerCountry(str(o.owner_primary_country));
    setOwnerCountryRes(str(o.owner_country_residence));
    setOwnerCountryCitizenship(str(o.owner_country_citizenship));
    setOwnerSSN(str(o.owner_us_tin));
    setOwnerForeignTaxId(str(o.owner_foreign_tax_id));
    setOwnerRefNumber(str(o.owner_reference_id));
    setOwnerAddress((o.owner_address as Address) ?? {});
    const ownerCode = str(o.owner_naics_code);
    const preset = resolveBizPreset(o.owner_business_activity, ownerCode);
    setOwnerBizActivity(str(o.owner_business_activity).trim() || preset?.label || '');
    setOwnerBizCode(ownerCode);
    // Load exactly what the scenario says. Substituting a default here made a
    // blank signer title impossible to test: the loader filled it back in
    // before any validation could see it, so the scenario silently passed on
    // data it never actually used.
    setSignerTitle(str(o.signer_title));
    setSignatureDate(str(o.signature_date));

    // Steps 3 & 4
    setRelatedParties((s.related_parties as RelatedParty[]) ?? []);
    setTransactions(((s.transactions ?? yearOne?.transactions ?? []) as TransactionRow[]).map((t) => ({
      ...t,
      amount_usd: str(t.amount_usd),
      loan_begin_usd: str(t.loan_begin_usd),
      description: str(t.description),
      transaction_date: str(t.transaction_date),
    })));
    setNoTransactionsConfirmed(Boolean(s.no_transactions_confirmed ?? yearOne?.no_transactions_confirmed ?? false));
    setPartViManagerial(s.part_vi_managerial ?? true);

    // Clear anything left over from a previous scenario. cat3Acknowledged
    // belongs here: left in place, a scenario written to exercise the tier-3
    // gate passed on an acknowledgment ticked by the PREVIOUS scenario.
    setCat3Acknowledged(false);
    // A scenario is a fully-populated filing, so its related-party and owner
    // sections count as reviewed, empty or not.
    setRelatedPartiesReviewed(true);
    setOwnerReviewed(true);
    setStepErrors([]);
    setRpErrors([]);
    setTxErrors([]);
    setEinErr(null);
    setError(null);
    setShowRpForm(false);
    setEditingRpIdx(null);
    setEditingTxIdx(null);

    const txCount = (s.transactions ?? yearOne?.transactions ?? []).length;
    const rpCount = (s.related_parties ?? []).length;
    const base = `Loaded ${str(f.llc_name) || 'scenario'} · ${rpCount} related ${rpCount === 1 ? 'party' : 'parties'} · ${txCount} transaction${txCount === 1 ? '' : 's'}. Now work through the form yourself, nothing has been saved.`;
    return s.year_specific_filings
      ? `${base} This is a ${s.year_specific_filings.length}-year job; only ${yearOne?.tax_year} was loaded, start the rest from the multi-year flow.`
      : base;
  };

  if (loadingFiling) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '3rem 1rem', textAlign: 'center', color: 'var(--tf-text-muted, #6b7280)' }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      <style>{`
        /* Text-like controls only.
           This used to be a bare \`.intake-form input\`, which also matched
           checkboxes and radios and gave them width:100%, a 0.5rem padding and
           a border. Inside a flex row that makes the box a full-width item, so
           its label gets whatever is left over, wraps to a few characters per
           line, and spills outside the card. Two places had already been
           patched with \`width: 1.1rem !important\` overrides scoped to
           .select-card and .confirm-check-row, which hid the problem for those
           rows and left it waiting for the next checkbox added anywhere else.
           The eligibility attestation was that next checkbox.
           Excluding the types here fixes it at the source; the two !important
           overrides below are now belt-and-braces rather than load-bearing. */
        .intake-form input:not([type="checkbox"]):not([type="radio"]),
        .intake-form select,
        .intake-form textarea {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--tf-border, #d1d5db);
          border-radius: 0.5rem;
          font-size: 0.9375rem;
          font-family: inherit;
          background: var(--tf-input-bg, var(--tf-surface, #fff));
          color: var(--tf-text, #111);
          outline: none;
          box-sizing: border-box;
          /* A field never widens its column. width: 100% is not enough inside
             a grid or flex parent, where the automatic minimum size is the
             control's min-content: for a select that is its longest option,
             and for a date input it is the browser's fixed picker width. */
          min-width: 0;
          max-width: 100%;
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }
        /* Custom dropdown chevron. The inset matches the field's 0.75rem left
           padding plus a little, so the arrow sits in visually balanced space
           rather than crowding the right edge, and the text can never run
           underneath it. */
        .intake-form select {
          appearance: none; -webkit-appearance: none; -moz-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%2364748B' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 1rem center;
          padding-right: 2.75rem;
        }
        /* The padlock on a paid-locked field, drawn in the control's right
           inset rather than after the label. \`.field-control\` wraps whatever a
           Field was given, which is usually one input but can be an input plus
           an explanatory box beneath it, so the lock is pinned to the height of
           the first row (controls are ~2.35rem tall) instead of to the centre
           of the wrapper, which would drift down the taller fields. */
        .intake-form .field-control { position: relative; }
        .intake-form .field-lock {
          position: absolute;
          right: 0.95rem;
          top: 1.175rem;
          transform: translateY(-50%);
          opacity: 0.8;
          pointer-events: none;
          color: var(--tf-muted);
        }
        /* A locked select is disabled, so its chevron was advertising a menu
           that cannot open. The lock takes that space. */
        .intake-form .field-control.is-locked select { background-image: none; }
        .intake-form .field-control.is-locked input:not([type="checkbox"]):not([type="radio"]) {
          padding-right: 2.25rem;
        }
        /* The chevron is a baked-in SVG, so its stroke cannot inherit the theme.
           Swap in a lighter one for dark mode instead of leaving a near-black
           arrow on a near-black field. */
        [data-theme="dark"] .intake-form select {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%2394A3B8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        }
        /* The native date-picker icon is themed globally in taxfile.css, not
           here: scoping it to .intake-form left every date field on every other
           screen with an invisible icon in dark mode. */
        /* Same exclusion as above. This ring is drawn with border-color plus a
           box-shadow, and the checkbox overrides force \`border: none\` and
           \`box-shadow: none\`, so applying it to a checkbox produced no visible
           focus state at all. Leaving checkboxes and radios out means they keep
           the browser's native focus ring, which is the accessible outcome. */
        .intake-form input:not([type="checkbox"]):not([type="radio"]):focus,
        .intake-form select:focus,
        .intake-form textarea:focus {
          border-color: var(--tf-accent);
          box-shadow: 0 0 0 3px rgba(var(--tf-accent-rgb), 0.18);
        }
        .intake-form input::placeholder { color: var(--tf-muted); opacity: 1; }
        .intake-form input[data-invalid="true"],
        .intake-form select[data-invalid="true"] {
          border-color: var(--tf-error);
          box-shadow: 0 0 0 3px rgba(var(--tf-error-rgb), 0.15);
        }
        /* The Tailwind preflight sets \`list-style: none\` on every ul, so the
           five lists in this page were indented but had no markers and read as
           loose lines rather than as a list. Restored here rather than inline
           on each one, because the next list added would have had the same
           problem. */
        .intake-form ul {
          list-style-type: disc;
          padding-left: 1.25rem;
        }
        .intake-form li { margin: 0; }
        .intake-form .field-error { font-size: 0.78rem; color: var(--tf-error-text); margin-top: 0.25rem; }
        .intake-form select option {
          background: var(--tf-surface);
          color: var(--tf-text);
        }

        /* ── Vertical accordion (steps as sections) ── */
        .acc-section {
          border: 1px solid var(--tf-border);
          border-radius: 0.75rem;
          background: var(--tf-surface);
          margin-bottom: 1.25rem;
          overflow: hidden;
        }
        .acc-trigger {
          display: flex; align-items: center; gap: 0.75rem; width: 100%;
          padding: 1rem 1.25rem; background: transparent; border: none;
          cursor: pointer; text-align: left; font-family: inherit;
          transition: background 0.18s ease;
        }
        .acc-trigger:hover { background: var(--tf-offset); }
        .acc-trigger[aria-expanded="true"] { border-bottom: 1px solid var(--tf-border); }
        .acc-trigger-label { flex: 1; font-weight: 700; font-size: 1rem; color: var(--tf-text); }
        .acc-progress-dot {
          display: inline-flex; align-items: center; justify-content: center;
          width: 1.35rem; height: 1.35rem; border-radius: 50%; flex-shrink: 0;
          border: 1.5px solid var(--tf-border); background: var(--tf-surface);
          color: var(--tf-on-accent); font-size: 0.7rem; font-weight: 800; line-height: 1;
        }
        .acc-progress-dot.is-complete { background: var(--tf-accent); border-color: var(--tf-accent); }
        .acc-trigger-chevron { color: var(--tf-muted); display: flex; transition: transform 0.2s ease; flex-shrink: 0; }
        .acc-trigger-chevron.is-open { transform: rotate(180deg); }
        /* Generous body padding, the form reads as dense otherwise, with
           fields running straight into the section edge. */
        .acc-body { padding: 1.75rem 1.5rem 1.5rem; }
        @media (max-width: 520px) { .acc-body { padding: 1.25rem 1rem; } }

        /* ── Year tabs (multi-year catch-up) ── */
        .year-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .year-tab {
          padding: 0.4rem 0.9rem; border-radius: 2rem; font-size: 0.85rem; font-weight: 600;
          border: 1.5px solid var(--tf-border); background: var(--tf-surface);
          color: var(--tf-muted); cursor: pointer; font-family: inherit;
          transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }
        .year-tab:hover { border-color: var(--tf-accent-soft); }
        .year-tab--active { background: var(--tf-accent); border-color: var(--tf-accent); color: var(--tf-on-accent); cursor: default; }

        /* ── Radio / checkbox selection cards ── */
        .select-card {
          display: flex; gap: 0.75rem; align-items: flex-start;
          padding: 0.875rem 1rem;
          border: 1px solid var(--tf-border);
          border-radius: 0.625rem; cursor: pointer;
          background: var(--tf-surface);
          transition: border-color 0.18s ease, background 0.18s ease,
                      box-shadow 0.18s ease, transform 0.18s ease;
        }
        .select-card { transform: translateY(0); }
        .select-card:hover {
          border-color: var(--tf-accent-soft);
          background: var(--tf-offset);
          transform: translateY(-1px);
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.07);
        }
        .select-card:active { transform: translateY(0); box-shadow: none; }
        /* Selected keeps the page surface behind it and states itself through
           the border + ring. Filling the card with a tint made it read as a
           coloured notice rather than a chosen option. */
        .select-card.is-selected {
          border-color: var(--tf-accent);
          box-shadow: 0 0 0 3px rgba(var(--tf-accent-rgb), 0.14);
        }
        .select-card.is-selected .select-card-label { color: var(--tf-accent); }
        .select-card input[type="radio"],
        .select-card input[type="checkbox"] {
          width: 1.1rem !important; height: 1.1rem !important;
          flex-shrink: 0; margin-top: 0.15rem;
          accent-color: var(--tf-accent);
          padding: 0 !important; border: none !important;
          box-shadow: none !important;
        }
        /* A faxed filing cannot change, so its cards must stop behaving like
           controls: no hover lift, no pointer, no click. The selected ones keep
           their ring, because the point of the read-only view is to show which
           answers went to the IRS. */
        .select-card.is-locked {
          cursor: default;
          pointer-events: none;
        }
        .select-card.is-locked:hover {
          border-color: var(--tf-border);
          background: var(--tf-surface);
          transform: translateY(0);
          box-shadow: none;
        }
        .select-card.is-locked.is-selected:hover {
          border-color: var(--tf-accent);
          box-shadow: 0 0 0 3px rgba(var(--tf-accent-rgb), 0.14);
        }
        .select-card-label { font-weight: 600; font-size: 0.9rem; color: var(--tf-text); }
        .select-card-hint { font-size: 0.8rem; color: var(--tf-muted); margin-top: 0.15rem; line-height: 1.4; }

        /* ── Transaction category accordion ── */
        .tx-cat-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.875rem 1rem; cursor: pointer; user-select: none;
          background: var(--tf-surface);
          transition: background 0.18s ease;
        }
        .tx-cat-header:hover { background: var(--tf-offset); }
        .tx-cat-header.is-open { background: rgba(var(--tf-accent-rgb), 0.08); }
        .tx-cat-chevron {
          width: 1.25rem; height: 1.25rem; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: var(--tf-muted);
          transition: transform 0.2s;
        }
        .tx-cat-chevron.is-open { transform: rotate(180deg); }
        .tx-cat-body {
          border-top: 1px solid var(--tf-border);
          padding: 0.875rem; background: var(--tf-offset);
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.5rem;
        }
        .tx-type-card {
          text-align: left; border: 1px solid var(--tf-border);
          border-radius: 0.625rem; padding: 0.75rem 0.875rem;
          background: var(--tf-surface); cursor: pointer; width: 100%;
          transition: border-color 0.18s ease, box-shadow 0.18s ease,
                      background 0.18s ease, transform 0.18s ease;
        }
        .tx-type-card:hover {
          border-color: var(--tf-accent-soft);
          background: var(--tf-offset);
          transform: translateY(-1px);
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.07);
        }
        .tx-type-card:active { transform: translateY(0); box-shadow: none; }
        .tx-type-card.is-selected { border-color: var(--tf-accent); box-shadow: 0 0 0 3px rgba(var(--tf-accent-rgb), 0.10); background: rgba(var(--tf-accent-rgb), 0.06); }
        .tx-type-label { font-weight: 600; font-size: 0.9rem; color: var(--tf-text); }
        .tx-type-sentence { display: block; margin-top: 0.25rem; font-size: 0.8125rem; color: var(--tf-muted); line-height: 1.45; }

        /* ── Transactions split: Add form (left) + live list (right) ── */
        .tx-split {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
          align-items: start;
          margin-top: 1.5rem;
        }
        @media (max-width: 640px) {
          .tx-split { grid-template-columns: 1fr; }
        }

        /* ── Confirm no-transactions row ──
           A checkbox the filer must tick, so it is styled as a control (full
           rounded border on the page surface), not as an amber notice, it used
           to wear the banner's fill and read as something to skim past. */
        .confirm-check-row {
          display: flex; gap: 0.75rem; align-items: flex-start;
          padding: 1rem 1.25rem;
          background: var(--tf-surface);
          border: 1px solid var(--tf-banner-amber-border);
          border-radius: 0.625rem;
          margin-top: 1.5rem;
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .confirm-check-row:hover { box-shadow: 0 1px 6px rgba(var(--tf-warn-rgb), 0.12); }
        /* Plain opt-ins (fiscal year, final return, owner services) carry no
           warning weight, so they start on a neutral border. Kept as a class
           rather than an inline style so .is-selected can still win. */
        .confirm-check-row--neutral { border-color: var(--tf-border); }
        /* Neutral rows are plain opt-ins, so their tick is the accent colour.
           The warn-amber tick is reserved for the no-transactions confirmation,
           and looked wrong against a blue selected border. */
        .confirm-check-row--neutral input[type="checkbox"] { accent-color: var(--tf-accent) !important; }
        .confirm-check-row.is-selected {
          border-color: var(--tf-accent);
          box-shadow: 0 0 0 3px rgba(var(--tf-accent-rgb), 0.14);
        }
        .confirm-check-row input[type="checkbox"] {
          width: 1.1rem !important; height: 1.1rem !important;
          flex-shrink: 0; margin-top: 0.15rem;
          accent-color: var(--tf-warn);
          padding: 0 !important; border: none !important;
          box-shadow: none !important;
        }

        /* ── Notices (green = routine, amber = review, red = complex) ──
           A notice is something to READ; a .select-card is something to CLICK.
           They used to share one look, a full saturated border around a tinted
           fill, so each read as the other. Notices now carry a left accent bar
           and no full outline; the enclosing box is the page surface, not a
           control. Anything clickable keeps the full rounded border. Never give
           a notice a complete border, and never give a control a left bar. */
        .cat-banner-green,
        .cat-banner-amber,
        .cat-banner-red {
          border: none;
          border-left: 3px solid;
          border-radius: 0 0.5rem 0.5rem 0;
          padding: 0.875rem 1.125rem;
          font-size: 0.8125rem;
          margin-bottom: 1.25rem;
          line-height: 1.55;
        }
        .cat-banner-green { background: var(--tf-banner-green-bg); border-left-color: var(--tf-banner-green-border); color: var(--tf-banner-green-text); }
        .cat-banner-amber { background: var(--tf-banner-amber-bg); border-left-color: var(--tf-banner-amber-border); color: var(--tf-banner-amber-text); }
        .cat-banner-red   { background: var(--tf-banner-red-bg);   border-left-color: var(--tf-banner-red-border);   color: var(--tf-banner-red-text); }
        /* Selection cards sitting inside a notice (e.g. the "have you filed
           earlier years?" prompt) need to read as controls against the tint, so
           they get the page surface behind them rather than the notice's. */
        .cat-banner-green .select-card,
        .cat-banner-amber .select-card,
        .cat-banner-red .select-card { background: var(--tf-surface); }
        .cat3-ack-row { display: flex; gap: 0.75rem; align-items: flex-start; margin-top: 0.75rem; }
        .cat3-ack-row input[type="checkbox"] { width: 1.1rem !important; height: 1.1rem !important; flex-shrink: 0; margin-top: 0.1rem; accent-color: var(--tf-error); padding: 0 !important; border: none !important; box-shadow: none !important; }
      `}</style>

      <div className="intake-form" style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>
        {/* Intake page header, a clean, consistent title bar above the sections */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              style={{ background: 'none', border: 'none', color: 'var(--tf-muted)', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, padding: 0, marginBottom: '0.35rem' }}
            >
              ← Dashboard
            </button>
            {/* The page title names the section the filer is on (e.g. "1. LLC
                details"), so the whole page reads as that step. The company name
                and form context move to the subtitle line below. */}
            <h1 style={{ fontSize: '1.375rem', lineHeight: 1.2, margin: 0, color: 'var(--tf-text)' }}>
              {`${stepNumber(step)}${STEP_LABELS[String(step)] ?? 'Filing'}`}
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', margin: '0.2rem 0 0' }}>
              {(llcName?.trim() ? `${llcName.trim()} · ` : '')}Form 5472 + Pro Forma 1120 · Tax year {taxYear}
            </p>
          </div>
        </div>

        {jobId && (
          <div style={{ background: 'rgba(var(--tf-accent-rgb), 0.08)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.625rem 1rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: 'var(--tf-text)' }}>
            {/* Reads off the SAME nextOpenYear the button and the routing use.
                It used to promise a next year unconditionally, so the last year
                of a two-year catch-up said "we'll take you to the next one"
                while its own button said the next stop was payment.

                Both branches NAME the years. "The next one" told the filer
                nothing, and "the last year left in this catch-up" read as
                though the other years had gone somewhere, on the screen where
                what they actually want to know is which years they are about to
                pay for. */}
            <strong>
              Tax year {taxYear}
              {jobYears.length > 1 ? ` of ${jobYears.length}` : ''}.
            </strong>{' '}
            {nextDraftYear
              ? `Finish this year and ${nextDraftYear} opens next.`
              : `This is the last one. Finishing it takes you to payment for ${joinYears(jobYears.map((y) => y.tax_year))} together.`}{' '}
            Your LLC and owner details are shared across every year.
          </div>
        )}

        {/* Year tabs, switch between the years selected for this catch-up job. */}
        {jobId && jobYears.length > 1 && (
          <div style={{ marginBottom: '1.25rem' }}>
            <div className="year-tabs" role="tablist" aria-label="Tax years in this catch-up">
              {jobYears.map((y) => {
                const active = y.tax_year === String(taxYear);
                return (
                  <button
                    key={y.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`year-tab${active ? ' year-tab--active' : ''}`}
                    onClick={() => switchYear(y.id)}
                    disabled={saving}
                  >
                    {y.tax_year}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
              Your company and owner details are shared across every year. Only the tax period and each year’s transactions change per year.
            </p>
          </div>
        )}

        {/* Scroll anchor kept for error-summary focus. */}
        <div ref={stepTopRef} aria-hidden="true" />

        {/* Two locks, two banners, and the sent one REPLACES the paid one
            rather than stacking on it. A filer whose pages are at the IRS does
            not need to be told which fields payment froze; they need to be told
            that none of them can move now. Showing both would end on the paid
            banner's promise that corrections can be re-downloaded as often as
            needed, which is exactly what is no longer true. */}
        {/* The sent banner says the three things a filer needs and stops. It
            used to also explain that their answers were worth keeping for next
            year, and that an edit here would leave them holding a return the
            IRS did not receive: both true, but that is the REASONING behind the
            lock, and a banner is not where someone reads an argument. The route
            out was described in prose ("from the filing page") with nothing to
            click, which is what the button in it now fixes. */}
        {isFaxLocked ? (
          <div className="cat-banner-amber" style={{ marginBottom: '1.25rem' }}>
            <strong>This filing has been faxed to the IRS.</strong> These answers are read-only: the
            IRS holds the pages exactly as they were sent. If something on it is wrong, email
            support@filetax.co.
            {filingId && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => navigate(`/filing/${filingId}`)}
                  style={{
                    background: 'none', border: 'none', padding: 0, margin: 0,
                    font: 'inherit', color: 'inherit', textAlign: 'left',
                    textDecoration: 'underline', textUnderlineOffset: '0.15em', cursor: 'pointer',
                  }}
                >
                  Download your fax record and the pages sent
                </button>.
              </>
            )}
          </div>
        ) : isPaidLocked && (
          <div className="cat-banner-amber" style={{ marginBottom: '1.25rem' }}>
            <strong>This filing has been paid.</strong> Your company and owner identity (EIN, LLC name, tax year, owner name &amp; tax ID, incorporation date) are locked. To file for a different company or year, start a new filing.{' '}
            You can correct other details and transactions, then re-download, as often as needed.
          </div>
        )}

        <div ref={errorSummaryRef}>
          {error && <div style={errorSummaryStyle}>{error}</div>}
          {stepErrors.length > 0 && (
            <div style={errorSummaryStyle}>
              <div style={{ fontWeight: 700, marginBottom: '0.45rem' }}>Please complete the following before continuing</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {stepErrors.map((e, i) => (
                  <li key={i} style={{ marginBottom: '0.25rem' }}>
                    {typeof e === 'string' ? e : (
                      // A button, not an anchor: there is no URL for a field
                      // inside a collapsed accordion section, and an href="#"
                      // would put a dead entry in the filer's history for every
                      // message they clicked. Underlined and inheriting the
                      // error colour, so it reads as the message it is rather
                      // than as a link bolted onto one.
                      <button
                        type="button"
                        onClick={() => jumpToField(e.section, e.field)}
                        style={errorLinkStyle}
                      >
                        {e.msg}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Step 1: LLC Details ── */}
        <AccordionSection numberLabel={stepNumber(1)} label={STEP_LABELS['1']} open={openSections.has('1')} complete={sectionProgress(1) === 'complete'} onToggle={() => toggleSection('1')} anchorRef={(el) => { sectionRefs.current['1'] = el; }} frozen={isFaxLocked}>
          <div>
            <h2 style={stepHeadingStyle}>Your LLC details</h2>
            <p style={stepSubheadStyle}>Basic information about the U.S. company. This goes on the Pro Forma 1120 and all Form 5472 filings.</p>

            {/* Which company is this filing for?
                Shown only on a brand-new filing that has saved companies, and
                only until the filer answers. Prefill used to happen first and
                announce itself afterwards, which is how a second-LLC filer
                ended up with the wrong EIN on a filing that freezes it at
                payment. */}
            {/* Same fill as "Before you start this year" directly below it.
                This box had no background, so it inherited the page and read as
                a different kind of surface from its neighbour, which is the
                same card at the same width with the same border. */}
            {showCompanyPicker && savedCompanies.length > 0 && (
              <div style={{
                border: '1px solid var(--tf-border)',
                borderRadius: '0.625rem',
                padding: '1.125rem 1.25rem',
                marginBottom: '1.5rem',
                background: 'var(--tf-bg)',
              }}>
                <h3 style={{ ...sectionLabelStyle, marginTop: 0 }}>Which company is this filing for?</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', margin: '0 0 0.875rem', lineHeight: 1.55 }}>
                  Pick a company to bring its details across, or start blank. Check the EIN is the right one: it is locked once this filing is paid for.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {savedCompanies.map((co) => (
                    <button
                      key={co.ein ?? co.llc_name ?? Math.random()}
                      type="button"
                      onClick={() => importCompany(co, importRelatedParties)}
                      style={{ ...groupedCardStyle, textAlign: 'left', padding: '0.75rem 1rem', cursor: 'pointer', background: 'transparent', display: 'block', width: '100%' }}
                    >
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--tf-text)' }}>
                        {co.llc_name?.trim() || 'Unnamed company'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                        EIN {formatEinDigits(co.ein)}
                        {co.state_of_formation ? ` · ${co.state_of_formation}` : ''}
                        {co.last_filed_tax_year ? ` · last filed ${co.last_filed_tax_year}` : ''}
                      </div>
                    </button>
                  ))}
                </div>

                {savedCompanies.some((c) => Array.isArray(c.related_parties) && c.related_parties.length > 0) && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.875rem', fontSize: '0.82rem', color: 'var(--tf-muted)' }}>
                    <input type="checkbox" checked={importRelatedParties} onChange={(e) => setImportRelatedParties(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
                    Also bring across the related parties saved for that company
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => setShowCompanyPicker(false)}
                  style={{ ...secondaryBtnStyle, marginTop: '0.875rem' }}
                >
                  Start blank
                </button>
              </div>
            )}

            {prefilledFromProfile && (
              <div className="cat-banner-green" style={{ marginBottom: '1.5rem' }}>
                <strong>We’ve brought across your saved details for this company.</strong> Please review everything below and update anything that changed. Your edits here apply to this filing only.
              </div>
            )}

            {/* Eligibility re-confirmation.
                The checker is a first-visit screen and Form 5472 is an annual
                obligation, so a year-two filer never sees it again. What it
                screens for changes between years: a second member joins, the
                owner meets the Substantial Presence Test, an 8832/2553 gets
                filed, U.S. activity starts. Asked once per filing rather than
                re-running all six questions, which would cost the user twice
                for the same answers. */}
            <div
              style={{
                border: '1px solid var(--tf-border)',
                borderRadius: '0.625rem',
                padding: '1.125rem 1.25rem',
                marginBottom: '1.5rem',
                background: 'var(--tf-bg)',
              }}
            >
              <h3 style={{ ...sectionLabelStyle, marginTop: 0 }}>Before you start this year</h3>
              {/* Uses the shared .confirm-check-row rather than a hand-rolled
                  flex row. The hand-rolled version is what surfaced the
                  checkbox-width bug: it had no !important override to protect
                  it, so the box took the full width and the label wrapped to a
                  few characters and spilled out of the card. The root cause is
                  fixed above, and matching the other opt-in rows also makes
                  this one look like the controls it sits beside. */}
              <label
                data-anchor="eligibility"
                className={`confirm-check-row confirm-check-row--neutral${eligibilityConfirmed ? ' is-selected' : ''}`}
                style={{ cursor: isPaidLocked ? 'not-allowed' : 'pointer', marginTop: 0 }}
              >
                <input
                  type="checkbox"
                  checked={eligibilityConfirmed}
                  onChange={(e) => setEligibilityConfirmed(e.target.checked)}
                  disabled={isPaidLocked}
                  style={{ accentColor: 'var(--tf-accent)' }}
                />
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                  For this tax year my LLC still has one owner, a non-U.S. individual, and no
                  8832 or 2553 election.
                  <InfoTooltip
                    label="What this flow covers"
                    text={
                      'This flow prepares Form 5472 with a pro forma 1120 for a U.S. LLC that, for this tax year: '
                      + '(1) has one owner only; '
                      + '(2) is owned by a non-U.S. individual, meaning no U.S. citizenship, no Green Card, and the Substantial Presence Test not met; '
                      + '(3) has no Form 8832 or Form 2553 election on file.'
                    }
                  />
                </div>
              </label>
              <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.5rem', lineHeight: 1.6 }}>
                Not sure?{' '}
                <Link to="/check" style={{ color: 'var(--tf-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                  Run the eligibility check
                </Link>
                {' '} (about a minute, nothing is saved).
              </p>

              <div style={{ borderTop: '1px solid var(--tf-border)', marginTop: '1rem', paddingTop: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--tf-text)', lineHeight: 1.65, marginBottom: '0.625rem' }}>
                  During this tax year, did the LLC own or rent out U.S. real estate, or was any
                  work performed by anyone physically inside the U.S.?
                  <InfoTooltip
                    label="About U.S.-source income"
                    text="Services count as U.S.-source based on where the work was done, not where the customer is. Having U.S. customers, or a U.S. bank account, does not by itself make income U.S.-source."
                  />
                </p>
                <div data-anchor="hasUsActivity" style={{ display: 'flex', gap: '0.625rem' }}>
                  {[
                    { val: false, label: 'No' },
                    { val: true, label: 'Yes' },
                  ].map((o) => (
                    <button
                      key={String(o.val)}
                      type="button"
                      onClick={() => setHasUsActivity(o.val)}
                      disabled={isPaidLocked}
                      style={{
                        padding: '0.5rem 1.5rem',
                        borderRadius: '0.5rem',
                        minHeight: '44px',
                        cursor: isPaidLocked ? 'not-allowed' : 'pointer',
                        fontWeight: 600,
                        fontSize: '0.875rem',
                        border: hasUsActivity === o.val ? '1.5px solid var(--tf-accent)' : '1px solid var(--tf-border)',
                        background: hasUsActivity === o.val ? 'var(--tf-accent)' : 'var(--tf-surface)',
                        color: hasUsActivity === o.val ? '#fff' : 'var(--tf-text)',
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {hasUsActivity === true && (
                  <div className="cat-banner-amber" style={{ marginTop: '0.875rem' }}>
                    <strong>You may also need to file a personal return.</strong> Income the IRS
                    treats as U.S.-source can make you personally liable for Form 1040-NR, which is
                    required even when no tax is due. That is separate from Form 5472, so carry on
                    here. Form 1040-NR is not part of this package. Confirm your position with a
                    CPA or tax adviser.
                  </div>
                )}
              </div>
            </div>

            {/* Single-year multi-year nudge. Two situations lead to offering a
                multi-year catch-up:
                  A) Filing the LATEST filable year, but the LLC was incorporated
                     in an earlier year. We first ASK whether earlier returns
                     were already filed. If yes → caught up, no nudge. If no →
                     offer multi-year.
                  B) Filing a year that is NOT the latest, earlier years are
                     almost certainly outstanding, so offer multi-year directly. */}
            {!jobId && !isPaidLocked && (() => {
              const latestFilable = new Date().getUTCFullYear() - 1;
              const ty = Number(taxYear);
              const doiYear = entityDOI ? Number(entityDOI.slice(0, 4)) : null;
              const incorpBefore = doiYear != null && doiYear < ty;
              const isLatest = ty === latestFilable;

              // The catch-up always runs from formation (or 2019, our floor)
              // through the latest filable year, whichever year they happen to
              // be sitting on right now.
              const firstYear = doiYear != null ? Math.max(doiYear, 2019) : null;
              const spanYears = firstYear != null ? latestFilable - firstYear + 1 : null;

              // The saving is entirely the reasonable-cause letter: one per JOB
              // when filed together, one per FILING when filed year by year. Say
              // the two totals rather than describing the rule, because "you
              // don't pay the letter fee per year" is abstract and "$595 instead
              // of $1,192" is not.
              const money =
                spanYears != null && spanYears >= 2 ? (
                  <>
                    {' '}All {spanYears} years together is{' '}
                    <strong>{usd(spanYears * PRICE_PER_YEAR + PRICE_RCL)}</strong>. Filed one at a
                    time it's <strong>{usd(spanYears * (PRICE_PER_YEAR + PRICE_RCL))}</strong>,
                    because each separate filing needs its own letter.
                  </>
                ) : null;

              // Offer text + CTA, shared by both branches. Agreeing saves the
              // current company/owner details to the profile so the multi-year
              // form prefills them, then goes to the year picker.
              const offer = (
                <>
                  Catching up on every missed year together means one
                  reasonable-cause letter covers them all, and you don't pay the
                  letter fee per year.{money}{' '}
                  <button
                    type="button"
                    onClick={goToMultiYearWithDetails}
                    style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    File multiple years →
                  </button>
                </>
              );

              // Situation B: not the latest year → offer directly.
              if (!isLatest && ty >= 2019) {
                return (
                  <div className="cat-banner-amber" style={{ marginBottom: '1.5rem' }}>
                    <strong>Filing more than one year?</strong> You're filing {ty},
                    which isn't the most recent year. {offer}
                  </div>
                );
              }

              // Situation A: latest year, incorporated earlier → ask first.
              if (isLatest && incorpBefore) {
                return (
                  <div ref={earlierYearsRef} className="cat-banner-amber" style={{ marginBottom: '1.5rem' }}>
                    <strong>Have you already filed for earlier years?</strong>{' '}
                    Your LLC was formed in {doiYear}, so Form 5472 may be due for
                    each year since.
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => setEarlierReturnsFiled(true)}
                        className={`select-card${earlierReturnsFiled === true ? ' is-selected' : ''}`}
                        style={{ cursor: 'pointer', flex: 1 }}
                      >
                        <span className="select-card-label">Yes, earlier years are filed</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEarlierReturnsFiled(false)}
                        className={`select-card${earlierReturnsFiled === false ? ' is-selected' : ''}`}
                        style={{ cursor: 'pointer', flex: 1 }}
                      >
                        <span className="select-card-label">No, not yet</span>
                      </button>
                    </div>
                    {earlierReturnsFiled === false && (
                      <div style={{ marginTop: '0.75rem' }}>{offer}</div>
                    )}
                    {earlierReturnsFiled === true && (
                      <div style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
                        Great, you're caught up. Continue with just {ty} below.
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            })()}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company information</h3>
              <div style={gridStyle}>
                <Field anchor="llcName" label="LLC / Corporation name" style={{ gridColumn: '1 / -1' }} required locked={isPaidLocked}>
                  <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" disabled={isPaidLocked} />
                </Field>
                <Field anchor="ein" label="EIN" locked={isPaidLocked} required tooltip="Your LLC's 9-digit federal tax ID (format 12-3456789). Find it on your IRS EIN confirmation (CP-575), your formation service dashboard (Stripe Atlas, Doola, Firstbase), or by searching your email for 'EIN'.">
                  <input
                    value={ein}
                    onChange={(e) => { setEin(formatEIN(e.target.value)); setEinErr(null); }}
                    onBlur={handleEinBlur}
                    placeholder="12-3456789"
                    data-invalid={!!einErr}
                    disabled={isPaidLocked}
                  />
                  {einErr && <div className="field-error">{einErr}</div>}
                </Field>
                <Field anchor="stateOfFormation" label="State of formation" required>
                  <select value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)}>
                    <option value="">Select state</option>
                    {US_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field
                  anchor="taxYear"
                  label="Tax year"
                  required
                  locked={isPaidLocked} status={!isPaidLocked && jobId ? 'set by your multi-year selection' : undefined}
                >
                  {/* In a multi-year catch-up each year's filing is created with a
                      fixed tax year, and the intake walks the years in order, so
                      the tax year can't be changed here. It's also locked once
                      the filing is paid. */}
                  {/* A year this company has already PAID for is offered but
                      not selectable: the same company and year were being
                      filed twice with no warning. Drafts never block, only a
                      completed payment does. */}
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)} disabled={isPaidLocked || !!jobId}>
                    {TAX_YEARS.map((y) => (
                      <option key={y} value={String(y)} disabled={yearAlreadyFiled(y)}>
                        {y}{yearAlreadyFiled(y) ? ' — already filed' : ''}
                      </option>
                    ))}
                  </select>
                  {yearAlreadyFiled(taxYear) && (
                    <div style={{ ...infoBoxStyle, marginTop: '0.5rem' }}>
                      You have already filed {taxYear} for this EIN with us, and it has been paid for.
                      Choose a different year. If you need to change what was filed, that is an amended
                      return rather than a second filing, so email hello@filetax.co.
                    </div>
                  )}
                </Field>
                <Field anchor="totalAssets" label="Total assets (USD)" status="optional" tooltip="Usually your LLC's bank balance on December 31, plus the value of anything else it owns (equipment, inventory). A rough figure is fine.">
                  <input type="text" inputMode="numeric" value={formatMoney(totalAssets)} onChange={(e) => setTotalAssets(stripMoney(e.target.value))} placeholder="e.g. 50,000" />
                </Field>
                <Field anchor="entityDOI" label="Date of incorporation" required locked={isPaidLocked} tooltip="The date your LLC was officially formed, shown on your formation documents (Articles of Organization / Certificate of Formation).">
                  <input type="date" value={entityDOI} onChange={(e) => setEntityDOI(e.target.value)} disabled={isPaidLocked} />
                </Field>
                <Field anchor="entityPrincipalCountry" label="Main country where the LLC does business" required>
                  <select value={entityPrincipalCountry} onChange={(e) => setEntityPrincipalCountry(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field anchor="entityBizActivity" label="Type of business" required tooltip="Pick the closest match, or choose “Other” to type your own. This sets the IRS business code that describes what your LLC does.">
                  {(() => {
                    // The dropdown value is "Other" when the current activity is a
                    // custom entry not in the preset list. Picking a preset also
                    // fills the NAICS code; picking "Other" lets the filer type
                    // both the activity and the code by hand.
                    const isPreset = BIZ_ACTIVITIES.some((a) => a.label === entityBizActivity);
                    const selectValue = entityBizActivity === '' ? '' : (isPreset ? entityBizActivity : '__other__');
                    return (
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__other__') {
                            // Switch to manual entry: clear so the free-text input shows.
                            setEntityBizActivity(' ');
                            return;
                          }
                          setEntityBizActivity(val);
                          const match = BIZ_ACTIVITIES.find((a) => a.label === val);
                          if (match) setEntityBizCode(match.code);
                        }}
                      >
                        <option value="">Select activity</option>
                        {BIZ_ACTIVITIES.map((a) => (
                          // Show the NAICS code next to each activity.
                          <option key={`${a.label}-${a.code}`} value={a.label}>{a.label} ({a.code})</option>
                        ))}
                        <option value="__other__">Other (enter manually)</option>
                      </select>
                    );
                  })()}
                </Field>
                {/* When "Other" is selected (activity is set but not a preset), let
                    the filer type the activity description directly. */}
                {entityBizActivity !== '' && !BIZ_ACTIVITIES.some((a) => a.label === entityBizActivity) && (
                  <Field label="Business activity" required>
                    <input
                      value={entityBizActivity.trim()}
                      onChange={(e) => setEntityBizActivity(e.target.value)}
                      placeholder="Describe what your LLC does"
                    />
                  </Field>
                )}
                <Field anchor="entityBizCode" label="Business code" required tooltip="The 6-digit IRS business-activity code that matches what your LLC does. We fill it in automatically when you pick a type of business above, you can also type it yourself.">
                  <input value={entityBizCode} onChange={(e) => setEntityBizCode(e.target.value)} placeholder="e.g. 541511" />
                </Field>
              </div>
            </section>

            {/* ── Fiscal year + final return ─────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Tax period</h3>
              <label className={`confirm-check-row confirm-check-row--neutral${isFiscalYear ? ' is-selected' : ''}`} style={{ cursor: 'pointer', marginTop: 0 }}>
                <input type="checkbox" checked={isFiscalYear} onChange={(e) => setIsFiscalYear(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                    My LLC uses a fiscal year (not January to December)
                    <InfoTooltip text="Most LLCs use the calendar year (Jan 1 to Dec 31). Only tick this if your LLC was set up with a different tax year-end. If you're not sure, leave it unticked." label="About fiscal year" />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                    Leave unticked for the normal calendar year.
                  </div>
                </div>
              </label>
              {isFiscalYear && (
                <>
                  <div style={{ ...gridStyle, marginTop: '0.875rem' }}>
                    <Field anchor="fiscalEndMonth" label="Fiscal year-end month" required tooltip="The month your LLC's fiscal year ends. We derive the exact tax period from your tax year, so it always lines up with the year you're filing.">
                      <select value={fiscalEndMonth} onChange={(e) => setFiscalEndMonth(e.target.value ? Number(e.target.value) : '')}>
                        <option value="">Select month</option>
                        {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                          <option key={m} value={i + 1}>{m}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {fiscalEndMonth !== '' && (
                    <div className="cat-banner-amber" style={{ marginTop: '0.875rem' }}>
                      <strong>Fiscal-year filing.</strong> For tax year {taxYear}, your period runs{' '}
                      {formatDateLong(effectiveTaxPeriod.begin)} to {formatDateLong(effectiveTaxPeriod.end)}.
                      Double-check your filing due date before submitting.
                    </div>
                  )}
                </>
              )}

              <label className={`confirm-check-row confirm-check-row--neutral${finalReturn ? ' is-selected' : ''}`} style={{ cursor: 'pointer', marginTop: '0.875rem' }}>
                <input type="checkbox" checked={finalReturn} onChange={(e) => setFinalReturn(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                    This is my LLC's final return
                    <InfoTooltip text="Tick this only if the LLC was dissolved, closed, or permanently stopped operating during this tax year. Do NOT tick it for a year with no activity or a temporary pause." label="About final return" />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                    Only if the LLC closed or dissolved this year, not for a quiet year.
                  </div>
                </div>
              </label>

              {/* The dissolution date ends the tax period. Asked only when the
                  final-return box is ticked, because on any other year it has
                  nothing to shorten and would just be a question with no
                  consequence. */}
              {finalReturn && (
                <>
                  <div style={{ ...gridStyle, marginTop: '0.875rem' }}>
                    <Field
                      anchor="dateOfClosure"
                      label="Date the LLC was dissolved"
                      required
                      tooltip="The date the dissolution took effect with your state of formation, shown on the Certificate of Dissolution or Cancellation the state issued. Not the date you stopped trading, and not the date you closed the bank account."
                    >
                      {/* Bounded by the period being filed, not by the tax-year
                          number: a March-year-end 2025 filer dissolves anywhere
                          from 1 Apr 2025 to 31 Mar 2026. Validation repeats this
                          on submit, because `max` alone is advisory. */}
                      <input
                        type="date"
                        value={dateOfClosure}
                        onChange={(e) => setDateOfClosure(e.target.value)}
                        min={dissolutionMin}
                        max={nominalTaxPeriod.end}
                        aria-invalid={dissolutionDateError ? 'true' : undefined}
                      />
                      {/* Hidden while the summary above is already carrying
                          this exact message, so a failed submit shows it once,
                          not twice. */}
                      {/* Compared on the TEXT, not on the error object: the
                          summary now carries anchored errors, so an identity
                          check would stop matching and the same sentence would
                          be shown twice, which is the duplication the original
                          check was written to prevent. */}
                      {dissolutionDateError && !stepErrors.some((e) => errText(e) === dissolutionDateError) && (
                        <span className="field-error" role="alert">{dissolutionDateError}</span>
                      )}
                    </Field>
                  </div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--tf-muted)' }}>
                    Must fall inside the period you're filing for{' '}
                    ({formatDateLong(effectiveTaxPeriod.begin)} to {formatDateLong(nominalTaxPeriod.end)}).
                    Your tax period ends on this date instead of the normal year-end, and
                    both forms will show the shorter period.
                  </div>
                </>
              )}

              {/* Form 1120 item E, boxes 3 and 4.
                  Shown only on the EARLIEST year of a job. Every year in a
                  multi-year catch-up carries the CURRENT address, because that
                  is where the filer can be reached on the date of filing. The
                  change is flagged on the earliest return because the IRS
                  processes the package in order and updates its record from the
                  first one it handles; flagging the last year would leave the
                  earlier returns processed against a stale address, which is
                  how a CP15 penalty notice reaches a dead mailbox. */}
              {isEarliestJobYear && (
                <>
                  <label className={`confirm-check-row confirm-check-row--neutral${nameChange ? ' is-selected' : ''}`} style={{ cursor: 'pointer', marginTop: '0.875rem' }}>
                    <input type="checkbox" checked={nameChange} onChange={(e) => setNameChange(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                        The LLC's name has changed since the IRS last heard from us
                        <InfoTooltip text="Tick this if the LLC's legal name is different from the name the IRS has on file, whether that came from your EIN application (Form SS-4) or an earlier filing. Renaming an LLC after the EIN was issued is common, and it counts even if this is your first Form 5472." label="About name change" />
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                        Different from the name on your EIN application or your last filing.
                      </div>
                    </div>
                  </label>

                  <label className={`confirm-check-row confirm-check-row--neutral${addressChange ? ' is-selected' : ''}`} style={{ cursor: 'pointer', marginTop: '0.875rem' }}>
                    <input type="checkbox" checked={addressChange} onChange={(e) => setAddressChange(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                        The LLC's address has changed since the IRS last heard from us
                        <InfoTooltip text="Tick this if the address above is different from the one the IRS has on file, whether that came from your EIN application (Form SS-4) or an earlier filing. This matters: the IRS sends penalty notices to the address it holds, so an unflagged change can send a notice somewhere you will never see it." label="About address change" />
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                        Different from the address on your EIN application or your last filing. Registered-agent and virtual-office changes count.
                      </div>
                    </div>
                  </label>

                  {jobYears.length > 1 && (nameChange || addressChange) && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', lineHeight: 1.6, color: 'var(--tf-muted)' }}>
                      Every year in this catch-up is filed with your current details, so the IRS can
                      reach you today. The change is flagged on {jobYears[0]?.tax_year}, the earliest
                      year, because that is the return the IRS processes first.
                    </div>
                  )}
                </>
              )}
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC mailing address</h3>
              {/* The mailing address defaults to the U.S. but is not forced there:
                  many foreign-owned LLCs receive mail at the owner's address
                  abroad, and plenty of countries have no state or region at all.
                  Country is selectable and State/region follows the same
                  US-required / otherwise-optional rule as every other address. */}
              <AddressFields anchor="mailing" value={mailing} onChange={setMailing} />
            </section>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtnStyle} onClick={() => continueFromSection('1')} disabled={saving}>
                {continueLabel('1')}
              </button>
            </div>
          </div>
        </AccordionSection>

        {/* ── Step 1b: Filing Status (only when the filing is late) ── */}
        {show1b && (
        <AccordionSection numberLabel={stepNumber('1b')} label={STEP_LABELS['1b']} open={openSections.has('1b')} complete={sectionProgress('1b') === 'complete'} onToggle={() => toggleSection('1b')} anchorRef={(el) => { sectionRefs.current['1b'] = el; }} frozen={isFaxLocked}>
          <div>
            <h2 style={stepHeadingStyle}>Filing status</h2>
            <p style={stepSubheadStyle}>
              The original filing deadline for this tax year has passed. We need a couple of extra details before generating your forms.
            </p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Extension</h3>
              <div data-anchor="extensionFiled" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[
                  { val: true, label: 'Yes, I filed an extension (Form 7004) before the original deadline' },
                  { val: false, label: "No, I didn't file an extension" },
                ].map(({ val, label }) => (
                  <label
                    key={String(val)}
                    className={`select-card${extensionFiled === val ? ' is-selected' : ''}${isFaxLocked ? ' is-locked' : ''}`}
                  >
                    <input
                      type="radio"
                      name="extensionFiled"
                      checked={extensionFiled === val}
                      onChange={() => setExtensionFiled(val)}
                    />
                    <span className="select-card-label">{label}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* A multi-year job used to show a green banner here explaining that
                the reasonable cause letter was already chosen at year selection
                and covers every year. Nothing is asked on this screen for a job,
                so the banner answered a question the filer had not been asked,
                on the step where they are trying to get on with the return. The
                absence of the section is its own answer. */}

            {rclSectionShown && (
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Reasonable cause letter</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--tf-text-muted, #6b7280)', marginBottom: '0.875rem', lineHeight: 1.55 }}>
                A reasonable cause letter can help reduce or waive the $25,000 penalty for late filing. It's a +${PRICE_RCL} add-on that we draft for you alongside your forms, charged once however many years you are filing.
              </p>
              <label className={`select-card${includeReasonableCause ? ' is-selected' : ''}${isFaxLocked ? ' is-locked' : ''}`} style={{ marginBottom: '1.25rem' }}>
                <input
                  type="checkbox"
                  checked={includeReasonableCause}
                  onChange={(e) => { setIncludeReasonableCause(e.target.checked); if (!e.target.checked) setReasonableCauseReasons([]); }}
                />
                <div>
                  <div className="select-card-label">Yes, include a reasonable cause letter (+${PRICE_RCL})</div>
                  <div className="select-card-hint">We will draft a personalized letter to the IRS on your behalf.</div>
                </div>
              </label>

              {includeReasonableCause && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.625rem' }}>
                    Select only the reasons that apply
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)', lineHeight: 1.5, margin: '-0.125rem 0 0.75rem' }}>
                    Choose only statements that are true for this filing. Your letter will include a
                    declaration under penalties of perjury, and you will sign it before filing.
                  </p>
                  <div data-anchor="rclReasons" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {REASONABLE_CAUSE_REASONS.map((r) => {
                      const checked = reasonableCauseReasons.includes(r.value);
                      const toggle = () => setReasonableCauseReasons((prev) => checked ? prev.filter((x) => x !== r.value) : [...prev, r.value]);
                      return (
                        <div
                          key={r.value}
                          role="checkbox"
                          aria-checked={checked}
                          aria-disabled={isFaxLocked || undefined}
                          // Not a real input, so `disabled` does nothing here:
                          // the handlers and the tab stop have to come off by
                          // hand, or a faxed filing still toggles its reasons.
                          tabIndex={isFaxLocked ? -1 : 0}
                          className={`select-card${checked ? ' is-selected' : ''}${isFaxLocked ? ' is-locked' : ''}`}
                          style={{ cursor: isFaxLocked ? 'default' : 'pointer' }}
                          onClick={isFaxLocked ? undefined : toggle}
                          onKeyDown={isFaxLocked ? undefined : (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
                        >
                          <input type="checkbox" checked={checked} readOnly disabled={isFaxLocked} tabIndex={-1} style={{ pointerEvents: 'none' }} />
                          <div>
                            <div className="select-card-label">{r.label}</div>
                            <div className="select-card-hint">{r.hint}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtnStyle} onClick={() => continueFromSection('1b')} disabled={saving}>{continueLabel('1b')}</button>
            </div>
          </div>
        </AccordionSection>
        )}

        {/* ── Step 2: Owner Details ── */}
        <AccordionSection numberLabel={stepNumber(2)} label={STEP_LABELS['2']} open={openSections.has('2')} complete={sectionProgress(2) === 'complete'} onToggle={() => toggleSection('2')} anchorRef={(el) => { sectionRefs.current['2'] = el; }} frozen={isFaxLocked}>
          <div>
            <h2 style={stepHeadingStyle}>Your details as the foreign owner</h2>
            <p style={stepSubheadStyle}>Details about you as the person (or entity) that owns 25% or more of this LLC. This goes on your Form 5472.</p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Your identity</h3>
              <div style={gridStyle}>
                <Field anchor="ownerName" label="Your full legal name" locked={isPaidLocked} tooltip="As shown on your government ID / passport." style={{ gridColumn: '1 / -1' }} required>
                  <input
                    value={ownerName}
                    onChange={(e) => {
                      setOwnerName(e.target.value);
                      if (!ownerRefNumber || ownerRefNumber === buildOwnerRef(ownerName)) {
                        setOwnerRefNumber(buildOwnerRef(e.target.value));
                      }
                    }}
                    placeholder="e.g. Rahul Sharma"
                    disabled={isPaidLocked}
                  />
                </Field>
                <Field anchor="signerTitle" label="Your title / role" tooltip="How you'll sign the return, e.g. Managing Member, Member, President. This prints on the Form 1120 signature block and any reasonable-cause letter. Defaults to Managing Member.">
                  <input
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                    placeholder="Managing Member"
                  />
                </Field>
                <Field anchor="signatureDate" label="Signature date" tooltip="We print this as the signature date on the Form 1120 for every year, so your forms are ready to print and mail as-is. Use the date you plan to sign and send them.">
                  <input
                    type="date"
                    value={signatureDate}
                    onChange={(e) => setSignatureDate(e.target.value)}
                  />
                </Field>
                <Field anchor="ownerCountry" label="Country where you do business" required tooltip="The country where you mainly carry out your own work or business activity. For many owners this is where they live and work.">
                  <select
                    value={ownerCountry}
                    onChange={(e) => {
                      const nextCountry = e.target.value;
                      setOwnerCountry(nextCountry);
                      // Prefill the other two country answers ONLY while they
                      // are still blank. For most owners all three are the same
                      // country, so filling them saves two lookups through a
                      // 200-item list.
                      //
                      // It is deliberately not a live mirror: once a value is
                      // there, whether the filer typed it or it came from their
                      // saved profile, changing the business country leaves it
                      // alone. Residence and citizenship print on Form 5472 and
                      // decide which foreign tax ID is asked for, so they are
                      // not ours to rewrite behind the filer's back.
                      setOwnerCountryRes((current) => current || nextCountry);
                      setOwnerCountryCitizenship((current) => current || nextCountry);
                    }}
                  >
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field anchor="ownerCountryRes" label="Country where you pay taxes" required tooltip="The country where you are a tax resident, i.e. where you file your personal income taxes.">
                  <select value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field anchor="ownerCountryCitizenship" label="Country of citizenship" required tooltip="The country that issued your passport. If you hold more than one, use the one you'll list on the form.">
                  <select value={ownerCountryCitizenship} onChange={(e) => setOwnerCountryCitizenship(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                {/* The label, placeholder and guidance all follow the country of
                    tax residence selected above: a filer in Jakarta is asked for
                    their NPWP, not for "your foreign tax ID". `taxIdWarning` is
                    advisory and never blocks the step, see countryTaxIds.ts. */}
                <Field
                  anchor="ownerForeignTaxId"
                  label={`Your ${ownerTaxIdInfo.label}`}
                  locked={isPaidLocked}
                  required
                  tooltip={taxIdTooltip(ownerCountryRes)}
                >
                  <input
                    value={ownerForeignTaxId}
                    onChange={(e) => setOwnerForeignTaxId(e.target.value)}
                    placeholder={taxIdPlaceholder(ownerCountryRes)}
                    disabled={isPaidLocked}
                  />
                  {ownerTaxIdInfo.issues === false && (
                    <div style={{ ...infoBoxStyle, marginTop: '0.5rem' }}>
                      {ownerCountryRes} does not issue personal tax ID numbers. Enter your{' '}
                      {ownerTaxIdInfo.alt ?? 'passport number'} instead, which the IRS accepts here.
                    </div>
                  )}
                  {ownerTaxIdWarning && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.8125rem', color: 'var(--tf-warn)' }}>
                      {ownerTaxIdWarning}
                    </div>
                  )}
                </Field>
                <Field label="U.S. tax ID" tooltip="Only if you happen to have a U.S. tax ID (SSN, ITIN, or your own EIN). Most foreign owners don't have one, so leave it blank if so.">
                  <input value={ownerSSN} onChange={(e) => setOwnerSSN(e.target.value)} placeholder="XXX-XX-XXXX or XX-XXXXXXX" />
                </Field>
                <Field anchor="ownerRefNumber" label="Your reference code" required tooltip="A short code that identifies you. It is printed on Form 5472. We suggest one automatically (e.g. your initials + 001); keep it or change it, it just needs to stay consistent.">
                  <input value={ownerRefNumber} onChange={(e) => setOwnerRefNumber(e.target.value)} placeholder="e.g. RAH001" />
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Your address</h3>
              <AddressFields anchor="ownerAddress" value={ownerAddress} onChange={setOwnerAddress} />
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Your type of business</h3>
              <div style={gridStyle}>
                <Field anchor="ownerBizActivity" label="Type of business" tooltip="Your own business, not the LLC's. Pick the closest match, or choose “Other” to type your own activity and code." required>
                  {(() => {
                    // Same manual-entry escape hatch as the LLC's business
                    // activity: the preset list never covers every trade, so
                    // "Other" reveals a free-text activity and leaves the code
                    // field open for the owner to type.
                    // resolveBizPreset also matches on the CODE when the stored
                    // activity is blank, so a legacy record still shows its preset
                    // instead of collapsing to "Select type" / "Other".
                    const preset = resolveBizPreset(ownerBizActivity, ownerBizCode);
                    const selectValue = preset
                      ? preset.label
                      : (ownerBizActivity === '' ? '' : '__other__');
                    return (
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__other__') {
                            // Switch to manual entry: a single space marks
                            // "custom, not yet typed" so the free-text input shows.
                            setOwnerBizActivity(' ');
                            setOwnerBizCode('');
                            return;
                          }
                          setOwnerBizActivity(val);
                          const match = RP_NAICS.find((n) => n.label === val);
                          if (match) setOwnerBizCode(match.code);
                        }}
                      >
                        <option value="">Select type</option>
                        {RP_NAICS.map((n) => <option key={`${n.code}-${n.label}`} value={n.label}>{n.label} ({n.code})</option>)}
                        <option value="__other__">Other (enter manually)</option>
                      </select>
                    );
                  })()}
                </Field>
                {ownerBizActivity !== '' && !resolveBizPreset(ownerBizActivity, ownerBizCode) && (
                  <Field label="Business activity" required>
                    <input
                      value={ownerBizActivity.trim()}
                      onChange={(e) => setOwnerBizActivity(e.target.value)}
                      placeholder="Describe your business"
                    />
                  </Field>
                )}
                <Field anchor="ownerBizCode" label="Business code" required tooltip="The 6-digit IRS business-activity code for your own business. We fill it in when you pick a type above, you can also type it yourself.">
                  <input value={ownerBizCode} onChange={(e) => setOwnerBizCode(e.target.value)} placeholder="e.g. 541511" />
                </Field>
              </div>
            </section>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtnStyle} onClick={() => continueFromSection('2')} disabled={saving}>{continueLabel('2')}</button>
            </div>
          </div>
        </AccordionSection>

        {/* ── Step 3: Related Parties ── */}
        <AccordionSection numberLabel={stepNumber(3)} label={STEP_LABELS['3']} open={openSections.has('3')} complete={sectionProgress(3) === 'complete'} onToggle={() => toggleSection('3')} anchorRef={(el) => { sectionRefs.current['3'] = el; }} frozen={isFaxLocked}>
          <div>
            <h2 style={stepHeadingStyle}>Related parties</h2>
            <p style={stepSubheadStyle}>
              Add any other foreign individuals or entities that had money dealings with this LLC (loans, payments, transfers). Each one gets its own Form 5472. If it's just you and the LLC, you can skip this step.
            </p>

            {relatedParties.length > 0 && (
              <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {relatedParties.map((rp, i) => (
                  <div key={i} data-anchor={`rp-${i}`} style={{ ...groupedCardStyle, padding: '0.875rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{rp.name || `Related party ${i + 1}`}</div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.2rem' }}>
                          {rp.country}
                          {rp.country_residence && rp.country_residence !== rp.country ? ` · Tax resident: ${rp.country_residence}` : ''}
                          {rp.ref_number ? ` · Ref: ${rp.ref_number}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="button" style={secondaryBtnStyle} onClick={() => openRpForm(i)}>Edit</button>
                        {(!isPaidLocked || i >= paidRelatedPartyCount) && (
                          <button type="button" style={{ ...secondaryBtnStyle, color: 'var(--tf-error-text)', borderColor: 'var(--tf-error-border)' }} onClick={() => removeRp(i)}>Remove</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showRpForm && (
              <div style={{ ...groupedCardStyle, padding: '1.25rem', marginBottom: '1.5rem' }}>
                <h3 style={{ ...sectionLabelStyle, marginBottom: '1rem' }}>{editingRpIdx !== null ? 'Edit related party' : 'Add related party'}</h3>
                {rpErrors.length > 0 && (
                  <div style={{ ...errorSummaryStyle, marginBottom: '1rem' }}>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {rpErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={gridStyle}>
                    <Field label="Full legal name" style={{ gridColumn: '1 / -1' }} required>
                      <input
                        value={rpDraft.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRpDraft((p) => {
                            const previousSuggestion = buildRelatedPartyRef(p.name, relatedParties.length);
                            const keepManualCode = p.ref_number && p.ref_number !== previousSuggestion;
                            return {
                              ...p,
                              name: val,
                              ref_number: keepManualCode
                                ? p.ref_number
                                : buildRelatedPartyRef(val, relatedParties.length),
                            };
                          });
                        }}
                        placeholder="Full legal name"
                      />
                    </Field>
                    <Field label="Country where they do business" required>
                      <select value={rpDraft.country} onChange={(e) => setRpDraft((p) => ({ ...p, country: e.target.value }))}>
                        <option value="">Select country</option>
                        {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Country where they pay taxes" required>
                      <select value={rpDraft.country_residence} onChange={(e) => setRpDraft((p) => ({ ...p, country_residence: e.target.value }))}>
                        <option value="">Select country</option>
                        {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </Field>
                    <Field label="U.S. tax ID" hint="If they have one (EIN or ITIN)">
                      <input value={rpDraft.us_tin ?? ''} onChange={(e) => setRpDraft((p) => ({ ...p, us_tin: e.target.value }))} placeholder="XX-XXXXXXX or XXX-XX-XXXX" />
                    </Field>
                    <Field
                      label="Their foreign tax ID"
                      hint="Their local tax number, or their company registration number"
                      tooltip={rpTaxIdTooltip}
                      required
                    >
                      <input value={rpDraft.foreign_tax_id} onChange={(e) => setRpDraft((p) => ({ ...p, foreign_tax_id: e.target.value }))} placeholder="Local tax or company registration number" />
                    </Field>
                    <Field label="Reference code" required tooltip="A short code identifying this related party. It is printed on Form 5472; keep it consistent.">
                      <input value={rpDraft.ref_number} onChange={(e) => setRpDraft((p) => ({ ...p, ref_number: e.target.value }))} placeholder="e.g. REL002" />
                    </Field>
                    <Field label="Type of business" required tooltip="Pick the closest match, or choose “Other” to type the activity and code by hand.">
                      {(() => {
                        const preset = resolveBizPreset(rpDraft.biz_activity, rpDraft.biz_code);
                        const selectValue = preset
                          ? preset.label
                          : (rpDraft.biz_activity === '' ? '' : '__other__');
                        return (
                          <select
                            value={selectValue}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__other__') {
                                setRpDraft((p) => ({ ...p, biz_activity: ' ', biz_code: '' }));
                                return;
                              }
                              const match = RP_NAICS.find((n) => n.label === val);
                              setRpDraft((p) => ({ ...p, biz_activity: val, biz_code: match ? match.code : p.biz_code }));
                            }}
                          >
                            <option value="">Select type</option>
                            {RP_NAICS.map((n) => <option key={`${n.code}-${n.label}`} value={n.label}>{n.label} ({n.code})</option>)}
                            <option value="__other__">Other (enter manually)</option>
                          </select>
                        );
                      })()}
                    </Field>
                    {rpDraft.biz_activity !== '' && !resolveBizPreset(rpDraft.biz_activity, rpDraft.biz_code) && (
                      <Field label="Business activity" required>
                        <input
                          value={rpDraft.biz_activity.trim()}
                          onChange={(e) => setRpDraft((p) => ({ ...p, biz_activity: e.target.value }))}
                          placeholder="Describe their business"
                        />
                      </Field>
                    )}
                    <Field label="Business code" required tooltip="The 6-digit IRS business-activity code. We fill it in when you pick a type above, you can also type it yourself.">
                      <input
                        value={rpDraft.biz_code}
                        onChange={(e) => setRpDraft((p) => ({ ...p, biz_code: e.target.value }))}
                        placeholder="e.g. 541511"
                      />
                    </Field>
                  </div>

                  <div>
                    <div style={{ ...sectionLabelStyle, marginBottom: '0.625rem' }}>Address</div>
                    <AddressFields value={rpDraft.address} onChange={(a) => setRpDraft((p) => ({ ...p, address: a }))} />
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button type="button" style={secondaryBtnStyle} onClick={() => { setShowRpForm(false); setEditingRpIdx(null); setRpErrors([]); }}>Cancel</button>
                    <button type="button" style={primaryBtnStyle} onClick={saveRpDraft}>{editingRpIdx !== null ? 'Save changes' : 'Add related party'}</button>
                  </div>
                </div>
              </div>
            )}

            {!showRpForm && (
              <button type="button" style={addBtnStyle} onClick={() => openRpForm()}>Add related party</button>
            )}
            {!showRpForm && isPaidLocked && billableRelatedPartyCount > paidRelatedPartyCount && (
              <div className="cat-banner-amber" style={{ marginTop: '0.5rem' }}>
                The new related party generates another Form 5472. Save your changes, then complete
                the ${PRICE_ADDITIONAL_PARTY} additional-party payment before downloading the updated package.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
              <button type="button" style={primaryBtnStyle} onClick={() => continueFromSection('3')} disabled={saving}>{continueLabel('3')}</button>
            </div>
          </div>
        </AccordionSection>

        {/* ── Step 4: Transactions ── */}
        <AccordionSection numberLabel={stepNumber(4)} label={STEP_LABELS['4']} open={openSections.has('4')} complete={sectionProgress(4) === 'complete'} onToggle={() => toggleSection('4')} anchorRef={(el) => { sectionRefs.current['4'] = el; }} frozen={isFaxLocked}>
          <div>
            <h2 style={stepHeadingStyle}>Money between you and the LLC</h2>
            <p style={stepSubheadStyle}>
              Tell us about any money or assets that moved between the LLC and you (or another related party) this year: money you put in, money you took out, loans, and so on. Don’t include normal business sales to customers or payments to vendors like Stripe or AWS.
            </p>

            {/* Owner managerial-services Part VI disclosure, pre-selected, can opt out */}
            <label className={`confirm-check-row confirm-check-row--neutral${partViManagerial ? ' is-selected' : ''}`} style={{ cursor: 'pointer', marginTop: 0, marginBottom: '1.5rem' }}>
              <input type="checkbox" checked={partViManagerial} onChange={(e) => setPartViManagerial(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                  I run the LLC myself (include the standard owner-services note)
                  <InfoTooltip text="As the foreign owner, you typically provide management and services to the LLC that have no set market price. The IRS expects this disclosed on your Form 5472, and we include a standard statement for you. Untick only if this does not apply, then no such statement is generated." label="About owner services" />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                  Recommended for almost all single-owner LLCs. Untick if it doesn’t apply.
                </div>
              </div>
            </label>

            <div ref={transactionsTopRef}>
              <TxSummaryPanel summary={txSummary} count={transactions.length} />
            </div>

            {/* Two-column split: the Add/Edit form on the left, and the live
                Transactions list on the right. Stacks (form first) on narrow
                screens via the tx-split responsive rule in the style block. */}
            <div className="tx-split">
            <div>
            <section style={{ ...sectionStyle, marginBottom: 0 }}>
              <h3 style={sectionLabelStyle}>{editingTxIdx !== null ? 'Edit transaction' : 'Add a transaction'}</h3>

              <Field label="Who was this transaction with?" required style={{ marginBottom: '1rem' }}>
                <select
                  value={txRelatedPartyIdx}
                  onChange={(e) => {
                    setTxRelatedPartyIdx(Number(e.target.value));
                    // The tier is resolved against the counterparty, so changing
                    // it can move this transaction from tier 1 to tier 3. Drop
                    // any acknowledgment given for the previous pairing.
                    setCat3Acknowledged(false);
                  }}
                >
                  {allPartyLabels.map((label, i) => (
                    <option key={i} value={i}>{label}</option>
                  ))}
                </select>
              </Field>

              {(() => {
                const isOwnerParty = txRelatedPartyIdx === 0;
                const quickList: QuickTx[] = isOwnerParty ? SIMPLE_TX : RELATED_PARTY_TX;
                const selectQuick = (q: QuickTx) => {
                  setTxType(q.value);
                  // The quick tile's own direction wins; otherwise the type's.
                  // This used to fall back to 'received' for every type with no
                  // dropdown, which put purchases of goods on the sales line and
                  // dissolution payouts under "other amounts received".
                  setTxDir(q.direction ?? defaultDirectionFor(q.value));
                  setShowDetailedTx(false);
                  setTxErrors([]);
                  setCat3Acknowledged(false);
                  scrollToTransactionDetails();
                };
                const partyWord = isOwnerParty ? 'you' : (allPartyLabels[txRelatedPartyIdx] || 'the related party');
                // Combo-box search across every transaction type (label + plain
                // sentence). Lets the filer type "royalty", "loan", "dissolution"
                // and jump straight to it instead of hunting the accordion.
                const q = txSearch.trim().toLowerCase();
                // The Part V and Part VI statements are generated for the owner
                // alone, so a type that exists only inside one of them has
                // nowhere to print on another party's Form 5472. Offering it
                // against a non-owner party lets the filer record a transaction
                // that then appears on no form at all.
                // A second rule, for Form 5472 PART VII questions 42a / 42b: a
                // loan between the LLC and a related party who is NOT the sole
                // owner forces one of them to Yes, and Part VII has no field to
                // set it in (the checkboxes are absent from every template's
                // AcroForm). Filing it would mean answering Yes as No, so the
                // type is not offered against a non-owner at all.
                //
                // Against the OWNER it stays, and must: a disregarded entity and
                // its sole owner are the same taxpayer, so an owner loan is a
                // bookkeeping entry, which is why it is tier 1. That is the
                // common case and removing it would gut the product.
                //
                // The eligibility gate asks this too, but the gate is bypassable
                // by design (the portal link carries nothing, and /portal can be
                // opened directly), so it cannot be the only place this is
                // enforced.
                const typeAllowed = (v: string) =>
                  (isOwnerParty || !OWNER_ONLY_TX_TYPES.has(v)) &&
                  (isOwnerParty || !NON_OWNER_BLOCKED_TX_TYPES.has(v));
                const searchResults = q
                  ? TX_TYPES.filter((t) =>
                      typeAllowed(t.value) && (
                        t.label.toLowerCase().includes(q) ||
                        t.sentence.toLowerCase().includes(q)))
                  : [];
                const selectType = (value: string) => {
                  setTxType(value);
                  setTxErrors([]);
                  // Fixed for types with no dropdown, the opening value for the
                  // rest. See defaultDirectionFor.
                  setTxDir(defaultDirectionFor(value));
                  setCat3Acknowledged(false);
                  scrollToTransactionDetails();
                };
                return (
                  <>
                    <div style={{ ...sectionLabelStyle, marginBottom: '0.5rem' }}>
                      {isOwnerParty ? 'What happened?' : 'What kind of dealing was this?'}
                    </div>
                    {txErrors.some((e) => e.includes('transaction type')) && (
                      <div style={{ ...errorSummaryStyle, marginBottom: '0.75rem' }}>Choose an option below.</div>
                    )}

                    {/* Searchable combo box, type to filter every transaction type. */}
                    <input
                      type="text"
                      value={txSearch}
                      onChange={(e) => setTxSearch(e.target.value)}
                      placeholder="Search transaction types (e.g. royalty, loan, dividend)…"
                      style={{ marginBottom: '0.75rem' }}
                    />

                    {q ? (
                      searchResults.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {searchResults.map((item) => (
                            <button
                              key={item.value}
                              type="button"
                              className={`tx-type-card${txType === item.value ? ' is-selected' : ''}`}
                              onClick={() => selectType(item.value)}
                            >
                              <span className="tx-type-label">{item.label}</span>
                              <span className="tx-type-sentence">{item.sentence.replace('{party}', partyWord)}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', padding: '0.5rem 0' }}>
                          No transaction types match “{txSearch.trim()}”. Try a different word, or browse the options below.
                        </div>
                      )
                    ) : (
                    <>
                    {/* Quick options, owner gets first-person shortcuts;
                        a related party gets neutral, LLC<->party wording. */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                      {quickList.map((q) => (
                        <button
                          key={q.value}
                          type="button"
                          className={`tx-type-card${txType === q.value ? ' is-selected' : ''}`}
                          onClick={() => selectQuick(q)}
                        >
                          <span className="tx-type-label">{q.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* "Record a different transaction" reveals the full category
                        accordion. No complexity/CPA wording appears until a
                        specific type is actually selected (the tier note below). */}
                    <button
                      type="button"
                      onClick={() => setShowDetailedTx((v) => !v)}
                      style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', padding: '0.75rem 0 0', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                    >
                      {showDetailedTx ? 'Hide other transaction types' : 'Record a different kind of transaction'}
                    </button>

                    {showDetailedTx && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                        {TX_CATEGORIES.map((cat) => {
                          const isOpen = openCategory === cat.key;
                          const typesInCat = TX_TYPES.filter(
                            (t) => cat.values.includes(t.value) && typeAllowed(t.value),
                          );
                          // A category whose every type is owner-only (Part V,
                          // Part VI) is empty for a non-owner party: hide it
                          // rather than render a heading that opens onto nothing.
                          if (typesInCat.length === 0) return null;
                          const hasSelection = typesInCat.some((t) => t.value === txType);
                          return (
                            <div key={cat.key} style={{ ...groupedCardStyle, borderColor: hasSelection ? 'var(--tf-accent)' : 'var(--tf-border)' }}>
                              <div
                                className={`tx-cat-header${isOpen ? ' is-open' : ''}`}
                                onClick={() => setOpenCategory(isOpen ? null : cat.key)}
                                role="button"
                                aria-expanded={isOpen}
                              >
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text)' }}>{cat.label}</span>
                                    {hasSelection && <span style={{ fontSize: '0.72rem', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', padding: '0.1rem 0.45rem', borderRadius: '1rem', fontWeight: 700 }}>Selected</span>}
                                  </div>
                                  <div style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.2rem' }}>{cat.description}</div>
                                </div>
                                <div className={`tx-cat-chevron${isOpen ? ' is-open' : ''}`}>
                                  <svg viewBox="0 0 20 20" fill="currentColor" width={18} height={18}>
                                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              </div>
                              {isOpen && (
                                <div className="tx-cat-body">
                                  {cat.note && (
                                    <p style={{ fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.55, color: 'var(--tf-banner-amber-text)', background: 'var(--tf-banner-amber-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.625rem 0.75rem', marginBottom: '0.625rem' }}>
                                      {cat.note}
                                    </p>
                                  )}
                                  {typesInCat.map((item) => (
                                    <button
                                      key={item.value}
                                      type="button"
                                      className={`tx-type-card${txType === item.value ? ' is-selected' : ''}`}
                                      onClick={() => {
                                        setTxType(item.value);
                                        setTxErrors([]);
                                        setTxDir(defaultDirectionFor(item.value));
                                        setCat3Acknowledged(false);
                                        scrollToTransactionDetails();
                                      }}
                                    >
                                      <span className="tx-type-label">{item.label}</span>
                                      <span className="tx-type-sentence">{item.sentence.replace('{party}', isOwnerParty ? 'you' : (allPartyLabels[txRelatedPartyIdx] || 'the related party'))}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    </>
                    )}
                  </>
                );
              })()}
            </section>

            {txType && (
              <section
                ref={transactionDetailsRef}
                style={{ ...sectionStyle, background: 'var(--tf-offset, #f8fafc)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.625rem', padding: '1.25rem', marginTop: '0.75rem', scrollMarginTop: '5.5rem' }}
              >
                <h3 style={{ ...sectionLabelStyle, marginBottom: '0.75rem' }}>Transaction details</h3>

                {txErrors.length > 0 && (
                  <div style={{ ...errorSummaryStyle, marginBottom: '0.875rem' }}>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {txErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                    </ul>
                  </div>
                )}

                {/* Tier note, revealed only AFTER a transaction type is picked, so we
                    never pre-signal complexity in the picker. Driven by
                    TX_TYPES.category: tier 1 (routine) shows no banner, tier 2 gets
                    an advisory note with no gate, tier 3 gets a warning AND blocks
                    the add until acknowledged. The tier is resolved against the
                    chosen counterparty, so the same type can sit in a different
                    tier for the owner than for a non-owner related party. */}
                {txCategory === 2 && (
                  <div className="cat-banner-amber" style={{ marginBottom: '1rem' }}>
                    <strong>Worth a second look.</strong> We can prepare this from your answers, but this type is one where the tax treatment depends on the details. If you are unsure how it should be described, a CPA or tax adviser can confirm it before you file.
                  </div>
                )}
                {txCategory === 3 && (
                  <div className="cat-banner-red" style={{ marginBottom: '1rem' }}>
                    <strong>This one’s more involved.</strong> This type of transaction can get complex. We’ll fill in everything we can from your answers, but we recommend a quick CPA review before you submit.
                    <div className="cat3-ack-row">
                      <input type="checkbox" checked={cat3Acknowledged} onChange={(e) => setCat3Acknowledged(e.target.checked)} id="cat3ack" />
                      <label htmlFor="cat3ack" style={{ fontSize: '0.8125rem', cursor: 'pointer' }}>I understand, proceed anyway</label>
                    </div>
                  </div>
                )}

                {/* Negative definition. Choosing the wrong type produces a wrong
                    return rather than an error, and the confusable pairs land in
                    different Parts of the form, so say what does NOT count. */}
                {/* Behind an info icon rather than a standing block. The text is
                    only useful to someone who is unsure they picked the right
                    type, and as a permanent panel it pushed the actual fields
                    down the page for everyone else, which on a phone is the
                    difference between seeing the amount field and not. */}
                {txType && txMeta?.notThis && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      marginBottom: '1rem',
                      fontSize: '0.8125rem',
                      color: 'var(--tf-muted)',
                    }}
                  >
                    <span>Not sure this is the right type?</span>
                    <InfoTooltip
                      text={`Not this: ${txMeta.notThis}`}
                      label={`What ${txMeta.label} does not cover`}
                    />
                  </div>
                )}

                <div style={gridStyle}>
                  {asksDirection(txType, txRelatedPartyIdx === 0) && (
                    <Field label="Who paid?" required>
                      <select value={txDir} onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')}>
                        <option value="received">LLC received the money</option>
                        <option value="paid">LLC paid the money</option>
                      </select>
                    </Field>
                  )}
                  {LOAN_TYPES.has(txType) && (
                    <Field
                      label="Beginning balance (USD)"
                      hint="Outstanding loan balance at the START of the tax year (0 if the loan started this year)"
                    >
                      <input type="text" inputMode="numeric" value={formatMoney(txLoanBegin)} onChange={(e) => setTxLoanBegin(stripMoney(e.target.value))} placeholder="0" />
                    </Field>
                  )}
                  <Field
                    label={selectedTxMeta?.amountLabel ?? 'Amount (USD)'}
                    status={selectedTxMeta?.amountOptional ? 'optional' : undefined}
                    tooltip={selectedTxMeta?.amountOptional ? undefined : selectedTxMeta?.amountHint}
                    required={!selectedTxMeta?.amountOptional && !PART_V_TYPES.has(txType) && !PART_VI_TYPES.has(txType)}
                  >
                    <input type="text" inputMode="numeric" value={formatMoney(txAmt)} onChange={(e) => setTxAmt(stripMoney(e.target.value))} placeholder="0" />
                  </Field>
                  <Field label="Transaction date" status="optional">
                    <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                  </Field>
                  <Field label="Description" status="optional" style={{ gridColumn: '1 / -1' }}>
                    <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Short description" />
                  </Field>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={primaryBtnStyle}
                    onClick={addTransaction}
                    disabled={txCategory === 3 && !cat3Acknowledged}
                  >
                    {editingTxIdx !== null ? 'Save changes' : 'Add transaction'}
                  </button>
                  {editingTxIdx !== null && (
                    <button type="button" style={secondaryBtnStyle} onClick={clearTxForm}>
                      Cancel edit
                    </button>
                  )}
                </div>
              </section>
            )}
            </div>

            {/* Right column, live list of everything added this year. */}
            <section style={{ ...sectionStyle, marginBottom: 0 }}>
              <div style={{ ...sectionLabelStyle, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                Transactions
                {transactions.length > 0 && (
                  <span style={{ background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontSize: '0.72rem', fontWeight: 700, padding: '0.05rem 0.5rem', borderRadius: '999px', letterSpacing: 0 }}>
                    {transactions.length}
                  </span>
                )}
              </div>
              {transactions.length === 0 ? (
                <div style={{ border: '1px dashed var(--tf-border)', borderRadius: '0.625rem', padding: '1.5rem 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--tf-muted)', lineHeight: 1.5 }}>
                  No transactions yet. Fill in the form and select “Add transaction”, each one you add shows up here.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {transactions.map((t, i) => {
                    const meta = TX_TYPES.find((x) => x.value === t.transaction_type);
                    const partyLabel = allPartyLabels[t.related_party_index] || 'Unknown party';
                    const isEditing = editingTxIdx === i;
                    const amount = t.amount_usd && Number(t.amount_usd) > 0
                      ? formatUsd(t.amount_usd)
                      : '';
                    const sentence = asksDirection(t.transaction_type, t.related_party_index === 0)
                      ? `The LLC ${t.direction === 'received' ? 'received' : 'paid'}${amount ? ` ${amount}` : ' money'} ${t.direction === 'received' ? 'from' : 'to'} ${partyLabel} for this transaction: ${meta?.label ?? humanizeTxType(t.transaction_type)}.`
                      // The TX_TYPES sentences carry no terminal period, so the
                      // full stop is added here in both branches. It used to be
                      // added only when there was no amount, which is why a card
                      // with one read "...as a capital contribution The reported
                      // amount was USD 123,456."
                      : `${(meta?.sentence ?? humanizeTxType(t.transaction_type)).replace('{party}', partyLabel)}.${amount ? ` The reported amount was ${amount}.` : ''}`;
                    return (
                      <div key={i} data-anchor={`tx-${i}`} style={{ ...groupedCardStyle, padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', borderColor: isEditing ? 'var(--tf-accent)' : undefined }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.84rem', color: 'var(--tf-text)', lineHeight: 1.5 }}>
                            {sentence}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                          <button
                            type="button"
                            aria-label="Edit transaction"
                            style={{ ...secondaryBtnStyle, fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                            onClick={() => startEditTransaction(i)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            aria-label="Delete transaction"
                            style={{ ...secondaryBtnStyle, fontSize: '0.8rem', padding: '0.3rem 0.65rem', color: 'var(--tf-error-text)', borderColor: 'var(--tf-error-border)' }}
                            onClick={() => removeTransaction(i)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            </div>

            {transactions.length === 0 && (
              <label data-anchor="noTransactions" className={`confirm-check-row${noTransactionsConfirmed ? ' is-selected' : ''}`} style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={noTransactionsConfirmed}
                  onChange={(e) => setNoTransactionsConfirmed(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text, #111)' }}>
                    The LLC had no money dealings with you or a related party this year
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.15rem' }}>
                    This is uncommon. If you put any money into the LLC, or it made any payments to you, those count.
                  </div>
                </div>
              </label>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="button" style={primaryBtnStyle} onClick={() => continueFromSection('4')} disabled={saving}>{continueLabel('4')}</button>
            </div>
          </div>
        </AccordionSection>

        {/* ── Step 5: Review ── */}
        <AccordionSection
          numberLabel={stepNumber(5)}
          label={STEP_LABELS['5']}
          open={openSections.has('5')}
          // A faxed filing is finished, so this section carries the tick on its
          // own. Waiting for `step === 5` left the last step of a completed
          // filing looking like the one thing still outstanding.
          complete={isFaxLocked || (step === 5 && validateForSubmit().length === 0)}
          onToggle={() => toggleSection('5')}
          anchorRef={(el) => { sectionRefs.current['5'] = el; }}
          frozen={isFaxLocked}
          // Outside the frozen fieldset, because a faxed filing disables every
          // control in the body and this one has to keep working: it is the only
          // thing left to do with the return, and without it the review section
          // ends on nothing at all.
          liveFooter={isFaxLocked && filingId ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                type="button"
                style={primaryBtnStyle}
                onClick={() => navigate(`/filing/${filingId}`)}
              >
                Go to downloads →
              </button>
            </div>
          ) : null}
        >
          <div>
            {/* "Submit" was the wrong word for what this step does. Nothing is
                filed here and nothing is sent to the IRS: the next thing that
                happens is payment, and only then are the forms prepared. A
                filer who reads "submit" on the last step reasonably believes
                they have just filed. */}
            {/* Once the fax is at the IRS both sentences below are false: it IS
                filed, it HAS been sent, and nothing on this page can be
                corrected. Same summary, opposite tense. */}
            <h2 style={stepHeadingStyle}>
              {isFaxLocked ? 'Your filing as we sent it' : 'Review & continue to payment'}
            </h2>
            <p style={stepSubheadStyle}>
              {isFaxLocked
                ? 'This is what was faxed to the IRS. It is filed, and these answers are'
                  + ' read-only. If something on them is wrong, email support@filetax.co: a'
                  + ' correction is a new filing, not an edit to this one.'
                : 'Check everything below. Nothing is filed yet, and nothing is sent to the IRS.'
                  + ' Next you pay, then we prepare your forms. You can still correct anything on'
                  + ' this page until you pay.'}
            </p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC details</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Name" value={llcName} />
                <SummaryRow label="EIN" value={ein} />
                <SummaryRow label="State of formation" value={stateOfFormation} />
                <SummaryRow label="Tax year" value={taxYear} />
                <SummaryRow label="Total assets" value={totalAssets ? formatUsd(totalAssets) : null} />
                <SummaryRow label="Date of incorporation" value={formatDateMMDDYYYY(entityDOI)} />
                <SummaryRow label="Principal country" value={entityPrincipalCountry} />
                <SummaryRow label="Business type" value={entityBizActivity} />
                <SummaryRow label="Business code" value={entityBizCode} />
                <SummaryRow label="Mailing address" value={formatAddress(mailing)} />
                <SummaryRow label="Initial return" value={isInitialReturn(entityDOI, taxYear, isFiscalYear ? fiscalEndMonth : '') ? 'Yes' : 'No'} />
                <SummaryRow label="Final return" value={finalReturn ? 'Yes' : 'No'} />
                {finalReturn && (
                  <SummaryRow
                    label="Dissolved"
                    value={dateOfClosure ? formatDateMMDDYYYY(dateOfClosure) : 'Not provided'}
                  />
                )}
                {nameChange && <SummaryRow label="Name change" value="Yes" />}
                {addressChange && <SummaryRow label="Address change" value="Yes" />}
                <SummaryRow label="Accounting period" value={isFiscalYear ? 'Fiscal year' : 'Calendar year'} />
                {isFiscalYear && <SummaryRow label="Fiscal year" value={fiscalEndMonth !== '' ? `${formatDateLong(effectiveTaxPeriod.begin)} to ${formatDateLong(effectiveTaxPeriod.end)}` : 'Not provided'} />}
                {earlierReturnsFiled !== null && (
                  <SummaryRow label="Earlier years already filed" value={earlierReturnsFiled ? 'Yes' : 'No'} />
                )}
              </div>
            </section>

            {/* Filing status is shown unconditionally. It used to render only
                when step 1b was reachable (`show1b`), which hid the extension and
                reasonable-cause answers from an on-time filer's review, the user
                could not see what had been decided on their behalf. */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Filing status</h3>
              <div style={reviewGridStyle}>
                <SummaryRow
                  label="Filing timing"
                  value={filingTimingLabel}
                />
                <SummaryRow
                  label="Extension (Form 7004) filed"
                  value={
                    extensionFiled === null
                      ? (show1b ? 'Not provided' : 'Not applicable, filing on time')
                      : extensionFiled ? 'Yes' : 'No'
                  }
                />
                <SummaryRow label="Reasonable cause letter" value={includeReasonableCause ? `Yes (+$${PRICE_RCL})` : 'No'} />
              </div>
                {includeReasonableCause && reasonableCauseReasons.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                      Reasons selected
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {reasonableCauseReasons.map((r) => (
                        <li key={r} style={{ fontSize: '0.875rem', color: 'var(--tf-text)' }}>
                          {REASONABLE_CAUSE_REASONS.find((x) => x.value === r)?.label ?? r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Primary owner</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Name" value={ownerName} />
                <SummaryRow label="Country where you do business" value={ownerCountry} />
                <SummaryRow label="Country where you pay taxes" value={ownerCountryRes} />
                <SummaryRow label="Citizenship" value={ownerCountryCitizenship} />
                <SummaryRow label={ownerTaxIdInfo.short} value={ownerForeignTaxId} />
                <SummaryRow label="U.S. tax ID" value={ownerSSN} />
                <SummaryRow label="Reference code" value={ownerRefNumber} />
                <SummaryRow label="Business type" value={ownerBizActivity.trim() || RP_NAICS.find((n) => n.code === ownerBizCode)?.label} />
                <SummaryRow label="Business code" value={ownerBizCode} />
                <SummaryRow label="Address" value={formatAddress(ownerAddress)} />
                <SummaryRow label="Signing as" value={signerTitle} />
                <SummaryRow label="Signature date" value={formatDateMMDDYYYY(signatureDate)} />
              </div>
            </section>

            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Related parties ({relatedParties.length})</h3>
                {relatedParties.map((rp, i) => (
                  <div key={i} style={{ ...reviewGridStyle, marginBottom: '0.75rem' }}>
                    <SummaryRow label="Name" value={rp.name} />
                    <SummaryRow label="Country where they do business" value={rp.country} />
                    <SummaryRow label="Country where they pay taxes" value={rp.country_residence} />
                    <SummaryRow label="Foreign tax ID" value={rp.foreign_tax_id} />
                    <SummaryRow label="U.S. tax ID" value={rp.us_tin} />
                    <SummaryRow label="Reference code" value={rp.ref_number} />
                    <SummaryRow label="Business type" value={rp.biz_activity?.trim()} />
                    <SummaryRow label="Business code" value={rp.biz_code} />
                    <SummaryRow label="Address" value={formatAddress(rp.address)} />
                  </div>
                ))}
              </section>
            )}

            {transactions.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
                <TxSummaryPanel summary={txSummary} count={transactions.length} />
                {transactions.map((t, i) => {
                  const meta = TX_TYPES.find((x) => x.value === t.transaction_type);
                  const isLoan = LOAN_TYPES.has(t.transaction_type);
                  return (
                    <div key={i} style={{ ...reviewGridStyle, marginBottom: '0.5rem' }}>
                      <SummaryRow label="Type" value={meta?.label ?? humanizeTxType(t.transaction_type)} />
                      <SummaryRow label="Party" value={allPartyLabels[t.related_party_index] ?? 'Not provided'} />
                      <SummaryRow label={isLoan ? 'Closing balance' : 'Amount'} value={t.amount_usd ? formatUsd(t.amount_usd) : 'Not provided'} />
                      {isLoan && <SummaryRow label="Beginning balance" value={t.loan_begin_usd ? formatUsd(t.loan_begin_usd) : 'USD 0'} />}
                      {/* Echoed back only when it was actually asked, so review
                          does not present a value the filer never chose. */}
                      {asksDirection(t.transaction_type, t.related_party_index === 0)
                        && <SummaryRow label="Direction" value={t.direction === 'received' ? 'Money in' : 'Money out'} />}
                      <SummaryRow label="Date" value={t.transaction_date || null} />
                      <SummaryRow label="Description" value={t.description || null} />
                    </div>
                  );
                })}
              </section>
            )}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner services</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Standard owner-services statement included" value={partViManagerial ? 'Yes' : 'No'} />
              </div>
            </section>

            {/* ── Delivery ──────────────────────────────────────────────────
                In REVIEW rather than step 1b, because this is not a fact about
                the tax year, it is a choice about what happens to the finished
                package. It sits with the other things being bought, next to the
                price the filer is about to pay.

                Locked after payment along with everything else: `isPaidLocked`
                hides the control and leaves the answer visible, because
                transmission is what the $9 bought and re-deciding it afterwards
                would mean either an unpaid fax or a second charge. */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Delivery</h3>
              {/* On a CATCH-UP this is reported, not asked. The fee is charged
                  once for the whole job and every year is transmitted together,
                  so the question belongs on the screen that picks the years,
                  beside the reasonable-cause letter, and it is asked there. A
                  tick box per year's review would ask five times for one $9
                  line and let the answer differ between years, which is the
                  same fact in two places this codebase keeps getting wrong.
                  A filer who said no is offered it again after payment, below
                  the download, by FaxPanel. */}
              {isPaidLocked || jobId ? (
                <>
                  <div style={reviewGridStyle}>
                    <SummaryRow label="IRS fax transmission" value={includeIrsFax ? 'Yes' : 'No, download and send it yourself'} />
                  </div>
                  {jobId && !isPaidLocked && (
                    <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', lineHeight: 1.6, marginTop: '0.5rem' }}>
                      Chosen once for the whole catch-up, on the screen where you picked the years. You can
                      change it there until you pay, and add it afterwards from the filing page.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {/* Neutral, not the bare .confirm-check-row. The bare class
                      carries the amber border and the warn-coloured tick, which
                      are reserved for the no-transactions confirmation: a thing
                      the filer asserts and may get wrong. Buying fax delivery
                      is an ordinary opt-in like the fiscal-year and final-return
                      boxes, so it takes their neutral border and the accent tick,
                      and turns blue when selected as they do. */}
                  <label
                    className={`confirm-check-row confirm-check-row--neutral${includeIrsFax ? ' is-selected' : ''}`}
                    style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={includeIrsFax}
                      onChange={(e) => setIncludeIrsFax(e.target.checked)}
                    />
                    <span>
                      <span style={{ fontWeight: 600, color: 'var(--tf-text)', fontSize: '0.9375rem' }}>
                        Fax my completed forms to the IRS for me (+${PRICE_FAX})
                      </span>
                      <span style={{ display: 'block', color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.6, marginTop: '0.25rem' }}>
                        {/* Says what they get and what is still theirs to do:
                            without this the filer prints and mails to Ogden,
                            and the page should say so rather than implying fax
                            is the only route. It does NOT say the forms cannot
                            be e-filed. Owner's instruction, 8 August 2026: no
                            surface mentions electronic filing at all, here or
                            on the catch-up screen. It answered a question
                            nobody on this page had asked and put the words
                            "cannot be filed" in front of someone deciding to
                            pay. */}
                        We transmit the package and send you the confirmation. Charged once
                        {jobId ? ' for the whole catch-up, however many years it covers' : ' per filing'}.
                        Without it you download the forms and mail them to the IRS yourself.
                      </span>
                    </span>
                  </label>
                  {/* A follow-up note used to appear here once the fax was
                      ticked. Removed twice over. It repeated what the option
                      above it already says, and it called the confirmation
                      "your proof of filing", which is the one claim this
                      product does not make: the confirmation evidences
                      TRANSMISSION on a date. Timeliness depends on the
                      deadline and acceptance is the IRS's to give, which is
                      why the confirmation document itself refuses that wording
                      and why it is the competitor claim §4 singles out as the
                      one not to copy. Do not reinstate it. */}
                </>
              )}
            </section>

            {noTransactionsConfirmed && (
              <div style={infoBoxStyle}>No reportable transactions confirmed.</div>
            )}

            {/* What it costs, itemised, on the screen where they decide.
                The filer used to leave this step, and the filing page after it,
                without ever being shown a figure: the first number in the whole
                flow was on Dodo's checkout. Services.tsx already promises "you
                will see every service itemised before you are asked to pay",
                so this is the page making that sentence true. Read from
                `checkoutLines` rather than added up here, so it cannot drift
                from the cart `create-checkout-session` builds. */}
            {!isPaidLocked && reviewCart.total > 0 && (
              <section style={{ marginTop: '1.5rem' }}>
                <h3 style={sectionLabelStyle}>What you pay</h3>
                <div style={payCardStyle}>
                  {reviewCart.lines.map((line) => (
                    <div key={line.label} style={payLineStyle}>
                      <span>{line.label}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{usd(line.amount)}</span>
                    </div>
                  ))}
                  <div style={payTotalStyle}>
                    <span>{jobId && jobYears.length > 1 ? 'Total for every year' : 'Total'}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>{usd(reviewCart.total)}</span>
                  </div>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', lineHeight: 1.5, marginTop: '0.875rem', marginBottom: 0 }}>
                    Prices exclude tax.
                  </p>
                </div>
              </section>
            )}

            {!isPaidLocked && (
              <div className="cat-banner-amber" style={{ marginTop: '1.5rem' }}>
                <strong>Before you submit:</strong> once you pay, your company and owner identity (EIN, LLC name, tax year, your legal name and foreign tax ID, and incorporation date) are locked and cannot be changed. To file for a different company or year you’d start a new
                filing. Other details (addresses, transactions) can still be corrected afterward. Please
                double-check these now.
              </div>
            )}

            {previewErr && (
              <div className="cat-banner-red" style={{ marginTop: '1rem' }}>{previewErr}</div>
            )}

            {/* Preview sits BEFORE submit and is styled as the secondary
                action. "Can I see the forms before I pay?" is the most common
                question from people who did not buy, and the honest answer is
                now a button rather than a paragraph. It does not replace the
                summary above it: the summary is what they can correct, the
                preview is what they are buying. */}
            {/* No actions on a faxed filing. `handleSubmit` is refused by the
                write path anyway, so "Save corrections & re-download" only
                offered a correction that cannot happen. The download of the fax
                record lives on the filing page, which the banner points to. */}
            {!isFaxLocked && (
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem', flexWrap: 'wrap' }}>
              {!isPaidLocked && (
                <button
                  type="button"
                  style={{ ...secondaryBtnStyle, opacity: previewBusy ? 0.6 : 1 }}
                  onClick={handlePreviewDraft}
                  disabled={previewBusy || saving}
                >
                  {previewBusy ? 'Preparing preview…' : 'Preview my forms'}
                </button>
              )}
              <button type="button" style={primaryBtnStyle} onClick={handleSubmit} disabled={saving || previewBusy}>
                {saving
                  ? 'Saving…'
                  : isPaidLocked
                    ? (billableRelatedPartyCount > paidRelatedPartyCount
                        ? 'Save & continue to additional-party payment'
                        : 'Save corrections & re-download')
                    : jobId
                      ? (hasNextDraftYear
                          // Name the year we are about to open. "Save & file next
                          // year" left the user guessing which of their catch-up
                          // years came next; handleSubmit routes to the earliest
                          // remaining draft, so mirror that exact choice here.
                          ? `Save ${taxYear} & continue to ${nextDraftYear ?? 'the next year'} →`
                          // The last year of a catch-up, and the single-year
                          // case: both land on the filing page, where the next
                          // action is paying. Generation happens after that,
                          // so promising forms here overstates what the click
                          // does.
                          : 'Finish & continue to payment →')
                      : 'Continue to payment →'}
              </button>
            </div>
            )}
          </div>
        </AccordionSection>
      </div>

      {draftDocs && (
        <DraftPreviewModal
          docs={draftDocs}
          taxYear={taxYear}
          onClose={() => setDraftDocs(null)}
        />
      )}

      {import.meta.env.DEV && <DevScenarioLoader onLoad={applyScenario} />}
    </>
  );
}
