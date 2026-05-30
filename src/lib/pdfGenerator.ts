/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * PDFs are served from /pdf/ (public/pdf/) to avoid CORS.
 *
 * Templates (static + fillable AcroForm, verified field names):
 *   public/pdf/Form-5472.pdf          — 78 fields, 3 pages
 *   public/pdf/Form-1120-Page-1.pdf   — 17 fields, 1 page
 *
 * Field names are simple flat AcroForm names (NOT XFA dot-paths).
 * Verified by live PDF dump — see audit output in project docs.
 *
 * ── Form 5472 field map ───────────────────────────────────────────────────────
 * See form5472Fields.ts (F5472 constants) for the complete mapping.
 *
 * ── Form 1120 Page 1 field map ────────────────────────────────────────────────
 * TextField    CorporateName
 * TextField    AddressLine1
 * TextField    City
 * TextField    State
 * TextField    Country
 * TextField    Zipcode
 * TextField    EIN
 * CheckBox     Initial Return
 * CheckBox     FinalReturn
 * CheckBox     NameChange
 * CheckBox     AddressChange
 * TextField    Signature       — owner_full_name (auto-filled at generation time)
 * TextField    Date            — today's date in MM/DD/YYYY format
 * TextField    Title           — filing.signer_title ?? "Owner" (default)
 * TextField    BeginningDate   — month+day only, e.g. "January 1" (year auto-filled by form)
 * TextField    EndingDate      — e.g. "December 31"
 * TextField    EndingYear      — last 2 digits only, e.g. "25" (form pre-prints "20")
 */

import { PDFDocument, PDFCheckBox, PDFTextField, rgb, StandardFonts } from 'pdf-lib';
import { F5472 } from './form5472Fields';
import type { Filing, Transaction, Address } from './supabase';

// ── IRS mailing address ───────────────────────────────────────────────────────
const IRS_MAILING_ADDRESS = [
  'Internal Revenue Service',
  '1973 Rulon White Blvd',
  'M/S 6112 Attn: PIN Unit',
  'Ogden, UT 84201',
];

// ── Template paths — must match filenames in public/pdf/ ──────────────────────
const FORM_5472_PATH = `${import.meta.env.BASE_URL}pdf/Form-5472.pdf`;
const FORM_1120_PATH = `${import.meta.env.BASE_URL}pdf/Form-1120-Page-1.pdf`;

const pdfCache: Record<string, ArrayBuffer> = {};

async function fetchPdfBytes(path: string): Promise<ArrayBuffer> {
  if (pdfCache[path]) return pdfCache[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error(
    `Could not load PDF template at ${path} (${res.status}). ` +
    `Ensure public/pdf/Form-5472.pdf and public/pdf/Form-1120-Page-1.pdf exist.`
  );
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) throw new Error(
    `PDF at ${path} is too small (${bytes.byteLength} bytes). Re-upload the template.`
  );
  pdfCache[path] = bytes;
  return bytes;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setText(
  doc: PDFDocument,
  fieldName: string,
  value: string | null | undefined,
  fontSize?: number
) {
  if (!fieldName) return;
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFTextField) {
      field.setText(value ?? '');
      if (fontSize != null) field.setFontSize(fontSize);
    }
  } catch {
    console.warn(`[pdfGenerator] TextField not found: ${fieldName}`);
  }
}

function setCheck(doc: PDFDocument, fieldName: string, checked: boolean) {
  if (!fieldName) return;
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFCheckBox) checked ? field.check() : field.uncheck();
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
 * Uses UTC getters to avoid off-by-one for YYYY-MM-DD stored dates.
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

/**
 * Today's date formatted as MM/DD/YYYY — used for the signature Date field.
 * Uses local time (intentional: this is the date the form is generated/signed).
 */
function todayFormatted(): string {
  const d = new Date();
  return (
    `${String(d.getMonth() + 1).padStart(2, '0')}/` +
    `${String(d.getDate()).padStart(2, '0')}/` +
    `${d.getFullYear()}`
  );
}

/** Street address only — line1 + line2 */
function fmtStreet(addr: Address | null | undefined): string {
  if (!addr) return '';
  return [addr.line1, addr.line2].filter(Boolean).join(', ');
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

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

/**
 * Build tax period begin: month-day label and year as separate strings.
 *
 * Priority order:
 *  1. If date_of_incorporation falls within taxYear → use that date as the
 *     period begin (handles initial returns regardless of the initial_return flag).
 *  2. If tax_period_begin is explicitly set → use that.
 *  3. Default → January 1 of taxYear.
 *
 * Uses UTC getters throughout.
 */
function resolvePeriodBegin(
  filing: Filing,
  taxYear: string
): { label: string; year: string } {
  // 1. Incorporation date in the tax year → use it as the beginning date
  if (filing.date_of_incorporation) {
    const d = new Date(filing.date_of_incorporation);
    if (!isNaN(d.getTime()) && String(d.getUTCFullYear()) === taxYear) {
      return { label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`, year: taxYear };
    }
  }
  // 2. Explicit tax_period_begin stored on the filing
  if (filing.tax_period_begin) {
    const [yearStr, monthStr, dayStr] = filing.tax_period_begin.split('-');
    const month = parseInt(monthStr, 10);
    const day   = parseInt(dayStr, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { label: `${MONTH_NAMES[month - 1]} ${day}`, year: yearStr };
    }
  }
  // 3. Default — January 1
  return { label: 'January 1', year: taxYear };
}

function resolvePeriodEnd(
  filing: Filing,
  taxYear: string
): { label: string; year: string } {
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
  capital_contribution: number;
  distribution: number;
  formation_costs: number;
  property_transfer: number;
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
        t.borrowed_end += amt; t.hasPartIV = true; break;
      case 'loan_from_llc':
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
      case 'other':
        dir === 'paid' ? (t.other_paid += amt) : (t.other_received += amt);
        t.hasPartIV = true; break;
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
  // fontSize 8 — smaller than the default causes pdf-lib to position the
  // text baseline lower within the field widget, matching the vertical
  // placement seen when filling manually in Adobe / IRS viewer.
  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);
  setText(doc, F5472.TAX_YEAR_BEGIN,      begin.label, 8);
  setText(doc, F5472.TAX_YEAR_BEGIN_YEAR, begin.year,  8);
  setText(doc, F5472.TAX_YEAR_END,        end.label,   8);
  setText(doc, F5472.TAX_YEAR_END_YEAR,   end.year,    8);

  // ── Part I — Reporting Corporation
  setText(doc, F5472.CORP_NAME,           filing.llc_name ?? '');
  setText(doc, F5472.CORP_ADDRESS,        fmtStreet(filing.mailing_address));
  setText(doc, F5472.CORP_EIN,            fmtEin(filing.ein));
  setText(doc, F5472.CORP_CITY_STATE_ZIP, fmtCityStateZip(filing.mailing_address));
  setText(doc, F5472.CORP_TOTAL_ASSETS,   fmt(filing.total_assets));
  // Business activity: fontSize 10 to match manual fill appearance
  setText(doc, F5472.CORP_ACTIVITY,       filing.naics_description ?? '', 10);
  setText(doc, F5472.CORP_ACTIVITY_CODE,  filing.naics_code ? String(filing.naics_code) : '', 9);

  const grossTotal = txn.total_received + txn.total_paid +
    txn.capital_contribution + txn.distribution +
    txn.formation_costs + txn.property_transfer;
  setText(doc, F5472.CORP_GROSS_PAYMENTS, fmt(grossTotal));
  setText(doc, F5472.CORP_NUM_FORMS,      '1');
  setText(doc, F5472.CORP_GROSS_ALL,      fmt(grossTotal));

  setCheck(doc, F5472.CONSOLIDATED_FILING, false);
  setCheck(doc, F5472.INITIAL_RETURN_YES,  isInitial);
  setText(doc,  F5472.PARTS_VIII_COUNT,   '0');

  setText(doc, F5472.CORP_COUNTRY_OF_INC,           'United States');
  setText(doc, F5472.CORP_DATE_OF_INCORPORATION,    fmtDate(filing.date_of_incorporation));
  setText(doc, F5472.CORP_RESIDENT_COUNTRY,         'United States');
  setText(doc, F5472.CORP_COUNTRY_BUSINESS,
    filing.mailing_address?.country ?? 'United States');

  setCheck(doc, F5472.FOREIGN_OWNS_50PCT,       true);
  setCheck(doc, F5472.CORP_IS_FOREIGN_OWNED_DE, true);

  // ── Part II — 25% Foreign Shareholder (row 4)
  setText(doc, F5472.SHAREHOLDER_NAME,                filing.owner_full_name ?? '');
  setText(doc, F5472.SHAREHOLDER_US_TIN,              filing.owner_us_tin ?? '');
  setText(doc, F5472.SHAREHOLDER_REFERENCE_ID,        filing.owner_reference_id ?? '');
  setText(doc, F5472.SHAREHOLDER_FOREIGN_TIN,         filing.owner_foreign_tax_id ?? '');
  setText(doc, F5472.SHAREHOLDER_COUNTRY_BUSINESS,    filing.owner_country_citizenship ?? '');
  setText(doc, F5472.SHAREHOLDER_COUNTRY_CITIZENSHIP, filing.owner_country_citizenship ?? '');
  setText(doc, F5472.SHAREHOLDER_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // ── Part III — Related Party
  setCheck(doc, F5472.RP_IS_FOREIGN_PERSON,      true);
  setCheck(doc, F5472.RP_IS_US_PERSON,           false);
  setText(doc,  F5472.RP_NAME,                   filing.owner_full_name ?? '');
  setText(doc,  F5472.RP_US_TIN,                 filing.owner_us_tin ?? '');
  setText(doc,  F5472.RP_REFERENCE_ID,           filing.owner_reference_id ?? '');
  setText(doc,  F5472.RP_FOREIGN_TIN,            filing.owner_foreign_tax_id ?? '');
  // Business activity: fontSize 10 to match manual fill appearance
  setText(doc,  F5472.RP_ACTIVITY,               filing.owner_business_activity ?? filing.naics_description ?? '', 10);
  setText(doc,  F5472.RP_ACTIVITY_CODE,          filing.naics_code ? String(filing.naics_code) : '', 9);

  setCheck(doc, F5472.RP_RELATED_TO_CORP,        false);
  setCheck(doc, F5472.RP_RELATED_TO_SHAREHOLDER, false);
  setCheck(doc, F5472.RP_IS_25PCT_SHAREHOLDER,   true);

  setText(doc, F5472.RP_COUNTRY_BUSINESS,
    filing.owner_country_citizenship ?? filing.owner_country_residence ?? '');
  setText(doc, F5472.RP_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // ── Part IV — Monetary Transactions
  if (txn.hasPartIV) {
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

  // ── Part V / VI checkboxes
  // Part VI is always checked for a foreign-owned single-member LLC whose
  // foreign owner provides uncompensated management services — the standard
  // fact pattern for this app's filer base.
  setCheck(doc, F5472.PART_V_CHECKBOX,  txn.hasPartV);
  setCheck(doc, F5472.PART_VI_CHECKBOX, true);

  // Update field appearances before flattening so text renders at the
  // correct vertical position (matching manual fill / IRS viewer output).
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  doc.getForm().updateFieldAppearances(helvetica);

  doc.getForm().flatten();
  return doc.save();
}

// ─── Pro Forma Form 1120 (page 1 only) filler ────────────────────────────────
//
// Verified field names (17 fields total):
//   CorporateName, AddressLine1, City, State, Country, Zipcode, EIN
//   Initial Return, FinalReturn, NameChange, AddressChange
//   Signature  — owner_full_name (auto-filled at generation time)
//   Date       — today's date (MM/DD/YYYY), filled automatically at generation time
//   Title      — filing.signer_title if set, otherwise defaults to "Owner"
//   BeginningDate — month+day only (e.g. "January 1"); year auto-filled by form
//   EndingDate    — e.g. "December 31"
//   EndingYear    — last 2 digits only (e.g. "25"); form pre-prints "20"

export async function fillProForma1120(filing: Filing): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(FORM_1120_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  const set = (name: string, val: string, fs?: number) => setText(doc, name, val, fs);
  const chk = (name: string, val: boolean) => setCheck(doc, name, val);

  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);

  // ── Tax year header
  // fontSize 8 — positions text lower in the field widget bounding box,
  // matching the vertical placement seen when filling manually.
  set('BeginningDate', begin.label,           8); // e.g. "January 1" or "March 15"
  set('EndingDate',    end.label,             8); // e.g. "December 31"
  set('EndingYear',    end.year.slice(-2),    8); // last 2 digits: "2025" → "25"

  // ── Corp identity
  set('CorporateName', filing.llc_name ?? '');
  set('EIN',           fmtEin(filing.ein));
  set('AddressLine1',  fmtStreet(filing.mailing_address));
  set('City',          filing.mailing_address?.city ?? '');
  set('State',         filing.mailing_address?.region ?? '');
  set('Country',       '');
  set('Zipcode',       filing.mailing_address?.postal_code ?? '');

  // ── Box E checkboxes
  const isFinal = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getUTCFullYear()) === taxYear
  );
  const isInitial = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getUTCFullYear()) === taxYear
  );
  chk('Initial Return', isInitial);
  chk('FinalReturn',    isFinal);
  chk('NameChange',     filing.name_change    ?? false);
  chk('AddressChange',  filing.address_change ?? false);

  // ── Signature block
  set('Signature', filing.owner_full_name ?? '');
  set('Date',  todayFormatted());
  set('Title', filing.signer_title ?? 'Owner');

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  doc.getForm().updateFieldAppearances(helvetica);

  doc.getForm().flatten();
  return doc.save();
}

// ─── Combined Statements PDF (Part V + Part VI) ───────────────────────────────
//
// A single PDF containing:
//   Page 1: Part VI — Treas. Reg. § 1.6038A-2(b)(7)(ix) non-arm's length
//           service disclosure (always included for this app's filer type)
//   Page 2: Part V  — non-monetary transaction itemization
//           (only added when hasPartV is true)
//
// The IRS mailing address (Ogden, UT PIN Unit) is printed in the footer
// of the first page so filers know exactly where to send the package.

export async function generateStatementsPdf(
  filing: Filing,
  transactions: Transaction[]
): Promise<Uint8Array> {
  const txn = aggregateTransactions(transactions);
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  const pdfDoc = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── Shared drawing helpers ──────────────────────────────────────────────────

  function wrapText(
    text: string,
    fnt: typeof font,
    size: number,
    maxW: number
  ): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (fnt.widthOfTextAtSize(test, size) > maxW) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // ── PAGE 1: Part VI Statement ───────────────────────────────────────────────
  {
    const page = pdfDoc.addPage([612, 792]);
    const margin   = 72;
    const maxWidth = 612 - margin * 2;
    let y = 792 - margin;

    function drawLine(
      text: string,
      fnt: typeof font,
      size: number,
      indent = 0
    ): void {
      page.drawText(text, { x: margin + indent, y, size, font: fnt, color: rgb(0, 0, 0) });
      y -= size * 1.6;
    }

    function drawWrapped(
      text: string,
      fnt: typeof font,
      size: number,
      indent = 0
    ): void {
      const lines = wrapText(text, fnt, size, maxWidth - indent);
      for (const line of lines) drawLine(line, fnt, size, indent);
      y -= size * 0.4;
    }

    function drawDivider(): void {
      y -= 6;
      page.drawLine({
        start: { x: margin, y },
        end:   { x: 612 - margin, y },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
      });
      y -= 10;
    }

    // Header
    drawLine('ATTACHMENT TO FORM 5472 — PART VI STATEMENT', boldFont, 10);
    drawLine('Disclosure of Non-Arm\'s Length Service Transaction', boldFont, 10);
    drawLine('Treas. Reg. § 1.6038A-2(b)(7)(ix)', font, 9);
    drawDivider();

    // Filer block
    drawLine(`Tax Year:                ${taxYear}`, font, 10);
    drawLine(`Reporting Corporation:   ${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`, font, 10);
    drawLine(`Foreign Related Party:   ${filing.owner_full_name ?? ''}`, font, 10);
    drawDivider();

    // Body
    drawWrapped(
      'This statement is submitted pursuant to Treasury Regulation ' +
      '§ 1.6038A-2(b)(7)(ix) in connection with Form 5472 for the above-referenced ' +
      'tax year.',
      font, 10
    );

    drawWrapped(
      'During the tax year, the foreign related party identified above served as the ' +
      'sole member-manager of the reporting corporation, a foreign-owned U.S. ' +
      'disregarded entity. In that capacity, the foreign related party provided ' +
      'general management, administrative, and oversight services to the reporting ' +
      'corporation.',
      font, 10
    );

    drawWrapped(
      'These services were provided without monetary compensation. No payments were ' +
      'made or received by either party in connection with such services during the ' +
      'tax year.',
      font, 10
    );

    drawWrapped(
      'The fair market value of these services is not determinable because they ' +
      'were rendered solely in the capacity of member-manager and are inseparable ' +
      'from the ownership interest itself. No arm\'s length price exists for the ' +
      'services as described.',
      font, 10
    );

    drawWrapped(
      'Accordingly, this transaction is reported as a non-monetary, non-arm\'s ' +
      'length transaction with no determinable fair market value, consistent with ' +
      'Treas. Reg. § 1.6038A-2(b)(7)(ix).',
      font, 10
    );

    drawDivider();

    // Signature line — owner name and date only; no "Prepared by:" label
    y -= 18;
    page.drawLine({
      start: { x: margin, y },
      end:   { x: margin + 220, y },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });
    y -= 14;
    drawLine(`${filing.owner_full_name ?? ''}  —  Date: ${todayFormatted()}`, font, 9);

    // IRS mailing address footer
    const footerY = margin - 18;
    page.drawLine({
      start: { x: margin, y: footerY + 14 },
      end:   { x: 612 - margin, y: footerY + 14 },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
    page.drawText('Mail completed package to:', {
      x: margin, y: footerY,
      size: 8, font: boldFont, color: rgb(0.3, 0.3, 0.3),
    });
    let fy = footerY - 11;
    for (const line of IRS_MAILING_ADDRESS) {
      page.drawText(line, { x: margin, y: fy, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
      fy -= 11;
    }
  }

  // ── PAGE 2: Part V Statement (only if there are Part V transactions) ─────────
  if (txn.hasPartV) {
    const page = pdfDoc.addPage([612, 792]);
    const margin   = 72;
    const maxWidth = 612 - margin * 2;
    let y = 792 - margin;

    function drawLine(
      text: string,
      fnt: typeof font,
      size: number,
      indent = 0
    ): void {
      page.drawText(text, { x: margin + indent, y, size, font: fnt, color: rgb(0, 0, 0) });
      y -= size * 1.6;
    }

    function drawWrapped(
      text: string,
      fnt: typeof font,
      size: number,
      indent = 0
    ): void {
      const lines = wrapText(text, fnt, size, maxWidth - indent);
      for (const line of lines) drawLine(line, fnt, size, indent);
      y -= size * 0.4;
    }

    function drawDivider(): void {
      y -= 6;
      page.drawLine({
        start: { x: margin, y },
        end:   { x: 612 - margin, y },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
      });
      y -= 10;
    }

    // Header
    drawLine('ATTACHMENT TO FORM 5472 — PART V STATEMENT', boldFont, 10);
    drawLine('Non-Monetary and Less-Than-Arm\'s-Length Transactions', boldFont, 10);
    drawDivider();

    // Filer block
    drawLine(`Tax Year:                ${taxYear}`, font, 10);
    drawLine(`Reporting Corporation:   ${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`, font, 10);
    drawLine(`Foreign Owner:           ${filing.owner_full_name ?? ''}`, font, 10);
    drawDivider();

    // Intro
    drawWrapped(
      'The following non-monetary or less-than-arm\'s-length transactions occurred ' +
      'between the foreign-owned U.S. disregarded entity and its foreign owner ' +
      'during the tax year, reported pursuant to Treas. Reg. § 1.6038A-2(b)(7):',
      font, 10
    );
    y -= 4;

    // Transaction lines
    if (txn.capital_contribution > 0)
      drawLine(`Capital contributions made by owner to LLC:        $${fmt(txn.capital_contribution)}`, font, 10, 12);
    if (txn.distribution > 0)
      drawLine(`Distributions made by LLC to owner:                $${fmt(txn.distribution)}`, font, 10, 12);
    if (txn.formation_costs > 0)
      drawLine(`Formation/organization costs paid by owner:        $${fmt(txn.formation_costs)}`, font, 10, 12);
    if (txn.property_transfer > 0)
      drawLine(`Property transferred to/from LLC (FMV):           $${fmt(txn.property_transfer)}`, font, 10, 12);

    drawDivider();
    drawWrapped(
      'All amounts are in U.S. dollars. These transactions are reported pursuant ' +
      'to Treas. Reg. § 1.6038A-2(b)(7).',
      font, 9
    );
  }

  return pdfDoc.save();
}

// ─── Cover Letter ──────────────────────────────────────────────────────────────
//
// A professional cover letter addressed to the IRS, identifying the filing
// package contents and the enclosures. Always the first page in the package.

export async function generateCoverLetter(filing: Filing): Promise<Uint8Array> {
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);
  const pdfDoc  = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page   = pdfDoc.addPage([612, 792]);
  const margin  = 72;
  let y = 792 - margin;

  function drawLine(
    text: string,
    fnt: typeof font,
    size: number,
    indent = 0
  ): void {
    page.drawText(text, { x: margin + indent, y, size, font: fnt, color: rgb(0, 0, 0) });
    y -= size * 1.6;
  }

  function drawBlank(lines = 1, size = 10): void {
    y -= size * 1.6 * lines;
  }

  // ── Sender block (top-left)
  drawLine(filing.llc_name ?? 'LLC Name', boldFont, 10);
  if (filing.mailing_address) {
    const street = fmtStreet(filing.mailing_address);
    const cityLine = fmtCityStateZip(filing.mailing_address);
    if (street)   drawLine(street, font, 10);
    if (cityLine) drawLine(cityLine, font, 10);
  }
  drawBlank(1);
  drawLine(todayFormatted(), font, 10);
  drawBlank(2);

  // ── Recipient block
  drawLine('Internal Revenue Service', font, 10);
  for (const line of IRS_MAILING_ADDRESS.slice(1)) {
    drawLine(line, font, 10);
  }
  drawBlank(2);

  // ── Re: line
  drawLine(
    `Re:  Form 5472 Filing Package — Tax Year ${taxYear}`,
    boldFont, 10
  );
  drawLine(
    `     ${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`,
    font, 10
  );
  drawBlank(1);

  // ── Salutation
  drawLine('To Whom It May Concern:', font, 10);
  drawBlank(1);

  // ── Body
  const maxWidth = 612 - margin * 2;
  function drawWrapped(text: string, fnt: typeof font, size: number, indent = 0): void {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (fnt.widthOfTextAtSize(test, size) > maxWidth - indent) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    for (const line of lines) drawLine(line, fnt, size, indent);
    y -= size * 0.4;
  }

  drawWrapped(
    `Please find enclosed the Form 5472 filing package for the above-referenced ` +
    `foreign-owned U.S. disregarded entity for the tax year ending December 31, ${taxYear}. ` +
    `This package is submitted pursuant to IRC § 6038A and the accompanying regulations.`,
    font, 10
  );
  drawBlank(1);

  // ── Enclosures
  drawLine('Enclosed:', boldFont, 10);
  drawBlank(0.5, 10);
  drawLine('1.  Pro Forma Form 1120 (cover return)', font, 10, 12);
  drawLine('2.  Form 5472 — Information Return of a 25% Foreign-Owned U.S. Corporation', font, 10, 12);
  drawLine('3.  Part VI Statement — Treas. Reg. § 1.6038A-2(b)(7)(ix)', font, 10, 12);
  drawLine('4.  Part V Statement (if applicable) — Non-Monetary Transactions', font, 10, 12);
  drawBlank(2);

  drawWrapped(
    'Please do not hesitate to contact the undersigned if additional information is required.',
    font, 10
  );
  drawBlank(3);

  // ── Signature block
  page.drawLine({
    start: { x: margin, y },
    end:   { x: margin + 200, y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  y -= 14;
  drawLine(filing.owner_full_name ?? '', font, 10);
  drawLine(filing.signer_title ?? 'Owner', font, 10);
  drawLine(filing.llc_name ?? '', font, 10);

  return pdfDoc.save();
}

// ─── Filing Instructions page ─────────────────────────────────────────────────
//
// Included ONLY when filing.include_irs_fax === false.
// Provides step-by-step mailing instructions for the paper filing package.

export async function generateFilingInstructions(
  filing: Filing
): Promise<Uint8Array> {
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);
  const pdfDoc  = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page   = pdfDoc.addPage([612, 792]);
  const margin  = 72;
  const maxWidth = 612 - margin * 2;
  let y = 792 - margin;

  function drawLine(
    text: string,
    fnt: typeof font,
    size: number,
    indent = 0
  ): void {
    page.drawText(text, { x: margin + indent, y, size, font: fnt, color: rgb(0, 0, 0) });
    y -= size * 1.6;
  }

  function drawWrapped(text: string, fnt: typeof font, size: number, indent = 0): void {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (fnt.widthOfTextAtSize(test, size) > maxWidth - indent) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    for (const line of lines) drawLine(line, fnt, size, indent);
    y -= size * 0.4;
  }

  function drawBlank(lines = 1, size = 10): void {
    y -= size * 1.6 * lines;
  }

  function drawDivider(): void {
    y -= 6;
    page.drawLine({
      start: { x: margin, y },
      end:   { x: 612 - margin, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= 10;
  }

  // ── Title
  drawLine('FILING INSTRUCTIONS', boldFont, 12);
  drawLine(`Form 5472 Package — Tax Year ${taxYear}`, font, 10);
  drawLine(`${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`, font, 10);
  drawDivider();

  // ── Step 1
  drawLine('Step 1 — Assemble the Package', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    'Print all documents in this package single-sided on standard 8.5 × 11\" white paper. ' +
    'Arrange the pages in the following order:',
    font, 10
  );
  drawLine('1.  This cover letter', font, 10, 12);
  drawLine('2.  These filing instructions', font, 10, 12);
  drawLine('3.  Pro Forma Form 1120 (page 1 only)', font, 10, 12);
  drawLine('4.  Form 5472 (all pages)', font, 10, 12);
  drawLine('5.  Part VI Statement (attachment to Form 5472)', font, 10, 12);
  drawLine('6.  Part V Statement, if applicable', font, 10, 12);
  drawBlank(1);

  // ── Step 2
  drawLine('Step 2 — Review Before Signing', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    'Verify all fields on Form 5472 and the Pro Forma 1120 are complete and accurate. ' +
    'Sign and date the Pro Forma 1120 signature block. Do NOT sign Form 5472 separately — ' +
    'it is attached to and filed with the Pro Forma 1120.',
    font, 10
  );
  drawBlank(1);

  // ── Step 3
  drawLine('Step 3 — Mail the Package', boldFont, 10);
  drawBlank(0.5);
  drawWrapped('Send the complete package by U.S. Mail or private delivery service to:', font, 10);
  drawBlank(0.5);
  for (const line of IRS_MAILING_ADDRESS) {
    drawLine(line, boldFont, 10, 12);
  }
  drawBlank(1);
  drawWrapped(
    'We strongly recommend using certified mail (USPS) or an IRS-approved private delivery ' +
    'service (FedEx, UPS, DHL) so you have proof of timely filing.',
    font, 10
  );
  drawBlank(1);

  // ── Due Date
  drawLine('Due Date', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    `The filing deadline is April 15, ${Number(taxYear) + 1} (or October 15, ${Number(taxYear) + 1} ` +
    'if a timely Form 7004 extension was filed). Late filing carries a $25,000 penalty per form ' +
    'under IRC § 6038A(d).',
    font, 10
  );
  drawBlank(1);

  drawDivider();

  // ── Penalty notice
  drawWrapped(
    'IMPORTANT: Failure to timely file or include required information on Form 5472 may result ' +
    'in a $25,000 penalty per form per tax year, with continuation penalties of $25,000 for each ' +
    '30-day period the failure continues after IRS notification.',
    boldFont, 9
  );

  return pdfDoc.save();
}

// ─── Package generator ────────────────────────────────────────────────────────
//
// Generates a SINGLE combined PDF in the correct page order:
//   Page 1:      Cover Letter
//   Page 2:      Filing Instructions (ONLY if include_irs_fax === false)
//   Page 3(+):   Pro Forma Form 1120 (1 page)
//   Next pages:  Form 5472 (3 pages)
//   Final pages: Statements (Part VI always; Part V if applicable)

export interface FilingPackage {
  /**
   * Combined single PDF with all pages in the correct order.
   * Always contains: cover letter, pro forma 1120, form 5472, statements.
   * Filing instructions page is included only when include_irs_fax === false.
   */
  combinedPdfBytes: Uint8Array;
  /** Individual PDFs retained for backward compatibility / separate downloads */
  form5472Bytes: Uint8Array;
  proForma1120Bytes: Uint8Array;
  statementsPdfBytes: Uint8Array;
  coverLetterBytes: Uint8Array;
  filingInstructionsBytes: Uint8Array | null;
  hasPartV: boolean;
  hasPartVI: true;
}

export async function generateFilingPackage(
  filing: Filing,
  transactions: Transaction[]
): Promise<FilingPackage> {
  const includeFax = filing.include_irs_fax === true;

  // Generate all components in parallel
  const [
    form5472Bytes,
    proForma1120Bytes,
    statementsPdfBytes,
    coverLetterBytes,
    filingInstructionsBytes,
  ] = await Promise.all([
    fillForm5472(filing, transactions),
    fillProForma1120(filing),
    generateStatementsPdf(filing, transactions),
    generateCoverLetter(filing),
    includeFax ? Promise.resolve(null) : generateFilingInstructions(filing),
  ]);

  // ── Assemble combined PDF in the correct page order ──────────────────────────
  const combined = await PDFDocument.create();

  async function appendPdf(srcBytes: Uint8Array): Promise<void> {
    const src = await PDFDocument.load(srcBytes);
    const pages = await combined.copyPages(src, src.getPageIndices());
    for (const page of pages) combined.addPage(page);
  }

  // 1. Cover letter (always)
  await appendPdf(coverLetterBytes);

  // 2. Filing instructions (only when NOT faxing)
  if (filingInstructionsBytes) {
    await appendPdf(filingInstructionsBytes);
  }

  // 3. Pro Forma 1120
  await appendPdf(proForma1120Bytes);

  // 4. Form 5472
  await appendPdf(form5472Bytes);

  // 5. Statements (Part VI always; Part V appended inside generateStatementsPdf when applicable)
  await appendPdf(statementsPdfBytes);

  const combinedPdfBytes = await combined.save();

  const txn = aggregateTransactions(transactions);
  return {
    combinedPdfBytes,
    form5472Bytes,
    proForma1120Bytes,
    statementsPdfBytes,
    coverLetterBytes,
    filingInstructionsBytes,
    hasPartV: txn.hasPartV,
    hasPartVI: true,
  };
}
