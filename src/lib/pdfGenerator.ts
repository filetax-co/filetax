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
} from './supabase';
import { getF5472Map, F5472Map } from './form5472Fields';
import { getF1120Map, F1120Map } from './form1120Fields';

// Re-export for consumers that import these types from pdfGenerator
export type Form5472Fields = F5472Map;
export type Form1120Fields = F1120Map;

export const EARLIEST_SUPPORTED_TAX_YEAR = 2019;

// ─── helpers ───────────────────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined): string =>
  n != null && n !== 0 ? String(Math.round(n)) : '';

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const parts = iso.split('-');
  const [y, m, d] = parts;
  if (!y || !m || !d || parts.length !== 3) {
    console.warn('[pdfGenerator] fmtDate: unexpected ISO format:', iso);
    return '';
  }
  return `${m}/${d}/${y}`;
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

// ─── address helpers ──────────────────────────────────────────────────────────────────

/** Build a combined "City, ST  ZIP" string from the LLC's US address. */
const buildCityStateZip = (filing: Filing): string => {
  const a = filing.llc_us_address;
  if (!a) return filing.state_of_formation ?? '';
  const city  = a.city ?? '';
  const state = a.state ?? filing.state_of_formation ?? '';
  const zip   = a.zip ?? '';
  if (!city && !state && !zip) return '';
  return [city, state].filter(Boolean).join(', ') + (zip ? `  ${zip}` : '');
};

/** Return a single street line from the LLC's US address. */
const buildStreet = (filing: Filing): string => {
  const a = filing.llc_us_address;
  if (!a) return '';
  return a.street ?? '';
};

// ─── period helpers ───────────────────────────────────────────────────────────────────

const resolvePeriodBegin = (filing: Filing): string => {
  if (filing.tax_period_begin) return fmtDate(filing.tax_period_begin);
  const y = filing.tax_year != null ? Number(filing.tax_year) : new Date().getFullYear();
  return `01/01/${y}`;
};

const resolvePeriodEnd = (filing: Filing): string => {
  if (filing.tax_period_end) return fmtDate(filing.tax_period_end);
  const y = filing.tax_year != null ? Number(filing.tax_year) : new Date().getFullYear();
  return `12/31/${y}`;
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
  // Part V — Distributions / contributions
  distributions_paid: number;
  contributions_received: number;
  // flags
  hasPartIV: boolean;
  hasPartV: boolean;
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
    hasPartIV: false, hasPartV: false,
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
        t.borrowed_end = amt; t.hasPartIV = true; break;
      case 'loan_from_llc':
        t.loaned_end = amt; t.hasPartIV = true; break;
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
      // ── Part V / Part VI narrative-only types ──────────────────────────────────
      // These transactions are described in an attached statement; they have no
      // determinable FMV to report on AcroForm Part IV lines (per IRS instructions
      // for Form 5472). No dollar amount is accumulated, but hasPartV must be set
      // so the Part V checkbox is ticked and the statement attachment is triggered.
      case 'formation_costs':
      case 'property_transfer':
      case 'nonmonetary_other':
        t.hasPartV = true; break;
      default:
        break;
    }
  }

  return t;
};

// ─── total helpers ──────────────────────────────────────────────────────────────────────

const totalReceived = (t: AggregatedTransactions): number =>
  t.sales_received + t.tangible_prop_received + t.rents_received +
  t.royalties_received + t.intangible_received + t.services_received +
  t.commissions_received + t.interest_received + t.insurance_received +
  t.loan_guarantee_received + t.other_received + t.borrowed_end +
  t.contributions_received;

const totalPaid = (t: AggregatedTransactions): number =>
  t.sales_paid + t.tangible_prop_paid + t.rents_paid +
  t.royalties_paid + t.intangible_paid + t.services_paid +
  t.commissions_paid + t.interest_paid + t.insurance_paid +
  t.loan_guarantee_paid + t.other_paid + t.loaned_end +
  t.distributions_paid;

// ─── Part V statement builder ───────────────────────────────────────────────────────────
//
// Per IRS instructions for Form 5472, Part V (line 40b), when the taxpayer has
// formation costs, property transfers, or other nonmonetary/non-arm's-length
// transactions that cannot be valued at FMV, they must attach a statement
// describing the nature, terms, and conditions of each transaction.
// This function builds that statement as a standalone PDF page.

const PART_V_NARRATIVE_TYPES = new Set([
  'formation_costs',
  'property_transfer',
  'nonmonetary_other',
]);

const TYPE_LABELS: Record<string, string> = {
  formation_costs:    'Formation Costs (Part V, Line 40b)',
  property_transfer:  'Property Transfer — Non-arm\'s Length (Part V, Line 40b)',
  nonmonetary_other:  'Other Nonmonetary / Non-arm\'s Length Transaction (Part V, Line 40b)',
};

export const buildPartVStatement = async (
  filing: Filing,
  txns: Transaction[],
  taxYear: number,
): Promise<PDFDocument> => {
  const narrativeTxns = txns.filter(tx => PART_V_NARRATIVE_TYPES.has(tx.transaction_type));

  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  const PAGE_W = 612;  // US Letter
  const PAGE_H = 792;
  const MARGIN = 56;
  const COL_W  = PAGE_W - MARGIN * 2;

  // Helper: add a new page and return it with a fresh cursor
  const addPage = (): { page: PDFPage; cursor: { y: number } } => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    return { page, cursor: { y: PAGE_H - MARGIN } };
  };

  // Helper: draw text, returns new y after drawing
  const draw = (
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    opts: { size?: number; font?: typeof bold; color?: ReturnType<typeof rgb>; maxWidth?: number },
  ): number => {
    const size  = opts.size  ?? 10;
    const font  = opts.font  ?? reg;
    const color = opts.color ?? rgb(0, 0, 0);
    // Word-wrap naively by splitting on spaces and measuring
    const words  = text.split(' ');
    const maxW   = opts.maxWidth ?? COL_W;
    let   line   = '';
    let   drawY  = y;
    const lineH  = size * 1.45;

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

  // ── Page 1: header ────────────────────────────────────────────────────────────────
  let { page, cursor } = addPage();

  // Document title
  cursor.y = draw(page, 'STATEMENT REQUIRED UNDER FORM 5472, PART V', MARGIN, cursor.y, {
    size: 13, font: bold,
  });
  cursor.y -= 4;

  // Sub-heading: entity + period
  const periodBegin = resolvePeriodBegin(filing);
  const periodEnd   = resolvePeriodEnd(filing);
  cursor.y = draw(
    page,
    `Taxpayer: ${filing.llc_name ?? ''} — EIN: ${filing.ein ?? ''}`,
    MARGIN, cursor.y, { size: 10 },
  );
  cursor.y = draw(
    page,
    `Tax Year: ${periodBegin} – ${periodEnd}  (Tax Year ${taxYear})`,
    MARGIN, cursor.y, { size: 10 },
  );
  cursor.y -= 6;

  // Divider
  page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end:   { x: PAGE_W - MARGIN, y: cursor.y },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
  cursor.y -= 14;

  // Introductory paragraph (IRS-facing language)
  const intro =
    'Pursuant to the Instructions for Form 5472 (Part V, Line 40b), the reporting ' +
    'corporation listed above had the following transactions during the tax year that ' +
    'cannot be reported at fair market value on Part IV because they are formation costs, ' +
    'property transfers, or other nonmonetary / non-arm\'s-length transactions. ' +
    'Each transaction is described below.';
  cursor.y = draw(page, intro, MARGIN, cursor.y, { size: 10 });
  cursor.y -= 14;

  // ── Transaction entries ───────────────────────────────────────────────────────────
  const MIN_Y = MARGIN + 60; // minimum bottom margin before page break

  narrativeTxns.forEach((tx, idx) => {
    // Page break if not enough room for a full entry
    if (cursor.y < MIN_Y) {
      ({ page, cursor } = addPage());
    }

    const label = TYPE_LABELS[tx.transaction_type] ?? tx.transaction_type;
    const txDate = tx.transaction_date ? fmtDate(tx.transaction_date) : 'Not specified';
    const direction = tx.direction ?? 'N/A';
    const desc = tx.description?.trim() || '(No description provided)';

    // Entry header
    cursor.y = draw(page, `Transaction ${idx + 1}: ${label}`, MARGIN, cursor.y, {
      size: 10, font: bold,
    });
    cursor.y -= 2;

    // Fields
    const fields: [string, string][] = [
      ['Date:',      txDate],
      ['Direction:', direction === 'paid' ? 'Paid by LLC to related party' : direction === 'received' ? 'Received by LLC from related party' : direction],
      ['Description:', desc],
    ];

    for (const [fieldLabel, fieldValue] of fields) {
      // Measure label width so value starts after it
      const labelW = bold.widthOfTextAtSize(fieldLabel, 10) + 6;
      page.drawText(fieldLabel, { x: MARGIN + 12, y: cursor.y, size: 10, font: bold, color: rgb(0, 0, 0) });
      cursor.y = draw(page, fieldValue, MARGIN + 12 + labelW, cursor.y, {
        size: 10,
        maxWidth: COL_W - 12 - labelW,
      });
    }

    cursor.y -= 12;

    // Thin separator between entries
    if (idx < narrativeTxns.length - 1) {
      page.drawLine({
        start: { x: MARGIN + 12, y: cursor.y },
        end:   { x: PAGE_W - MARGIN, y: cursor.y },
        thickness: 0.35,
        color: rgb(0.6, 0.6, 0.6),
      });
      cursor.y -= 10;
    }
  });

  // ── Footer on last page ───────────────────────────────────────────────────────────
  cursor.y -= 20;
  if (cursor.y < MIN_Y) {
    ({ page, cursor } = addPage());
  }
  draw(
    page,
    'This statement is attached to and made a part of Form 5472 filed by the reporting corporation named above.',
    MARGIN, cursor.y, { size: 9, color: rgb(0.4, 0.4, 0.4) },
  );

  return doc;
};

// ─── Form 5472 filler ───────────────────────────────────────────────────────────────────────────

const fill5472 = async (
  filing: Filing,
  txns: Transaction[],
  taxYear: number,
): Promise<PDFDocument> => {
  const url = get5472PdfUrl(taxYear);
  const doc = await loadPdf(url);
  const F   = getF5472Map(taxYear);
  const txn = aggregateTransactions(txns);

  const periodBegin = resolvePeriodBegin(filing);
  const periodEnd   = resolvePeriodEnd(filing);

  const [pbM, pbD, pbY] = periodBegin.split('/');
  const [, , peY]       = periodEnd.split('/');

  // ── Header — tax period ────────────────────────────────────────────────────────────
  const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const beginMonthName = pbM ? (monthNames[Number(pbM)] ?? pbM) : '';
  setText(doc, F.TAX_YEAR_BEGIN,      pbD ? `${beginMonthName} ${pbD}` : periodBegin);
  setText(doc, F.TAX_YEAR_BEGIN_YEAR, pbY ?? '');
  setText(doc, F.TAX_YEAR_END,        periodEnd);
  setText(doc, F.TAX_YEAR_END_YEAR,   peY ?? '');

  // ── Part I — Reporting Corporation ──────────────────────────────────────────────
  setText(doc, F.CORP_NAME,                  filing.llc_name ?? '');
  setText(doc, F.CORP_ADDRESS,               buildStreet(filing));
  setText(doc, F.CORP_CITY_STATE_ZIP,        buildCityStateZip(filing));
  setText(doc, F.CORP_EIN,                   filing.ein ?? '');
  setText(doc, F.CORP_TOTAL_ASSETS,          fmt(filing.total_assets));
  setText(doc, F.CORP_ACTIVITY,              filing.naics_description ?? filing.owner_business_activity ?? '');
  setText(doc, F.CORP_ACTIVITY_CODE,         filing.naics_code ?? '');
  setText(doc, F.CORP_DATE_OF_INCORPORATION, fmtDate(filing.date_of_incorporation));
  setText(doc, F.CORP_COUNTRY_OF_INC,        filing.country_of_incorporation ?? 'US');
  setText(doc, F.CORP_RESIDENT_COUNTRY,      'US');
  setText(doc, F.CORP_COUNTRY_BUSINESS,      filing.state_of_formation ?? 'US');

  // 1f gross payments on this form / 1g number of 5472s / 1h gross all forms
  const grossThisForm = totalReceived(txn) + totalPaid(txn);
  setText(doc, F.CORP_GROSS_PAYMENTS, fmt(grossThisForm));
  setText(doc, F.CORP_NUM_FORMS,      '1');
  setText(doc, F.CORP_GROSS_ALL,      fmt(grossThisForm));

  // Checkboxes 1i / 1j / 2 / 3
  checkBox(doc, F.CONSOLIDATED_FILING,       false);
  const taxYearVal = filing.tax_year != null ? Number(filing.tax_year) : taxYear;
  const incorpYear = filing.date_of_incorporation
    ? new Date(`${filing.date_of_incorporation}T12:00:00`).getFullYear()
    : 0;
  const isInitial  = filing.initial_return ?? (incorpYear > 0 && incorpYear === taxYearVal);
  checkBox(doc, F.INITIAL_RETURN_YES,        isInitial);
  checkBox(doc, F.FOREIGN_OWNS_50PCT,        true);
  checkBox(doc, F.CORP_IS_FOREIGN_OWNED_DE,  true);

  // ── Part II — 25 % Foreign Shareholder ───────────────────────────────────────────
  setText(doc, F.SHAREHOLDER_NAME,                filing.owner_full_name ?? '');
  setText(doc, F.SHAREHOLDER_US_TIN,              filing.owner_us_tin ?? '');
  setText(doc, F.SHAREHOLDER_REFERENCE_ID,        filing.owner_reference_id ?? '');
  setText(doc, F.SHAREHOLDER_FOREIGN_TIN,         filing.owner_foreign_tax_id ?? '');
  setText(doc, F.SHAREHOLDER_COUNTRY_BUSINESS,    filing.owner_primary_country ?? filing.owner_country_residence ?? '');
  setText(doc, F.SHAREHOLDER_COUNTRY_CITIZENSHIP, filing.owner_country_citizenship ?? '');
  setText(doc, F.SHAREHOLDER_RESIDENT_COUNTRY,    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // ── Part III — Related Party ──────────────────────────────────────────────────────
  checkBox(doc, F.RP_IS_FOREIGN_PERSON, true);
  checkBox(doc, F.RP_IS_US_PERSON,      false);

  setText(doc, F.RP_NAME,          filing.owner_full_name ?? '');
  setText(doc, F.RP_US_TIN,        filing.owner_us_tin ?? '');
  setText(doc, F.RP_REFERENCE_ID,  filing.owner_reference_id ?? '');
  setText(doc, F.RP_FOREIGN_TIN,   filing.owner_foreign_tax_id ?? '');
  setText(doc, F.RP_ACTIVITY,      filing.owner_business_activity ?? filing.naics_description ?? '');
  setText(doc, F.RP_ACTIVITY_CODE, filing.owner_naics_code ?? filing.naics_code ?? '');
  setText(doc, F.RP_COUNTRY_BUSINESS,  filing.owner_primary_country ?? filing.owner_country_residence ?? '');
  setText(doc, F.RP_RESIDENT_COUNTRY,  filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // 8e — Relationship checkboxes
  if (filing.rp_is_both) {
    checkBox(doc, F.RP_RELATED_TO_CORP,        true);
    checkBox(doc, F.RP_RELATED_TO_SHAREHOLDER, true);
    checkBox(doc, F.RP_IS_25PCT_SHAREHOLDER,   true);
  } else if (filing.rp_is_related_only) {
    checkBox(doc, F.RP_RELATED_TO_CORP,        false);
    checkBox(doc, F.RP_RELATED_TO_SHAREHOLDER, true);
    checkBox(doc, F.RP_IS_25PCT_SHAREHOLDER,   false);
  } else {
    checkBox(doc, F.RP_RELATED_TO_CORP,        false);
    checkBox(doc, F.RP_RELATED_TO_SHAREHOLDER, false);
    checkBox(doc, F.RP_IS_25PCT_SHAREHOLDER,   true);
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

  // ── Part V — Non-monetary / distributions ───────────────────────────────────────
  if (txn.hasPartV) {
    checkBox(doc, F.PART_V_CHECKBOX, true);
  }

  return doc;
};

// ─── Pro Forma 1120 filler ──────────────────────────────────────────────────────────────────────────

const fill1120 = async (
  filing: Filing,
  txns: Transaction[],
  taxYear: number,
): Promise<PDFDocument> => {
  const url = get1120PdfUrl(taxYear);
  const doc = await loadPdf(url);
  const F   = getF1120Map(taxYear);

  const periodBegin = resolvePeriodBegin(filing);
  const periodEnd   = resolvePeriodEnd(filing);
  const [, , peY]   = periodEnd.split('/');

  // ── Entity header ────────────────────────────────────────────────────────────────
  setText(doc, F.CORP_NAME,         filing.llc_name ?? '');
  setText(doc, F.EIN,               filing.ein ?? '');
  setText(doc, F.TOTAL_ASSETS,      fmt(filing.total_assets));
  setText(doc, F.DATE_INCORPORATED, fmtDate(filing.date_of_incorporation));

  // Address — some revisions have a single combined field (2019–2024),
  // others (fallback / 2025) use split fields. We write both sets;
  // setText is a no-op for any empty-string field name.
  setText(doc, F.CORP_ADDRESS,        buildStreet(filing));       // combined (2019–2024)
  setText(doc, F.CORP_CITY_STATE_ZIP, buildCityStateZip(filing)); // combined (2019–2024)
  setText(doc, F.CORP_ADDRESS_LINE1,  buildStreet(filing));       // split (fallback / 2025)
  setText(doc, F.CORP_CITY,    filing.llc_us_address?.city  ?? '');
  setText(doc, F.CORP_STATE,   filing.llc_us_address?.state ?? filing.state_of_formation ?? '');
  setText(doc, F.CORP_ZIP,     filing.llc_us_address?.zip   ?? '');
  setText(doc, F.CORP_COUNTRY, filing.llc_us_address?.country ?? 'US');

  // ── Tax period ─────────────────────────────────────────────────────────────────────
  setText(doc, F.BEGINNING_DATE, periodBegin);
  setText(doc, F.ENDING_DATE,    periodEnd);
  setText(doc, F.ENDING_YEAR,    peY ?? '');

  // ── Checkboxes ─────────────────────────────────────────────────────────────────────
  const taxYearVal = filing.tax_year != null ? Number(filing.tax_year) : taxYear;
  const incorpYear = filing.date_of_incorporation
    ? new Date(`${filing.date_of_incorporation}T12:00:00`).getFullYear()
    : 0;
  const isInitial  = filing.initial_return ?? (incorpYear > 0 && incorpYear === taxYearVal);
  checkBox(doc, F.INITIAL_RETURN,  isInitial);
  checkBox(doc, F.NAME_CHANGE,     filing.name_change    ?? false);
  checkBox(doc, F.ADDRESS_CHANGE,  filing.address_change ?? false);

  // ── Signature block ────────────────────────────────────────────────────────────────
  setText(doc, F.SIGNATURE, filing.owner_full_name ?? '');
  setText(doc, F.TITLE,     filing.signer_title ?? 'Managing Member');

  void txns;

  return doc;
};

// ─── merge helper ─────────────────────────────────────────────────────────────────────────────────
//
// Flattens AcroForm fields in `src` (so field values are baked into the page
// content as plain graphics) then copies all its pages into `dest`.
// Flattening is required before copyPages — without it, field widgets from
// different PDFs collide in the merged document and values disappear or render
// incorrectly in strict PDF readers (Adobe, IRS e-file tools).

const mergeInto = async (dest: PDFDocument, src: PDFDocument): Promise<void> => {
  src.getForm().flatten();
  const pages = await dest.copyPages(src, src.getPageIndices());
  for (const page of pages) {
    dest.addPage(page);
  }
};

// ─── public entry point ────────────────────────────────────────────────────────────────────────────

export interface FilingPackage {
  /** Individual Form 5472 (AcroForm, field values still editable) */
  form5472: Uint8Array;
  /** Individual Pro Forma 1120 (AcroForm, field values still editable) */
  form1120: Uint8Array;
  /**
   * Combined filing package: Pro Forma 1120 pages first, then Form 5472 pages,
   * then the Part V statement (if applicable).
   * Fields are flattened (baked in) so the merged document renders correctly
   * in all PDF viewers and IRS submission tools.
   */
  combined: Uint8Array;
  /**
   * Standalone Part V statement PDF — present only when the filing contains
   * formation_costs, property_transfer, or nonmonetary_other transactions.
   * Undefined otherwise.
   */
  statement?: Uint8Array;
}

export const generateFilingPackage = async (
  filing: Filing,
  transactions: Transaction[],
  taxYear?: number,
): Promise<FilingPackage> => {
  const year = taxYear ?? (filing.tax_year != null ? Number(filing.tax_year) : new Date().getFullYear() - 1);

  const txn = aggregateTransactions(transactions);

  // Build all PDFs in parallel where possible
  const [doc5472, doc1120] = await Promise.all([
    fill5472(filing, transactions, year),
    fill1120(filing, transactions, year),
  ]);

  // Build statement only when needed
  const docStatement = txn.hasPartV
    ? await buildPartVStatement(filing, transactions, year)
    : null;

  // Build the combined PDF: 1120 first (cover), then 5472, then statement
  const merged = await PDFDocument.create();
  await mergeInto(merged, doc1120);
  await mergeInto(merged, doc5472);
  if (docStatement) {
    await mergeInto(merged, docStatement);
  }

  const saveJobs: Promise<Uint8Array>[] = [
    doc5472.save(),
    doc1120.save(),
    merged.save(),
  ];
  if (docStatement) {
    saveJobs.push(docStatement.save());
  }

  const saved = await Promise.all(saveJobs);
  const [form5472, form1120, combined] = saved;
  const statement = docStatement ? saved[3] : undefined;

  return { form5472, form1120, combined, statement };
};

/** @alias generateFilingPackage — kept for callers that use the old name */
export const assembleFilingPackage = generateFilingPackage;
