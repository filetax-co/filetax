/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * Entry point: generateFilingPackage(filing, transactions, taxYear)
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
} from 'pdf-lib';
import {
  Filing,
  Transaction,
} from './supabase';
import {
  get5472Fields,
  get1120Fields,
  Form5472Fields,
  Form1120Fields,
} from './form5472Fields';

export const EARLIEST_SUPPORTED_TAX_YEAR = 2019;

// ─── helpers ───────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined): string =>
  n != null && n !== 0 ? String(Math.round(n)) : '';

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
};

const loadPdf = async (url: string): Promise<PDFDocument> => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch PDF: ${url} (${resp.status})`);
  const buf = await resp.arrayBuffer();
  return PDFDocument.load(buf);
};

const setText = (doc: PDFDocument, fieldName: string, value: string): void => {
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
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFCheckBox) {
      checked ? field.check() : field.uncheck();
    }
  } catch {
    // silently skip
  }
};

// ─── tax-year → PDF URL resolver ───────────────────────────────────────────

const BASE = import.meta.env.BASE_URL ?? '/';

export const get5472PdfUrl = (taxYear: number): string => {
  if (taxYear >= 2025) return `${BASE}forms/Form-5472-2025.pdf`;
  if (taxYear === 2024) return `${BASE}forms/Form-5472-2024.pdf`;
  if (taxYear === 2023) return `${BASE}forms/Form-5472-2023.pdf`;
  if (taxYear === 2022) return `${BASE}forms/Form-5472-2022.pdf`;
  if (taxYear === 2021) return `${BASE}forms/Form-5472-2021.pdf`;
  if (taxYear === 2020) return `${BASE}forms/Form-5472-2020.pdf`;
  return `${BASE}forms/Form-5472-2019.pdf`;
};

export const get1120PdfUrl = (taxYear: number): string => {
  if (taxYear >= 2025) return `${BASE}forms/Form-1120-2025.pdf`;
  if (taxYear === 2024) return `${BASE}forms/Form-1120-2024.pdf`;
  if (taxYear === 2023) return `${BASE}forms/Form-1120-2023.pdf`;
  if (taxYear === 2022) return `${BASE}forms/Form-1120-2022.pdf`;
  if (taxYear === 2021) return `${BASE}forms/Form-1120-2021.pdf`;
  if (taxYear === 2020) return `${BASE}forms/Form-1120-2020.pdf`;
  return `${BASE}forms/Form-1120-2019.pdf`;
};

// ─── period helpers ────────────────────────────────────────────────────────

const resolvePeriodBegin = (filing: Filing): string => {
  if (filing.tax_period_begin) return fmtDate(filing.tax_period_begin);
  const y = filing.tax_year ?? new Date().getFullYear();
  return `01/01/${y}`;
};

const resolvePeriodEnd = (filing: Filing): string => {
  if (filing.tax_period_end) return fmtDate(filing.tax_period_end);
  const y = filing.tax_year ?? new Date().getFullYear();
  const mm = String(12).padStart(2, '0');
  const dd = String(31).padStart(2, '0');
  return `${mm}/${dd}/${y}`;
};

// ─── transaction aggregation ───────────────────────────────────────────────

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
        // amount_usd IS the closing balance — last row wins (txns sorted asc by created_at)
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
        // Dividends → Part V distribution line (same as explicit distribution)
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
      default:
        break;
    }
  }

  return t;
};

// ─── total helpers ─────────────────────────────────────────────────────────

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

// ─── Form 5472 filler ──────────────────────────────────────────────────────

const fill5472 = async (
  filing: Filing,
  txns: Transaction[],
  taxYear: number,
): Promise<PDFDocument> => {
  const url  = get5472PdfUrl(taxYear);
  const doc  = await loadPdf(url);
  const F    = get5472Fields(taxYear) as Form5472Fields;
  const txn  = aggregateTransactions(txns);

  const periodBegin = resolvePeriodBegin(filing);
  const periodEnd   = resolvePeriodEnd(filing);

  // ── Part I — LLC / reporting corporation ──────────────────────────────────
  setText(doc, F.CORP_NAME,           filing.llc_name ?? '');
  setText(doc, F.CORP_EIN,            filing.ein ?? '');
  setText(doc, F.CORP_TOTAL_ASSETS,   fmt(filing.total_assets));
  setText(doc, F.CORP_COUNTRY_INC,    filing.country_of_incorporation ?? 'US');
  setText(doc, F.CORP_COUNTRY_BIZ,    filing.country_of_business ?? filing.state_of_formation ?? '');
  setText(doc, F.CORP_STATE_INC,      filing.state_of_formation ?? '');
  setText(doc, F.CORP_PERIOD_BEGIN,   periodBegin);
  setText(doc, F.CORP_PERIOD_END,     periodEnd);

  // ── Part II — Foreign owner ───────────────────────────────────────────────
  setText(doc, F.OWNER_NAME,          filing.owner_full_name ?? '');
  setText(doc, F.OWNER_COUNTRY_RES,   filing.owner_country_residence ?? '');
  setText(doc, F.OWNER_COUNTRY_BIZ,   filing.owner_country_residence ?? '');
  setText(doc, F.OWNER_PASSPORT,      filing.owner_passport_number ?? '');
  setText(doc, F.OWNER_FOREIGN_TAX_ID, filing.owner_foreign_tax_id ?? '');

  // ── Part III — Initial / final return ────────────────────────────────────
  const taxYearVal = filing.tax_year ?? taxYear;
  const incorpYear = filing.year_of_incorporation ?? 0;
  checkBox(doc, F.INITIAL_RETURN, incorpYear === taxYearVal);
  checkBox(doc, F.FINAL_RETURN,   filing.is_final_return ?? false);

  // ── Part IV — Monetary transactions ──────────────────────────────────────
  if (txn.hasPartIV) {
    // Received side
    setText(doc, F.LINE_5_SALES_RECEIVED,       fmt(txn.sales_received));
    setText(doc, F.LINE_7_TANGIBLE_RECEIVED,    fmt(txn.tangible_prop_received));
    setText(doc, F.LINE_9_RENTS_RECEIVED,       fmt(txn.rents_received));
    setText(doc, F.LINE_11_ROYALTIES_RECEIVED,  fmt(txn.royalties_received));
    setText(doc, F.LINE_13_INTANGIBLE_RECEIVED, fmt(txn.intangible_received));
    setText(doc, F.LINE_15_SERVICES_RECEIVED,   fmt(txn.services_received));
    setText(doc, F.LINE_17A_BORROWED_BEGIN,     fmt(txn.borrowed_begin));
    setText(doc, F.LINE_17B_BORROWED_END,       fmt(txn.borrowed_end));
    setText(doc, F.LINE_19_INTEREST_RECEIVED,   fmt(txn.interest_received));
    setText(doc, F.LINE_21_OTHER_RECEIVED,      fmt(txn.other_received));
    setText(doc, F.LINE_22_TOTAL_RECEIVED,      fmt(totalReceived(txn)));
    // Paid side
    setText(doc, F.LINE_23_SALES_PAID,          fmt(txn.sales_paid));
    setText(doc, F.LINE_25_TANGIBLE_PAID,       fmt(txn.tangible_prop_paid));
    setText(doc, F.LINE_27_RENTS_PAID,          fmt(txn.rents_paid));
    setText(doc, F.LINE_29_ROYALTIES_PAID,      fmt(txn.royalties_paid));
    setText(doc, F.LINE_31_INTANGIBLE_PAID,     fmt(txn.intangible_paid));
    setText(doc, F.LINE_33_SERVICES_PAID,       fmt(txn.services_paid));
    setText(doc, F.LINE_35A_LOANED_BEGIN,       fmt(txn.loaned_begin));
    setText(doc, F.LINE_35B_LOANED_END,         fmt(txn.loaned_end));
    setText(doc, F.LINE_37_INTEREST_PAID,       fmt(txn.interest_paid));
    setText(doc, F.LINE_39_OTHER_PAID,          fmt(txn.other_paid));
    setText(doc, F.LINE_40_TOTAL_PAID,          fmt(totalPaid(txn)));
  }

  // ── Part V — Non-monetary / less-than-FMV ────────────────────────────────
  if (txn.hasPartV) {
    setText(doc, F.LINE_41_DISTRIBUTIONS,    fmt(txn.distributions_paid));
    setText(doc, F.LINE_42_CONTRIBUTIONS,    fmt(txn.contributions_received));
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  const signerTitle = (filing as Record<string, unknown>).signer_title as string | undefined;
  setText(doc, F.SIGNER_TITLE, signerTitle ?? 'Owner');

  return doc;
};

// ─── Pro Forma 1120 filler ─────────────────────────────────────────────────

const fill1120 = async (
  filing: Filing,
  txns: Transaction[],
  taxYear: number,
): Promise<PDFDocument> => {
  const url = get1120PdfUrl(taxYear);
  const doc = await loadPdf(url);
  const F   = get1120Fields(taxYear) as Form1120Fields;
  const txn = aggregateTransactions(txns);

  const periodBegin = resolvePeriodBegin(filing);
  const periodEnd   = resolvePeriodEnd(filing);

  setText(doc, F.CORP_NAME,         filing.llc_name ?? '');
  setText(doc, F.CORP_EIN,          filing.ein ?? '');
  setText(doc, F.PERIOD_BEGIN,      periodBegin);
  setText(doc, F.PERIOD_END,        periodEnd);
  setText(doc, F.STATE_INC,         filing.state_of_formation ?? '');
  setText(doc, F.TOTAL_ASSETS,      fmt(filing.total_assets));
  setText(doc, F.NAICS_CODE,        (filing as Record<string,unknown>).naics_code as string ?? '');
  setText(doc, F.BUSINESS_ACTIVITY, (filing as Record<string,unknown>).naics_description as string ?? '');

  // Income lines — gross receipts from related-party transactions
  const grossReceipts = txn.sales_received + txn.services_received;
  setText(doc, F.LINE_1A_GROSS_RECEIPTS, fmt(grossReceipts));
  setText(doc, F.LINE_1C_GROSS_RECEIPTS_LESS_RETURNS, fmt(grossReceipts));

  // Deduction lines
  setText(doc, F.LINE_15_RENTS,     fmt(txn.rents_paid));
  setText(doc, F.LINE_17_INTEREST,  fmt(txn.interest_paid));

  // Balance sheet (Schedule L)
  setText(doc, F.LINE_1E_TOTAL_ASSETS, fmt(filing.total_assets));

  // Loans from shareholders (owner lent to LLC) — balance sheet liability
  setText(doc, F.LINE_1F_LOANS_FROM_SHAREHOLDERS, fmt(txn.borrowed_end));
  // Loans to shareholders (LLC lent to owner) — balance sheet asset
  setText(doc, F.LINE_1H_LOANS_TO_SHAREHOLDERS, fmt(txn.loaned_end));

  return doc;
};

// ─── public entry point ────────────────────────────────────────────────────

export interface FilingPackage {
  form5472: Uint8Array;
  form1120: Uint8Array;
}

export const generateFilingPackage = async (
  filing: Filing,
  transactions: Transaction[],
  taxYear?: number,
): Promise<FilingPackage> => {
  const year = taxYear ?? filing.tax_year ?? new Date().getFullYear() - 1;

  const [doc5472, doc1120] = await Promise.all([
    fill5472(filing, transactions, year),
    fill1120(filing, transactions, year),
  ]);

  const [form5472, form1120] = await Promise.all([
    doc5472.save(),
    doc1120.save(),
  ]);

  return { form5472, form1120 };
};
