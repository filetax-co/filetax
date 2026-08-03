/**
 * PDF Generation Layer, Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * Entry point: generateFilingPackage(filing, transactions, taxYear)
 *              assembleFilingPackage (alias, same function, kept for callers)
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFPage,
  PDFName,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import {
  Filing,
  Transaction,
  Address,
} from './supabase';
import { getF5472Map, F5472Map } from './form5472Fields';
import { getF1120Map, F1120Map } from './form1120Fields';
import {
  normalizeFiling,
  NormalizedFiling,
  NormalizedParty,
} from './filingMapping';
import {
  DrawnSignature,
  embedDrawnSignature,
  drawSignatureInBox,
  faxSignatureBlocker,
} from './drawnSignature';
import {
  embedSignatureFont,
  drawTypedSignatureInBox,
  drawTypedSignatureOverField,
} from './typedSignature';

// Re-export for consumers that import these types from pdfGenerator
export type Form5472Fields = F5472Map;
export type Form1120Fields = F1120Map;

export const EARLIEST_SUPPORTED_TAX_YEAR = 2019;

// ─── helpers ───────────────────────────────────────────────────────────────────────────────

// Amounts printed on Form 5472 / Form 1120 use thousands separators
// (e.g. 1,234,567). Zero and empty values print blank so the form isn't
// littered with 0s on lines that have no activity.
const fmt = (n: number | null | undefined): string =>
  n != null && n !== 0 ? Math.round(n).toLocaleString('en-US') : '';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format an ISO date (YYYY-MM-DD) as "December 1, 2025".
 *
 * Per the platform spec (§0 global conventions), every displayed and printed
 * date must use this single human format, never a numeric/slash/dash form ,
 * so a global audience never has to guess DD-MM vs MM-DD.
 */
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const parts = iso.split('-');
  const [y, m, d] = parts;
  if (!y || !m || !d || parts.length !== 3) {
    console.warn('[pdfGenerator] fmtDate: unexpected ISO format:', iso);
    return '';
  }
  const monthName = MONTH_NAMES[Number(m)] ?? m;
  return `${monthName} ${Number(d)}, ${y}`;
};

/** Format an ISO date (YYYY-MM-DD) as numeric MM/DD/YYYY (the IRS form format). */
const fmtDateNumeric = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const parts = iso.split('-');
  const [y, m, d] = parts;
  if (!y || !m || !d || parts.length !== 3) return '';
  return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
};

const loadPdf = async (url: string): Promise<PDFDocument> => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch PDF: ${url} (${resp.status})`);
  const buf = await resp.arrayBuffer();
  return PDFDocument.load(buf);
};

// Uniform font size for every value typed into an IRS AcroForm field. The blank
// IRS templates ship every field with an auto-size default appearance (size 0),
// which makes pdf-lib shrink each field's text independently to fit its box, so
// a long value renders much smaller than a short one and the printed forms look
// uneven from page to page. Pinning one size makes all entered text uniform.
// 8pt sits one point below the statement/letter body size (FS_BODY) so entered
// values sit comfortably inside the IRS field boxes (median height ~12pt) and
// long values no longer crowd or clip when printed on the actual forms.
const FORM_FIELD_FONT_SIZE = 8;

// ─── character encoding guard ────────────────────────────────────────────────
//
// The IRS templates and every page we draw use the standard PDF fonts, which
// are WinAnsi-encoded. Handing pdf-lib a character outside that set throws
// (`WinAnsi cannot encode "В" (0x0412)`), from drawText immediately, and from
// save() for form fields, whose appearance is generated lazily. Unguarded,
// that surfaced as an unhandled exception and NO package at all: a filer whose
// legal name is in Cyrillic, Greek, Arabic, Devanagari or any CJK script could
// not produce a filing, and the failure said nothing useful.
//
// Everything entered is therefore routed through toFormText():
//   • Unicode-normalized to NFC, so a decomposed accent ("e" + U+0301) becomes
//     the single WinAnsi-encodable "é" instead of failing. This alone rescues
//     most Latin-script names.
//   • Anything still unencodable is recorded, and the character is dropped
//     rather than thrown on, so generation always completes.
//
// A dropped character must never silently reach a filed return, so the names
// are collected and generateFilingPackage reports them (see unsupportedText).
// Full non-Latin support requires embedding a Unicode font via @pdf-lib/fontkit;
// until then intake should ask for the romanized legal name, which is what the
// IRS expects on these forms anyway.

/** Code points WinAnsiEncoding can represent, beyond printable ASCII. */
const WINANSI_EXTRA = new Set(
  ('€‚ƒ„…†‡ˆ‰Š‹ŒŽ'
    + '‘’“”•–-˜™š›œžŸ')
    .split(''),
);
const isFormSafeChar = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x20 && c <= 0x7e) return true;          // printable ASCII
  if (c >= 0xa0 && c <= 0xff) return true;          // Latin-1 supplement
  return WINANSI_EXTRA.has(ch);
};

/** Characters this filing could not represent, keyed by the value they came from. */
export interface UnsupportedText { value: string; characters: string[] }
let unsupportedSink: UnsupportedText[] | null = null;

/**
 * The message to refuse a package with, or null when there is nothing wrong.
 *
 * Every caller that hands bytes to a filer MUST call this and throw on a
 * non-null result. It lives here, next to toFormText, because it did not: the
 * single-year download in FilingWizard refused correctly while the multi-year
 * download had no check at all, so the one population the guard exists to
 * protect - an owner whose legal name is not Latin - got a catch-up package
 * with their name silently stripped on every year's return. Two call sites, one
 * of them written months later, is exactly how that happens; one function they
 * both call is the fix.
 *
 * This refusal is CORRECT BEHAVIOUR and is not a gap to be closed later. The
 * IRS does not hold a non-Latin business name at all: its systems allow only
 * A-Z, 0-9, hyphen and ampersand, so the EIN was issued against a Latin name on
 * the SS-4 and the return has to carry that same name or it does not match the
 * entity. See the handoff, section 4.
 *
 * Do NOT "solve" this by transliterating for the filer. Any romanization we
 * generate is a guess at a string the IRS already has on file, and a near miss
 * is worse than a refusal: it files a return under a name that does not match
 * the EIN record. Only the filer can read their own EIN letter. That is why
 * this message names the document to copy the name from.
 */
export const refuseUnsupportedText = (
  unsupported: UnsupportedText[] | undefined,
): string | null => {
  if (!unsupported?.length) return null;
  const detail = unsupported.map((u) => `"${u.value}" (${u.characters.join(' ')})`).join('; ');
  return (
    'The IRS only holds names in Latin characters, so this filing cannot be '
    + `generated as entered: ${detail}. Edit the filing and enter the name `
    + 'exactly as it appears on your IRS EIN confirmation letter (CP 575) or '
    + 'your Form SS-4, which is the spelling the IRS has on record for this '
    + 'entity. Do not translate it, and do not romanize it yourself if the '
    + 'letter shows something different.'
  );
};

/** Normalize to NFC and strip anything the PDF fonts cannot encode. */
export const toFormText = (value: string | null | undefined): string => {
  if (value == null) return '';
  const nfc = String(value).normalize('NFC');
  let bad: string[] | null = null;
  let out = '';
  for (const ch of nfc) {
    if (isFormSafeChar(ch)) out += ch;
    else (bad ??= []).push(ch);
  }
  if (bad && unsupportedSink) {
    unsupportedSink.push({ value: String(value), characters: [...new Set(bad)] });
  }
  return out;
};

const setText = (doc: PDFDocument, fieldName: string, value: string): void => {
  if (!fieldName) return;
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFTextField) {
      field.setText(toFormText(value));
      // Force a fixed size instead of the template's auto-size (0) so text is
      // the same size across every field and every page.
      field.setFontSize(FORM_FIELD_FONT_SIZE);
      // setFontSize writes the size onto the FIELD's /DA only, and pdf-lib's
      // appearance provider resolves `widgetFontSize ?? fieldFontSize` - a
      // widget's own /DA wins. Most template fields keep the widget merged into
      // the field dict, so writing one writes both, but a field with a separate
      // kid widget (Form 7004's LLC_State and LLC_Country) kept the template's
      // auto-size 0 on the widget. Auto-size then measured those two short
      // values into their boxes and painted them at 10 while every neighbouring
      // field on the same address line rendered at 8. Dropping the widget /DA
      // makes widgetFontSize undefined so the field's size governs.
      for (const widget of field.acroField.getWidgets()) {
        if (widget.dict !== field.acroField.dict) widget.dict.delete(PDFName.of('DA'));
      }
    }
  } catch {
    // Field not present in this revision, silently skip
  }
};

const checkBox = (doc: PDFDocument, fieldName: string, checked: boolean): void => {
  if (!fieldName) return;
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFCheckBox) {
      checked ? field.check() : field.uncheck();
    }
  } catch {
    // silently skip
  }
};

// ─── tax-year → PDF URL resolver ────────────────────────────────────────────────────────
//
// Files available in public/pdf/:
//   Form-5472.pdf            (2024, latest/generic)
//   Form-5472-2023.pdf
//   Form-5472-2022.pdf
//   Form-5472-2019-2021.pdf  (covers 2019, 2020, 2021)
//   Form-1120-2025.pdf
//   Form-1120-2024.pdf
//   Form-1120-2023.pdf
//   Form-1120-2022.pdf
//   Form-1120-2021.pdf
//   Form-1120-2020.pdf
//   Form-1120-2019.pdf

const BASE = import.meta.env.BASE_URL ?? '/';

export const get5472PdfUrl = (taxYear: number): string => {
  if (taxYear >= 2024) return `${BASE}pdf/Form-5472.pdf`;
  if (taxYear === 2023) return `${BASE}pdf/Form-5472-2023.pdf`;
  if (taxYear === 2022) return `${BASE}pdf/Form-5472-2022.pdf`;
  return `${BASE}pdf/Form-5472-2019-2021.pdf`;
};

export const get1120PdfUrl = (taxYear: number): string => {
  if (taxYear >= 2025) return `${BASE}pdf/Form-1120-2025.pdf`;
  if (taxYear === 2024) return `${BASE}pdf/Form-1120-2024.pdf`;
  if (taxYear === 2023) return `${BASE}pdf/Form-1120-2023.pdf`;
  if (taxYear === 2022) return `${BASE}pdf/Form-1120-2022.pdf`;
  if (taxYear === 2021) return `${BASE}pdf/Form-1120-2021.pdf`;
  if (taxYear === 2020) return `${BASE}pdf/Form-1120-2020.pdf`;
  return `${BASE}pdf/Form-1120-2019.pdf`;
};

export const get7004PdfUrl = (_taxYear: number): string => {
  // Only the 2025 revision is bundled today; reuse it for now (the form shape
  // is stable year to year). Drop year-specific PDFs into public/pdf/ later.
  return `${BASE}pdf/Form-7004-2025.pdf`;
};

// ─── address helpers ──────────────────────────────────────────────────────────────────

/** Build a combined "City, ST  ZIP" string from a US address. */
const buildCityStateZip = (a: Address | null, fallbackState?: string | null): string => {
  if (!a) return fallbackState ?? '';
  const city  = a.city ?? '';
  const state = a.state ?? fallbackState ?? '';
  const zip   = a.zip ?? '';
  if (!city && !state && !zip) return '';
  return [city, state].filter(Boolean).join(', ') + (zip ? `  ${zip}` : '');
};

/** Return a single street line from a US address. */
const buildStreet = (a: Address | null): string => a?.street ?? '';

/** Build a single-line address string (street, city, state, zip, country). */
const buildFullAddress = (a: Address | null): string => {
  if (!a) return '';
  const line1 = a.street ?? '';
  const cityStateZip = [a.city, a.state].filter(Boolean).join(', ')
    + (a.zip ? `  ${a.zip}` : '');
  const country = a.country ?? '';
  return [line1, cityStateZip, country].map((s) => s.trim()).filter(Boolean).join(', ');
};

/**
 * Form 5472 combines the party name and address into a single field
 * (ShareholderNameAddress / RPNameAddress). Build "Name, Street, City, ST ZIP,
 * Country", falling back to name-only when no address is on file.
 */
const buildNameAndAddress = (name: string, a: Address | null): string => {
  const addr = buildFullAddress(a);
  return addr ? `${name} - ${addr}` : name;
};

// ─── period & initial-return derivation ─────────────────────────────────────────────────
//
// For an initial (first-ever) return whose formation date falls mid-year, the
// tax period BEGINS on the formation date (a short year), not January 1. For
// every other return the period is the full calendar year. The period end is
// always December 31 of the tax year (calendar-year filers, the only case the
// platform supports).

export interface ResolvedPeriod {
  /** ISO begin date (YYYY-MM-DD). */
  beginISO: string;
  /** ISO end date (YYYY-MM-DD). */
  endISO: string;
  /** "January 1, 2025", human format for statements / 1120. */
  beginText: string;
  /** "December 31, 2025", human format. */
  endText: string;
  /** Whether this filing is an initial return. */
  isInitial: boolean;
  /** Whether this filing is a final return (the LLC was dissolved). */
  isFinal: boolean;
  /** Four-digit tax year. */
  year: number;
}

// Exported for the verification harness. The period is the one value that
// reaches all three forms (the 5472 header, the 1120 header and Form 7004), and
// once a package is assembled every field is flattened, so a test cannot read
// it back off the PDF. Asserting on this directly is the only precise check.
export const resolvePeriod = (filing: NormalizedFiling, taxYear: number): ResolvedPeriod => {
  const year = filing.tax_year != null ? Number(filing.tax_year) : taxYear;

  const incorpISO = filing.date_of_incorporation ?? null;

  // The nominal period is the fiscal period if supplied, else the calendar year.
  const nominalBegin = filing.tax_period_begin ?? `${year}-01-01`;
  const nominalEnd = filing.tax_period_end ?? `${year}-12-31`;

  // An initial return is one whose formation date falls WITHIN the nominal
  // period (inclusive). This works for both calendar and fiscal years, a
  // fiscal period can span two calendar years, so we compare against the period
  // bounds, not just the tax-year number.
  const incorpInPeriod =
    !!incorpISO && incorpISO >= nominalBegin && incorpISO <= nominalEnd;
  const isInitial = filing.initial_return ?? incorpInPeriod;

  // Short-year begin: an initial return begins on the formation date (the entity
  // did not exist before it), never before the nominal period start. Take the
  // later of the two so a fiscal filer formed mid-period gets the formation date.
  const beginISO =
    isInitial && incorpISO && incorpISO > nominalBegin ? incorpISO : nominalBegin;

  // Short-year END, the mirror of the line above, and the one that was missing.
  // A final return ends when the entity ceased to exist, which for this product
  // is the date the LLC was dissolved with its state of formation. Without this
  // an LLC dissolved in June printed a period running to 31 December on both the
  // Form 5472 header and the pro forma 1120, covering months in which the entity
  // did not exist.
  //
  // Take the EARLIER of the nominal end and the dissolution date, so a closure
  // date after period end (a dissolution filed in a later year) cannot extend
  // the period, and a fiscal filer who dissolves mid-period is truncated too.
  // Gated on final_return: a dissolution date recorded against a year that is
  // not the final one must not shorten that year.
  const closureISO = filing.date_of_closure ?? null;
  const isFinal = filing.final_return === true;
  const endISO =
    isFinal && closureISO && closureISO > beginISO && closureISO < nominalEnd
      ? closureISO
      : nominalEnd;

  return {
    beginISO,
    endISO,
    beginText: fmtDate(beginISO),
    endText: fmtDate(endISO),
    isInitial,
    isFinal,
    year,
  };
};

/**
 * A timely Form 7004 suppresses a reasonable-cause letter only while its
 * six-month extension is still open. Once that extended deadline passes, an
 * opted-in late filer needs the letter even though extension_filed remains true.
 */
export const shouldIncludeReasonableCause = (
  optedIn: boolean,
  extensionFiled: boolean,
  periodEndISO: string,
  todayISO = new Date().toISOString().slice(0, 10),
): boolean => {
  if (!optedIn) return false;
  if (!extensionFiled) return true;

  const [year, month, day] = periodEndISO.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`shouldIncludeReasonableCause: bad period end "${periodEndISO}"`);
  }

  // Form 1120 is due on the 15th day of the fourth month after period end.
  // Form 7004 extends that deadline by six months.
  const extended = new Date(Date.UTC(year, month + 9, 15)).toISOString().slice(0, 10);
  return todayISO > extended;
};

// ─── transaction aggregation ────────────────────────────────────────────────────────────

export interface AggregatedTransactions {
  // Part IV, Received (LLC received from owner / foreign party)
  sales_received: number;
  tangible_prop_received: number;
  rents_received: number;
  royalties_received: number;
  intangible_received: number;
  services_received: number;
  commissions_received: number;
  interest_received: number;
  insurance_received: number;
  loan_guarantee_received: number;
  other_received: number;
  // Part IV, Paid (LLC paid to owner / foreign party)
  sales_paid: number;
  tangible_prop_paid: number;
  rents_paid: number;
  royalties_paid: number;
  intangible_paid: number;
  services_paid: number;
  commissions_paid: number;
  interest_paid: number;
  insurance_paid: number;
  loan_guarantee_paid: number;
  other_paid: number;
  // Part IV, Loan balances (amount_usd on each loan row IS the closing balance)
  borrowed_begin: number;
  borrowed_end: number;
  loaned_begin: number;
  loaned_end: number;
  // Part V, Distributions / contributions / nonmonetary owner transactions
  distributions_paid: number;
  contributions_received: number;
  // Part V, Formation / start-up costs the owner paid on behalf of the LLC.
  // Tracked in its own bucket so it feeds both the Part V summary and the
  // 1f/1h gross, without being relabeled as a capital contribution.
  formation_costs_paid: number;
  // Part VI, monetary consideration recorded on nonmonetary / below-FMV items
  part_vi_amount: number;
  // flags
  hasPartIV: boolean;
  /**
   * true when any of these types are present:
   *   distribution, dividend, capital_contribution
   * Ticks PART_V_CHECKBOX and triggers the Part V statement.
   *
   * Note: property_transfer and nonmonetary_other belong ONLY in Part VI
   * (they are nonmonetary / less-than-FMV transactions disclosed there).
   */
  hasPartV: boolean;
  /**
   * true always (every 5472 filing involves managerial services by the
   * foreign owner whose FMV cannot be determined).
   * Additionally true when property_transfer or nonmonetary_other
   * transactions exist.
   * Ticks PART_VI_CHECKBOX and triggers the Part VI statement.
   */
  hasPartVI: boolean;
  /** true when any property_transfer transactions exist (used by Part VI statement) */
  hasPropertyTransfer: boolean;
  /** true when any nonmonetary_other transactions exist (used by Part VI statement) */
  hasNonmonetaryOther: boolean;
}

export const aggregateTransactions = (txns: Transaction[]): AggregatedTransactions => {
  const t: AggregatedTransactions = {
    sales_received: 0, tangible_prop_received: 0,
    rents_received: 0, royalties_received: 0,
    intangible_received: 0, services_received: 0,
    commissions_received: 0, interest_received: 0,
    insurance_received: 0, loan_guarantee_received: 0,
    other_received: 0,
    sales_paid: 0, tangible_prop_paid: 0,
    rents_paid: 0, royalties_paid: 0,
    intangible_paid: 0, services_paid: 0,
    commissions_paid: 0, interest_paid: 0,
    insurance_paid: 0, loan_guarantee_paid: 0,
    other_paid: 0,
    borrowed_begin: 0, borrowed_end: 0,
    loaned_begin: 0, loaned_end: 0,
    distributions_paid: 0, contributions_received: 0,
    formation_costs_paid: 0,
    part_vi_amount: 0,
    hasPartIV: false,
    // Part V: only monetary owner transactions (distributions, contributions, dividends)
    hasPartV: false,
    // Part VI is ALWAYS true, managerial services by foreign owner are
    // present in every filing and have no determinable FMV.
    hasPartVI: true,
    hasPropertyTransfer: false,
    hasNonmonetaryOther: false,
  };

  for (const tx of txns) {
    const amt = tx.amount_usd ?? 0;
    const dir = tx.direction;

    switch (tx.transaction_type) {
      case 'sales':
        dir === 'received' ? (t.sales_received += amt) : (t.sales_paid += amt);
        t.hasPartIV = true; break;
      case 'tangible_property':
        dir === 'received' ? (t.tangible_prop_received += amt) : (t.tangible_prop_paid += amt);
        t.hasPartIV = true; break;
      case 'rent_royalty':
        if (dir === 'received') {
          tx.is_royalty ? (t.royalties_received += amt) : (t.rents_received += amt);
        } else {
          tx.is_royalty ? (t.royalties_paid += amt) : (t.rents_paid += amt);
        }
        t.hasPartIV = true; break;
      case 'intangible':
        dir === 'received' ? (t.intangible_received += amt) : (t.intangible_paid += amt);
        t.hasPartIV = true; break;
      case 'service_payment':
        dir === 'received' ? (t.services_received += amt) : (t.services_paid += amt);
        t.hasPartIV = true; break;
      case 'commission':
        dir === 'received' ? (t.commissions_received += amt) : (t.commissions_paid += amt);
        t.hasPartIV = true; break;
      case 'loan_to_llc':
        // LLC borrowed from the related party: 17a = begin, 17b = end balance.
        t.borrowed_begin += tx.loan_begin_usd ?? 0;
        t.borrowed_end += amt; t.hasPartIV = true; break;
      case 'loan_from_llc':
        // LLC loaned to the related party: 31a = begin, 31b = end balance.
        t.loaned_begin += tx.loan_begin_usd ?? 0;
        t.loaned_end += amt; t.hasPartIV = true; break;
      case 'interest':
        dir === 'paid' ? (t.interest_paid += amt) : (t.interest_received += amt);
        t.hasPartIV = true; break;
      case 'insurance':
        dir === 'paid' ? (t.insurance_paid += amt) : (t.insurance_received += amt);
        t.hasPartIV = true; break;
      case 'loan_guarantee':
        dir === 'paid' ? (t.loan_guarantee_paid += amt) : (t.loan_guarantee_received += amt);
        t.hasPartIV = true; break;
      case 'dividend':
        t.distributions_paid += amt;
        t.hasPartV = true; break;
      case 'capital_contribution':
        t.contributions_received += amt;
        t.hasPartV = true; break;
      case 'distribution':
        t.distributions_paid += amt;
        t.hasPartV = true; break;
      case 'other':
        dir === 'paid' ? (t.other_paid += amt) : (t.other_received += amt);
        t.hasPartIV = true; break;
      // ── Part VI only, nonmonetary / less-than-FMV transactions ─────────────
      // These are NOT reported on Part V (no monetary amount to disclose there).
      // They are always disclosed in the Part VI statement instead.
      case 'property_transfer':
        t.hasPropertyTransfer = true; t.part_vi_amount += amt; break;
      case 'nonmonetary_other':
        t.hasNonmonetaryOther = true; t.part_vi_amount += amt; break;
      // formation_costs: owner paid something on behalf of LLC, Part V disclosure.
      // Accumulate the amount so it feeds the Part V summary and the 1f/1h gross;
      // previously only the flag was set and the dollar amount was dropped.
      case 'formation_costs':
        t.formation_costs_paid += amt;
        t.hasPartV = true; break;
      default:
        break;
    }
  }

  return t;
};

// ─── total helpers ──────────────────────────────────────────────────────────────────────
//
// Line 22 = "Total" of the Part IV amounts-received lines (9–21), and line 36 =
// "Total" of the amounts-paid lines (23–35). The loan lines (17a/17b borrowed,
// 31a/31b loaned) fall inside those ranges on the form, so the ENDING loan
// balance (17b into line 22, 31b into line 36) is included in the totals, the
// beginning balance is not (it would double-count the same loan).
//   • Capital contributions and distributions are Part V transactions (owner /
//     DE transactions), NOT Part IV, they are disclosed on the Part V
//     statement. They are added to the 1f/1h gross-payments figure but not to
//     the Part IV line 22/36 subtotals.
//   • Line 1f gross payments = line 22 + line 36 (+ Part V monetary + Part VI
//     amount). So 1f/1h build on these same totals.

const totalReceived = (t: AggregatedTransactions): number =>
  t.sales_received + t.tangible_prop_received + t.rents_received +
  t.royalties_received + t.intangible_received + t.services_received +
  t.commissions_received + t.interest_received + t.insurance_received +
  t.loan_guarantee_received + t.other_received +
  // Line 17b, amounts borrowed, ending balance (rolls into the line 22 total).
  t.borrowed_end;

const totalPaid = (t: AggregatedTransactions): number =>
  t.sales_paid + t.tangible_prop_paid + t.rents_paid +
  t.royalties_paid + t.intangible_paid + t.services_paid +
  t.commissions_paid + t.interest_paid + t.insurance_paid +
  t.loan_guarantee_paid + t.other_paid +
  // Line 31b, amounts loaned, ending balance (rolls into the line 36 total).
  t.loaned_end;

/**
 * Gross payments for Form 5472 line 1f (this form) / line 1h (all forms).
 *
 * Line 1f/1h are the aggregate of the monetary transactions reported for the
 * related party. This includes the Part IV totals (line 22 + line 36, which now
 * carry the ending loan balances on 17b/31b), the monetary Part V transactions
 * (owner distributions, capital contributions, dividends) and any monetary
 * Part VI amounts (consideration on property transfers / other nonmonetary
 * items where an amount was recorded).
 *
 * `isOwner` GATES THE PART V / PART VI COMPONENT, AND HAS TO
 *
 * Parts V and VI belong to the owner's Form 5472 alone: buildYearDocs builds
 * those statements for the owner only, and fill5472 ticks both checkboxes for
 * the owner only. This aggregate was ungated, so a distribution, dividend,
 * capital contribution, formation cost, property transfer or other nonmonetary
 * item attached to an ADDITIONAL related party still counted toward that
 * party's line 1f and the entity-wide line 1h - while appearing on no Part IV
 * line, no checkbox and no statement, because a non-owner's form has none of
 * those.
 *
 * The result was a Form 5472 whose line 1f exceeded line 22 + line 36 with
 * nothing on the return accounting for the difference, which is the kind of
 * discrepancy a reviewer opens a case about. Line 1f is the gross payments
 * reported ON THIS FORM, so an amount this form does not report cannot belong
 * in it.
 *
 * The amount is not silently lost, because intake no longer lets these six
 * types be attached to anyone but the owner (validateTransactions in
 * Intake.tsx), which is where they were always meant to sit and where they are
 * actually disclosed. This gate is the backstop for rows saved before that
 * validation existed.
 */
export const grossPaymentsForLines1f1h = (
  t: AggregatedTransactions,
  isOwner: boolean,
): number =>
  totalReceived(t) + totalPaid(t) +
  (isOwner
    ? t.distributions_paid + t.contributions_received + t.formation_costs_paid + t.part_vi_amount
    : 0);

// ─── shared statement page utilities ─────────────────────────────────────────────────────────

const PAGE_W  = 612; // US Letter
const PAGE_H  = 792;
const MARGIN  = 56;
const COL_W   = PAGE_W - MARGIN * 2;
const MIN_Y   = MARGIN + 60;

// Single, consistent type scale for every generated statement / letter /
// instructions page. Body copy is a constant 9pt across all forms; only the
// page title and the footer disclaimer differ, kept close so the pages read
// uniformly.
const FS_BODY    = 9;
const FS_HEADING = 12;   // page title
const FS_FOOTER  = 8;    // small footer disclaimer

type FontPair = { bold: Awaited<ReturnType<PDFDocument['embedFont']>>; reg: Awaited<ReturnType<PDFDocument['embedFont']>> };

/**
 * Word-wrap `text` into `doc`'s `page` starting at (x, y).
 * Returns the y coordinate AFTER the last line drawn.
 */
const drawWrapped = (
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: {
    size?:     number;
    font?:     FontPair['bold'] | FontPair['reg'];
    color?:    ReturnType<typeof rgb>;
    maxWidth?: number;
  },
  fonts: FontPair,
): number => {
  const size   = opts.size     ?? FS_BODY;
  const font   = opts.font     ?? fonts.reg;
  const color  = opts.color    ?? rgb(0, 0, 0);
  const maxW   = opts.maxWidth ?? COL_W;
  const lineH  = size * 1.45;
  // widthOfTextAtSize throws on an unencodable character just as drawText does,
  // so sanitize before measuring, not just before drawing.
  const words  = toFormText(text).split(' ');
  let   line   = '';
  let   drawY  = y;

  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxW && line) {
      page.drawText(line, { x, y: drawY, size, font, color });
      drawY -= lineH;
      line   = word;
    } else {
      line = trial;
    }
  }
  if (line) {
    page.drawText(line, { x, y: drawY, size, font, color });
    drawY -= lineH;
  }
  return drawY;
};

/** Append a new Letter page and return it with a reset cursor. */
const newPage = (doc: PDFDocument): { page: PDFPage; cursor: { y: number } } => {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return { page, cursor: { y: PAGE_H - MARGIN } };
};

/** Draw a full-width horizontal rule at cursor.y; advances cursor. */
const drawRule = (page: PDFPage, cursor: { y: number }, thick = 0.75): void => {
  page.drawLine({
    start:     { x: MARGIN, y: cursor.y },
    end:       { x: PAGE_W - MARGIN, y: cursor.y },
    thickness: thick,
    color:     rgb(0, 0, 0),
  });
  cursor.y -= 14;
};

/** Standard statement header block (title + entity line + period + rule). */
const drawStatementHeader = (
  page: PDFPage,
  cursor: { y: number },
  title: string,
  filing: Filing,
  periodBegin: string,
  periodEnd: string,
  taxYear: number,
  fonts: FontPair,
): void => {
  cursor.y = drawWrapped(page, title, MARGIN, cursor.y,
    { size: FS_HEADING, font: fonts.bold }, fonts);
  cursor.y -= 4;
  cursor.y = drawWrapped(page,
    `Taxpayer: ${filing.llc_name ?? ''}    EIN: ${filing.ein ?? ''}`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y = drawWrapped(page,
    `Tax Year: ${periodBegin} – ${periodEnd}  (Tax Year ${taxYear})`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 6;
  drawRule(page, cursor);
};

// ─── Part V statement ─────────────────────────────────────────────────────────────────────────────
//
// Required by Form 5472, Part V (checkbox "TransactionsWithOwner").
// Documents monetary transactions between the LLC and its foreign owner:
//   • Owner distributions / withdrawals
//   • Dividends paid to owner
//   • Capital contributions by the owner
//   • Payments made by the owner on behalf of the LLC (formation costs)
//
// NOTE: property_transfer and nonmonetary_other are Part VI disclosures ONLY.
// They are NOT included in this Part V statement.

const PART_V_TYPES = new Set([
  'distribution', 'dividend', 'capital_contribution', 'formation_costs',
]);

const PART_V_TYPE_LABELS: Record<string, string> = {
  distribution:         'Distribution / Withdrawal by Owner',
  dividend:             'Dividend Paid to Owner',
  capital_contribution: 'Capital Contribution by Owner',
  formation_costs:      'Payment by Owner on Behalf of LLC (Formation / Start-up Costs)',
};

/**
 * A readable description for a transaction type that has no entry above.
 *
 * PART_V_TYPES and PART_V_TYPE_LABELS currently hold the same four codes, so
 * this is unreachable today. It exists because the previous fallback printed
 * `tx.transaction_type` itself, meaning the day someone adds a fifth Part V
 * code and forgets the label, an internal identifier like `capital_contribution`
 * is what the IRS reads on the filer's statement. A humanised form is wrong in
 * the sense of being unpolished; a raw code is wrong in the sense of being
 * unprofessional on a filed return.
 */
const humanizeTxCode = (code: string): string =>
  code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const buildPartVStatement = async (
  filing: NormalizedFiling,
  txns: Transaction[],
  period: ResolvedPeriod,
): Promise<PDFDocument> => {
  const partVTxns = txns.filter(tx => PART_V_TYPES.has(tx.transaction_type));

  const doc   = await PDFDocument.create();
  const bold  = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg   = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: FontPair = { bold, reg };

  const periodBegin = period.beginText;
  const periodEnd   = period.endText;

  let { page, cursor } = newPage(doc);

  drawStatementHeader(
    page, cursor,
    'STATEMENT REQUIRED UNDER FORM 5472, PART V: TRANSACTIONS WITH FOREIGN OWNER',
    filing, periodBegin, periodEnd, period.year, fonts,
  );

  // Intro paragraph, cite the governing law, reference Part V and the txns.
  const intro =
    'This statement is furnished under Internal Revenue Code section 6038A and '
    + 'Treasury Regulation section 1.6038A-2, and supports Part V of Form 5472. '
    + 'During the tax year identified above, the reporting corporation engaged in the '
    + 'following reportable transactions with its foreign owner. '
    + 'Each such transaction is described below.';
  cursor.y = drawWrapped(page, intro, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 14;

  // ── Aggregated monetary totals block ──────────────────────────────────────────
  const txn = aggregateTransactions(txns);
  if (txn.distributions_paid > 0 || txn.contributions_received > 0 || txn.formation_costs_paid > 0) {
    cursor.y = drawWrapped(page, 'Summary of Monetary Part V Transactions:', MARGIN, cursor.y,
      { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 2;
    if (txn.distributions_paid > 0) {
      cursor.y = drawWrapped(page,
        `Total Distributions / Withdrawals paid to Owner:  $${txn.distributions_paid.toLocaleString('en-US')}`,
        MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
    }
    if (txn.contributions_received > 0) {
      cursor.y = drawWrapped(page,
        `Total Capital Contributions received from Owner:  $${txn.contributions_received.toLocaleString('en-US')}`,
        MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
    }
    if (txn.formation_costs_paid > 0) {
      cursor.y = drawWrapped(page,
        `Total Formation / Start-up Costs paid by Owner on behalf of LLC:  $${txn.formation_costs_paid.toLocaleString('en-US')}`,
        MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
    }
    cursor.y -= 12;
  }

  // ── Individual transaction entries ────────────────────────────────────────────────
  if (partVTxns.length > 0) {
    cursor.y = drawWrapped(page, 'Transaction Detail:', MARGIN, cursor.y,
      { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 4;
  }

  partVTxns.forEach((tx, idx) => {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));

    const label     = PART_V_TYPE_LABELS[tx.transaction_type] ?? humanizeTxCode(tx.transaction_type);
    const txDate    = tx.transaction_date ? fmtDate(tx.transaction_date) : 'Not specified';
    const amtText   = tx.amount_usd != null && tx.amount_usd !== 0
      ? `$${tx.amount_usd.toLocaleString('en-US')}`
      : 'N/A (nonmonetary, FMV not determinable)';
    const desc      = tx.description?.trim();

    cursor.y = drawWrapped(page, `Transaction ${idx + 1}: ${label}`, MARGIN, cursor.y,
      { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 2;

    // The transaction label already states who paid whom (e.g. "Capital
    // Contribution by Owner"), so a separate Direction line would be redundant
    // and can read incorrectly, it is omitted. Description is omitted when blank.
    const fields: [string, string][] = [
      ['Date:',   txDate],
      ['Amount:', amtText],
      ...(desc ? [['Description:', desc] as [string, string]] : []),
    ];

    for (const [fieldLabel, fieldValue] of fields) {
      if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
      const labelW = bold.widthOfTextAtSize(fieldLabel, 10) + 6;
      page.drawText(toFormText(fieldLabel), { x: MARGIN + 12, y: cursor.y, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
      cursor.y = drawWrapped(page, fieldValue, MARGIN + 12 + labelW, cursor.y,
        { size: FS_BODY, maxWidth: COL_W - 12 - labelW }, fonts);
    }

    cursor.y -= 12;

    if (idx < partVTxns.length - 1) {
      if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
      page.drawLine({
        start: { x: MARGIN + 12, y: cursor.y },
        end:   { x: PAGE_W - MARGIN, y: cursor.y },
        thickness: 0.35, color: rgb(0.6, 0.6, 0.6),
      });
      cursor.y -= 10;
    }
  });

  // Footer
  cursor.y -= 20;
  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
  drawWrapped(page,
    'This statement is attached to and made a part of Form 5472 (Part V) filed by the reporting corporation named above.',
    MARGIN, cursor.y, { size: FS_FOOTER, color: rgb(0.4, 0.4, 0.4) }, fonts);

  return doc;
};

// ─── Part VI statement ────────────────────────────────────────────────────────────────────────────
//
// Required by Form 5472, Part VI (checkbox "NonMonetoryTransactionsWithOwner").
// This statement is ALWAYS generated for every 5472 filing because the foreign
// owner of a domestic disregarded entity necessarily provides managerial and
// operational services to the LLC whose fair market value cannot be determined
// with certainty.
//
// Item 1 (always): Managerial services FMV disclosure.
// Item 2 (conditional): property_transfer transactions (transfer at less than FMV).
// Item 3 (conditional): nonmonetary_other transactions.

export const buildPartVIStatement = async (
  filing: NormalizedFiling,
  party: NormalizedParty,
  txns: Transaction[],
  period: ResolvedPeriod,
): Promise<PDFDocument> => {
  const propertyTransferTxns = txns.filter(tx => tx.transaction_type === 'property_transfer');
  const nonmonetaryOtherTxns = txns.filter(tx => tx.transaction_type === 'nonmonetary_other');

  const doc   = await PDFDocument.create();
  const bold  = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg   = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: FontPair = { bold, reg };

  const periodBegin = period.beginText;
  const periodEnd   = period.endText;

  let { page, cursor } = newPage(doc);

  drawStatementHeader(
    page, cursor,
    'ATTACHMENT TO FORM 5472 – PART VI: NONMONETARY AND LESS-THAN-FULL CONSIDERATION TRANSACTIONS',
    filing, periodBegin, periodEnd, period.year, fonts,
  );

  const ownerName = party.full_name || (party.is_owner ? 'the foreign owner' : 'the related party');
  const llcName   = filing.llc_name ?? 'the reporting corporation';

  // Running item counter so item numbers stay correct regardless of which
  // blocks are present for this particular party.
  let itemNo = 0;

  // ── Item: Managerial services, OWNER ONLY, when enabled ──────────────────────────
  // The owner of a foreign-owned DE necessarily provides managerial services
  // whose FMV cannot be determined; this is disclosed on the owner's Form 5472
  // Part VI by default. The user may opt out (part_vi_managerial = false), in
  // which case this item is omitted. Additional related parties never get this
  // item, they only appear in Part VI for an actual non-monetary transaction.
  const managerialOn = party.is_owner && (filing.part_vi_managerial ?? true);
  if (managerialOn) {
    itemNo += 1;
    cursor.y = drawWrapped(page,
      `Item ${itemNo}: Uncompensated Managerial and Operational Services by Foreign Owner`,
      MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 4;

    const para1 =
      `Pursuant to Treas. Reg. § 1.6038A-2(b)(4), the Reporting Corporation hereby discloses ` +
      `that during the tax year ended ${periodEnd}, ${ownerName} (a 25% foreign shareholder and ` +
      `related party) provided uncompensated administrative, managerial, and operational ` +
      `services to the Reporting Corporation.`;
    const para2 =
      `These services encompassed general management, strategic decision-making, business ` +
      `development, and operational oversight. No monetary consideration was paid, accrued, or ` +
      `otherwise exchanged between the Reporting Corporation and the related party for these ` +
      `services.`;

    cursor.y = drawWrapped(page, para1, MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
    cursor.y -= 8;
    cursor.y = drawWrapped(page, para2, MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
    cursor.y -= 16;
  }

  // ── Item: Property transfer (conditional) ────────────────────────────────────────
  if (propertyTransferTxns.length > 0) {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));

    itemNo += 1;
    cursor.y = drawWrapped(page,
      `Item ${itemNo}: Transfer of Property at Less Than Fair Market Value`,
      MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 4;

    cursor.y = drawWrapped(page,
      `During the tax year, the following property transfer(s) occurred between ` +
      `${llcName} and ${ownerName}. The consideration paid, if any, may have been ` +
      `less than the fair market value of the property transferred. Each transfer is ` +
      `described below:`,
      MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
    cursor.y -= 10;

    propertyTransferTxns.forEach((tx, idx) => {
      if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));

      const txDate  = tx.transaction_date ? fmtDate(tx.transaction_date) : 'Not specified';
      const counterparty = party.is_owner ? 'owner' : 'related party';
      const dirText = tx.direction === 'paid'
        ? `Property transferred from LLC to ${counterparty}`
        : `Property transferred from ${counterparty} to LLC`;
      const amtText = tx.amount_usd != null && tx.amount_usd !== 0
        ? `$${tx.amount_usd.toLocaleString('en-US')} (consideration paid; FMV may differ)`
        : 'No consideration paid (gratuitous transfer or FMV not determinable)';
      const desc    = tx.description?.trim();

      cursor.y = drawWrapped(page, `Transfer ${idx + 1}:`, MARGIN + 12, cursor.y,
        { size: FS_BODY, font: bold }, fonts);
      cursor.y -= 2;

      const fields: [string, string][] = [
        ['Date:',               txDate],
        ['Direction:',          dirText],
        ['Consideration:',      amtText],
        ...(desc ? [['Property described:', desc] as [string, string]] : []),
      ];

      for (const [fieldLabel, fieldValue] of fields) {
        if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
        const labelW = bold.widthOfTextAtSize(fieldLabel, 10) + 6;
        page.drawText(toFormText(fieldLabel), { x: MARGIN + 24, y: cursor.y, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
        cursor.y = drawWrapped(page, fieldValue, MARGIN + 24 + labelW, cursor.y,
          { size: FS_BODY, maxWidth: COL_W - 24 - labelW }, fonts);
      }
      cursor.y -= 10;
    });
  }

  // ── Item 3: Other nonmonetary transactions (conditional) ──────────────────────────
  if (nonmonetaryOtherTxns.length > 0) {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));

    itemNo += 1;
    cursor.y = drawWrapped(page,
      `Item ${itemNo}: Other Nonmonetary Transactions (FMV Not Determinable)`,
      MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 4;

    cursor.y = drawWrapped(page,
      `During the tax year, the following nonmonetary transaction(s) occurred between ` +
      `${llcName} and ${ownerName}. No consideration was exchanged and/or the fair ` +
      `market value cannot be determined:`,
      MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
    cursor.y -= 10;

    nonmonetaryOtherTxns.forEach((tx, idx) => {
      if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));

      const txDate = tx.transaction_date ? fmtDate(tx.transaction_date) : 'Not specified';
      const desc   = tx.description?.trim();

      cursor.y = drawWrapped(page, `Transaction ${idx + 1}:`, MARGIN + 12, cursor.y,
        { size: FS_BODY, font: bold }, fonts);
      cursor.y -= 2;

      const fields: [string, string][] = [
        ['Date:', txDate],
        ...(desc ? [['Description:', desc] as [string, string]] : []),
      ];

      for (const [fieldLabel, fieldValue] of fields) {
        if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
        const labelW = bold.widthOfTextAtSize(fieldLabel, 10) + 6;
        page.drawText(toFormText(fieldLabel), { x: MARGIN + 24, y: cursor.y, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
        cursor.y = drawWrapped(page, fieldValue, MARGIN + 24 + labelW, cursor.y,
          { size: FS_BODY, maxWidth: COL_W - 24 - labelW }, fonts);
      }
      cursor.y -= 10;
    });
  }

  // Footer
  cursor.y -= 20;
  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
  drawWrapped(page,
    'This statement is attached to and made a part of Form 5472 (Part VI) filed by the reporting corporation named above.',
    MARGIN, cursor.y, { size: FS_FOOTER, color: rgb(0.4, 0.4, 0.4) }, fonts);

  return doc;
};

// ─── Reasonable Cause Letter (one letter covering ALL late years) ───────────────────────────
//
// IRS first-time-filer penalty abatement for late Form 5472 is requested with a
// reasonable-cause statement. A SINGLE letter may cover multiple late years for
// the same entity. This builder produces that one letter, listing every year in
// the job and incorporating the user's narrative.

export const buildReasonableCauseLetter = async (
  filing: NormalizedFiling,
  taxYears: number[],
  narrative: string | null | undefined,
  /**
   * Optional drawn signature, a PNG data URL. Drawn above the typed name in the
   * signature block. See drawnSignature.ts for why this is an option rather
   * than a stored asset, and why a drawn mark is legally equivalent to the
   * typed name rather than superior to it.
   */
  drawnSignature?: DrawnSignature | null,
): Promise<PDFDocument> => {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: FontPair = { bold, reg };

  let { page, cursor } = newPage(doc);

  const years = [...taxYears].sort((a, b) => a - b);
  const yearsText =
    years.length === 1
      ? `tax year ${years[0]}`
      : `tax years ${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;

  cursor.y = drawWrapped(page, 'REASONABLE CAUSE STATEMENT', MARGIN, cursor.y,
    { size: FS_HEADING, font: bold }, fonts);
  cursor.y -= 4;
  cursor.y = drawWrapped(page,
    'Request for abatement of penalties under IRC §6038A for late-filed Form 5472',
    MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
  cursor.y -= 6;
  drawRule(page, cursor);

  cursor.y = drawWrapped(page,
    `Taxpayer: ${filing.llc_name ?? ''}`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y = drawWrapped(page, `Employer Identification Number: ${filing.ein ?? ''}`, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y = drawWrapped(page, `Tax year(s) covered: ${yearsText}`, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 14;

  cursor.y = drawWrapped(page, 'To the Internal Revenue Service:', MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 10;

  const single = years.length === 1;
  // NOTE: The intro no longer asserts that the return is being filed
  // "voluntarily, before any notice or examination." Voluntariness is only
  // claimed when the filer actually selects the voluntary-filing reason, which
  // contributes its own paragraph via RCL_REASON_PARAGRAPHS.voluntary_filing.
  const intro =
    `I am the owner of ${filing.llc_name ?? 'my company'}, a U.S. limited liability company ` +
    `that I wholly own as a non-U.S. person and that is treated as a foreign owned ` +
    `disregarded entity. I respectfully ask the Internal Revenue Service to abate in full ` +
    `any penalties charged under Internal Revenue Code §6038A for the late filing of ` +
    `Form 5472, and the accompanying pro forma Form 1120, for ${yearsText}. ` +
    `The facts that establish reasonable cause are set out below.`;
  cursor.y = drawWrapped(page, intro, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 12;

  cursor.y = drawWrapped(page, 'Statement of Facts and Reasonable Cause', MARGIN, cursor.y,
    { size: FS_BODY, font: bold }, fonts);
  cursor.y -= 6;

  const DEFAULT_BODY =
    'I am a non-U.S. individual and the sole owner of my company. When my company was ' +
    'formed, I had no previous experience with the U.S. federal tax system and no reason ' +
    'to expect an information reporting obligation for a company that owed no U.S. tax. I ' +
    'used a formation service to set up my company and was not told, at formation or later, ' +
    'that Treasury Regulation section 1.6038A-2 requires a foreign owned disregarded entity ' +
    'to file Form 5472 with a pro forma Form 1120 whether or not any tax is due.\n\n' +
    'My belief that no return was required was reasonable and held in good faith. A taxpayer ' +
    'exercises ordinary business care and prudence, within the meaning of Treasury ' +
    'Regulation section 301.6651-1(c)(1), when they reasonably rely on the absence of any ' +
    'indication that a filing is due and have no U.S. income tax to pay. There was no ' +
    `willful neglect and no intent to ignore the filing requirement.\n\n` +
    'As soon as I learned of the requirement, I acted diligently to become compliant, ' +
    `gathering the records needed to prepare a complete and accurate Form 5472 for each ` +
    `affected year and filing ${single ? 'this delinquent return' : 'these delinquent returns'} ` +
    'as promptly as I was able. I have also put ' +
    'procedures in place to make sure Form 5472 is filed on time in all future years.';

  const body = (narrative && narrative.trim()) ? narrative.trim() : DEFAULT_BODY;
  // Each reason / point is its own paragraph (split on blank lines).
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paras.forEach((para) => {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
    cursor.y = drawWrapped(page, para, MARGIN, cursor.y, { size: FS_BODY }, fonts);
    cursor.y -= 10;
  });
  cursor.y -= 4;

  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
  const close =
    'For these reasons, my failure to file was due to reasonable cause and not to willful ' +
    'neglect, and abatement is warranted under Internal Revenue Code section 6038A(d) and ' +
    'the reasonable cause standard of Treasury Regulation section 301.6651-1(c). I ' +
    `respectfully ask that any penalties charged under section 6038A for ${yearsText} be ` +
    `abated in full. All required ${single ? 'Form 5472 and the accompanying pro forma ' +
    'Form 1120 are' : 'Forms 5472 and accompanying pro forma Forms 1120 are'} enclosed. I ` +
    'will promptly provide any additional information the IRS may need.';
  cursor.y = drawWrapped(page, close, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 16;
  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));

  cursor.y = drawWrapped(page, 'Signed under penalties of perjury,', MARGIN, cursor.y, { size: FS_BODY }, fonts);

  // ── Signature block ────────────────────────────────────────────────────────
  // 26 CFR 301.6651-1(c)(1) requires the reasonable cause showing to be a
  // written statement containing a declaration under penalties of perjury, so
  // of everything in the package this is the document that most needs to read
  // as signed.
  //
  // Layout is: drawn mark (if any), then the typed name, then the title. The
  // typed name stays even when a mark is drawn. It is the printed name beneath
  // the signature, which is what a reviewer expects to see, and it is
  // independently a valid signature under IRM 10.10.1.3.1.1, so the letter is
  // never worse off than before this feature existed.
  const rclSignature = await embedDrawnSignature(doc, drawnSignature);
  const SIG_BOX_H = 34;

  if (rclSignature) {
    // Reserve the box first so a tall signature cannot run off the bottom of
    // the page and land on top of the closing paragraph.
    if (cursor.y - SIG_BOX_H < MARGIN) ({ page, cursor } = newPage(doc));
    cursor.y -= SIG_BOX_H + 2;
    drawSignatureInBox(page, rclSignature, {
      x: MARGIN,
      y: cursor.y,
      maxWidth: 200,
      maxHeight: SIG_BOX_H,
    });
    cursor.y -= 12;
  } else {
    // No mark was drawn, so the typed name signs. Render it in the script face
    // above its own printed form, which is the layout a reviewer expects and
    // the one the drawn path above already produces. See typedSignature.ts for
    // why this is the fallback and not the default.
    //
    // If the script face is unavailable or cannot render this name, this draws
    // nothing and the whitespace-for-a-pen behaviour that predates it stands.
    if (cursor.y - SIG_BOX_H < MARGIN) ({ page, cursor } = newPage(doc));
    cursor.y -= SIG_BOX_H + 2;
    const scriptFont = await embedSignatureFont(doc, filing.owner.full_name);
    if (scriptFont) {
      drawTypedSignatureInBox(page, scriptFont, filing.owner.full_name ?? '', {
        x: MARGIN,
        y: cursor.y,
        maxWidth: 200,
        maxHeight: SIG_BOX_H,
      });
    }
    cursor.y -= 12;
  }

  cursor.y = drawWrapped(page, `${filing.owner.full_name || '________________________'}`,
    MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
  drawWrapped(page, `${filing.signer_title ?? 'Managing Member'}, ${filing.llc_name ?? ''}`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);

  return doc;
};

// ─── Filing instructions page (page 1 of each per-year PDF) ──────────────────────────────────

export const buildInstructionsPage = async (
  filing: NormalizedFiling,
  period: ResolvedPeriod,
  opts: { isLate: boolean; hasRCL: boolean; formCount: number },
): Promise<PDFDocument> => {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: FontPair = { bold, reg };

  let { page, cursor } = newPage(doc);

  cursor.y = drawWrapped(page, `Filing Instructions, Tax Year ${period.year}`, MARGIN, cursor.y,
    { size: FS_HEADING, font: bold }, fonts);
  cursor.y -= 4;
  cursor.y = drawWrapped(page,
    `${filing.llc_name ?? ''}    EIN: ${filing.ein ?? ''}`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 6;
  drawRule(page, cursor);

  // Preparer-style filing instructions (Lacerte / CCH ProSystem fx format:
  // "Return / Mail to / Deadline / Other" blocks stating exactly what to do).
  const formsLine = opts.formCount > 1
    ? `Form 1120 (pro forma) with ${opts.formCount} Forms 5472 attached (one per related party)`
    : 'Form 1120 (pro forma) with Form 5472 attached';

  // NOTE: No "Signature" instruction. The owner's signature and date are
  // collected during intake and already printed on the pro forma Form 1120
  // (see the signature block below), so the filer does not need to sign again.
  const rows: [string, string][] = [
    ['Taxpayer', `${filing.llc_name ?? ''} (EIN ${filing.ein ?? 'Not provided'})`],
    ['Return', `${formsLine}, for the tax period ${period.beginText} through ${period.endText}.`],
  ];
  if (opts.hasRCL) {
    rows.push(['Attachment', 'A Reasonable Cause Statement is enclosed once for the whole submission, placed at the front of the package.']);
  }
  rows.push(
    ['Assembly', 'Do not staple. Assemble in this order: Form 1120 (pro forma) on top, then each Form 5472 with its attached statements.'],
    ['Mail to', 'Internal Revenue Service\n1973 Rulon White Blvd., M/S 6112, Attn: PIN Unit\nOgden, UT 84201'],
    ['Or fax to', '855-887-7737 (a foreign-owned U.S. DE may file Form 5472 by fax in lieu of mailing)'],
    ['Deadline', 'File by the 15th day of the 4th month after the close of the tax year (April 15 for a calendar-year filer). Verify the current IRS address and fax number on irs.gov before sending.'],
    ['Proof of filing', 'Keep a copy and proof of mailing (USPS Certified Mail). The IRS does not send a receipt.'],
  );

  const labelW = 88;
  for (const [label, value] of rows) {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
    const startY = cursor.y;
    page.drawText(toFormText(label), { x: MARGIN, y: startY, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
    // A value may contain hard line breaks (address block).
    let vy = startY;
    for (const seg of value.split('\n')) {
      vy = drawWrapped(page, seg, MARGIN + labelW, vy, { size: FS_BODY, maxWidth: COL_W - labelW }, fonts);
    }
    cursor.y = Math.min(vy, startY - 12) - 6;
  }

  cursor.y -= 8;
  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
  cursor.y = drawWrapped(page, 'Important notices:', MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
  cursor.y -= 4;
  const notices = [
    'Penalty: failing to file a correct, complete Form 5472 carries a $25,000 penalty per form, per related party, per year under IRC §6038A.',
    // "The statutory period" told the filer nothing, and there is no fixed
    // number of years to give instead. 26 CFR 1.6038A-3(g) requires records to
    // be kept as long as they may be relevant, and in no case less than the
    // limitations period on assessment. For a section 6038A filer that period
    // is unusual: under IRC 6501(c)(8) it does not expire until 3 years AFTER
    // the IRS is furnished the information, so the clock starts on the date the
    // Form 5472 is actually filed, not on the year it reports. A filer catching
    // up on 2019 in 2026 must keep the 2019 records until at least 2029. Saying
    // "keep for six years" would be wrong for exactly the multi-year catch-up
    // customer this product is built for.
    'Record retention: keep invoices, contracts, bank statements, related-party agreements, and a copy of this package for at least 3 years from the date you FILE this Form 5472, and longer while the records remain relevant. Under IRC §6501(c)(8) the IRS assessment window does not close until 3 years after it receives the information, so for a late or catch-up filing the clock starts when you file, not when the tax year ended.',
    'State obligations: this federal filing does not cover state requirements (e.g. Delaware franchise tax, California LLC fee). Check your state of formation.',
  ];
  for (const n of notices) {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
    cursor.y = drawWrapped(page, `• ${n}`, MARGIN, cursor.y, { size: FS_BODY }, fonts);
    cursor.y -= 7;
  }

  void opts.isLate;
  return doc;
};

// ─── IRS fax cover page ─────────────────────────────────────────────────────────────────────────
//
// Page 1 of the FAX transmission only. It is not part of the customer download,
// and it is the opposite document to buildInstructionsPage: instructions are
// addressed to the FILER ("do not staple", "mail to", "keep proof of mailing")
// and would be nonsense to transmit to Ogden.
//
// Standard transmittal-letter layout, with the content corrected for what this
// package actually is. Three things are deliberately NOT said, because they are
// true of a real Form 1120 and false here:
//
//   - It is not described as a "U.S. Corporation Income Tax Return". A domestic
//     DE wholly owned by one foreign person is a corporation for section 6038A
//     purposes only (26 CFR 301.7701-2(c)(2)(vi)); (c)(2)(i) otherwise
//     disregards it. Calling the package an income tax return misstates the
//     entity's status in writing, in an IRS file.
//   - No balance-due / payment line. No tax is computed on a pro forma 1120.
//   - No schedule list (1125-A, 8990, and so on). The pro forma 1120 carries
//     only the name, address and items B and E, so listing schedules would
//     invite attachments that do not belong in the package.
//
// Form 5472 leads the subject line because it is the return; the pro forma 1120
// is the transmittal that carries it.

/** Where a foreign-owned DE sends Form 5472. Verify on irs.gov before a season. */
export const IRS_5472_FAX = '855-887-7737';

export interface FaxCoverOpts {
  /** Forms 5472 enclosed, one per related party. */
  formCount: number;
  /** A Reasonable Cause Statement is enclosed. */
  hasRCL: boolean;
  /** A Form 7004 is enclosed. */
  has7004: boolean;
  /** Total pages in the transmission, INCLUDING this cover page. */
  pageCount: number;
  /** Marks the subject line "Amended" rather than "Original". */
  isAmended?: boolean;
  /** Sending fax number, printed in the From block. */
  senderFax?: string;
  /** Transmission date. Defaults to today. */
  sentOn?: Date;
}

export const buildFaxCoverPage = async (
  filing: NormalizedFiling,
  period: ResolvedPeriod,
  opts: FaxCoverOpts,
): Promise<PDFDocument> => {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const fonts: FontPair = { bold, reg };

  let { page, cursor } = newPage(doc);

  const entity = filing.llc_name ?? '';
  const ein    = filing.ein ?? '';
  const sentOn = opts.sentOn ?? new Date();
  const dateText = fmtDate(
    `${sentOn.getFullYear()}-${String(sentOn.getMonth() + 1).padStart(2, '0')}-${String(sentOn.getDate()).padStart(2, '0')}`,
  );

  // ── Sender letterhead ──────────────────────────────────────────────────────
  cursor.y = drawWrapped(page, entity, MARGIN, cursor.y, { size: FS_HEADING, font: bold }, fonts);
  for (const line of [
    buildStreet(filing.llc_us_address),
    buildCityStateZip(filing.llc_us_address, filing.state_of_formation),
  ]) {
    if (line) cursor.y = drawWrapped(page, line, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  }
  cursor.y -= 10;
  drawRule(page, cursor);

  // ── Fax transmission block ─────────────────────────────────────────────────
  // A fax cover's first job is making the transmission reconstructable: who
  // sent what, to where, on what date, and how many pages should have arrived.
  const faxRows: [string, string][] = [
    ['To', `Internal Revenue Service, Ogden\nFax ${IRS_5472_FAX}`],
    ['From', opts.senderFax ? `${entity}\nFax ${opts.senderFax}` : entity],
    ['Date', dateText],
    ['Pages', `${opts.pageCount} (including this cover page)`],
  ];
  const labelW = 78;
  for (const [label, value] of faxRows) {
    const startY = cursor.y;
    page.drawText(toFormText(label), { x: MARGIN, y: startY, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
    let vy = startY;
    for (const seg of value.split('\n')) {
      vy = drawWrapped(page, seg, MARGIN + labelW, vy, { size: FS_BODY, maxWidth: COL_W - labelW }, fonts);
    }
    cursor.y = Math.min(vy, startY - 12) - 4;
  }
  cursor.y -= 6;
  drawRule(page, cursor);

  // ── Subject / identifiers ──────────────────────────────────────────────────
  const kind = opts.isAmended ? 'Amended' : 'Original';
  cursor.y = drawWrapped(page,
    `Subject: ${kind} Form 5472 filing for a foreign-owned U.S. disregarded entity`,
    MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
  cursor.y -= 2;
  cursor.y = drawWrapped(page, `EIN: ${ein}`, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y = drawWrapped(page,
    `Tax year: ${period.beginText} through ${period.endText}`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 12;

  // ── Body ───────────────────────────────────────────────────────────────────
  cursor.y = drawWrapped(page, 'To Whom It May Concern,', MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 10;

  const forms = opts.formCount === 1 ? 'one Form 5472' : `${opts.formCount} Forms 5472`;
  const intro =
    `Transmitted by fax are ${forms} for ${entity} for the tax year shown above, filed under ` +
    `Internal Revenue Code section 6038A. ${entity} is a U.S. limited liability company wholly ` +
    'owned by one foreign person, treated as a corporation for section 6038A reporting purposes ' +
    'under 26 CFR 301.7701-2(c)(2)(vi). A pro forma Form 1120 accompanies the filing as the ' +
    'transmittal required by the Instructions for Form 5472, and reports no income tax. These ' +
    'forms cannot be filed electronically.';
  cursor.y = drawWrapped(page, intro, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 12;

  // ── Enclosures, built from what is actually in the package ─────────────────
  cursor.y = drawWrapped(page, 'Enclosed:', MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
  cursor.y -= 4;
  const enclosures: string[] = [];
  if (opts.hasRCL) {
    enclosures.push('Reasonable Cause Statement, signed under penalties of perjury');
  }
  enclosures.push('Pro forma Form 1120 (transmittal), signed and dated');
  if (opts.has7004) {
    enclosures.push('Form 7004, Application for Automatic Extension of Time to File');
  }
  enclosures.push(
    opts.formCount === 1
      ? 'Form 5472, with its Part V / Part VI statements'
      : `${opts.formCount} Forms 5472, one per related party, each with its Part V / Part VI statements`,
  );
  for (const e of enclosures) {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
    cursor.y = drawWrapped(page, `• ${e}`, MARGIN + 10, cursor.y, { size: FS_BODY, maxWidth: COL_W - 10 }, fonts);
    cursor.y -= 3;
  }
  cursor.y -= 12;

  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
  cursor.y = drawWrapped(page,
    'Please direct any questions regarding this filing to the signatory below.',
    MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 16;

  // ── Signature block ────────────────────────────────────────────────────────
  // Matches the pro forma 1120 and the Reasonable Cause Statement: the typed
  // name of the owner, with their title. No blank signature rule is drawn,
  // because on the fax path there is no opportunity to pen one in.
  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
  cursor.y = drawWrapped(page, 'Sincerely,', MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 24;
  cursor.y = drawWrapped(page, filing.owner.full_name || '', MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
  drawWrapped(page, `${filing.signer_title ?? 'Managing Member'}, ${entity}`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);

  return doc;
};

// ─── Form 5472 filler ───────────────────────────────────────────────────────────────────────────

interface Fill5472Opts {
  /** Form 5472 Line 1g, total number of 5472s filed for this entity/year. */
  numForms: number;
  /** Form 5472 Line 1h, aggregate gross of all transactions across ALL 5472s. */
  grossAllForms: number;
}

const fill5472 = async (
  filing: NormalizedFiling,
  party: NormalizedParty,
  txns: Transaction[],
  period: ResolvedPeriod,
  opts: Fill5472Opts,
): Promise<PDFDocument> => {
  const url = get5472PdfUrl(period.year);
  const doc = await loadPdf(url);
  const F   = getF5472Map(period.year);
  const txn = aggregateTransactions(txns);

  // ── Header, tax period ────────────────────────────────────────────────────────────
  // The 5472 header has separate month-day and year boxes; fill them with the
  // human month name ("November 1") and the four-digit year. The combined
  // human string ("November 1, 2025") is what the statements use.
  const [pbY, pbM, pbD] = period.beginISO.split('-');
  const [peY, peM, peD] = period.endISO.split('-');
  const beginMonthName = pbM ? (MONTH_NAMES[Number(pbM)] ?? pbM) : '';
  const endMonthName = peM ? (MONTH_NAMES[Number(peM)] ?? peM) : '';
  setText(doc, F.TAX_YEAR_BEGIN,      pbD ? `${beginMonthName} ${Number(pbD)}` : period.beginText);
  setText(doc, F.TAX_YEAR_BEGIN_YEAR, pbY ?? '');
  // Use the ACTUAL end day from the period, not a hardcoded "31". A June
  // fiscal-year-end must print "June 30", not the impossible "June 31".
  setText(doc, F.TAX_YEAR_END,        (endMonthName && peD) ? `${endMonthName} ${Number(peD)}` : period.endText);
  setText(doc, F.TAX_YEAR_END_YEAR,   peY ?? '');

  // ── Part I, Reporting Corporation (the US LLC) ──────────────────────────────────
  setText(doc, F.CORP_NAME,                  filing.llc_name ?? '');
  setText(doc, F.CORP_ADDRESS,               buildStreet(filing.llc_us_address));
  setText(doc, F.CORP_CITY_STATE_ZIP,        buildCityStateZip(filing.llc_us_address, filing.state_of_formation));
  setText(doc, F.CORP_EIN,                   filing.ein ?? '');
  setText(doc, F.CORP_TOTAL_ASSETS,          fmt(filing.total_assets));
  setText(doc, F.CORP_ACTIVITY,              filing.naics_description ?? filing.owner.business_activity ?? '');
  setText(doc, F.CORP_ACTIVITY_CODE,         filing.naics_code ?? '');
  setText(doc, F.CORP_DATE_OF_INCORPORATION, fmtDateNumeric(filing.date_of_incorporation));
  // The reporting corporation is a US entity: incorporated in and conducting
  // business in the United States. However, Part I line 1n "country of
  // residence" reflects where the entity's income is taxed, for a foreign-owned
  // disregarded entity the income flows to and is taxed in the owner's home
  // country (the U.S. only requires reporting), so 1n mirrors the owner's
  // country of tax residence.
  const ownerTaxCountry =
    filing.owner.country_residence || filing.owner.country_business || 'United States';
  setText(doc, F.CORP_COUNTRY_OF_INC,        filing.country_of_incorporation ?? 'United States');
  setText(doc, F.CORP_RESIDENT_COUNTRY,      ownerTaxCountry);
  // Principal country(ies) where the business is conducted. The filer supplies
  // this in intake (entity_principal_country); it is NOT always the US, a
  // foreign-owned DE often operates from the owner's country. Honor the user's
  // answer, falling back to the US only when none was given.
  const principalCountry =
    ((filing as unknown as Record<string, unknown>)['entity_principal_country'] as string | undefined)?.trim() || 'United States';
  setText(doc, F.CORP_COUNTRY_BUSINESS,      principalCountry);

  // 1f gross payments on THIS form / 1g number of 5472s / 1h gross across ALL forms.
  // 1f/1h aggregate the monetary transactions for this party: Part IV flows,
  // plus - for the OWNER's form only, which is the only one carrying them - the
  // monetary Part V (distributions/contributions/dividends) and Part VI amounts.
  const grossThisForm = grossPaymentsForLines1f1h(txn, party.is_owner);
  setText(doc, F.CORP_GROSS_PAYMENTS, fmt(grossThisForm));
  setText(doc, F.CORP_NUM_FORMS,      String(opts.numForms));
  setText(doc, F.CORP_GROSS_ALL,      fmt(opts.grossAllForms));

  // Checkboxes 1i / 1j / 2 / 3
  checkBox(doc, F.CONSOLIDATED_FILING,       false);
  checkBox(doc, F.INITIAL_RETURN_YES,        period.isInitial);
  checkBox(doc, F.FOREIGN_OWNS_50PCT,        true);
  checkBox(doc, F.CORP_IS_FOREIGN_OWNED_DE,  true);

  // ── Part II, 25 % Foreign Shareholder ───────────────────────────────────────────
  // Part II is ALWAYS the 25% foreign shareholder (the owner), on every Form
  // 5472 for this entity, including the ones filed for additional related
  // parties. Only Part III changes per form. The 5472 combines name + mailing
  // address into a single field.
  const owner = filing.owner;
  setText(doc, F.SHAREHOLDER_NAME,                buildNameAndAddress(owner.full_name, owner.address));
  setText(doc, F.SHAREHOLDER_US_TIN,              owner.us_tin);
  setText(doc, F.SHAREHOLDER_REFERENCE_ID,        owner.reference_id);
  setText(doc, F.SHAREHOLDER_FOREIGN_TIN,         owner.foreign_tax_id);
  setText(doc, F.SHAREHOLDER_COUNTRY_BUSINESS,    owner.country_business);
  setText(doc, F.SHAREHOLDER_COUNTRY_CITIZENSHIP, owner.country_citizenship);
  setText(doc, F.SHAREHOLDER_RESIDENT_COUNTRY,    owner.country_residence);

  // ── Part III, Related Party (THIS form's party) ─────────────────────────────────
  // For the owner's own 5472 the related party IS the owner; for an additional
  // related party's 5472 this is that related party.
  checkBox(doc, F.RP_IS_FOREIGN_PERSON, true);
  checkBox(doc, F.RP_IS_US_PERSON,      false);

  setText(doc, F.RP_NAME,          buildNameAndAddress(party.full_name, party.address));
  setText(doc, F.RP_US_TIN,        party.us_tin);
  setText(doc, F.RP_REFERENCE_ID,  party.reference_id);
  setText(doc, F.RP_FOREIGN_TIN,   party.foreign_tax_id);
  setText(doc, F.RP_ACTIVITY,      party.business_activity || filing.naics_description || '');
  setText(doc, F.RP_ACTIVITY_CODE, party.business_code || filing.naics_code || '');
  setText(doc, F.RP_COUNTRY_BUSINESS,  party.country_business);
  setText(doc, F.RP_RESIDENT_COUNTRY,  party.country_residence);

  // 8e, Relationship checkboxes.
  // For the owner of a single-member LLC, the related party IS the 25%
  // shareholder. Additional related parties are related to that shareholder
  // but are not themselves the 25% direct shareholder.
  if (party.is_owner) {
    checkBox(doc, F.RP_RELATED_TO_CORP,        false);
    checkBox(doc, F.RP_RELATED_TO_SHAREHOLDER, false);
    checkBox(doc, F.RP_IS_25PCT_SHAREHOLDER,   true);
  } else {
    checkBox(doc, F.RP_RELATED_TO_CORP,        false);
    checkBox(doc, F.RP_RELATED_TO_SHAREHOLDER, true);
    checkBox(doc, F.RP_IS_25PCT_SHAREHOLDER,   false);
  }

  // ── Part IV, Monetary Transactions ──────────────────────────────────────────────
  if (txn.hasPartIV) {
    // Loan-guarantee fees (lines 20 / 34) have no field in the 2019-2021 Form
    // 5472 revision. Writing to the absent field is a silent no-op, which left
    // the amount off the return entirely while it still counted toward the
    // line 22 / 36 totals, a total with nothing behind it. When the dedicated
    // line is unavailable, disclose the amount under "other amounts"
    // (line 21 / 35) instead so it is reported and the totals still foot.
    const guaranteeReceivedHasLine = !!F.LINE_20_LOAN_GUARANTEE_RECEIVED;
    const guaranteePaidHasLine     = !!F.LINE_34_LOAN_GUARANTEE_PAID;
    const otherReceived = txn.other_received
      + (guaranteeReceivedHasLine ? 0 : txn.loan_guarantee_received);
    const otherPaid = txn.other_paid
      + (guaranteePaidHasLine ? 0 : txn.loan_guarantee_paid);

    setText(doc, F.LINE_9_SALES_RECEIVED,           fmt(txn.sales_received));
    setText(doc, F.LINE_10_TANGIBLE_PROP_RECEIVED,  fmt(txn.tangible_prop_received));
    setText(doc, F.LINE_13A_RENTS_RECEIVED,         fmt(txn.rents_received));
    setText(doc, F.LINE_13B_ROYALTIES_RECEIVED,     fmt(txn.royalties_received));
    setText(doc, F.LINE_14_INTANGIBLE_RECEIVED,     fmt(txn.intangible_received));
    setText(doc, F.LINE_15_SERVICES_RECEIVED,       fmt(txn.services_received));
    setText(doc, F.LINE_16_COMMISSIONS_RECEIVED,    fmt(txn.commissions_received));
    setText(doc, F.LINE_17A_BORROWED_BEGIN,         fmt(txn.borrowed_begin));
    setText(doc, F.LINE_17B_BORROWED_END,           fmt(txn.borrowed_end));
    setText(doc, F.LINE_18_INTEREST_RECEIVED,       fmt(txn.interest_received));
    setText(doc, F.LINE_19_INSURANCE_RECEIVED,      fmt(txn.insurance_received));
    setText(doc, F.LINE_20_LOAN_GUARANTEE_RECEIVED, fmt(txn.loan_guarantee_received));
    setText(doc, F.LINE_21_OTHER_RECEIVED,          fmt(otherReceived));
    setText(doc, F.LINE_22_TOTAL_RECEIVED,          fmt(totalReceived(txn)));
    setText(doc, F.LINE_23_SALES_PAID,              fmt(txn.sales_paid));
    setText(doc, F.LINE_24_TANGIBLE_PROP_PAID,      fmt(txn.tangible_prop_paid));
    setText(doc, F.LINE_27A_RENTS_PAID,             fmt(txn.rents_paid));
    setText(doc, F.LINE_27B_ROYALTIES_PAID,         fmt(txn.royalties_paid));
    setText(doc, F.LINE_28_INTANGIBLE_PAID,         fmt(txn.intangible_paid));
    setText(doc, F.LINE_29_SERVICES_PAID,           fmt(txn.services_paid));
    setText(doc, F.LINE_30_COMMISSIONS_PAID,        fmt(txn.commissions_paid));
    setText(doc, F.LINE_31A_LOANED_BEGIN,           fmt(txn.loaned_begin));
    setText(doc, F.LINE_31B_LOANED_END,             fmt(txn.loaned_end));
    setText(doc, F.LINE_32_INTEREST_PAID,           fmt(txn.interest_paid));
    setText(doc, F.LINE_33_INSURANCE_PAID,          fmt(txn.insurance_paid));
    setText(doc, F.LINE_34_LOAN_GUARANTEE_PAID,     fmt(txn.loan_guarantee_paid));
    setText(doc, F.LINE_35_OTHER_PAID,              fmt(otherPaid));
    setText(doc, F.LINE_36_TOTAL_PAID,              fmt(totalPaid(txn)));
  }

  // ── Part V, owner transactions checkbox ───────────────────────────────────────
  // Part V (and its statement) applies to the OWNER's 5472 only; additional
  // related parties never carry Part V.
  if (party.is_owner && txn.hasPartV) {
    checkBox(doc, F.PART_V_CHECKBOX, true);
  }

  // ── Part VI, nonmonetary transactions checkbox ───────────────────────────────
  // OWNER: checked when the managerial-services disclosure is on (default true;
  //   the owner of a foreign-owned DE provides managerial services whose FMV
  //   cannot be determined), OR when an actual non-monetary transaction exists.
  //   If the user opted out of the managerial disclosure AND there is no
  //   non-monetary transaction, Part VI is not checked.
  // OTHER RELATED PARTIES: checked only when they actually had a non-monetary /
  //   below-FMV transaction.
  // Part VI (and its statement) applies to the OWNER's 5472 only.
  const managerialOn = party.is_owner && (filing.part_vi_managerial ?? true);
  const partVIApplies = party.is_owner
    && (managerialOn || txn.hasPropertyTransfer || txn.hasNonmonetaryOther);
  checkBox(doc, F.PART_VI_CHECKBOX, partVIApplies);

  return doc;
};

// ─── Pro Forma 1120 filler ──────────────────────────────────────────────────────────────────────────

/**
 * Draw a signature image over an AcroForm text field's widget, and clear the
 * field's text.
 *
 * Unlike the reasonable cause letter, the pro forma 1120 has no separate
 * printed-name line under the signature: the "Signature of officer" field IS
 * the line. Leaving the typed name in place and drawing over it would stack two
 * marks in one box. So when a mark is drawn, it replaces the typed name rather
 * than joining it. Both are acceptable signatures under IRM 10.10.1.3.1.1, and
 * the officer's name is on the return regardless as the entity contact, so
 * nothing is lost.
 *
 * The image is drawn onto the PAGE, not into the field's appearance stream, so
 * it survives the flatten() that runs when the year package is merged.
 *
 * Returns true if the signature was drawn.
 */
const drawSignatureOverField = async (
  doc: PDFDocument,
  fieldName: string,
  drawnSignature: DrawnSignature | null | undefined,
): Promise<boolean> => {
  if (!fieldName || !drawnSignature) return false;
  try {
    const image = await embedDrawnSignature(doc, drawnSignature);
    if (!image) return false;

    const field = doc.getForm().getField(fieldName);
    if (!(field instanceof PDFTextField)) return false;

    const widgets = field.acroField.getWidgets();
    const widget = widgets[0];
    if (!widget) return false;
    const rect = widget.getRectangle();

    // Locate the page that actually carries this widget rather than assuming
    // page 1. getPages()[0] is right for every revision shipped today, but the
    // signature block is near the foot of page 1 and a future template that
    // paginates differently would silently put the mark on the wrong page.
    const pages = doc.getPages();
    const page =
      pages.find((p) => {
        const annots = p.node.Annots();
        if (!annots) return false;
        for (let i = 0; i < annots.size(); i++) {
          if (annots.get(i) === widget.dict || annots.lookup(i) === widget.dict) return true;
        }
        return false;
      }) ?? pages[0];
    if (!page) return false;

    // Clear the typed name so the box carries one mark, not two.
    field.setText('');

    // Inset slightly so the mark sits inside the ruled box rather than on it.
    const pad = 1;
    drawSignatureInBox(page, image, {
      x: rect.x + pad,
      y: rect.y + pad,
      maxWidth: Math.max(rect.width - pad * 2, 1),
      maxHeight: Math.max(rect.height - pad * 2, 1),
    });
    return true;
  } catch {
    // Field absent in this revision, or an unusable image. The typed name that
    // is already in the field stands, which is itself a valid signature.
    return false;
  }
};

const fill1120 = async (
  filing: NormalizedFiling,
  period: ResolvedPeriod,
  /** Optional drawn signature, applied to the officer signature line. */
  drawnSignature?: DrawnSignature | null,
): Promise<PDFDocument> => {
  const url = get1120PdfUrl(period.year);
  const doc = await loadPdf(url);
  const F   = getF1120Map(period.year);
  const addr = filing.llc_us_address;

  // ── Entity header ────────────────────────────────────────────────────────────────
  setText(doc, F.CORP_NAME,         filing.llc_name ?? '');
  setText(doc, F.EIN,               filing.ein ?? '');
  setText(doc, F.TOTAL_ASSETS,      fmt(filing.total_assets));
  setText(doc, F.DATE_INCORPORATED, fmtDateNumeric(filing.date_of_incorporation));

  // Address, some revisions have a single combined field (2019–2024),
  // others (fallback / 2025) use split fields. We write both sets;
  // setText is a no-op for any empty-string field name.
  setText(doc, F.CORP_ADDRESS,        buildStreet(addr));                          // combined (2019–2024)
  setText(doc, F.CORP_CITY_STATE_ZIP, buildCityStateZip(addr, filing.state_of_formation)); // combined
  setText(doc, F.CORP_ADDRESS_LINE1,  buildStreet(addr));                          // split (fallback / 2025)
  setText(doc, F.CORP_CITY,    addr?.city  ?? '');
  setText(doc, F.CORP_STATE,   addr?.state ?? filing.state_of_formation ?? '');
  setText(doc, F.CORP_ZIP,     addr?.zip   ?? '');
  setText(doc, F.CORP_COUNTRY, addr?.country || 'United States');

  // ── Tax period ───────────────────────────────────────────────────────────────────────
  // The 1120 header reads "For calendar year YYYY, or tax year beginning ____,
  // ending ____, 20__". For a plain calendar-year filer the beginning/ending
  // blanks stay EMPTY (the printed "calendar year" + the year box cover it).
  // For a short or fiscal year we fill the blanks with month + day only (the
  // year lives in the separate year box), e.g. "September 10" / "December 31".
  const isCalendarYear =
    !filing.is_fiscal_year && period.beginISO === `${period.year}-01-01` && period.endISO === `${period.year}-12-31`;
  const monthDay = (iso: string): string => {
    const [, m, d] = iso.split('-');
    return m && d ? `${MONTH_NAMES[Number(m)] ?? m} ${Number(d)}` : '';
  };
  setText(doc, F.BEGINNING_DATE, isCalendarYear ? '' : monthDay(period.beginISO));
  setText(doc, F.ENDING_DATE,    isCalendarYear ? '' : monthDay(period.endISO));
  // The 1120 header pre-prints "20" before the ending-year box, so the field
  // holds only the last two digits (e.g. "26" → "2026"). Writing the full year
  // produced "202026". For a calendar-year filer the printed "calendar year
  // YYYY" already carries the year, so leave the box empty; only a short/fiscal
  // year needs the ending year filled here. The ending year is taken from the
  // PERIOD END, not the tax year, a fiscal year ending March 2026 (tax year
  // 2025) must print "26", not "25".
  const endYearTwoDigit = (period.endISO.split('-')[0] ?? String(period.year)).slice(-2);
  setText(doc, F.ENDING_YEAR, isCalendarYear ? '' : endYearTwoDigit);

  // ── Checkboxes (item E) ──────────────────────────────────────────────────────────────
  checkBox(doc, F.INITIAL_RETURN,  period.isInitial);
  checkBox(doc, F.FINAL_RETURN,    filing.final_return   ?? false);
  checkBox(doc, F.NAME_CHANGE,     filing.name_change    ?? false);
  checkBox(doc, F.ADDRESS_CHANGE,  filing.address_change ?? false);

  // ── Signature block ────────────────────────────────────────────────────────────────
  // The owner signs. The signature date is collected in intake and printed so
  // the form is ready to print and mail as-is. Falls back to blank (owner can
  // hand-write it) rather than inventing a date.
  setText(doc, F.SIGNATURE, filing.owner.full_name);
  setText(doc, F.TITLE,     filing.signer_title ?? 'Managing Member');
  setText(doc, F.DATE,      fmtDateNumeric(filing.signature_date));

  // A drawn mark, when one was collected, replaces the typed name on the
  // signature line. Runs after setText so it overwrites the value just set.
  //
  // CAVEAT, recorded rather than resolved: a typed name is on the IRM
  // 10.10.1.3.1.1 list of acceptable electronic signatures and so is a
  // handwritten mark drawn on screen, but plain Form 1120 is NOT on the
  // permanent electronic-signature list at IRM Exhibit 10.10.1-2, and neither
  // is Form 5472 or 7004. That is equally true of the typed name this product
  // has always used, so drawing a mark does not make the package worse. The
  // owner, a practising CPA, extended the drawn signature from the reasonable
  // cause letter to the 1120. Revisit before the 2027 season rather than
  // inheriting it.
  const markDrawn = await drawSignatureOverField(doc, F.SIGNATURE, drawnSignature);

  // No mark, so the typed name signs. Render it over the same field in the
  // script face, so the signature line reads as signed rather than as a filled
  // box. Falls back to the Helvetica value setText() already wrote whenever the
  // face is unavailable or lacks a glyph for this name.
  if (!markDrawn) {
    // Raw, not toFormText(): the embedded face is not WinAnsi-bound, and
    // setText() above already reported any unencodable characters, so routing
    // it through again would double-report them to the filer.
    await drawTypedSignatureOverField(doc, F.SIGNATURE, filing.owner.full_name);
  }

  return doc;
};

// ─── Form 7004 filler (automatic 6-month extension to file) ──────────────────────────────────
//
// 7004 maps purely from entity + period data we already hold. Field names come
// from the custom AcroForm in public/pdf/Form-7004-2025.pdf (13 fields).
// For a calendar-year filer, LLC_Calendar_Year carries the year; for an initial
// short year or a fiscal year, the beginning/ending fields carry the actual
// period instead.
//
// The three year boxes take TWO digits, not four. The IRS form preprints the
// century, "calendar year 20 __" and "tax year beginning ____, 20 __, and
// ending ____, 20 __", so a four-digit year printed "20 2025". The boxes are
// 14.3pt wide, which is the giveaway: room for two characters.

/** "2025" → "25". The century is preprinted on the form. */
const twoDigitYear = (year: string | number): string =>
  String(year).trim().slice(-2);

/**
 * "2025-07-01" → "July 1". The 7004 period line reads
 * "beginning ______, 20 __", so the blank takes the month and day and the year
 * belongs in the box that follows it, the same convention the 1120 filler
 * already uses for its period line.
 */
const monthAndDay = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return m && d ? `${MONTH_NAMES[Number(m)] ?? m} ${Number(d)}` : '';
};

/**
 * Print the period's ENDING date into the second LLC_Beginning_Date widget.
 *
 * See the call site: the two date slots on the period line share one field
 * name, so the field itself can only ever carry the BEGINNING date. The ending
 * slot is therefore detached from the field and the date drawn onto the page in
 * its place.
 *
 * The widget has to be REMOVED, not just collapsed to a zero-size rectangle.
 * A collapsed widget keeps its appearance stream, and pdf-lib's flatten() ,
 * which runs when the year package is merged, draws that stream through a
 * degenerate transform, leaving a stray copy of the beginning date on the page.
 * That is invisible in the standalone 7004 and visible in the combined
 * download, which is the file the filer actually gets.
 */
const drawEndingDateOver2ndWidget = async (
  doc: PDFDocument,
  endText: string,
): Promise<void> => {
  try {
    const field = doc.getForm().getField('LLC_Beginning_Date');
    if (!(field instanceof PDFTextField)) return;
    const widgets = field.acroField.getWidgets();
    // One widget means the template was fixed upstream, nothing to do.
    if (widgets.length < 2) return;

    // Rightmost widget is the "ending" slot; do not assume array order.
    const endingIdx = widgets.reduce(
      (best, w, i) =>
        w.getRectangle().x > widgets[best].getRectangle().x ? i : best,
      0,
    );
    const rect = widgets[endingIdx].getRectangle();

    const page = doc.getPages()[0];
    if (!page) return;

    // Detach it from the field, then drop the annotation from the page so
    // nothing is left to paint or to flatten.
    const ref = field.acroField.normalizedEntries().Kids.get(endingIdx);
    field.acroField.removeWidget(endingIdx);
    const annots = page.node.Annots();
    if (annots) {
      const at = annots.indexOf(ref);
      if (at !== undefined && at !== -1) annots.remove(at);
    }

    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(toFormText(endText), {
      x: rect.x + 1,
      // Sit the baseline inside the box the same way an AcroForm field does.
      y: rect.y + (rect.height - FORM_FIELD_FONT_SIZE) / 2 + 1,
      size: FORM_FIELD_FONT_SIZE,
      font,
    });
  } catch {
    // Template without this field, leave the page as it is.
  }
};

const fill7004 = async (
  filing: NormalizedFiling,
  period: ResolvedPeriod,
): Promise<PDFDocument> => {
  const url  = get7004PdfUrl(period.year);
  const doc  = await loadPdf(url);
  const addr = filing.llc_us_address;

  setText(doc, 'LLC_Name',           filing.llc_name ?? '');
  setText(doc, 'LLC_EIN',            filing.ein ?? '');
  setText(doc, 'LLC_Street_Address', buildStreet(addr));
  setText(doc, 'LLC_City',           addr?.city ?? '');
  setText(doc, 'LLC_State',          addr?.state ?? filing.state_of_formation ?? '');
  setText(doc, 'LLC_Country',        addr?.country || 'United States');
  setText(doc, 'LLC_ZIP',            addr?.zip ?? '');

  // Calendar-year filers: just the year. Short/fiscal years: fill the period.
  //
  // BOTH ends have to be tested. Testing only the start meant a calendar-year
  // LLC dissolved mid-year still counted as a calendar-year filer, because a
  // final return begins on 1 January like any other, so Form 7004 ticked
  // "calendar year" and printed no short period at all. The 1120 filler has
  // always tested both; this one had not been updated to match.
  const isCalendarYear =
    !filing.is_fiscal_year &&
    period.beginISO === `${period.year}-01-01` &&
    period.endISO === `${period.year}-12-31`;
  if (isCalendarYear) {
    setText(doc, 'LLC_Calendar_Year', twoDigitYear(period.year));
  } else {
    // The date blank holds the MONTH AND DAY only, the year that follows it is
    // the "20 __" box. period.beginText is the long form ("July 1, 2025") used
    // on the 1120 and the statements, and printing that here gave the year
    // twice: "beginning July 1, 2025, 20 25".
    setText(doc, 'LLC_Beginning_Date', monthAndDay(period.beginISO));
    setText(doc, 'LLC_Beginning_Year', twoDigitYear(period.beginISO.split('-')[0] ?? period.year));
    setText(doc, 'LLC_Ending_Year',    twoDigitYear(period.endISO.split('-')[0] ?? period.year));

    // The template gives LLC_Beginning_Date TWO widgets, the "beginning" slot
    // and the "ending" slot share one field name, so setting the field printed
    // the BEGINNING date in both, and the form read "beginning July 1 and
    // ending July 1". A single AcroForm field cannot hold two different values,
    // so the ending slot is drawn on the page directly and its widget collapsed
    // to nothing so it has no value of its own left to paint.
    await drawEndingDateOver2ndWidget(doc, monthAndDay(period.endISO));
  }

  checkBox(doc, 'Initial_Return', period.isInitial);
  checkBox(doc, 'Final_Return',   filing.final_return ?? false);

  return doc;
};

// ─── merge helper ─────────────────────────────────────────────────────────────────────────────────

const mergeInto = async (dest: PDFDocument, src: PDFDocument): Promise<void> => {
  src.getForm().flatten();
  const pages = await dest.copyPages(src, src.getPageIndices());
  for (const page of pages) {
    dest.addPage(page);
  }
};

// ─── public entry point ────────────────────────────────────────────────────────────────────────────

export interface FilingPackage {
  // NOTE: both of these are FLATTENED, despite what this comment used to claim.
  // assembleYear merges the same PDFDocument objects into the combined package,
  // and mergeInto calls getForm().flatten() on its source, so the fields are
  // gone by the time these are saved. That is the behaviour we want, nobody
  // should be able to alter an IRS form after it is generated, but do not build
  // anything that expects to read or set a field on these bytes: a test that
  // reads a checkbox back off form1120 will find no fields at all.
  /** The OWNER's Form 5472, flattened. */
  form5472: Uint8Array;
  /** Pro Forma 1120, flattened. */
  form1120: Uint8Array;
  /**
   * Combined filing package (pages flattened and merged):
   *   1. Pro Forma 1120
   *   then, for EACH related party (owner first):
   *     2. Form 5472
   *     3. Part V statement (only if that party has Part V transactions)
   *     4. Part VI statement (owner always; others only if they have a
   *        non-monetary transaction)
   */
  combined: Uint8Array;
  /** The OWNER's standalone Part V statement, if the owner has Part V txns. */
  statement_partV?: Uint8Array;
  /** The OWNER's standalone Part VI statement (always present). */
  statement_partVI: Uint8Array;
  /**
   * Form 7004 (6-month extension), present when the filing opted into an
   * extension (filed elsewhere → for their records, or filing one through us).
   * Also produced standalone via generateForm7004().
   */
  form7004?: Uint8Array;
  /**
   * Reasonable Cause Letter, present when filing.include_rcl is true. Appended
   * to the combined package (before the forms) AND returned standalone.
   */
  reasonableCauseLetter?: Uint8Array;
  /**
   * The package as it should be TRANSMITTED BY FAX, present only when
   * `generateFilingPackage` is called with `{ fax: true }`.
   *
   * This is NOT `combined`. Two differences, both of which matter:
   *   - the filer-facing instructions page is removed (it tells the reader to
   *     mail the package and keep proof of mailing, which is meaningless to
   *     send to Ogden), and
   *   - an IRS-facing fax cover page is added in front, carrying the page
   *     count needed to reconstruct the transmission.
   */
  faxPayload?: Uint8Array;
  /** Number of Form 5472s generated (Line 1g). */
  formCount: number;
  /**
   * Entered text that the PDF fonts could not represent, and which was
   * therefore dropped from the forms. Non-empty means the package is NOT safe
   * to file as-is: a name or address is missing characters. Callers must
   * surface this and ask for a romanized spelling rather than deliver it.
   */
  unsupportedText?: UnsupportedText[];
}

// Each reason renders as its own paragraph, written in the FIRST PERSON as the
// owner's own statement (the letter is signed by the owner under penalty of
// perjury). Paragraphs adapt to how many tax years the letter covers, so a
// single-year filing reads "this year / this return" and a multi-year filing
// reads "these years / these returns". No mini-headers, no em dashes.
// buildReasonableCauseLetter splits the joined narrative on blank lines.
//
// `n` is the number of tax years the letter covers.
const RCL_REASON_PARAGRAPHS: Record<string, (n: number) => string> = {
  first_time_filing: (n) => {
    const s = n === 1;
    return (
      `${s ? 'This year is' : 'These years are'} the first time my company has had to deal ` +
      'with the U.S. tax system. Before this, I had no U.S. tax history and no basis on ' +
      'which I could reasonably have known about an information reporting obligation under ' +
      'Internal Revenue Code §6038A. The Service recognizes, under Treasury Regulation ' +
      '§1.6038A-4(b)(2)(ii), that an honest misunderstanding of fact or law can be ' +
      'reasonable cause, especially where the taxpayer has no prior history of U.S. tax ' +
      'problems. My failure to file was a first time, inadvertent error made in good faith, ' +
      'not willful neglect.'
    );
  },
  // Merged reason: the owner relied on the formation service that set up the
  // entity, and that service never mentioned the Form 5472 requirement.
  not_informed: (_n) =>
    'I set up my company through an online formation service and relied on that service to ' +
    'tell me about the filing obligations that came with the entity it created for me. At ' +
    'no point, either when my company was formed or afterward, did that formation service ' +
    'or its agent tell me that Treasury Regulation §1.6038A-2 requires a foreign owned ' +
    'disregarded entity to file Form 5472 together with a pro forma Form 1120, whether or ' +
    'not any tax is owed. Because the service I hired to set up my company never mentioned ' +
    'this, I had no reasonable way of discovering this specialized reporting obligation ' +
    'while running a low activity LLC. My good faith reliance on the service I engaged to ' +
    'form my company is ordinary business care and prudence, and supports reasonable cause.',
  no_tax_liability: (n) => {
    const s = n === 1;
    return (
      `My company had no U.S. effectively connected income and owed no U.S. income tax for ` +
      `${s ? 'this year' : 'these years'}. I genuinely, though mistakenly, believed that a ` +
      'company that owed no U.S. tax did not have to file a U.S. return. The rules here are ' +
      'genuinely difficult: Treasury Regulation §301.7701-3 treats my LLC as a disregarded ' +
      'entity for tax purposes, while Treasury Regulation §1.6038A-1(c)(1) at the same time ' +
      'treats it as a domestic corporation only for information reporting. My ' +
      'misunderstanding of this technical distinction was an honest mistake of law, which ' +
      'meets the reasonable cause standard described in Internal Revenue Manual ' +
      '20.1.1.3.2.2.1.'
    );
  },
  minimal_activity: (n) => {
    const s = n === 1;
    return (
      `${s ? 'During this year' : 'Throughout these years'} my company had little or no ` +
      'activity and very few reportable transactions. Because my company was dormant or ' +
      'nearly dormant, my good faith belief that no U.S. filing was required was all the ' +
      'more understandable. With no active U.S. business generating income, it was easy to ' +
      'overlook a purely informational filing even while exercising ordinary business care ' +
      'and prudence.'
    );
  },
  language_barrier: (_n) =>
    'English is not my first language, which made it much harder for me to understand the ' +
    'U.S. tax rules on my own. The Internal Revenue Manual (20.1.1.3.2.2.1) says that a ' +
    'taxpayer’s education, background, and language ability must be taken into account ' +
    'when deciding whether they used ordinary business care. The language barrier, together ' +
    'with how complex the U.S. cross border tax rules are, genuinely limited my ability to ' +
    'identify the Form 5472 requirement on my own, despite my honest efforts.',
  discovered_late: (n) => {
    const s = n === 1;
    return (
      'I only became aware of the Form 5472 requirement recently, when I reviewed my ' +
      'company’s obligations more closely. As soon as I found out, I did not hide the ' +
      `problem or delay. I moved quickly to prepare and file the delinquent ` +
      `${s ? 'return' : 'returns'}. Acting immediately shows that my earlier failure to ` +
      'file came from genuine lack of awareness, not from any intent to ignore U.S. tax law.'
    );
  },
  voluntary_filing: (n) => {
    const s = n === 1;
    return (
      'I am correcting this on my own, voluntarily. ' +
      `${s ? 'This return is' : 'These returns are'} being filed before I received any ` +
      'penalty notice, audit, or other contact from the IRS. Treasury Regulation ' +
      '§1.6038A-4(b)(2)(ii) lists whether the taxpayer voluntarily filed as a factor in ' +
      'deciding reasonable cause. My coming forward on my own, without being prompted, ' +
      'weighs strongly in favor of abating the penalty in full.'
    );
  },
  new_procedures: (_n) =>
    'To make sure I stay compliant from now on, I have put proper procedures in place. I ' +
    'have added the annual Form 5472 and pro forma Form 1120 deadlines to how I manage my ' +
    'company, so this filing is not missed again. These steps show that the failure to file ' +
    'was an isolated, first time lapse and that I intend to meet all future U.S. reporting ' +
    'obligations accurately and on time.',
};

/**
 * Build a first-person, multi-paragraph reasonable-cause narrative (one
 * paragraph per selected reason). `yearCount` tunes singular vs plural wording.
 * Returns null when no reasons are given so the letter falls back to its own
 * default narrative.
 */
export const narrativeFromReasonCodes = (
  reasons: string[] | null | undefined,
  yearCount = 1,
): string | null => {
  if (!reasons || reasons.length === 0) return null;
  const n = Math.max(1, yearCount);
  const chosen = reasons.map((r) => RCL_REASON_PARAGRAPHS[r]?.(n)).filter(Boolean);
  return chosen.length ? chosen.join('\n\n') : null;
};

// Build the narrative for a single-year filing: free-text wins, else reason codes.
const rclNarrativeFromReasons = (filing: Filing & Record<string, unknown>): string | null => {
  const free = (filing['rcl_narrative'] as string | undefined)?.trim();
  if (free) return free;
  return narrativeFromReasonCodes(filing.reasonable_cause_reasons as string[] | null | undefined, 1);
};

/**
 * Whether to include Form 7004 in the package. The form is produced when the
 * filer either explicitly requests it (include_7004) OR indicates they filed an
 * extension (extension_filed), in both cases the completed 7004 belongs in the
 * package so the filer has a copy of what was/should be filed.
 */
const wants7004 = (raw: Filing): boolean =>
  raw.include_7004 === true || (raw as Filing & { extension_filed?: boolean }).extension_filed === true;

/**
 * Generate a standalone, filled Form 7004, used both inside the package and
 * as an independent "file an extension only" download.
 */
export const generateForm7004 = async (
  rawFiling: Filing,
  taxYear?: number,
): Promise<Uint8Array> => {
  const year = taxYear ?? (rawFiling.tax_year != null ? Number(rawFiling.tax_year) : new Date().getFullYear() - 1);
  const filing = normalizeFiling(rawFiling);
  const period = resolvePeriod(filing, year);
  const doc = await fill7004(filing, period);
  return doc.save();
};

/**
 * Gross of all reportable transactions for a single party (drives 1f / 1h).
 *
 * `isOwner` must be that party's own flag, not a constant: line 1h is the sum
 * of every form's line 1f, so passing the wrong one here makes the entity-wide
 * total disagree with the forms it is meant to total.
 */
const grossForTransactions = (txns: Transaction[], isOwner: boolean): number => {
  const agg = aggregateTransactions(txns);
  return grossPaymentsForLines1f1h(agg, isOwner);
};

const PART_V_TX_TYPES = new Set<Transaction['transaction_type']>([
  'distribution', 'dividend', 'capital_contribution', 'formation_costs',
]);
const PART_VI_TX_TYPES = new Set<Transaction['transaction_type']>([
  'property_transfer', 'nonmonetary_other',
]);

interface PartyDocs {
  party: NormalizedParty;
  doc5472: PDFDocument;
  docPartV: PDFDocument | null;
  docPartVI: PDFDocument | null;
}

interface YearDocs {
  filing: NormalizedFiling;
  period: ResolvedPeriod;
  doc1120: PDFDocument;
  partyDocs: PartyDocs[];
  formCount: number;
}

/**
 * Build all the per-year documents (one 1120 + one 5472-with-statements per
 * related party) WITHOUT saving or merging. Shared by the single-year and
 * multi-year entry points.
 */
const buildYearDocs = async (
  filing: NormalizedFiling,
  period: ResolvedPeriod,
  transactions: Transaction[],
  /** Optional drawn signature, applied to the pro forma 1120 signature line. */
  drawnSignature?: DrawnSignature | null,
): Promise<YearDocs> => {
  // Partition transactions by related party (0 = owner; 1..n = others).
  const txByParty = new Map<number, Transaction[]>();
  for (const tx of transactions) {
    const idx = tx.related_party_index ?? 0;
    const list = txByParty.get(idx) ?? [];
    list.push(tx);
    txByParty.set(idx, list);
  }

  // A party gets a 5472 if it's the owner (always) or it has a transaction.
  const partiesToFile = filing.parties.filter(
    (p) => p.is_owner || (txByParty.get(p.index)?.length ?? 0) > 0,
  );

  // Line 1g / 1h, form count and entity-wide gross across all forms.
  const formCount = partiesToFile.length;
  const grossAllForms = partiesToFile.reduce(
    (sum, p) => sum + grossForTransactions(txByParty.get(p.index) ?? [], p.is_owner),
    0,
  );
  const fillOpts: Fill5472Opts = { numForms: formCount, grossAllForms };

  const doc1120 = await fill1120(filing, period, drawnSignature);

  const partyDocs: PartyDocs[] = await Promise.all(
    partiesToFile.map(async (party): Promise<PartyDocs> => {
      const ptxns = txByParty.get(party.index) ?? [];
      // Part V and Part VI statements are produced for the OWNER only. Additional
      // related parties get a 5472 with Parts I–IV; their Part V/VI disclosures
      // (owner distributions, managerial services, nonmonetary transfers) belong
      // to the owner's return, not theirs.
      const hasPartV  = party.is_owner && ptxns.some((t) => PART_V_TX_TYPES.has(t.transaction_type));
      const managerialOn = party.is_owner && (filing.part_vi_managerial ?? true);
      const hasPartVI = party.is_owner
        && (managerialOn || ptxns.some((t) => PART_VI_TX_TYPES.has(t.transaction_type)));

      const [doc5472, docPartV, docPartVI] = await Promise.all([
        fill5472(filing, party, ptxns, period, fillOpts),
        hasPartV  ? buildPartVStatement(filing, ptxns, period) : Promise.resolve(null),
        hasPartVI ? buildPartVIStatement(filing, party, ptxns, period) : Promise.resolve(null),
      ]);
      return { party, doc5472, docPartV, docPartVI };
    }),
  );

  return { filing, period, doc1120, partyDocs, formCount };
};

/** Merge one year's docs (optionally prefixed with an instructions/RCL page) into a fresh PDF. */
const assembleYear = async (
  yd: YearDocs,
  prefix: PDFDocument[],
  // Optional Form 7004, inserted immediately after the 1120 and before the
  // 5472s so the package reads: [prefix] → 1120 → 7004 → owner 5472 + its
  // Part V/VI statements → other parties' 5472s.
  form7004Doc?: PDFDocument | null,
): Promise<PDFDocument> => {
  const merged = await PDFDocument.create();
  for (const p of prefix) await mergeInto(merged, p);
  await mergeInto(merged, yd.doc1120);
  if (form7004Doc) await mergeInto(merged, form7004Doc);
  // Owner (index 0) first, then additional related parties, each 5472 followed
  // by its own Part V / Part VI statements.
  const ordered = [...yd.partyDocs].sort((a, b) => Number(b.party.is_owner) - Number(a.party.is_owner));
  for (const pd of ordered) {
    await mergeInto(merged, pd.doc5472);
    if (pd.docPartV)  await mergeInto(merged, pd.docPartV);
    if (pd.docPartVI) await mergeInto(merged, pd.docPartVI);
  }
  return merged;
};

/**
 * Build the full single-year filing package.
 *
 * Emits ONE Form 5472 per related party (the owner is always party index 0).
 * `combined` leads with a filing-instructions page (page 1), then the pro forma
 * 1120, then each party's 5472 + statements.
 */
export const generateFilingPackage = async (
  rawFiling: Filing,
  transactions: Transaction[],
  taxYear?: number,
  opts?: {
    /** Also build `faxPayload`, the transmission-ready package. See FilingPackage. */
    fax?: boolean;
    /** Sending fax number, printed in the cover page's From block. */
    senderFax?: string;
    /**
     * Drawn signature, a PNG data URL from the on-screen canvas. Applied to the
     * reasonable cause letter and to the pro forma 1120 signature line.
     *
     * Passed per call and never persisted, which is what keeps the "we never
     * store your documents" claim true. See drawnSignature.ts.
     */
    drawnSignature?: DrawnSignature | null;
  },
): Promise<FilingPackage> => {
  const year =
    taxYear ?? (rawFiling.tax_year != null ? Number(rawFiling.tax_year) : new Date().getFullYear() - 1);

  // Collect anything unencodable that comes up while this package is built.
  const unsupported: UnsupportedText[] = [];
  unsupportedSink = unsupported;
  try {

  const filing = normalizeFiling(rawFiling);
  const period = resolvePeriod(filing, year);
  const yd = await buildYearDocs(filing, period, transactions, opts?.drawnSignature);

  // A reasonable-cause letter is included when the filing opted in, honoring
  // either the canonical include_rcl flag or the older include_reasonable_cause
  // column. A Form 7004 suppresses the letter only while its extension is
  // still open. An expired extension is late and may need reasonable cause.
  const optedRCL =
    !!filing.include_rcl || (filing as unknown as Record<string, unknown>)['include_reasonable_cause'] === true;
  const hasRCL = shouldIncludeReasonableCause(
    optedRCL,
    filing.extension_filed === true,
    period.endISO,
  );
  const instructions = await buildInstructionsPage(filing, period, {
    isLate: hasRCL, hasRCL, formCount: yd.formCount,
  });

  // Reasonable Cause Letter, built when the filing opted into the RCL. It is
  // the cover letter, so it leads the combined package (before instructions),
  // and is also returned standalone.
  let reasonableCauseLetter: Uint8Array | undefined;
  let rclDoc: PDFDocument | null = null;
  if (hasRCL) {
    rclDoc = await buildReasonableCauseLetter(
      filing, [period.year], rclNarrativeFromReasons(rawFiling), opts?.drawnSignature,
    );
    reasonableCauseLetter = await rclDoc.save();
  }

  // Form 7004, included when the filing opted into an extension (or marked one
  // as filed). Generated up front so it can be placed in the package right after
  // the 1120, and also returned standalone.
  const include7004 = wants7004(rawFiling);
  let form7004: Uint8Array | undefined;
  let form7004Doc: PDFDocument | null = null;
  if (include7004) {
    const doc7004 = await fill7004(filing, period);
    form7004 = await doc7004.save();
    // A fresh copy for the combined package (mergeInto flattens its source).
    form7004Doc = await PDFDocument.load(form7004);
  }

  // Combined order (per spec): Instructions → RCL (if any) → 1120 → 7004 (if any)
  // → owner 5472 + its Part V/VI statements → other parties' 5472s.
  const prefix: PDFDocument[] = [instructions];
  if (rclDoc) prefix.push(await PDFDocument.load(reasonableCauseLetter!));
  const merged = await assembleYear(yd, prefix, form7004Doc);

  const ownerDocs = yd.partyDocs.find((pd) => pd.party.is_owner) ?? yd.partyDocs[0];
  const [form1120, combined, form5472, statement_partVI, statement_partV] = await Promise.all([
    yd.doc1120.save(),
    merged.save(),
    ownerDocs.doc5472.save(),
    ownerDocs.docPartVI ? ownerDocs.docPartVI.save() : Promise.resolve(new Uint8Array()),
    ownerDocs.docPartV  ? ownerDocs.docPartV.save()  : Promise.resolve<Uint8Array | undefined>(undefined),
  ]);

  // De-duplicate: the same name is drawn on several forms and statements.
  const seen = new Set<string>();
  const unsupportedText = unsupported.filter((u) => {
    const k = u.value + ' ' + u.characters.join('');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // ── Fax payload ────────────────────────────────────────────────────────────
  // Built from `combined` rather than by re-running assembleYear, because
  // mergeInto flattens its sources and yd has already been consumed.
  let faxPayload: Uint8Array | undefined;
  if (opts?.fax) {
    // HARD BLOCK. On the mail path an unsigned package is recoverable: the
    // filer prints it and pens the line in. On the fax path there is no hand
    // between the PDF and Ogden, so an unsigned package would be transmitted
    // and would come back from Sinch as `delivered`, which is a blank
    // penalties-of-perjury jurat reported as a success. Refuse to build the
    // payload at all rather than produce one that must not be sent.
    const blocker = faxSignatureBlocker({
      ownerFullName: filing.owner.full_name,
      drawnSignature: opts.drawnSignature,
      includesRCL: hasRCL,
    });
    if (blocker) throw new Error(blocker);

    const body = await PDFDocument.load(combined);
    // Drop the filer-facing instructions, which lead `combined`. It can run to
    // more than one page, so remove exactly as many as were generated rather
    // than assuming one.
    for (let i = instructions.getPageCount() - 1; i >= 0; i--) body.removePage(i);

    // The cover states the total page count, which includes the cover itself ,
    // so build it once to learn its own length, then again with the true total.
    const coverOpts: FaxCoverOpts = {
      formCount: yd.formCount,
      hasRCL,
      has7004: include7004,
      pageCount: 0,
      // Always "Original": the product has no amended-return concept, no
      // column, no intake question, no UI. FaxCoverOpts.isAmended exists so the
      // cover is ready if that changes, but nothing can set it today.
      senderFax: opts.senderFax,
    };
    const probe = await buildFaxCoverPage(filing, period, coverOpts);
    const cover = await buildFaxCoverPage(filing, period, {
      ...coverOpts,
      pageCount: probe.getPageCount() + body.getPageCount(),
    });

    const out = await PDFDocument.create();
    await mergeInto(out, cover);
    const pages = await out.copyPages(body, body.getPageIndices());
    for (const p of pages) out.addPage(p);
    faxPayload = await out.save();
  }

  return {
    form5472, form1120, combined, statement_partVI, statement_partV,
    form7004, reasonableCauseLetter, formCount: yd.formCount,
    ...(faxPayload ? { faxPayload } : {}),
    ...(unsupportedText.length ? { unsupportedText } : {}),
  };

  } finally {
    unsupportedSink = null;
  }
};

/** @alias generateFilingPackage, kept for callers that use the old name */
export const assembleFilingPackage = generateFilingPackage;

// ─── Multi-year catch-up package ─────────────────────────────────────────────────────────────

export interface MultiYearYearInput {
  /** The filing row for this specific year (entity/owner carried forward). */
  filing: Filing;
  /** That year's transactions. */
  transactions: Transaction[];
  /** Tax year (four-digit). */
  taxYear: number;
}

export interface MultiYearPackage {
  /** One entry per tax year, each a complete print-ready PDF (instructions → forms). */
  perYear: { taxYear: number; pdf: Uint8Array; formCount: number }[];
  /** The single Reasonable Cause Statement covering ALL years (if include_rcl). */
  reasonableCauseLetter?: Uint8Array;
  /**
   * Everything bundled into ONE PDF (optional convenience download):
   *   RCL (once) → for each year: instructions → 1120 → 5472s + statements.
   */
  bundled: Uint8Array;
  /** Years included, ascending. */
  taxYears: number[];
  /**
   * Characters no form in this package could print. Same contract as
   * FilingPackage.unsupportedText, and it exists for the same reason: the
   * caller must refuse to deliver a package that has any. See
   * refuseUnsupportedText().
   */
  unsupportedText?: UnsupportedText[];
}

/**
 * Build a multi-year catch-up package.
 *
 * Per the product decision: ONE reasonable-cause letter covers every late year;
 * each year is delivered as its own print-ready PDF (instructions as page 1);
 * and a single bundled PDF is also produced for convenience. The RCL appears
 * exactly once (its own file, and once at the front of the bundle).
 */
export const generateMultiYearPackage = async (
  years: MultiYearYearInput[],
  opts: {
    includeRCL: boolean;
    rclNarrative?: string | null;
    /**
     * Drawn signature, applied to the single reasonable cause letter and to the
     * pro forma 1120 of EVERY year in the catch-up. One drawing signs the whole
     * package, which matches how the filer experiences it: they are signing one
     * submission, not one document per year.
     */
    drawnSignature?: DrawnSignature | null;
  },
): Promise<MultiYearPackage> => {
  if (years.length === 0) throw new Error('generateMultiYearPackage: no years provided');

  // Collect anything unencodable across EVERY year, exactly as the single-year
  // path does. Without this the sink stayed null here and toFormText dropped
  // characters silently, so the caller had nothing to refuse on.
  const unsupported: UnsupportedText[] = [];
  unsupportedSink = unsupported;
  try {

  const sorted = [...years].sort((a, b) => b.taxYear - a.taxYear); // most recent first
  const taxYears = sorted.map((y) => y.taxYear).sort((a, b) => a - b);

  // Build every year's docs.
  const yearDocs = await Promise.all(
    sorted.map((y) => {
      const f = normalizeFiling(y.filing);
      const p = resolvePeriod(f, y.taxYear);
      return buildYearDocs(f, p, y.transactions, opts.drawnSignature);
    }),
  );

  // One RCL covering all years (use the most-recent year's entity/owner data).
  const rclDoc = opts.includeRCL
    ? await buildReasonableCauseLetter(yearDocs[0].filing, taxYears, opts.rclNarrative, opts.drawnSignature)
    : null;

  // Per-year PDFs: instructions page (page 1) → that year's forms. No RCL here
  // (it is delivered once, separately and in the bundle).
  const perYear: MultiYearPackage['perYear'] = [];
  for (const yd of yearDocs) {
    const instructions = await buildInstructionsPage(yd.filing, yd.period, {
      isLate: opts.includeRCL, hasRCL: opts.includeRCL, formCount: yd.formCount,
    });
    const y7004 = wants7004(yd.filing) ? await PDFDocument.load(await (await fill7004(yd.filing, yd.period)).save()) : null;
    const merged = await assembleYear(yd, [instructions], y7004);
    perYear.push({ taxYear: yd.period.year, pdf: await merged.save(), formCount: yd.formCount });
  }

  // Bundle: RCL once → each year (instructions → forms), OLDEST YEAR FIRST.
  //
  // yearDocs is newest-first, because the RCL above takes its entity and owner
  // details from yearDocs[0] and the most recent year is the right source for
  // those. Iterating it directly put the bundle in reverse chronological order
  // while `taxYears` (and therefore the download's own filename, which reads
  // "2019-2023") said ascending. A catch-up submission is read oldest to
  // newest, so the bundle follows taxYears rather than the build order.
  const chronological = [...yearDocs].sort((a, b) => a.period.year - b.period.year);

  const bundle = await PDFDocument.create();
  if (rclDoc) {
    const rclCopy = await PDFDocument.load(await rclDoc.save());
    await mergeInto(bundle, rclCopy);
  }
  for (const yd of chronological) {
    const instructions = await buildInstructionsPage(yd.filing, yd.period, {
      isLate: opts.includeRCL, hasRCL: opts.includeRCL, formCount: yd.formCount,
    });
    // Re-fill the year docs for the bundle (a PDFDocument can't be merged twice
    // after flatten()), so rebuild from the same inputs.
    const rebuilt = await buildYearDocs(yd.filing, yd.period,
      // reconstruct this year's transactions from the input list
      sorted.find((s) => s.taxYear === yd.period.year)!.transactions,
      opts.drawnSignature);
    const y7004 = wants7004(yd.filing) ? await PDFDocument.load(await (await fill7004(yd.filing, yd.period)).save()) : null;
    const yearMerged = await assembleYear(rebuilt, [instructions], y7004);
    const yearCopy = await PDFDocument.load(await yearMerged.save());
    await mergeInto(bundle, yearCopy);
  }

  // De-duplicate: the same name is drawn on several forms, and in a catch-up
  // on several years' worth of them, so an unromanizable owner name would
  // otherwise be reported once per document.
  const seen = new Set<string>();
  const unsupportedText = unsupported.filter((u) => {
    const k = u.value + ' ' + u.characters.join('');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    perYear: perYear.sort((a, b) => a.taxYear - b.taxYear),
    reasonableCauseLetter: rclDoc ? await rclDoc.save() : undefined,
    bundled: await bundle.save(),
    taxYears,
    ...(unsupportedText.length ? { unsupportedText } : {}),
  };

  } finally {
    unsupportedSink = null;
  }
};
