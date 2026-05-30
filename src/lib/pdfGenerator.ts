/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * PDFs are served from /pdf/ (public/pdf/) to avoid CORS.
 *
 * Templates (static + fillable AcroForm):
 *   public/pdf/Form-5472.pdf          — Form 5472 (Rev. 12-2023)
 *   public/pdf/Form-1120-Page-1.pdf   — Pro Forma 1120, page 1 only
 *
 * ── Form 5472 (Rev. 12-2023) field structure ──────────────────────────────
 * See form5472Fields.ts for the complete field name map.
 *
 * Part IV line numbering (Rev. 12-2023 — CHANGED from earlier revisions):
 *   Lines 9–22  = amounts RECEIVED by reporting corp
 *   Lines 23–36 = amounts PAID by reporting corp
 *
 * ── Pro Forma 1120 (2025) field structure ──────────────────────────────
 * Header date fields:       PgHeader[0].f1_1 (begin month/day)
 *                           PgHeader[0].f1_2 (begin year)
 *                           PgHeader[0].f1_3 (end month/day, includes year)
 * Box A checkboxes (all must be UNCHECKED):
 *   A1a = Consolidated return                 PgHeader[0].c1_1a[0]
 *   A1b = Life/nonlife consolidated return    PgHeader[0].c1_1b[0]
 *   A2  = Personal holding company (PHC)      PgHeader[0].c1_2[0]
 *   A3  = Personal service corp               PgHeader[0].c1_3[0]
 *   A4  = Schedule M-3 attached               PgHeader[0].c1_4[0]
 * Identity fields:
 *   Name       PgHeader[0].NameFieldsReadOrder[0].f1_4[0]
 *   EIN (B)    PgHeader[0].NameFieldsReadOrder[0].f1_5[0]
 *   Address    PgHeader[0].NameFieldsReadOrder[0].f1_6[0]
 *   C Date inc PgHeader[0].NameFieldsReadOrder[0].f1_7[0]  — LEAVE BLANK
 *   City       PgHeader[0].NameFieldsReadOrder[0].f1_8[0]
 *   State      PgHeader[0].NameFieldsReadOrder[0].f1_9[0]
 *   Country    PgHeader[0].NameFieldsReadOrder[0].f1_10[0]
 *   ZIP        PgHeader[0].NameFieldsReadOrder[0].f1_11[0]
 *   D Assets   PgHeader[0].NameFieldsReadOrder[0].f1_12[0]
 * Box E checkboxes:
 *   E1 = Initial return    PgHeader[0].NameFieldsReadOrder[0].A_ReadOrder[0].c1_E1[0]
 *   E2 = Final return      PgHeader[0].NameFieldsReadOrder[0].A_ReadOrder[0].c1_E2[0]
 *   E3 = Name change       PgHeader[0].NameFieldsReadOrder[0].A_ReadOrder[0].c1_E3[0]
 *   E4 = Address change    PgHeader[0].NameFieldsReadOrder[0].A_ReadOrder[0].c1_E4[0]
 */

import { PDFDocument, PDFCheckBox, PDFTextField } from 'pdf-lib';
import { F5472 } from './form5472Fields';
import type { Filing, Transaction, Address } from './supabase';

// ── Template paths — must match filenames in public/pdf/ ─────────────────────
const FORM_5472_PATH = `${import.meta.env.BASE_URL}pdf/Form-5472.pdf`;
const FORM_1120_PATH = `${import.meta.env.BASE_URL}pdf/Form-1120-Page-1.pdf`;

const pdfCache: Record<string, ArrayBuffer> = {};

async function fetchPdfBytes(path: string): Promise<ArrayBuffer> {
  if (pdfCache[path]) return pdfCache[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error(
    `Could not load PDF template at ${path} (${res.status}). ` +
    `Ensure public/pdf/Form-5472.pdf and public/pdf/Form-1120-Page-1.pdf exist in the repo.`
  );
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) throw new Error(
    `PDF at ${path} is empty or too small (${bytes.byteLength} bytes). ` +
    `Re-upload the correct AcroForm template to public/pdf/.`
  );
  pdfCache[path] = bytes;
  return bytes;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setText(doc: PDFDocument, fieldName: string, value: string | null | undefined) {
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFTextField) {
      field.setText(value ?? '');
    }
  } catch {
    console.warn(`[pdfGenerator] TextField not found: ${fieldName}`);
  }
}

function setCheck(doc: PDFDocument, fieldName: string, checked: boolean) {
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFCheckBox) {
      checked ? field.check() : field.uncheck();
    }
  } catch {
    console.warn(`[pdfGenerator] CheckBox not found: ${fieldName}`);
  }
}

/** Format number as whole-dollar string for IRS forms (no cents, no $) */
function fmt(val: number | null | undefined): string {
  if (val == null || val === 0) return '';
  return Math.round(val).toLocaleString('en-US');
}

/** Format EIN as XX-XXXXXXX */
function fmtEin(ein: string | null | undefined): string {
  if (!ein) return '';
  const digits = ein.replace(/\D/g, '');
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return ein;
}

/**
 * Format a date string as MM/DD/YYYY.
 * Uses UTC getters to avoid off-by-one when date is stored as "YYYY-MM-DD"
 * (parsed as UTC midnight) and rendered in a local time zone west of UTC.
 */
function fmtDate(val: string | null | undefined): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return (
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}/` +
    `${String(d.getUTCDate()).padStart(2, '0')}/` +
    `${d.getUTCFullYear()}`
  );
}

/** Street address only — line1 + line2 */
function fmtStreet(addr: Address | null | undefined): string {
  if (!addr) return '';
  return [addr.line1, addr.line2].filter(Boolean).join(', ');
}

/** City only */
function fmtCity(addr: Address | null | undefined): string {
  return addr?.city ?? '';
}

/** State/region only */
function fmtState(addr: Address | null | undefined): string {
  return addr?.region ?? '';
}

/** ZIP/postal code only */
function fmtZip(addr: Address | null | undefined): string {
  return addr?.postal_code ?? '';
}

/** City, State ZIP — for single combined field (Form 5472 style) */
function fmtCityStateZip(addr: Address | null | undefined): string {
  if (!addr) return '';
  return [
    addr.city,
    addr.region,
    addr.postal_code,
    addr.country && addr.country !== 'US' && addr.country !== 'USA' ? addr.country : null,
  ].filter(Boolean).join(', ');
}

/**
 * Build tax period begin: month-day label and year as separate strings.
 * Uses UTC getters throughout.
 */
function resolvePeriodBegin(
  filing: Filing,
  taxYear: string
): { label: string; year: string } {
  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  if (filing.initial_return && filing.date_of_incorporation) {
    const d = new Date(filing.date_of_incorporation);
    if (!isNaN(d.getTime()) && String(d.getUTCFullYear()) === taxYear) {
      return { label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`, year: taxYear };
    }
  }
  if (filing.tax_period_begin) {
    const [yearStr, monthStr, dayStr] = filing.tax_period_begin.split('-');
    const month = parseInt(monthStr, 10);
    const day   = parseInt(dayStr, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { label: `${MONTH_NAMES[month - 1]} ${day}`, year: yearStr };
    }
  }
  return { label: 'January 1', year: taxYear };
}

function resolvePeriodEnd(
  filing: Filing,
  taxYear: string
): { label: string; year: string } {
  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  if (filing.tax_period_end) {
    const [yearStr, monthStr, dayStr] = filing.tax_period_end.split('-');
    const month = parseInt(monthStr, 10);
    const day   = parseInt(dayStr, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { label: `${MONTH_NAMES[month - 1]} ${day}`, year: yearStr };
    }
  }
  return { label: 'December 31', year: taxYear };
}

// ─── Transaction aggregator ───────────────────────────────────────────────────

export const PART_V_CATEGORIES = [
  'capital_contribution',
  'distribution',
  'formation_costs',
  'property_transfer',
  'nonmonetary_other',
] as const;

interface TxnTotals {
  // Received
  sales_received: number;
  tangible_prop_received: number;
  rents_received: number;
  royalties_received: number;
  intangible_received: number;
  services_received: number;
  commissions_received: number;
  borrowed_begin: number;
  borrowed_end: number;
  interest_received: number;
  insurance_received: number;
  loan_guarantee_received: number;
  other_received: number;
  total_received: number;
  // Paid
  sales_paid: number;
  tangible_prop_paid: number;
  rents_paid: number;
  royalties_paid: number;
  intangible_paid: number;
  services_paid: number;
  commissions_paid: number;
  loaned_begin: number;
  loaned_end: number;
  interest_paid: number;
  insurance_paid: number;
  loan_guarantee_paid: number;
  other_paid: number;
  total_paid: number;
  // Part V
  capital_contribution: number;
  distribution: number;
  formation_costs: number;
  property_transfer: number;
  // Flags
  hasPartIV: boolean;
  hasPartV: boolean;
}

function aggregateTransactions(txns: Transaction[]): TxnTotals {
  const t: TxnTotals = {
    sales_received: 0, tangible_prop_received: 0,
    rents_received: 0, royalties_received: 0,
    intangible_received: 0, services_received: 0,
    commissions_received: 0,
    borrowed_begin: 0, borrowed_end: 0,
    interest_received: 0, insurance_received: 0,
    loan_guarantee_received: 0, other_received: 0, total_received: 0,
    sales_paid: 0, tangible_prop_paid: 0,
    rents_paid: 0, royalties_paid: 0,
    intangible_paid: 0, services_paid: 0,
    commissions_paid: 0,
    loaned_begin: 0, loaned_end: 0,
    interest_paid: 0, insurance_paid: 0,
    loan_guarantee_paid: 0, other_paid: 0, total_paid: 0,
    capital_contribution: 0, distribution: 0,
    formation_costs: 0, property_transfer: 0,
    hasPartIV: false, hasPartV: false,
  };

  for (const tx of txns) {
    const amt = tx.amount_usd ?? 0;
    const dir = tx.direction;

    switch (tx.transaction_type) {
      // — Sales / tangible property
      case 'sales':
        dir === 'received'
          ? (t.sales_received += amt)
          : (t.sales_paid += amt);
        t.hasPartIV = true; break;
      case 'tangible_property':
        dir === 'received'
          ? (t.tangible_prop_received += amt)
          : (t.tangible_prop_paid += amt);
        t.hasPartIV = true; break;
      // — Rents / royalties
      case 'rent_royalty':
        if (dir === 'received') {
          tx.is_royalty ? (t.royalties_received += amt) : (t.rents_received += amt);
        } else {
          tx.is_royalty ? (t.royalties_paid += amt) : (t.rents_paid += amt);
        }
        t.hasPartIV = true; break;
      // — Intangible property
      case 'intangible':
        dir === 'received'
          ? (t.intangible_received += amt)
          : (t.intangible_paid += amt);
        t.hasPartIV = true; break;
      // — Services
      case 'service_payment':
        dir === 'received'
          ? (t.services_received += amt)
          : (t.services_paid += amt);
        t.hasPartIV = true; break;
      // — Commissions
      case 'commission':
        dir === 'received'
          ? (t.commissions_received += amt)
          : (t.commissions_paid += amt);
        t.hasPartIV = true; break;
      // — Borrowing / lending (17a/17b = borrowed; 31a/31b = loaned)
      case 'loan_to_llc':
        // LLC borrowed from owner: goes on line 17
        t.borrowed_end += amt;
        t.hasPartIV = true; break;
      case 'loan_from_llc':
        // LLC loaned to owner: goes on line 31
        t.loaned_end += amt;
        t.hasPartIV = true; break;
      // — Interest
      case 'interest':
        dir === 'paid'
          ? (t.interest_paid += amt)
          : (t.interest_received += amt);
        t.hasPartIV = true; break;
      // — Insurance
      case 'insurance':
        dir === 'paid'
          ? (t.insurance_paid += amt)
          : (t.insurance_received += amt);
        t.hasPartIV = true; break;
      // — Loan guarantee fees
      case 'loan_guarantee':
        dir === 'paid'
          ? (t.loan_guarantee_paid += amt)
          : (t.loan_guarantee_received += amt);
        t.hasPartIV = true; break;
      // — Other
      case 'other':
        dir === 'paid'
          ? (t.other_paid += amt)
          : (t.other_received += amt);
        t.hasPartIV = true; break;
      // — Part V (non-monetary / disregarded entity formation/dissolution)
      case 'capital_contribution':
        t.capital_contribution += amt; t.hasPartV = true; break;
      case 'distribution':
        t.distribution += amt; t.hasPartV = true; break;
      case 'formation_costs':
        t.formation_costs += amt; t.hasPartV = true; break;
      case 'property_transfer':
        t.property_transfer += amt; t.hasPartV = true; break;
    }
  }

  // Compute totals (lines 22 and 36)
  t.total_received =
    t.sales_received + t.tangible_prop_received +
    t.rents_received + t.royalties_received +
    t.intangible_received + t.services_received +
    t.commissions_received + t.borrowed_end +
    t.interest_received + t.insurance_received +
    t.loan_guarantee_received + t.other_received;
  t.total_paid =
    t.sales_paid + t.tangible_prop_paid +
    t.rents_paid + t.royalties_paid +
    t.intangible_paid + t.services_paid +
    t.commissions_paid + t.loaned_end +
    t.interest_paid + t.insurance_paid +
    t.loan_guarantee_paid + t.other_paid;

  return t;
}

// ─── Form 5472 filler ─────────────────────────────────────────────────────────

export async function fillForm5472(
  filing: Filing,
  transactions: Transaction[]
): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(FORM_5472_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const txn = aggregateTransactions(transactions);
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  const isInitial = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getUTCFullYear()) === taxYear
  );

  // ── Header: tax year
  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);
  setText(doc, F5472.TAX_YEAR_BEGIN,       begin.label);
  setText(doc, F5472.TAX_YEAR_BEGIN_YEAR,  begin.year);
  setText(doc, F5472.TAX_YEAR_END,         end.label);
  setText(doc, F5472.TAX_YEAR_END_YEAR,    end.year);

  // ── Part I — Reporting Corporation
  setText(doc, F5472.CORP_NAME,           filing.llc_name ?? '');
  setText(doc, F5472.CORP_ADDRESS,        fmtStreet(filing.mailing_address));
  setText(doc, F5472.CORP_EIN,            fmtEin(filing.ein));
  setText(doc, F5472.CORP_CITY_STATE_ZIP, fmtCityStateZip(filing.mailing_address));
  setText(doc, F5472.CORP_TOTAL_ASSETS,   fmt(filing.total_assets));
  setText(doc, F5472.CORP_ACTIVITY,       filing.naics_description ?? '');
  setText(doc, F5472.CORP_ACTIVITY_CODE,  filing.naics_code ? String(filing.naics_code) : '');

  // 1f, 1g, 1h
  const grossTotal = txn.total_received + txn.total_paid +
    txn.capital_contribution + txn.distribution +
    txn.formation_costs + txn.property_transfer;
  setText(doc, F5472.CORP_GROSS_PAYMENTS, fmt(grossTotal));
  setText(doc, F5472.CORP_NUM_FORMS,      '1');
  setText(doc, F5472.CORP_GROSS_ALL,      fmt(grossTotal)); // same value when only 1 form

  // 1i — Consolidated filing: always FALSE for a single-entity DE filing
  setCheck(doc, F5472.CONSOLIDATED_FILING, false);
  // 1j — Initial return
  setCheck(doc, F5472.INITIAL_RETURN_YES, isInitial);
  // 1k — Parts VIII count: 0 unless CSA (not applicable here)
  setText(doc, F5472.PARTS_VIII_COUNT, '0');

  // 1l, 1m, 1n, 1o
  setText(doc, F5472.CORP_COUNTRY_OF_INC,      'United States');
  setText(doc, F5472.CORP_DATE_OF_INCORPORATION, fmtDate(filing.date_of_incorporation));
  setText(doc, F5472.CORP_RESIDENT_COUNTRY,    'United States');
  setText(doc, F5472.CORP_COUNTRY_BUSINESS,
    filing.mailing_address?.country ?? 'United States');

  // Checkbox 2: foreign person owns ≥ 50% — always true for foreign-owned DE
  setCheck(doc, F5472.FOREIGN_OWNS_50PCT, true);
  // Checkbox 3: foreign-owned U.S. DE — always true
  setCheck(doc, F5472.CORP_IS_FOREIGN_OWNED_DE, true);

  // Part II — Surrogate corp: always unchecked
  setCheck(doc, F5472.SURROGATE_CORP_CHECKBOX, false);

  // Part II — Row 4: direct 25% foreign shareholder
  setText(doc, F5472.SHAREHOLDER_NAME,               filing.owner_full_name ?? '');
  setText(doc, F5472.SHAREHOLDER_US_TIN,             filing.owner_us_tin ?? '');
  setText(doc, F5472.SHAREHOLDER_REFERENCE_ID,       filing.owner_reference_id ?? '');
  setText(doc, F5472.SHAREHOLDER_FOREIGN_TIN,        filing.owner_foreign_tax_id ?? '');
  setText(doc, F5472.SHAREHOLDER_COUNTRY_BUSINESS,   filing.owner_country_citizenship ?? '');
  setText(doc, F5472.SHAREHOLDER_COUNTRY_CITIZENSHIP,filing.owner_country_citizenship ?? '');
  setText(doc, F5472.SHAREHOLDER_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // Rows 5, 6, 7 — explicitly blank
  for (const key of [
    F5472.SHAREHOLDER2_NAME, F5472.SHAREHOLDER2_US_TIN, F5472.SHAREHOLDER2_REFERENCE_ID,
    F5472.SHAREHOLDER2_FOREIGN_TIN, F5472.SHAREHOLDER2_COUNTRY_BUSINESS,
    F5472.SHAREHOLDER2_COUNTRY_CITIZENSHIP, F5472.SHAREHOLDER2_RESIDENT_COUNTRY,
    F5472.SHAREHOLDER3_NAME, F5472.SHAREHOLDER3_US_TIN, F5472.SHAREHOLDER3_REFERENCE_ID,
    F5472.SHAREHOLDER3_FOREIGN_TIN, F5472.SHAREHOLDER3_COUNTRY_BUSINESS,
    F5472.SHAREHOLDER3_COUNTRY_CITIZENSHIP, F5472.SHAREHOLDER3_RESIDENT_COUNTRY,
    F5472.SHAREHOLDER4_NAME, F5472.SHAREHOLDER4_US_TIN, F5472.SHAREHOLDER4_REFERENCE_ID,
    F5472.SHAREHOLDER4_FOREIGN_TIN, F5472.SHAREHOLDER4_COUNTRY_BUSINESS,
    F5472.SHAREHOLDER4_COUNTRY_CITIZENSHIP, F5472.SHAREHOLDER4_RESIDENT_COUNTRY,
  ]) setText(doc, key, '');

  // Part III — Related Party
  // The related party IS the 25% foreign shareholder (same person).
  setCheck(doc, F5472.RP_IS_FOREIGN_PERSON, true);
  setCheck(doc, F5472.RP_IS_US_PERSON,      false);
  setText(doc, F5472.RP_NAME,         filing.owner_full_name ?? '');
  setText(doc, F5472.RP_US_TIN,       filing.owner_us_tin ?? '');
  setText(doc, F5472.RP_REFERENCE_ID, filing.owner_reference_id ?? '');
  setText(doc, F5472.RP_FOREIGN_TIN,  filing.owner_foreign_tax_id ?? '');
  setText(doc, F5472.RP_ACTIVITY,     filing.owner_business_activity ?? filing.naics_description ?? '');
  setText(doc, F5472.RP_ACTIVITY_CODE,filing.naics_code ? String(filing.naics_code) : '');

  // 8e — Relationship: the owner IS the 25% foreign shareholder
  setCheck(doc, F5472.RP_RELATED_TO_CORP,        false);
  setCheck(doc, F5472.RP_RELATED_TO_SHAREHOLDER, false);
  setCheck(doc, F5472.RP_IS_25PCT_SHAREHOLDER,   true);

  setText(doc, F5472.RP_COUNTRY_BUSINESS,
    filing.owner_country_citizenship ?? filing.owner_country_residence ?? '');
  setText(doc, F5472.RP_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // Part IV — Monetary Transactions (lines 9-36 per Rev. 12-2023)
  if (txn.hasPartIV) {
    // Amounts RECEIVED (lines 9-22)
    setText(doc, F5472.LINE_9_SALES_RECEIVED,           fmt(txn.sales_received));
    setText(doc, F5472.LINE_10_TANGIBLE_PROP_RECEIVED,  fmt(txn.tangible_prop_received));
    setText(doc, F5472.LINE_11_PCT_PAYMENTS_RECEIVED,   '');
    setText(doc, F5472.LINE_12_CST_PAYMENTS_RECEIVED,   '');
    setText(doc, F5472.LINE_13A_RENTS_RECEIVED,         fmt(txn.rents_received));
    setText(doc, F5472.LINE_13B_ROYALTIES_RECEIVED,     fmt(txn.royalties_received));
    setText(doc, F5472.LINE_14_INTANGIBLE_RECEIVED,     fmt(txn.intangible_received));
    setText(doc, F5472.LINE_15_SERVICES_RECEIVED,       fmt(txn.services_received));
    setText(doc, F5472.LINE_16_COMMISSIONS_RECEIVED,    fmt(txn.commissions_received));
    setText(doc, F5472.LINE_17A_BORROWED_BEGIN,         fmt(txn.borrowed_begin));
    setText(doc, F5472.LINE_17B_BORROWED_END,           fmt(txn.borrowed_end));
    setText(doc, F5472.LINE_18_INTEREST_RECEIVED,       fmt(txn.interest_received));
    setText(doc, F5472.LINE_19_INSURANCE_RECEIVED,      fmt(txn.insurance_received));
    setText(doc, F5472.LINE_20_LOAN_GUARANTEE_RECEIVED, fmt(txn.loan_guarantee_received));
    setText(doc, F5472.LINE_21_OTHER_RECEIVED,          fmt(txn.other_received));
    setText(doc, F5472.LINE_22_TOTAL_RECEIVED,          fmt(txn.total_received));

    // Amounts PAID (lines 23-36)
    setText(doc, F5472.LINE_23_SALES_PAID,              fmt(txn.sales_paid));
    setText(doc, F5472.LINE_24_TANGIBLE_PROP_PAID,      fmt(txn.tangible_prop_paid));
    setText(doc, F5472.LINE_25_PCT_PAYMENTS_PAID,       '');
    setText(doc, F5472.LINE_26_CST_PAYMENTS_PAID,       '');
    setText(doc, F5472.LINE_27A_RENTS_PAID,             fmt(txn.rents_paid));
    setText(doc, F5472.LINE_27B_ROYALTIES_PAID,         fmt(txn.royalties_paid));
    setText(doc, F5472.LINE_28_INTANGIBLE_PAID,         fmt(txn.intangible_paid));
    setText(doc, F5472.LINE_29_SERVICES_PAID,           fmt(txn.services_paid));
    setText(doc, F5472.LINE_30_COMMISSIONS_PAID,        fmt(txn.commissions_paid));
    setText(doc, F5472.LINE_31A_LOANED_BEGIN,           fmt(txn.loaned_begin));
    setText(doc, F5472.LINE_31B_LOANED_END,             fmt(txn.loaned_end));
    setText(doc, F5472.LINE_32_INTEREST_PAID,           fmt(txn.interest_paid));
    setText(doc, F5472.LINE_33_INSURANCE_PAID,          fmt(txn.insurance_paid));
    setText(doc, F5472.LINE_34_LOAN_GUARANTEE_PAID,     fmt(txn.loan_guarantee_paid));
    setText(doc, F5472.LINE_35_OTHER_PAID,              fmt(txn.other_paid));
    setText(doc, F5472.LINE_36_TOTAL_PAID,              fmt(txn.total_paid));
  }

  // Part V — checkbox only (description goes on attached statement)
  setCheck(doc, F5472.PART_V_CHECKBOX,  txn.hasPartV);
  // Part VI — always false (nonmonetary transactions handled in Part V for DE)
  setCheck(doc, F5472.PART_VI_CHECKBOX, false);

  // Part VII — all No (standard for a simple foreign-owned DE with no imports/CSA/FDII)
  setCheck(doc, F5472.LINE_37_YES,  false); setCheck(doc, F5472.LINE_37_NO,  true);
  setCheck(doc, F5472.LINE_38A_YES, false); setCheck(doc, F5472.LINE_38A_NO, true);
  setCheck(doc, F5472.LINE_38C_YES, false); setCheck(doc, F5472.LINE_38C_NO, true);
  setCheck(doc, F5472.LINE_39_YES,  false); setCheck(doc, F5472.LINE_39_NO,  true);
  setCheck(doc, F5472.LINE_40A_YES, false); setCheck(doc, F5472.LINE_40A_NO, true);
  setCheck(doc, F5472.LINE_41A_YES, false); setCheck(doc, F5472.LINE_41A_NO, true);
  setCheck(doc, F5472.LINE_42A_YES, false); setCheck(doc, F5472.LINE_42A_NO, true);
  setCheck(doc, F5472.LINE_42B_YES, false); setCheck(doc, F5472.LINE_42B_NO, true);
  setCheck(doc, F5472.LINE_43A_YES, false); setCheck(doc, F5472.LINE_43A_NO, true);

  // Part VIII — all No (no CSA)
  setCheck(doc, F5472.LINE_45_YES, false); setCheck(doc, F5472.LINE_45_NO, true);
  setCheck(doc, F5472.LINE_46_YES, false); setCheck(doc, F5472.LINE_46_NO, true);
  setCheck(doc, F5472.LINE_48C_YES,false); setCheck(doc, F5472.LINE_48C_NO, true);

  doc.getForm().flatten();
  return doc.save();
}

// ─── Pro Forma Form 1120 (2025) filler ───────────────────────────────────────────
//
// Field paths verified from the 2025 Form 1120 PDF text layer.
//
//   HDR = topmostSubform[0].Page1[0].PgHeader[0]
//   NF  = HDR.NameFieldsReadOrder[0]
//   AR  = NF.A_ReadOrder[0]
//
// Box A (all must be unchecked):
//   HDR.c1_1a[0] = Consolidated return
//   HDR.c1_1b[0] = Life/nonlife consolidated return
//   HDR.c1_2[0]  = Personal holding co (PHC)
//   HDR.c1_3[0]  = Personal service corp (PSC)
//   HDR.c1_4[0]  = Schedule M-3 attached
//
// Identity + address:
//   NF.f1_4[0]   = Corp name
//   NF.f1_5[0]   = EIN (Box B)
//   NF.f1_6[0]   = Street address
//   NF.f1_7[0]   = Date incorporated (Box C) — BLANK on Pro Forma
//   NF.f1_8[0]   = City
//   NF.f1_9[0]   = State or province
//   NF.f1_10[0]  = Country
//   NF.f1_11[0]  = ZIP or foreign postal code
//   NF.f1_12[0]  = Total assets (Box D)
//
// Box E checkboxes:
//   AR.c1_E1[0]  = (1) Initial return
//   AR.c1_E2[0]  = (2) Final return
//   AR.c1_E3[0]  = (3) Name change
//   AR.c1_E4[0]  = (4) Address change

const H1120 = 'topmostSubform[0].Page1[0].PgHeader[0]';
const NF    = `${H1120}.NameFieldsReadOrder[0]`;
const AR    = `${NF}.A_ReadOrder[0]`;

export async function fillProForma1120(filing: Filing): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(FORM_1120_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  // Remove pages 2–6 — Pro Forma only uses Page 1
  for (let i = doc.getPageCount() - 1; i >= 1; i--) {
    doc.removePage(i);
  }

  const form = doc.getForm();
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  const set = (name: string, val: string) => {
    try {
      const f = form.getField(name);
      if (f instanceof PDFTextField) f.setText(val);
    } catch {
      console.warn(`[proForma1120] field not found: ${name}`);
    }
  };
  const chk = (name: string, val: boolean) => {
    try {
      const f = form.getField(name);
      if (f instanceof PDFCheckBox) val ? f.check() : f.uncheck();
    } catch {
      console.warn(`[proForma1120] checkbox not found: ${name}`);
    }
  };

  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);

  // ── Tax year header
  set(`${H1120}.f1_1[0]`, begin.label);  // "January 1"
  set(`${H1120}.f1_2[0]`, begin.year);   // "2025"
  set(`${H1120}.f1_3[0]`, end.label);    // "December 31"
  // End year is embedded in f1_3 on this template (no separate year field for end)

  // ── Box A — all unchecked (foreign-owned DE is none of these)
  chk(`${H1120}.c1_1a[0]`, false);  // Consolidated return
  chk(`${H1120}.c1_1b[0]`, false);  // Life/nonlife consolidated
  chk(`${H1120}.c1_2[0]`,  false);  // PHC
  chk(`${H1120}.c1_3[0]`,  false);  // PSC
  chk(`${H1120}.c1_4[0]`,  false);  // M-3 attached

  // ── Corp name + address (NameFieldsReadOrder)
  set(`${NF}.f1_4[0]`,  filing.llc_name ?? '');
  set(`${NF}.f1_5[0]`,  fmtEin(filing.ein));           // Box B: EIN
  set(`${NF}.f1_6[0]`,  fmtStreet(filing.mailing_address));
  set(`${NF}.f1_7[0]`,  '');                            // Box C: Date incorporated — BLANK
  set(`${NF}.f1_8[0]`,  fmtCity(filing.mailing_address));
  set(`${NF}.f1_9[0]`,  fmtState(filing.mailing_address));
  set(`${NF}.f1_10[0]`, '');                            // Country — blank for US domestic
  set(`${NF}.f1_11[0]`, fmtZip(filing.mailing_address));
  set(`${NF}.f1_12[0]`, fmt(filing.total_assets));      // Box D: Total assets

  // ── Box E — Initial / Final / Name change / Address change
  const isFinal = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getUTCFullYear()) === taxYear
  );
  const isInitial = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getUTCFullYear()) === taxYear
  );
  chk(`${AR}.c1_E1[0]`, isInitial);                    // (1) Initial return
  chk(`${AR}.c1_E2[0]`, isFinal);                      // (2) Final return
  chk(`${AR}.c1_E3[0]`, filing.name_change    ?? false); // (3) Name change
  chk(`${AR}.c1_E4[0]`, filing.address_change ?? false); // (4) Address change

  form.flatten();
  return doc.save();
}

// ─── Part V Attachment Statement ─────────────────────────────────────────────

export function generatePartVStatement(
  filing: Filing,
  transactions: Transaction[]
): string {
  const txn = aggregateTransactions(transactions);
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);
  const lines: string[] = [];

  lines.push('ATTACHMENT TO FORM 5472 — PART V STATEMENT');
  lines.push(`Tax Year: ${taxYear}`);
  lines.push(`Reporting Corporation: ${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`);
  lines.push(`Foreign Owner: ${filing.owner_full_name ?? ''}`);
  lines.push('');
  lines.push(
    'The following transactions occurred between the foreign-owned U.S. ' +
    'disregarded entity and its foreign owner during the tax year:'
  );
  lines.push('');

  if (txn.capital_contribution > 0)
    lines.push(`Capital contributions made by owner to LLC: $${fmt(txn.capital_contribution)}`);
  if (txn.distribution > 0)
    lines.push(`Distributions made by LLC to owner: $${fmt(txn.distribution)}`);
  if (txn.formation_costs > 0)
    lines.push(`Formation/organization costs paid on behalf of LLC: $${fmt(txn.formation_costs)}`);
  if (txn.property_transfer > 0)
    lines.push(`Property transferred to/from LLC: $${fmt(txn.property_transfer)}`);

  lines.push('');
  lines.push('These transactions are reported pursuant to Reg. § 1.6038A-2(b)(7).');

  return lines.join('\n');
}

// ─── Package generator ────────────────────────────────────────────────────────

export interface FilingPackage {
  form5472Bytes: Uint8Array;
  proForma1120Bytes: Uint8Array;
  partVStatement: string;
  hasPartV: boolean;
}

export async function generateFilingPackage(
  filing: Filing,
  transactions: Transaction[]
): Promise<FilingPackage> {
  const [form5472Bytes, proForma1120Bytes] = await Promise.all([
    fillForm5472(filing, transactions),
    fillProForma1120(filing),
  ]);

  const txn = aggregateTransactions(transactions);

  return {
    form5472Bytes,
    proForma1120Bytes,
    partVStatement: generatePartVStatement(filing, transactions),
    hasPartV: txn.hasPartV,
  };
}
