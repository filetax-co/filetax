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

import { PDFDocument, PDFCheckBox, PDFTextField } from 'pdf-lib';
import { F5472 } from './form5472Fields';
import type { Filing, Transaction, Address } from './supabase';

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

function setText(doc: PDFDocument, fieldName: string, value: string | null | undefined) {
  if (!fieldName) return;
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFTextField) field.setText(value ?? '');
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
  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);
  setText(doc, F5472.TAX_YEAR_BEGIN,      begin.label);
  setText(doc, F5472.TAX_YEAR_BEGIN_YEAR, begin.year);
  setText(doc, F5472.TAX_YEAR_END,        end.label);
  setText(doc, F5472.TAX_YEAR_END_YEAR,   end.year);

  // ── Part I — Reporting Corporation
  setText(doc, F5472.CORP_NAME,           filing.llc_name ?? '');
  setText(doc, F5472.CORP_ADDRESS,        fmtStreet(filing.mailing_address));
  setText(doc, F5472.CORP_EIN,            fmtEin(filing.ein));
  setText(doc, F5472.CORP_CITY_STATE_ZIP, fmtCityStateZip(filing.mailing_address));
  setText(doc, F5472.CORP_TOTAL_ASSETS,   fmt(filing.total_assets));
  setText(doc, F5472.CORP_ACTIVITY,       filing.naics_description ?? '');
  setText(doc, F5472.CORP_ACTIVITY_CODE,  filing.naics_code ? String(filing.naics_code) : '');

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
  setText(doc,  F5472.RP_ACTIVITY,               filing.owner_business_activity ?? filing.naics_description ?? '');
  setText(doc,  F5472.RP_ACTIVITY_CODE,          filing.naics_code ? String(filing.naics_code) : '');

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
  setCheck(doc, F5472.PART_V_CHECKBOX,  txn.hasPartV);
  setCheck(doc, F5472.PART_VI_CHECKBOX, false);

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

  const set = (name: string, val: string) => setText(doc, name, val);
  const chk = (name: string, val: boolean) => setCheck(doc, name, val);

  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);

  // ── Tax year header
  // BeginningDate: month+day only — no year (form auto-fills / pre-prints year)
  set('BeginningDate', begin.label);                        // e.g. "January 1" or "March 15"
  set('EndingDate',    end.label);                          // e.g. "December 31"
  set('EndingYear',    end.year.slice(-2));                 // last 2 digits: "2025" → "25"

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
  // Signature: owner's full name — pre-filled at generation time
  set('Signature', filing.owner_full_name ?? '');
  // Date: today's date (the date the form is prepared/generated)
  set('Date',  todayFormatted());
  // Title: use signer_title if provided; default to "Owner"
  set('Title', filing.signer_title ?? 'Owner');

  doc.getForm().flatten();
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
