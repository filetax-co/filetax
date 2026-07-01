/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * Entry point: generateFilingPackage(filing, transactions, taxYear)
 *              assembleFilingPackage (alias — same function, kept for callers)
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFPage,
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

// Re-export for consumers that import these types from pdfGenerator
export type Form5472Fields = F5472Map;
export type Form1120Fields = F1120Map;

export const EARLIEST_SUPPORTED_TAX_YEAR = 2019;

// ─── helpers ───────────────────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined): string =>
  n != null && n !== 0 ? String(Math.round(n)) : '';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format an ISO date (YYYY-MM-DD) as "December 1, 2025".
 *
 * Per the platform spec (§0 global conventions), every displayed and printed
 * date must use this single human format — never a numeric/slash/dash form —
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

const loadPdf = async (url: string): Promise<PDFDocument> => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch PDF: ${url} (${resp.status})`);
  const buf = await resp.arrayBuffer();
  return PDFDocument.load(buf);
};

const setText = (doc: PDFDocument, fieldName: string, value: string): void => {
  if (!fieldName) return;
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFTextField) {
      field.setText(value);
    }
  } catch {
    // Field not present in this revision — silently skip
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
//   Form-5472.pdf            (2024 — latest/generic)
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
 * (ShareholderNameAddress / RPNameAddress). Build "Name — Street, City, ST ZIP,
 * Country", falling back to name-only when no address is on file.
 */
const buildNameAndAddress = (name: string, a: Address | null): string => {
  const addr = buildFullAddress(a);
  return addr ? `${name}\n${addr}` : name;
};

// ─── period & initial-return derivation ─────────────────────────────────────────────────
//
// For an initial (first-ever) return whose formation date falls mid-year, the
// tax period BEGINS on the formation date (a short year), not January 1. For
// every other return the period is the full calendar year. The period end is
// always December 31 of the tax year (calendar-year filers — the only case the
// platform supports).

export interface ResolvedPeriod {
  /** ISO begin date (YYYY-MM-DD). */
  beginISO: string;
  /** ISO end date (YYYY-MM-DD). */
  endISO: string;
  /** "January 1, 2025" — human format for statements / 1120. */
  beginText: string;
  /** "December 31, 2025" — human format. */
  endText: string;
  /** Whether this filing is an initial return. */
  isInitial: boolean;
  /** Four-digit tax year. */
  year: number;
}

const resolvePeriod = (filing: NormalizedFiling, taxYear: number): ResolvedPeriod => {
  const year = filing.tax_year != null ? Number(filing.tax_year) : taxYear;

  const incorpISO = filing.date_of_incorporation ?? null;
  const incorpYear = incorpISO
    ? new Date(`${incorpISO}T12:00:00`).getFullYear()
    : 0;

  // Initial return: explicit flag, or inferred when the entity was formed in
  // the tax year itself.
  const isInitial = filing.initial_return ?? (incorpYear > 0 && incorpYear === year);

  // Short-year begin = formation date when this is an initial return AND the
  // entity was formed during the tax year; otherwise January 1.
  const beginISO =
    filing.tax_period_begin ??
    (isInitial && incorpISO && incorpYear === year ? incorpISO : `${year}-01-01`);

  const endISO = filing.tax_period_end ?? `${year}-12-31`;

  return {
    beginISO,
    endISO,
    beginText: fmtDate(beginISO),
    endText: fmtDate(endISO),
    isInitial,
    year,
  };
};

// ─── transaction aggregation ────────────────────────────────────────────────────────────

export interface AggregatedTransactions {
  // Part IV — Received (LLC received from owner / foreign party)
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
  // Part IV — Paid (LLC paid to owner / foreign party)
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
  // Part IV — Loan balances (amount_usd on each loan row IS the closing balance)
  borrowed_begin: number;
  borrowed_end: number;
  loaned_begin: number;
  loaned_end: number;
  // Part V — Distributions / contributions / nonmonetary owner transactions
  distributions_paid: number;
  contributions_received: number;
  // Part VI — monetary consideration recorded on nonmonetary / below-FMV items
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
    part_vi_amount: 0,
    hasPartIV: false,
    // Part V: only monetary owner transactions (distributions, contributions, dividends)
    hasPartV: false,
    // Part VI is ALWAYS true — managerial services by foreign owner are
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
      // ── Part VI only — nonmonetary / less-than-FMV transactions ─────────────
      // These are NOT reported on Part V (no monetary amount to disclose there).
      // They are always disclosed in the Part VI statement instead.
      case 'property_transfer':
        t.hasPropertyTransfer = true; t.part_vi_amount += amt; break;
      case 'nonmonetary_other':
        t.hasNonmonetaryOther = true; t.part_vi_amount += amt; break;
      // formation_costs: owner paid something on behalf of LLC — Part V disclosure
      case 'formation_costs':
        t.hasPartV = true; break;
      default:
        break;
    }
  }

  return t;
};

// ─── total helpers ──────────────────────────────────────────────────────────────────────
//
// Per the IRS Instructions for Form 5472:
//   • Line 22 = sum of the Part IV "amounts received" MONETARY-FLOW lines.
//   • Line 36 = sum of the Part IV "amounts paid"     MONETARY-FLOW lines.
//   • Loan balances (lines 17a/17b borrowed, 31a/31b loaned) are OUTSTANDING
//     BALANCES, not flows — they are reported on their own lines and are NOT
//     part of the line 22/36 totals.
//   • Capital contributions and distributions are Part V transactions (owner /
//     DE transactions), NOT Part IV — they are disclosed on the Part V
//     statement and are NOT part of the line 22/36 totals.
//   • Line 1f gross payments = line 22 + line 36 (+ Part VI FMV, which here is
//     "not determinable"). So 1f/1h are built from these same totals.

const totalReceived = (t: AggregatedTransactions): number =>
  t.sales_received + t.tangible_prop_received + t.rents_received +
  t.royalties_received + t.intangible_received + t.services_received +
  t.commissions_received + t.interest_received + t.insurance_received +
  t.loan_guarantee_received + t.other_received;

const totalPaid = (t: AggregatedTransactions): number =>
  t.sales_paid + t.tangible_prop_paid + t.rents_paid +
  t.royalties_paid + t.intangible_paid + t.services_paid +
  t.commissions_paid + t.interest_paid + t.insurance_paid +
  t.loan_guarantee_paid + t.other_paid;

/**
 * Gross payments for Form 5472 line 1f (this form) / line 1h (all forms).
 *
 * Line 1f/1h are the aggregate of the monetary transactions reported for the
 * related party. Per requirement, this includes not only the Part IV flows but
 * also the monetary Part V transactions (owner distributions, capital
 * contributions, dividends) and any monetary Part VI amounts (consideration on
 * property transfers / other nonmonetary items where an amount was recorded).
 * Loan balances (17a/17b, 31a/31b) remain balances, not flows, and are excluded.
 */
const grossPaymentsForLines1f1h = (t: AggregatedTransactions): number =>
  totalReceived(t) + totalPaid(t) + t.distributions_paid + t.contributions_received + t.part_vi_amount;

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
  const words  = text.split(' ');
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

  // Intro paragraph — cite the governing law, reference Part V and the txns.
  const intro =
    'This statement is furnished under Internal Revenue Code section 6038A and '
    + 'Treasury Regulation section 1.6038A-2, and supports Part V of Form 5472. '
    + 'During the tax year identified above, the reporting corporation engaged in the '
    + 'following reportable transactions with its 25% foreign owner (a related party '
    + 'within the meaning of section 6038A(c)) — including owner distributions and '
    + 'withdrawals, capital contributions, dividends, and amounts paid by the owner on '
    + 'behalf of the reporting corporation. Each such transaction is described below.';
  cursor.y = drawWrapped(page, intro, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 14;

  // ── Aggregated monetary totals block ──────────────────────────────────────────
  const txn = aggregateTransactions(txns);
  if (txn.distributions_paid > 0 || txn.contributions_received > 0) {
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

    const label     = PART_V_TYPE_LABELS[tx.transaction_type] ?? tx.transaction_type;
    const txDate    = tx.transaction_date ? fmtDate(tx.transaction_date) : 'Not specified';
    const dirText   = tx.direction === 'paid'
      ? 'Paid by LLC to related party'
      : tx.direction === 'received'
        ? 'Received by LLC from related party'
        : tx.direction;
    const amtText   = tx.amount_usd != null && tx.amount_usd !== 0
      ? `$${tx.amount_usd.toLocaleString('en-US')}`
      : 'N/A (nonmonetary, FMV not determinable)';
    const desc      = tx.description?.trim();

    cursor.y = drawWrapped(page, `Transaction ${idx + 1}: ${label}`, MARGIN, cursor.y,
      { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 2;

    // Omit the Description line entirely when the filer gave none — the label
    // already identifies the transaction.
    const fields: [string, string][] = [
      ['Date:',        txDate],
      ['Direction:',   dirText],
      ['Amount:',      amtText],
      ...(desc ? [['Description:', desc] as [string, string]] : []),
    ];

    for (const [fieldLabel, fieldValue] of fields) {
      if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
      const labelW = bold.widthOfTextAtSize(fieldLabel, 10) + 6;
      page.drawText(fieldLabel, { x: MARGIN + 12, y: cursor.y, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
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
    'STATEMENT REQUIRED UNDER FORM 5472, PART VI: NONMONETARY AND LESS-THAN-FMV TRANSACTIONS',
    filing, periodBegin, periodEnd, period.year, fonts,
  );

  const ownerName = party.full_name || (party.is_owner ? 'the foreign owner' : 'the related party');
  const llcName   = filing.llc_name ?? 'the reporting corporation';

  // Running item counter so item numbers stay correct regardless of which
  // blocks are present for this particular party.
  let itemNo = 0;

  // ── Item: Managerial services — OWNER ONLY, when enabled ──────────────────────────
  // The owner of a foreign-owned DE necessarily provides managerial services
  // whose FMV cannot be determined; this is disclosed on the owner's Form 5472
  // Part VI by default. The user may opt out (part_vi_managerial = false), in
  // which case this item is omitted. Additional related parties never get this
  // item — they only appear in Part VI for an actual non-monetary transaction.
  const managerialOn = party.is_owner && (filing.part_vi_managerial ?? true);
  if (managerialOn) {
    itemNo += 1;
    cursor.y = drawWrapped(page,
      `Item ${itemNo}: Managerial and Operational Services by Foreign Owner (FMV Not Determinable)`,
      MARGIN, cursor.y, { size: FS_BODY, font: bold }, fonts);
    cursor.y -= 4;

    const managerialText =
      `During the tax year ended ${periodEnd}, ${ownerName} (the 25% foreign shareholder and ` +
      `related party) provided managerial, operational, and administrative services to ` +
      `${llcName} (the reporting corporation). These services included, but were not ` +
      `limited to, general management, strategic decision-making, business development, ` +
      `and operational oversight. The fair market value of these services cannot be ` +
      `determined with reasonable certainty because no arm's-length charge was established ` +
      `and no comparable uncontrolled transactions exist for this type of owner-directed ` +
      `management activity. Accordingly, no dollar amount is reported on Part IV of ` +
      `Form 5472 for these services, and they are disclosed here pursuant to Part VI.`;

    cursor.y = drawWrapped(page, managerialText, MARGIN + 12, cursor.y, { size: FS_BODY }, fonts);
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
        page.drawText(fieldLabel, { x: MARGIN + 24, y: cursor.y, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
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
        page.drawText(fieldLabel, { x: MARGIN + 24, y: cursor.y, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
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
    `Taxpayer: ${filing.llc_name ?? ''}    EIN: ${filing.ein ?? ''}`,
    MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y = drawWrapped(page, `Covering: ${yearsText}.`, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 14;

  cursor.y = drawWrapped(page, 'To the Internal Revenue Service:', MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 10;

  const intro =
    `${filing.llc_name ?? 'The taxpayer'} (the "Reporting Corporation"), a U.S. limited ` +
    `liability company treated as a foreign-owned disregarded entity, respectfully ` +
    `requests abatement of any penalties asserted under Internal Revenue Code §6038A ` +
    `for the late filing of Form 5472 (with the accompanying pro forma Form 1120) for ` +
    `${yearsText}. The Reporting Corporation is filing these returns voluntarily and ` +
    `proactively, before any contact from the IRS, and submits the following statement ` +
    `of reasonable cause.`;
  cursor.y = drawWrapped(page, intro, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 12;

  cursor.y = drawWrapped(page, 'Statement of facts and reasonable cause:', MARGIN, cursor.y,
    { size: FS_BODY, font: bold }, fonts);
  cursor.y -= 4;

  const DEFAULT_BODY =
    'The Reporting Corporation is wholly owned by a non-U.S. individual who, at the ' +
    'time of formation, had no prior exposure to the United States federal tax system ' +
    'and no reason to anticipate an information-reporting obligation for an entity that ' +
    'generated no U.S. tax liability. The owner engaged a formation agent to establish ' +
    'the entity and was not advised, at formation or thereafter, that Treasury ' +
    'Regulation section 1.6038A-2 requires a foreign-owned disregarded entity to file ' +
    'Form 5472 with a pro forma Form 1120 irrespective of whether any tax is due.\n\n' +
    'The owner’s belief that no return was required was objectively reasonable and ' +
    'held in good faith. A taxpayer exercises ordinary business care and prudence, ' +
    'within the meaning of Treasury Regulation section 301.6651-1(c)(1), when the ' +
    'taxpayer reasonably relies on the absence of any indication that a filing is due ' +
    'and has no U.S. income tax to pay. There was no willful neglect and no intent to ' +
    'disregard the filing requirement.\n\n' +
    'Immediately upon learning of the requirement, the owner acted diligently to become ' +
    'compliant, gathering the records necessary to prepare a complete and accurate ' +
    'Form 5472 for each affected year and submitting these delinquent returns ' +
    'voluntarily, before any notice, examination, or contact from the Service. The ' +
    'owner has also implemented procedures to ensure that Form 5472 is filed timely in ' +
    'all future years.';

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
    'For the foregoing reasons, the failure to file was due to reasonable cause and not ' +
    'to willful neglect, and abatement is warranted under Internal Revenue Code ' +
    'section 6038A(d) and the reasonable-cause standard of Treasury Regulation section ' +
    '301.6651-1(c). The Reporting Corporation respectfully requests that any penalties ' +
    `asserted under section 6038A for ${yearsText} be abated in full. All required ` +
    'Forms 5472 and accompanying pro forma Forms 1120 are enclosed. The taxpayer will ' +
    'promptly furnish any additional information the Service may require.';
  cursor.y = drawWrapped(page, close, MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 16;
  if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));

  cursor.y = drawWrapped(page, 'Signed under penalties of perjury,', MARGIN, cursor.y, { size: FS_BODY }, fonts);
  cursor.y -= 24;
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

  const rows: [string, string][] = [
    ['Taxpayer', `${filing.llc_name ?? ''} (EIN ${filing.ein ?? '—'})`],
    ['Return', `${formsLine}, for the tax period ${period.beginText} through ${period.endText}.`],
    ['Signature', 'Sign and date the pro forma Form 1120 where indicated before mailing. The "Foreign-owned U.S. DE" notation is already printed across the top of the form.'],
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
    page.drawText(label, { x: MARGIN, y: startY, size: FS_BODY, font: bold, color: rgb(0, 0, 0) });
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
    'Record retention: keep invoices, contracts, bank statements, related-party agreements, and a copy of this package for the statutory period.',
    'State obligations: this federal filing does not cover state requirements (e.g. Delaware franchise tax, California LLC fee). Check your state of formation.',
  ];
  for (const n of notices) {
    if (cursor.y < MIN_Y) ({ page, cursor } = newPage(doc));
    cursor.y = drawWrapped(page, `• ${n}`, MARGIN, cursor.y, { size: 9 }, fonts);
    cursor.y -= 7;
  }

  void opts.isLate;
  return doc;
};

// ─── Form 5472 filler ───────────────────────────────────────────────────────────────────────────

interface Fill5472Opts {
  /** Form 5472 Line 1g — total number of 5472s filed for this entity/year. */
  numForms: number;
  /** Form 5472 Line 1h — aggregate gross of all transactions across ALL 5472s. */
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

  // ── Header — tax period ────────────────────────────────────────────────────────────
  // The 5472 header has separate month-day and year boxes; fill them with the
  // human month name ("November 1") and the four-digit year. The combined
  // human string ("November 1, 2025") is what the statements use.
  const [pbY, pbM, pbD] = period.beginISO.split('-');
  const [peY] = period.endISO.split('-');
  const beginMonthName = pbM ? (MONTH_NAMES[Number(pbM)] ?? pbM) : '';
  const endMonthName = period.endISO.split('-')[1];
  setText(doc, F.TAX_YEAR_BEGIN,      pbD ? `${beginMonthName} ${Number(pbD)}` : period.beginText);
  setText(doc, F.TAX_YEAR_BEGIN_YEAR, pbY ?? '');
  setText(doc, F.TAX_YEAR_END,        endMonthName ? `${MONTH_NAMES[Number(endMonthName)]} 31` : period.endText);
  setText(doc, F.TAX_YEAR_END_YEAR,   peY ?? '');

  // ── Part I — Reporting Corporation (the US LLC) ──────────────────────────────────
  setText(doc, F.CORP_NAME,                  filing.llc_name ?? '');
  setText(doc, F.CORP_ADDRESS,               buildStreet(filing.llc_us_address));
  setText(doc, F.CORP_CITY_STATE_ZIP,        buildCityStateZip(filing.llc_us_address, filing.state_of_formation));
  setText(doc, F.CORP_EIN,                   filing.ein ?? '');
  setText(doc, F.CORP_TOTAL_ASSETS,          fmt(filing.total_assets));
  setText(doc, F.CORP_ACTIVITY,              filing.naics_description ?? filing.owner.business_activity ?? '');
  setText(doc, F.CORP_ACTIVITY_CODE,         filing.naics_code ?? '');
  setText(doc, F.CORP_DATE_OF_INCORPORATION, fmtDate(filing.date_of_incorporation));
  // The reporting corporation is a US entity: incorporated in and conducting
  // business in the United States. However, Part I line 1n "country of
  // residence" reflects where the entity's income is taxed — for a foreign-owned
  // disregarded entity the income flows to and is taxed in the owner's home
  // country (the U.S. only requires reporting), so 1n mirrors the owner's
  // country of tax residence.
  const ownerTaxCountry =
    filing.owner.country_residence || filing.owner.country_business || 'United States';
  setText(doc, F.CORP_COUNTRY_OF_INC,        filing.country_of_incorporation ?? 'United States');
  setText(doc, F.CORP_RESIDENT_COUNTRY,      ownerTaxCountry);
  setText(doc, F.CORP_COUNTRY_BUSINESS,      'United States');

  // 1f gross payments on THIS form / 1g number of 5472s / 1h gross across ALL forms.
  // 1f/1h aggregate the monetary transactions for this party — Part IV flows plus
  // the monetary Part V (distributions/contributions/dividends) and Part VI amounts.
  const grossThisForm = grossPaymentsForLines1f1h(txn);
  setText(doc, F.CORP_GROSS_PAYMENTS, fmt(grossThisForm));
  setText(doc, F.CORP_NUM_FORMS,      String(opts.numForms));
  setText(doc, F.CORP_GROSS_ALL,      fmt(opts.grossAllForms));

  // Checkboxes 1i / 1j / 2 / 3
  checkBox(doc, F.CONSOLIDATED_FILING,       false);
  checkBox(doc, F.INITIAL_RETURN_YES,        period.isInitial);
  checkBox(doc, F.FOREIGN_OWNS_50PCT,        true);
  checkBox(doc, F.CORP_IS_FOREIGN_OWNED_DE,  true);

  // ── Part II — 25 % Foreign Shareholder (this party) ──────────────────────────────
  // The 5472 combines name + mailing address into a single field.
  setText(doc, F.SHAREHOLDER_NAME,                buildNameAndAddress(party.full_name, party.address));
  setText(doc, F.SHAREHOLDER_US_TIN,              party.us_tin);
  setText(doc, F.SHAREHOLDER_REFERENCE_ID,        party.reference_id);
  setText(doc, F.SHAREHOLDER_FOREIGN_TIN,         party.foreign_tax_id);
  setText(doc, F.SHAREHOLDER_COUNTRY_BUSINESS,    party.country_business);
  setText(doc, F.SHAREHOLDER_COUNTRY_CITIZENSHIP, party.country_citizenship);
  setText(doc, F.SHAREHOLDER_RESIDENT_COUNTRY,    party.country_residence);

  // ── Part III — Related Party (this party) ────────────────────────────────────────
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

  // 8e — Relationship checkboxes.
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

  // ── Part IV — Monetary Transactions ──────────────────────────────────────────────
  if (txn.hasPartIV) {
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
    setText(doc, F.LINE_21_OTHER_RECEIVED,          fmt(txn.other_received));
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
    setText(doc, F.LINE_35_OTHER_PAID,              fmt(txn.other_paid));
    setText(doc, F.LINE_36_TOTAL_PAID,              fmt(totalPaid(txn)));
  }

  // ── Part V — owner transactions checkbox ───────────────────────────────────────
  // Part V (and its statement) applies to the OWNER's 5472 only; additional
  // related parties never carry Part V.
  if (party.is_owner && txn.hasPartV) {
    checkBox(doc, F.PART_V_CHECKBOX, true);
  }

  // ── Part VI — nonmonetary transactions checkbox ───────────────────────────────
  // OWNER: checked when the managerial-services disclosure is on (default true;
  //   the owner of a foreign-owned DE provides managerial services whose FMV
  //   cannot be determined) — OR when an actual non-monetary transaction exists.
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

const fill1120 = async (
  filing: NormalizedFiling,
  period: ResolvedPeriod,
): Promise<PDFDocument> => {
  const url = get1120PdfUrl(period.year);
  const doc = await loadPdf(url);
  const F   = getF1120Map(period.year);
  const addr = filing.llc_us_address;

  // ── Entity header ────────────────────────────────────────────────────────────────
  setText(doc, F.CORP_NAME,         filing.llc_name ?? '');
  setText(doc, F.EIN,               filing.ein ?? '');
  setText(doc, F.TOTAL_ASSETS,      fmt(filing.total_assets));
  setText(doc, F.DATE_INCORPORATED, fmtDate(filing.date_of_incorporation));

  // Address — some revisions have a single combined field (2019–2024),
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
  // holds only the last two digits (e.g. "25" → "2025"). Writing the full year
  // produced "202025". For a calendar-year filer the printed "calendar year
  // YYYY" already carries the year, so leave the box empty; only a short/fiscal
  // year needs the ending year filled here.
  setText(doc, F.ENDING_YEAR, isCalendarYear ? '' : String(period.year).slice(-2));

  // ── Checkboxes (item E) ──────────────────────────────────────────────────────────────
  checkBox(doc, F.INITIAL_RETURN,  period.isInitial);
  checkBox(doc, F.FINAL_RETURN,    filing.final_return   ?? false);
  checkBox(doc, F.NAME_CHANGE,     filing.name_change    ?? false);
  checkBox(doc, F.ADDRESS_CHANGE,  filing.address_change ?? false);

  // ── Signature block ────────────────────────────────────────────────────────────────
  setText(doc, F.SIGNATURE, filing.owner.full_name);
  setText(doc, F.TITLE,     filing.signer_title ?? 'Managing Member');

  return doc;
};

// ─── Form 7004 filler (automatic 6-month extension to file) ──────────────────────────────────
//
// 7004 maps purely from entity + period data we already hold. Field names come
// from the custom AcroForm in public/pdf/Form-7004-2025.pdf (13 fields).
// For a calendar-year filer, LLC_Calendar_Year carries the 4-digit year; for an
// initial short year or a fiscal year, the beginning/ending fields carry the
// actual period instead.

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
  const isCalendarYear =
    !filing.is_fiscal_year && period.beginISO === `${period.year}-01-01`;
  if (isCalendarYear) {
    setText(doc, 'LLC_Calendar_Year', String(period.year));
  } else {
    setText(doc, 'LLC_Beginning_Date', period.beginText);
    setText(doc, 'LLC_Beginning_Year', period.beginISO.split('-')[0] ?? String(period.year));
    setText(doc, 'LLC_Ending_Year',    period.endISO.split('-')[0] ?? String(period.year));
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
  /** The OWNER's Form 5472 (AcroForm, field values still editable). */
  form5472: Uint8Array;
  /** Pro Forma 1120 (AcroForm, field values still editable). */
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
  /** Number of Form 5472s generated (Line 1g). */
  formCount: number;
}

// Each reason renders as its own fully-formed paragraph, in the voice of an
// experienced preparer, tied to the reasonable-cause standard. Paragraphs are
// separated by a blank line; buildReasonableCauseLetter splits on blank lines.
const RCL_REASON_PARAGRAPHS: Record<string, string> = (() => {
  const paragraphs: Record<string, string> = {
    first_time_filing:
      'This is the owner’s first filing obligation of any kind within the United States. ' +
      'The owner had no prior experience with the U.S. federal tax system and no ' +
      'established compliance history from which a Form 5472 obligation could reasonably ' +
      'have been anticipated. A first-time, inadvertent omission by a taxpayer acting in ' +
      'good faith is a classic circumstance of reasonable cause rather than willful neglect.',
    relied_on_non_us_advisor:
      'In forming and operating the entity, the owner relied in good faith on a non-U.S. ' +
      'accountant and formation service. Those advisors were not conversant with the ' +
      'information-reporting rules applicable to foreign-owned U.S. disregarded entities ' +
      'and did not identify the Form 5472 requirement. Reasonable reliance on a competent ' +
      'advisor is a recognized basis for reasonable cause.',
    not_informed:
      'Neither the formation agent, the registered agent, the bank that opened the ' +
      'entity’s account, nor any other party involved in establishing the entity advised ' +
      'the owner that Form 5472 was required. The owner had no notice of the obligation ' +
      'and no reasonable means of discovering it in the ordinary course of managing the entity.',
    no_tax_liability:
      'The entity conducted limited activity and had no U.S. income tax liability for the ' +
      'years at issue. The owner reasonably, if mistakenly, understood that an entity owing ' +
      'no U.S. tax had no U.S. return to file, and was unaware that Form 5472 is an ' +
      'information return required irrespective of any tax due. This good-faith ' +
      'misunderstanding is precisely the kind of error the reasonable-cause standard excuses.',
    minimal_activity:
      'The entity carried on minimal activity during the period, which reinforced the ' +
      'owner’s good-faith belief that no filing was due and made the reporting obligation ' +
      'easy to overlook despite the exercise of ordinary business care.',
    incomplete_records:
      'The records and documentation necessary to prepare a complete and accurate return ' +
      'were delayed or incomplete, in part because the entity was administered from ' +
      'outside the United States. The owner did not file an incomplete or inaccurate ' +
      'return, but instead assembled the information required to file correctly as soon as ' +
      'it was reasonably practicable.',
    language_barrier:
      'English is not the owner’s first language, and the technical requirements of the ' +
      'U.S. tax system were unfamiliar and difficult to navigate. This materially impaired ' +
      'the owner’s ability to identify the filing obligation notwithstanding good-faith effort.',
    discovered_late:
      'The owner learned of the Form 5472 requirement only recently, through professional ' +
      'review, and had no earlier awareness of it. Upon discovery, the owner did not delay.',
    voluntary_filing:
      'The Reporting Corporation is coming forward voluntarily. These delinquent returns ' +
      'are being filed proactively, before any notice, examination, or other contact from ' +
      'the Service. Voluntary compliance of this kind weighs strongly in favor of abatement.',
    new_procedures:
      'The owner has since implemented procedures — including engaging a qualified U.S. ' +
      'preparer and calendaring the annual deadline — to ensure that Form 5472 is filed ' +
      'timely in all future years. The lapse was isolated and will not recur.',
  };
  return paragraphs;
})();

/**
 * Build a professional, multi-paragraph reasonable-cause narrative (one
 * paragraph per selected reason). Returns null when no reasons are given so the
 * letter falls back to its own default narrative.
 */
export const narrativeFromReasonCodes = (
  reasons: string[] | null | undefined,
): string | null => {
  if (!reasons || reasons.length === 0) return null;
  const chosen = reasons.map((r) => RCL_REASON_PARAGRAPHS[r]).filter(Boolean);
  return chosen.length ? chosen.join('\n\n') : null;
};

// Build the narrative for a single-year filing: free-text wins, else reason codes.
const rclNarrativeFromReasons = (filing: Filing & Record<string, unknown>): string | null => {
  const free = (filing['rcl_narrative'] as string | undefined)?.trim();
  if (free) return free;
  return narrativeFromReasonCodes(filing.reasonable_cause_reasons as string[] | null | undefined);
};

/**
 * Whether to include Form 7004 in the package. Only an extension FILING
 * (include_7004) generates the form. A filing that merely records the owner
 * already filed 7004 elsewhere (extension_filed) does not re-generate it, and
 * we never produce a 7004-only package.
 */
const wants7004 = (raw: Filing): boolean =>
  raw.include_7004 === true;

/**
 * Generate a standalone, filled Form 7004 — used both inside the package and
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

/** Gross of all reportable transactions for a single party (drives 1f / 1h). */
const grossForTransactions = (txns: Transaction[]): number => {
  const agg = aggregateTransactions(txns);
  return grossPaymentsForLines1f1h(agg);
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
const buildYearDocs = async (filing: NormalizedFiling, period: ResolvedPeriod, transactions: Transaction[]): Promise<YearDocs> => {
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

  // Line 1g / 1h — form count and entity-wide gross across all forms.
  const formCount = partiesToFile.length;
  const grossAllForms = partiesToFile.reduce(
    (sum, p) => sum + grossForTransactions(txByParty.get(p.index) ?? []),
    0,
  );
  const fillOpts: Fill5472Opts = { numForms: formCount, grossAllForms };

  const doc1120 = await fill1120(filing, period);

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
): Promise<PDFDocument> => {
  const merged = await PDFDocument.create();
  for (const p of prefix) await mergeInto(merged, p);
  await mergeInto(merged, yd.doc1120);
  for (const pd of yd.partyDocs) {
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
): Promise<FilingPackage> => {
  const year =
    taxYear ?? (rawFiling.tax_year != null ? Number(rawFiling.tax_year) : new Date().getFullYear() - 1);

  const filing = normalizeFiling(rawFiling);
  const period = resolvePeriod(filing, year);
  const yd = await buildYearDocs(filing, period, transactions);

  // A reasonable-cause letter is included when the filing opted in — honoring
  // either the canonical include_rcl flag or the older include_reasonable_cause
  // column — but NOT when a Form 7004 extension was filed on time (then the
  // year is not late, so no RCL applies).
  const optedRCL =
    !!filing.include_rcl || (filing as unknown as Record<string, unknown>)['include_reasonable_cause'] === true;
  const hasRCL = optedRCL && filing.extension_filed !== true;
  const instructions = await buildInstructionsPage(filing, period, {
    isLate: hasRCL, hasRCL, formCount: yd.formCount,
  });

  // Reasonable Cause Letter — built when the filing opted into the RCL. It is
  // the cover letter, so it leads the combined package (before instructions),
  // and is also returned standalone.
  let reasonableCauseLetter: Uint8Array | undefined;
  let rclDoc: PDFDocument | null = null;
  if (hasRCL) {
    rclDoc = await buildReasonableCauseLetter(filing, [period.year], rclNarrativeFromReasons(rawFiling));
    reasonableCauseLetter = await rclDoc.save();
  }

  // Combined order: RCL (if any) → instructions → 1120 → 5472s/statements.
  const prefix: PDFDocument[] = [];
  if (rclDoc) prefix.push(await PDFDocument.load(reasonableCauseLetter!));
  prefix.push(instructions);
  const merged = await assembleYear(yd, prefix);

  // Form 7004 — included when the filing opted into an extension. Appended to
  // the end of the combined package AND returned standalone.
  const include7004 = wants7004(rawFiling);
  let form7004: Uint8Array | undefined;
  if (include7004) {
    const doc7004 = await fill7004(filing, period);
    form7004 = await doc7004.save();
    // Append a fresh copy to the combined PDF (mergeInto flattens its source).
    await mergeInto(merged, await PDFDocument.load(form7004));
  }

  const ownerDocs = yd.partyDocs.find((pd) => pd.party.is_owner) ?? yd.partyDocs[0];
  const [form1120, combined, form5472, statement_partVI, statement_partV] = await Promise.all([
    yd.doc1120.save(),
    merged.save(),
    ownerDocs.doc5472.save(),
    ownerDocs.docPartVI ? ownerDocs.docPartVI.save() : Promise.resolve(new Uint8Array()),
    ownerDocs.docPartV  ? ownerDocs.docPartV.save()  : Promise.resolve<Uint8Array | undefined>(undefined),
  ]);

  return { form5472, form1120, combined, statement_partVI, statement_partV, form7004, reasonableCauseLetter, formCount: yd.formCount };
};

/** @alias generateFilingPackage — kept for callers that use the old name */
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
  opts: { includeRCL: boolean; rclNarrative?: string | null },
): Promise<MultiYearPackage> => {
  if (years.length === 0) throw new Error('generateMultiYearPackage: no years provided');

  const sorted = [...years].sort((a, b) => b.taxYear - a.taxYear); // most recent first
  const taxYears = sorted.map((y) => y.taxYear).sort((a, b) => a - b);

  // Build every year's docs.
  const yearDocs = await Promise.all(
    sorted.map((y) => {
      const f = normalizeFiling(y.filing);
      const p = resolvePeriod(f, y.taxYear);
      return buildYearDocs(f, p, y.transactions);
    }),
  );

  // One RCL covering all years (use the most-recent year's entity/owner data).
  const rclDoc = opts.includeRCL
    ? await buildReasonableCauseLetter(yearDocs[0].filing, taxYears, opts.rclNarrative)
    : null;

  // Per-year PDFs: instructions page (page 1) → that year's forms. No RCL here
  // (it is delivered once, separately and in the bundle).
  const perYear: MultiYearPackage['perYear'] = [];
  for (const yd of yearDocs) {
    const instructions = await buildInstructionsPage(yd.filing, yd.period, {
      isLate: opts.includeRCL, hasRCL: opts.includeRCL, formCount: yd.formCount,
    });
    const merged = await assembleYear(yd, [instructions]);
    perYear.push({ taxYear: yd.period.year, pdf: await merged.save(), formCount: yd.formCount });
  }

  // Bundle: RCL once → each year (instructions → forms).
  const bundle = await PDFDocument.create();
  if (rclDoc) {
    const rclCopy = await PDFDocument.load(await rclDoc.save());
    await mergeInto(bundle, rclCopy);
  }
  for (const yd of yearDocs) {
    const instructions = await buildInstructionsPage(yd.filing, yd.period, {
      isLate: opts.includeRCL, hasRCL: opts.includeRCL, formCount: yd.formCount,
    });
    // Re-fill the year docs for the bundle (a PDFDocument can't be merged twice
    // after flatten()), so rebuild from the same inputs.
    const rebuilt = await buildYearDocs(yd.filing, yd.period,
      // reconstruct this year's transactions from the input list
      sorted.find((s) => s.taxYear === yd.period.year)!.transactions);
    const yearMerged = await assembleYear(rebuilt, [instructions]);
    const yearCopy = await PDFDocument.load(await yearMerged.save());
    await mergeInto(bundle, yearCopy);
  }

  return {
    perYear: perYear.sort((a, b) => a.taxYear - b.taxYear),
    reasonableCauseLetter: rclDoc ? await rclDoc.save() : undefined,
    bundled: await bundle.save(),
    taxYears,
  };
};
