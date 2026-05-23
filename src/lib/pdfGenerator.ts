/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * Field names are sourced from form5472Fields.ts, extracted
 * directly from the live IRS PDF AcroForm widget layer.
 *
 * Flow:
 *   1. Fetch the IRS PDF bytes (cached in memory after first load)
 *   2. Load into pdf-lib and get the AcroForm
 *   3. Fill text + checkbox fields using the F5472 field map
 *   4. Flatten (optional) and return Uint8Array
 *   5. Caller bundles into a ZIP with jszip
 */

import { PDFDocument, PDFCheckBox, PDFTextField } from 'pdf-lib';
import { F5472 } from './form5472Fields';
import type { Filing, Transaction } from './supabase';

// ─── IRS PDF URLs ────────────────────────────────────────────
const IRS_FORM_5472_URL = 'https://www.irs.gov/pub/irs-pdf/f5472.pdf';
const IRS_FORM_1120_URL = 'https://www.irs.gov/pub/irs-pdf/f1120.pdf';

// Simple in-memory cache so we don't re-fetch on every generation
const pdfCache: Record<string, ArrayBuffer> = {};

async function fetchPdfBytes(url: string): Promise<ArrayBuffer> {
  if (pdfCache[url]) return pdfCache[url];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF from ${url}: ${res.status}`);
  const bytes = await res.arrayBuffer();
  pdfCache[url] = bytes;
  return bytes;
}

// ─── Helpers ─────────────────────────────────────────────────

function setText(doc: PDFDocument, fieldName: string, value: string | null | undefined) {
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFTextField) {
      field.setText(value ?? '');
    }
  } catch {
    // Field not found — skip silently (form version mismatch)
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

/** Format a date string or Date as MM/DD/YYYY */
function fmtDate(val: string | null | undefined): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Split an ISO date (YYYY-MM-DD) into the two values the Form 5472
 * header needs:
 *   label  — month + day in long form, e.g. 'January 1' or 'March 15'
 *   year   — four-digit year string, e.g. '2024'
 *
 * Fallback behaviour when no date is stored:
 *   - tax_period_begin falls back to January 1 of tax_year
 *   - tax_period_end   falls back to December 31 of tax_year
 *
 * This keeps existing calendar-year filings working automatically
 * while allowing fiscal-year LLCs to supply their exact dates.
 */
function splitPeriodDate(
  isoDate: string | null | undefined,
  fallbackMonth: number,  // 1-based
  fallbackDay: number,
  fallbackYear: string
): { label: string; year: string } {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  if (isoDate) {
    // Parse as local date to avoid UTC midnight offset shifting the day
    const [yearStr, monthStr, dayStr] = isoDate.split('-');
    const month = parseInt(monthStr, 10);  // 1-based
    const day   = parseInt(dayStr, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        label: `${MONTH_NAMES[month - 1]} ${day}`,
        year:  yearStr,
      };
    }
  }

  // Fallback: infer from tax_year
  return {
    label: `${MONTH_NAMES[fallbackMonth - 1]} ${fallbackDay}`,
    year:  fallbackYear,
  };
}

// ─── Transaction aggregator ───────────────────────────────────

interface TxnTotals {
  sales_received: number;
  purchases_paid: number;
  services_rendered: number;
  services_received: number;
  rents_received: number;
  rents_paid: number;
  borrowed: number;
  loaned: number;
  interest_paid: number;
  interest_received: number;
  insurance_paid: number;
  insurance_received: number;
  dividends_paid: number;
  dividends_received: number;
  commission_paid: number;
  commission_received: number;
  intangible_paid: number;
  intangible_received: number;
  other_paid: number;
  other_received: number;
  other_desc: string;
  // Part V (DE-specific)
  capital_contribution: number;
  distribution: number;
  formation_costs: number;
  property_transfer: number;
  hasPartIV: boolean;
  hasPartV: boolean;
}

function aggregateTransactions(txns: Transaction[]): TxnTotals {
  const t: TxnTotals = {
    sales_received: 0, purchases_paid: 0,
    services_rendered: 0, services_received: 0,
    rents_received: 0, rents_paid: 0,
    borrowed: 0, loaned: 0,
    interest_paid: 0, interest_received: 0,
    insurance_paid: 0, insurance_received: 0,
    dividends_paid: 0, dividends_received: 0,
    commission_paid: 0, commission_received: 0,
    intangible_paid: 0, intangible_received: 0,
    other_paid: 0, other_received: 0, other_desc: '',
    capital_contribution: 0, distribution: 0,
    formation_costs: 0, property_transfer: 0,
    hasPartIV: false, hasPartV: false,
  };

  for (const tx of txns) {
    const amt = tx.amount_usd ?? 0;
    const dir = tx.direction; // 'received' | 'paid'

    switch (tx.transaction_type) {
      case 'sales':
        dir === 'received' ? (t.sales_received += amt) : (t.purchases_paid += amt);
        t.hasPartIV = true; break;
      case 'service_payment':
        dir === 'received' ? (t.services_rendered += amt) : (t.services_received += amt);
        t.hasPartIV = true; break;
      case 'rent_royalty':
        dir === 'received' ? (t.rents_received += amt) : (t.rents_paid += amt);
        t.hasPartIV = true; break;
      case 'loan_to_llc':
        t.borrowed += amt; t.hasPartIV = true; break;
      case 'loan_from_llc':
        t.loaned += amt; t.hasPartIV = true; break;
      case 'interest':
        dir === 'paid' ? (t.interest_paid += amt) : (t.interest_received += amt);
        t.hasPartIV = true; break;
      case 'insurance':
        dir === 'paid' ? (t.insurance_paid += amt) : (t.insurance_received += amt);
        t.hasPartIV = true; break;
      case 'dividend':
        dir === 'paid' ? (t.dividends_paid += amt) : (t.dividends_received += amt);
        t.hasPartIV = true; break;
      case 'commission':
        dir === 'paid' ? (t.commission_paid += amt) : (t.commission_received += amt);
        t.hasPartIV = true; break;
      case 'intangible':
        dir === 'paid' ? (t.intangible_paid += amt) : (t.intangible_received += amt);
        t.hasPartIV = true; break;
      case 'other':
        dir === 'paid' ? (t.other_paid += amt) : (t.other_received += amt);
        if (tx.description && !t.other_desc) t.other_desc = tx.description;
        t.hasPartIV = true; break;
      // Part V — DE-specific
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
  return t;
}

// ─── Form 5472 filler ─────────────────────────────────────────

export async function fillForm5472(
  filing: Filing,
  transactions: Transaction[]
): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(IRS_FORM_5472_URL);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const txn = aggregateTransactions(transactions);
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  // ── Header — Tax Period ────────────────────────────────────
  // Form 5472 has four header fields:
  //   f1_1: begin month+day label  (e.g. 'January 1' or 'April 1')
  //   f1_2: begin year             (e.g. '2024')
  //   f1_3: end month+day label    (e.g. 'December 31' or 'March 31')
  //   f1_4: end year               (e.g. '2024' or '2025')
  //
  // Values come from filing.tax_period_begin and filing.tax_period_end
  // (ISO dates collected from the user). Falls back to Jan 1 / Dec 31
  // of tax_year if those fields are not yet populated, so existing
  // calendar-year filings continue to work without re-entry.
  const begin = splitPeriodDate(filing.tax_period_begin, 1,  1,  taxYear);
  const end   = splitPeriodDate(filing.tax_period_end,   12, 31, taxYear);

  setText(doc, F5472.TAX_YEAR_BEGIN,      begin.label);
  setText(doc, F5472.TAX_YEAR_BEGIN_YEAR, begin.year);
  setText(doc, F5472.TAX_YEAR_END,        end.label);
  setText(doc, F5472.TAX_YEAR_END_YEAR,   end.year);

  // ── Part I — Reporting Corporation ────────────────────────
  setText(doc, F5472.CORP_NAME, filing.llc_name ?? '');
  setText(doc, F5472.CORP_ADDRESS, filing.mailing_address ?? '');
  setText(doc, F5472.CORP_CITY_STATE_ZIP,
    [filing.city, filing.state, filing.zip_code].filter(Boolean).join(', '));
  setText(doc, F5472.CORP_EIN, fmtEin(filing.ein));
  setText(doc, F5472.CORP_TOTAL_ASSETS, fmt(filing.total_assets));
  setText(doc, F5472.CORP_ACTIVITY, filing.naics_description ?? '');
  setText(doc, F5472.CORP_NAICS, filing.naics_code ?? '');
  setText(doc, F5472.CORP_STATE_OF_FORMATION, filing.state_of_formation ?? '');
  setText(doc, F5472.CORP_NUM_FORMS, '1');
  setText(doc, F5472.CORP_DATE_OF_INCORPORATION, fmtDate(filing.date_of_incorporation));

  // Initial / Final return checkboxes
  setCheck(doc, F5472.INITIAL_RETURN_YES, filing.initial_return === true);
  if (filing.initial_return) {
    setText(doc, F5472.INITIAL_RETURN_YEAR, taxYear);
  }
  // Final return: auto-derive when date_of_closure falls in tax year
  const isFinal = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getFullYear()) === taxYear
  );
  setCheck(doc, F5472.FINAL_RETURN_YES, isFinal);

  // Related party is foreign person (always true for our use case)
  setCheck(doc, F5472.RELATED_PARTY_IS_FOREIGN, true);

  // ── Part II — 25% Foreign Shareholder (direct, slot 4) ────
  setText(doc, F5472.SHAREHOLDER_NAME, filing.owner_full_name ?? '');
  setText(doc, F5472.SHAREHOLDER_ADDRESS, filing.owner_address ?? '');
  setText(doc, F5472.SHAREHOLDER_CITY_STATE_ZIP,
    [filing.owner_city, filing.owner_country_citizenship].filter(Boolean).join(', '));
  setText(doc, F5472.SHAREHOLDER_COUNTRY_CITIZENSHIP, filing.owner_country_citizenship ?? '');
  setText(doc, F5472.SHAREHOLDER_COUNTRY_RESIDENCE, filing.owner_country_residence ?? '');
  setText(doc, F5472.SHAREHOLDER_US_TIN, filing.owner_us_tin ?? '');
  setText(doc, F5472.SHAREHOLDER_REFERENCE_ID, filing.owner_reference_id ?? '');
  setText(doc, F5472.SHAREHOLDER_FOREIGN_TIN, filing.owner_foreign_tax_id ?? '');

  // ── Part II — Ultimate indirect shareholder (slot 6) ──────
  // For a single-member DE the direct owner IS the ultimate indirect
  // owner — fill slot 6 with the same data as slot 4.
  setText(doc, F5472.ULTIMATE_SHAREHOLDER_NAME, filing.owner_full_name ?? '');
  setText(doc, F5472.ULTIMATE_SHAREHOLDER_US_TIN, filing.owner_us_tin ?? '');
  setText(doc, F5472.ULTIMATE_SHAREHOLDER_REFERENCE_ID, filing.owner_reference_id ?? '');
  setText(doc, F5472.ULTIMATE_SHAREHOLDER_FOREIGN_TIN, filing.owner_foreign_tax_id ?? '');
  setText(doc, F5472.ULTIMATE_SHAREHOLDER_PRIMARY_COUNTRY, filing.owner_primary_country ?? '');
  setText(doc, F5472.ULTIMATE_SHAREHOLDER_CITIZENSHIP, filing.owner_country_citizenship ?? '');
  setText(doc, F5472.ULTIMATE_SHAREHOLDER_RESIDENCE, filing.owner_country_residence ?? '');

  // ── Part III — Related Party (mirrors Part II for single-member DE)
  setText(doc, F5472.RELATED_PARTY_NAME, filing.owner_full_name ?? '');
  setText(doc, F5472.RELATED_PARTY_COUNTRY, filing.owner_primary_country ?? filing.owner_country_citizenship ?? '');
  setText(doc, F5472.RELATED_PARTY_US_TIN, filing.owner_us_tin ?? '');
  setText(doc, F5472.RELATED_PARTY_REFERENCE_ID, filing.owner_reference_id ?? '');
  setText(doc, F5472.RELATED_PARTY_FOREIGN_TIN, filing.owner_foreign_tax_id ?? '');

  // Page 2 Part III continuation
  setText(doc, F5472.RP2_NAME, filing.owner_full_name ?? '');
  setText(doc, F5472.RP2_US_TIN, filing.owner_us_tin ?? '');
  setText(doc, F5472.RP2_REFERENCE_ID, filing.owner_reference_id ?? '');
  setText(doc, F5472.RP2_FOREIGN_TIN, filing.owner_foreign_tax_id ?? '');
  setText(doc, F5472.RP2_COUNTRY_RESIDENCE, filing.owner_country_residence ?? '');
  // Relationship: 25% foreign shareholder
  setCheck(doc, F5472.RP2_IS_25PCT_SHAREHOLDER, true);

  // ── Part IV — Monetary Transactions ───────────────────────
  setCheck(doc, F5472.PART_IV_APPLIES, txn.hasPartIV);
  if (txn.hasPartIV) {
    setText(doc, F5472.LINE_9_SALES_RECEIVED,         fmt(txn.sales_received));
    setText(doc, F5472.LINE_10_PURCHASES_PAID,         fmt(txn.purchases_paid));
    setText(doc, F5472.LINE_11_SERVICES_RENDERED,      fmt(txn.services_rendered));
    setText(doc, F5472.LINE_12_SERVICES_RECEIVED,      fmt(txn.services_received));
    setText(doc, F5472.LINE_13A_RENTS_RECEIVED,        fmt(txn.rents_received));
    setText(doc, F5472.LINE_13B_RENTS_PAID,            fmt(txn.rents_paid));
    setText(doc, F5472.LINE_14_BORROWED,               fmt(txn.borrowed));
    setText(doc, F5472.LINE_15_LOANED,                 fmt(txn.loaned));
    setText(doc, F5472.LINE_16_INTEREST_PAID,          fmt(txn.interest_paid));
    setText(doc, F5472.LINE_17A_INTEREST_RECEIVED,     fmt(txn.interest_received));
    setText(doc, F5472.LINE_18_INSURANCE_PAID,         fmt(txn.insurance_paid));
    setText(doc, F5472.LINE_19_INSURANCE_RECEIVED,     fmt(txn.insurance_received));
    setText(doc, F5472.LINE_20_DIVIDENDS_PAID,         fmt(txn.dividends_paid));
    setText(doc, F5472.LINE_21_DIVIDENDS_RECEIVED,     fmt(txn.dividends_received));
    setText(doc, F5472.LINE_22_COMMISSION_PAID,        fmt(txn.commission_paid));
    setText(doc, F5472.LINE_23_COMMISSION_RECEIVED,    fmt(txn.commission_received));
    setText(doc, F5472.LINE_24_INTANGIBLE_PAID,        fmt(txn.intangible_paid));
    setText(doc, F5472.LINE_25_INTANGIBLE_RECEIVED,    fmt(txn.intangible_received));
    setText(doc, F5472.LINE_26_OTHER_PAID,             fmt(txn.other_paid));
    setText(doc, F5472.LINE_27A_OTHER_RECEIVED,        fmt(txn.other_received));
    setText(doc, F5472.LINE_27B_OTHER_DESC,            txn.other_desc);
    // Totals
    const totalPaid = txn.purchases_paid + txn.services_received + txn.rents_paid +
      txn.borrowed + txn.interest_paid + txn.insurance_paid + txn.dividends_paid +
      txn.commission_paid + txn.intangible_paid + txn.other_paid;
    const totalReceived = txn.sales_received + txn.services_rendered + txn.rents_received +
      txn.loaned + txn.interest_received + txn.insurance_received + txn.dividends_received +
      txn.commission_received + txn.intangible_received + txn.other_received;
    setText(doc, F5472.LINE_28_TOTAL_PAID,     fmt(totalPaid));
    setText(doc, F5472.LINE_29_TOTAL_RECEIVED, fmt(totalReceived));
  }

  // ── Part V — DE-Specific Transactions ─────────────────────
  setCheck(doc, F5472.PART_V_APPLIES, txn.hasPartV);
  // Part V dollar amounts go on a separate attachment statement —
  // the PDF form only has the checkbox; dollar values are in the
  // attached statement generated by generatePartVStatement().

  // Flatten form fields so the PDF is print-ready and non-editable
  doc.getForm().flatten();

  return doc.save();
}

// ─── Pro Forma Form 1120 filler ───────────────────────────────

export async function fillProForma1120(filing: Filing): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(IRS_FORM_1120_URL);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  // Helper scoped to this doc
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

  // The Pro Forma 1120 uses the standard Form 1120 PDF with only
  // identifying information filled in — all income/deduction lines
  // are left blank per IRS instructions for foreign-owned DEs.
  //
  // Form 1120 field names (Rev. 2024):
  set('topmostSubform[0].Page1[0].f1_1[0]', filing.llc_name ?? '');
  set('topmostSubform[0].Page1[0].f1_2[0]', filing.mailing_address ?? '');
  set('topmostSubform[0].Page1[0].f1_3[0]',
    [filing.city, filing.state, filing.zip_code].filter(Boolean).join(', '));
  set('topmostSubform[0].Page1[0].f1_4[0]', fmtEin(filing.ein));

  // Tax period — use dynamic dates matching Form 5472 header logic
  const begin = splitPeriodDate(filing.tax_period_begin, 1,  1,  taxYear);
  const end   = splitPeriodDate(filing.tax_period_end,   12, 31, taxYear);
  set('topmostSubform[0].Page1[0].f1_5[0]', begin.year);
  set('topmostSubform[0].Page1[0].f1_6[0]', end.year);

  // Date incorporated (Item E)
  set('topmostSubform[0].Page1[0].f1_7[0]', fmtDate(filing.date_of_incorporation));
  // Total assets (Item D)
  set('topmostSubform[0].Page1[0].f1_8[0]', fmt(filing.total_assets));

  // Initial / Final return checkboxes on 1120
  chk('topmostSubform[0].Page1[0].c1_1[0]', filing.initial_return === true);
  const isFinal = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getFullYear()) === taxYear
  );
  chk('topmostSubform[0].Page1[0].c1_2[0]', isFinal);

  // All income/deduction/tax lines intentionally left blank
  // per IRS instructions for foreign-owned U.S. disregarded entities.

  form.flatten();
  return doc.save();
}

// ─── Part V Attachment Statement ─────────────────────────────

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
  lines.push('The following transactions occurred between the foreign-owned U.S.');
  lines.push('disregarded entity and its foreign owner during the tax year:');
  lines.push('');

  if (txn.capital_contribution > 0) {
    lines.push(`Capital contributions made by owner to LLC: $${fmt(txn.capital_contribution)}`);
  }
  if (txn.distribution > 0) {
    lines.push(`Distributions made by LLC to owner: $${fmt(txn.distribution)}`);
  }
  if (txn.formation_costs > 0) {
    lines.push(`Formation/organization costs paid on behalf of LLC: $${fmt(txn.formation_costs)}`);
  }
  if (txn.property_transfer > 0) {
    lines.push(`Property transferred to/from LLC: $${fmt(txn.property_transfer)}`);
  }

  lines.push('');
  lines.push('These transactions are reported pursuant to Reg. § 1.6038A-2(b)(7).');

  return lines.join('\n');
}

// ─── Package generator ───────────────────────────────────────

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
