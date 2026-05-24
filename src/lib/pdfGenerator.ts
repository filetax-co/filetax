/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * PDFs are served from /pdf/ (public/pdf/) to avoid CORS.
 *
 * ── Form 5472 field notes ────────────────────────────────────────────────
 * 1c  = CORP_STATE_OF_FORMATION  → always 'Delaware' for our users
 * 1f  = gross payments on this return (Part V total when hasPartV)
 * 1g  = CORP_NUM_FORMS (f1_14)   → always '1' (one Form 5472 per related party)
 * 1h  = CORP_FORMS_COUNT (f1_17) → '1' (total forms filed with this 1120)
 * 1i  = INITIAL_RETURN_YES checkbox
 * 1k  = INITIAL_RETURN_YEAR text field
 * 1l  = CORP_DATE_OF_INCORPORATION (f1_16) → fmtDate
 * 1m  = CORP_FORMS_COUNT (f1_17) → '1'
 * 1n  = CORP_IS_FOREIGN_OWNED_DE checkbox (c1_5)
 * 1o  = CORP_RESIDENT_COUNTRY (f1_19) → 'United States'
 * Part II 4a = SHAREHOLDER_NAME  → name only (no address)
 * Part II 5a = SHAREHOLDER_ADDRESS / SHAREHOLDER_CITY_STATE_ZIP
 * Part II 4b(2) = SHAREHOLDER_REFERENCE_ID
 * Part II 4b(3) = SHAREHOLDER_FOREIGN_TIN
 * Part II 4c   = SHAREHOLDER_COUNTRY_CITIZENSHIP
 * Part II 4d   = SHAREHOLDER_COUNTRY_RESIDENCE  (blank — country of residence)
 * Part II 4e   = SHAREHOLDER_RESIDENT_COUNTRY   (India — country under whose laws files)
 * Part III 8d  = RP2_ACTIVITY (principal business activity — blank for individual owner)
 * Part III 8e  = RP2_IS_25PCT_SHAREHOLDER (checkbox 1 = IS the 25% shareholder)
 * Part III 8f  = RP2_COUNTRY_RESIDENCE (India)
 * Part III 8g  = RP2_COUNTRY_OF_INCORPORATION (India)
 *
 * ── Pro Forma 1120 field notes (from live PDF dump) ─────────────────────
 * PgHeader f1_1 = tax year begin date e.g. "January 1, 2025"
 * PgHeader f1_2 = tax year end date   e.g. "December 31, 2025"
 * PgHeader f1_3 = date incorporated   (required — fmtDate)
 * NameFieldsReadOrder:
 *   f1_4 = corp name
 *   f1_5 = street address          ← NOT care-of; actual street goes here
 *   f1_6 = city
 *   f1_7 = state
 *   f1_8 = ZIP
 *   f1_9 = EIN
 *   f1_10= total assets            ← required; write filing.total_assets
 * Box A top checkboxes (must be explicitly UNCHECKED for foreign-owned single-member LLC):
 *   topmostSubform[0].Page1[0].c1_1[0] = Consolidated return
 *   topmostSubform[0].Page1[0].c1_2[0] = Life/nonlife consolidated return
 *   topmostSubform[0].Page1[0].c1_3[0] = Personal holding co
 *   topmostSubform[0].Page1[0].c1_4[0] = Personal service corp
 *   topmostSubform[0].Page1[0].c1_5[0] = Schedule M-3 attached
 * A_ReadOrder: c1_1=initial, c1_2=final, c1_3=name change, c1_4=addr change, c1_5=amended
 */

import { PDFDocument, PDFCheckBox, PDFTextField } from 'pdf-lib';
import { F5472 } from './form5472Fields';
import type { Filing, Transaction, Address } from './supabase';

const FORM_5472_PATH = `${import.meta.env.BASE_URL}pdf/f5472.pdf`;
const FORM_1120_PATH = `${import.meta.env.BASE_URL}pdf/f1120.pdf`;

const pdfCache: Record<string, ArrayBuffer> = {};

async function fetchPdfBytes(path: string): Promise<ArrayBuffer> {
  if (pdfCache[path]) return pdfCache[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error(
    `Could not load PDF template at ${path} (${res.status}). ` +
    `Run: curl -o public/pdf/f5472.pdf https://www.irs.gov/pub/irs-pdf/f5472.pdf`
  );
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) throw new Error(
    `PDF at ${path} is empty or too small (${bytes.byteLength} bytes). ` +
    `Re-download: curl -Lo public/pdf/f5472.pdf https://www.irs.gov/pub/irs-pdf/f5472.pdf`
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

/** Format a date string as MM/DD/YYYY */
function fmtDate(val: string | null | undefined): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
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
  const parts = [
    addr.city,
    addr.region,
    addr.postal_code,
    addr.country,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Build the tax period begin date.
 * Rule: if this is the initial return AND the incorporation date falls in the
 * same tax year, use the date of incorporation as the period start.
 * Otherwise default to January 1 of the tax year.
 */
function resolvePeriodBegin(
  filing: Filing,
  taxYear: string
): { label: string; year: string } {
  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  // If initial return and incorporation date is in the same tax year, use it
  if (filing.initial_return && filing.date_of_incorporation) {
    const d = new Date(filing.date_of_incorporation);
    if (!isNaN(d.getTime()) && String(d.getFullYear()) === taxYear) {
      return {
        label: `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`,
        year: taxYear,
      };
    }
  }

  // Explicit tax_period_begin overrides
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

// ─── Part V categories ────────────────────────────────────────────────────────

export const PART_V_CATEGORIES = [
  'capital_contribution',
  'distribution',
  'formation_costs',
  'property_transfer',
  'nonmonetary_other',
] as const;

// ─── Transaction aggregator ───────────────────────────────────────────────────

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
    const dir = tx.direction;

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

// ─── Form 5472 filler ─────────────────────────────────────────────────────────

export async function fillForm5472(
  filing: Filing,
  transactions: Transaction[]
): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(FORM_5472_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const txn = aggregateTransactions(transactions);
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  // ── Header — Tax Year ──────────────────────────────────────────────────
  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);
  setText(doc, F5472.TAX_YEAR_BEGIN,      begin.label);
  setText(doc, F5472.TAX_YEAR_BEGIN_YEAR, begin.year);
  setText(doc, F5472.TAX_YEAR_END,        end.label);
  setText(doc, F5472.TAX_YEAR_END_YEAR,   end.year);

  // ── Part I — Reporting Corporation ────────────────────────────────────
  setText(doc, F5472.CORP_NAME,           filing.llc_name ?? '');
  setText(doc, F5472.CORP_ADDRESS,        fmtStreet(filing.mailing_address));
  setText(doc, F5472.CORP_CITY_STATE_ZIP, fmtCityStateZip(filing.mailing_address));
  setText(doc, F5472.CORP_EIN,            fmtEin(filing.ein));
  setText(doc, F5472.CORP_TOTAL_ASSETS,   fmt(filing.total_assets));

  // 1e — Principal business activity
  setText(doc, F5472.CORP_ACTIVITY, filing.naics_description ?? '');

  // 1f — NAICS code
  setText(doc, F5472.CORP_NAICS,   filing.naics_code ? filing.naics_code : '0');
  setText(doc, F5472.CORP_NAICS_2, '');

  // 1g — State/country of incorporation: always 'Delaware' for our users
  setText(doc, F5472.CORP_STATE_OF_FORMATION, 'Delaware');

  // 1h — Number of Forms 5472 filed with this return: always '1'
  setText(doc, F5472.CORP_NUM_FORMS, '1');

  // 1i — Initial return checkbox: flag OR auto-detect from incorporation year
  const isInitial5472 = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getFullYear()) === taxYear
  );
  setCheck(doc, F5472.INITIAL_RETURN_YES, isInitial5472);

  // 1j — Final return: check if closure date is in this tax year
  const isFinal5472 = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getFullYear()) === taxYear
  );
  setCheck(doc, F5472.FINAL_RETURN_YES, isFinal5472);

  // 1k — Tax year of initial return (text field next to 1i)
  if (isInitial5472) {
    setText(doc, F5472.INITIAL_RETURN_YEAR, taxYear);
  }

  // 1l — Date of incorporation (f1_16)
  setText(doc, F5472.CORP_DATE_OF_INCORPORATION, fmtDate(filing.date_of_incorporation));

  // 1m — Total number of Forms 5472 attached (f1_17): always '1'
  setText(doc, F5472.CORP_FORMS_COUNT, '1');

  // 1n — Foreign-owned U.S. DE checkbox (c1_5)
  setCheck(doc, F5472.CORP_IS_FOREIGN_OWNED_DE, true);

  // 1o — Country under whose laws reporting corp is resident: United States
  setText(doc, F5472.CORP_RESIDENT_COUNTRY, 'United States');

  // 1f (gross payments) — Part V total when only Part V transactions exist.
  // Capital contributions are Part V (not Part IV) so txn.hasPartIV may be false.
  // Per IRS instructions, line 1f = total gross payments reported on this form.
  const partVTotal =
    txn.capital_contribution + txn.distribution +
    txn.formation_costs + txn.property_transfer;
  const partIVTotalPaid =
    txn.purchases_paid + txn.services_received + txn.rents_paid +
    txn.borrowed + txn.interest_paid + txn.insurance_paid +
    txn.dividends_paid + txn.commission_paid + txn.intangible_paid + txn.other_paid;
  const partIVTotalReceived =
    txn.sales_received + txn.services_rendered + txn.rents_received +
    txn.loaned + txn.interest_received + txn.insurance_received +
    txn.dividends_received + txn.commission_received +
    txn.intangible_received + txn.other_received;
  const grossPaymentsTotal = partIVTotalPaid + partIVTotalReceived + partVTotal;
  // CORP_TOTAL_ASSETS (f1_9) is 1d; 1f gross payments uses the NAICS_2 overflow field
  // on the same line — but the IRS form places 1f in a dedicated text field.
  // Based on the field map, f1_12 (CORP_NAICS_2) is the 1f gross-payments slot.
  // Write gross payments there when non-zero.
  if (grossPaymentsTotal > 0) {
    setText(doc, F5472.CORP_NAICS_2, fmt(grossPaymentsTotal));
  }

  // ── Checkbox 3 — Related party is a foreign person ────────────────────
  setCheck(doc, F5472.RELATED_PARTY_IS_FOREIGN, true);
  setCheck(doc, F5472.RELATED_PARTY_IS_US,      false);

  // ── Part II — 25% Foreign Shareholder ─────────────────────────────────
  // 4a — Name only (address goes in 5a fields below — NOT combined here)
  setText(doc, F5472.SHAREHOLDER_NAME, filing.owner_full_name ?? '');

  // 5a — Street address and city/state/zip (separate fields, no duplication)
  const ownerAddr = filing.owner_address;
  setText(doc, F5472.SHAREHOLDER_ADDRESS,        fmtStreet(ownerAddr));
  setText(doc, F5472.SHAREHOLDER_CITY_STATE_ZIP, fmtCityStateZip(ownerAddr));

  // 4b(1) — US TIN (blank for non-US owner with no SSN/ITIN)
  setText(doc, F5472.SHAREHOLDER_US_TIN,       filing.owner_us_tin ?? '');
  // 4b(2) — Reference ID number (e.g. CHI001)
  setText(doc, F5472.SHAREHOLDER_REFERENCE_ID, filing.owner_reference_id ?? '');
  // 4b(3) — Foreign tax identifying number (FTIN)
  setText(doc, F5472.SHAREHOLDER_FOREIGN_TIN,  filing.owner_foreign_tax_id ?? '');

  // 4c — Country(ies) of citizenship / incorporation
  setText(doc, F5472.SHAREHOLDER_COUNTRY_CITIZENSHIP, filing.owner_country_citizenship ?? '');
  // 4d — Country of residence: leave blank (IRS: only if different from 4e)
  setText(doc, F5472.SHAREHOLDER_COUNTRY_RESIDENCE, '');
  // 4e — Country under whose laws files as resident (India)
  setText(doc, F5472.SHAREHOLDER_RESIDENT_COUNTRY, filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // ── Part III — Related Party (Page 1) ─────────────────────────────────
  setText(doc, F5472.RELATED_PARTY_NAME,         filing.owner_full_name          ?? '');
  setText(doc, F5472.RELATED_PARTY_COUNTRY,      filing.owner_country_citizenship ?? '');
  setText(doc, F5472.RELATED_PARTY_US_TIN,       filing.owner_us_tin              ?? '');
  setText(doc, F5472.RELATED_PARTY_REFERENCE_ID, filing.owner_reference_id        ?? '');
  setText(doc, F5472.RELATED_PARTY_FOREIGN_TIN,  filing.owner_foreign_tax_id      ?? '');

  // ── Part III — Related Party (Page 2 / 8a–8g) ────────────────────────
  setCheck(doc, F5472.RP2_IS_FOREIGN_PERSON, true);
  setCheck(doc, F5472.RP2_IS_US_PERSON,      false);

  setText(doc, F5472.RP2_NAME,         filing.owner_full_name    ?? '');
  setText(doc, F5472.RP2_US_TIN,       filing.owner_us_tin       ?? '');
  setText(doc, F5472.RP2_REFERENCE_ID, filing.owner_reference_id ?? '');
  setText(doc, F5472.RP2_FOREIGN_TIN,  filing.owner_foreign_tax_id ?? '');

  // 8d — Principal business activity: blank for individual owner
  setText(doc, F5472.RP2_ACTIVITY, '');

  // 8e — Relationship checkboxes: exactly one must be checked; uncheck the others
  const isDirectShareholder = !(filing.rp_is_related_only ?? false) && !(filing.rp_is_both ?? false);
  const isRelatedOnly       = (filing.rp_is_related_only ?? false) && !(filing.rp_is_both ?? false);
  const isBoth              = filing.rp_is_both ?? false;
  setCheck(doc, F5472.RP2_IS_25PCT_SHAREHOLDER,      isDirectShareholder);
  setCheck(doc, F5472.RP2_IS_RELATED_TO_SHAREHOLDER, isRelatedOnly);
  setCheck(doc, F5472.RP2_IS_25PCT_AND_RELATED,       isBoth);

  // 8f — Country under whose laws related party files as resident
  setText(doc, F5472.RP2_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // 8g — Country of incorporation / principal place of business
  setText(doc, F5472.RP2_COUNTRY_OF_INCORPORATION,
    filing.owner_country_citizenship ?? filing.owner_country_residence ?? '');

  // 8d (country of residence) — leave blank per IRS if same as 8f
  setText(doc, F5472.RP2_COUNTRY_RESIDENCE, '');

  // ── Part IV — Monetary Transactions ──────────────────────────────────
  setCheck(doc, F5472.PART_IV_APPLIES, txn.hasPartIV);
  if (txn.hasPartIV) {
    setText(doc, F5472.LINE_9_SALES_RECEIVED,      fmt(txn.sales_received));
    setText(doc, F5472.LINE_10_PURCHASES_PAID,      fmt(txn.purchases_paid));
    setText(doc, F5472.LINE_11_SERVICES_RENDERED,   fmt(txn.services_rendered));
    setText(doc, F5472.LINE_12_SERVICES_RECEIVED,   fmt(txn.services_received));
    setText(doc, F5472.LINE_13A_RENTS_RECEIVED,     fmt(txn.rents_received));
    setText(doc, F5472.LINE_13B_RENTS_PAID,         fmt(txn.rents_paid));
    setText(doc, F5472.LINE_14_BORROWED,            fmt(txn.borrowed));
    setText(doc, F5472.LINE_15_LOANED,              fmt(txn.loaned));
    setText(doc, F5472.LINE_16_INTEREST_PAID,       fmt(txn.interest_paid));
    setText(doc, F5472.LINE_17A_INTEREST_RECEIVED,  fmt(txn.interest_received));
    setText(doc, F5472.LINE_18_INSURANCE_PAID,      fmt(txn.insurance_paid));
    setText(doc, F5472.LINE_19_INSURANCE_RECEIVED,  fmt(txn.insurance_received));
    setText(doc, F5472.LINE_20_DIVIDENDS_PAID,      fmt(txn.dividends_paid));
    setText(doc, F5472.LINE_21_DIVIDENDS_RECEIVED,  fmt(txn.dividends_received));
    setText(doc, F5472.LINE_22_COMMISSION_PAID,     fmt(txn.commission_paid));
    setText(doc, F5472.LINE_23_COMMISSION_RECEIVED, fmt(txn.commission_received));
    setText(doc, F5472.LINE_24_INTANGIBLE_PAID,     fmt(txn.intangible_paid));
    setText(doc, F5472.LINE_25_INTANGIBLE_RECEIVED, fmt(txn.intangible_received));
    setText(doc, F5472.LINE_26_OTHER_PAID,          fmt(txn.other_paid));
    setText(doc, F5472.LINE_27A_OTHER_RECEIVED,     fmt(txn.other_received));
    setText(doc, F5472.LINE_27B_OTHER_DESC,         txn.other_desc);

    setText(doc, F5472.LINE_28_TOTAL_PAID,     fmt(partIVTotalPaid));
    setText(doc, F5472.LINE_29_TOTAL_RECEIVED, fmt(partIVTotalReceived));
  }

  // ── Part V / VI ───────────────────────────────────────────────────────
  setCheck(doc, F5472.PART_V_APPLIES,  txn.hasPartV);
  setCheck(doc, F5472.PART_VI_APPLIES, false);

  // ── Part VII — Yes/No questions (default No) ──────────────────────────
  setCheck(doc, F5472.LINE_37_YES,  false); setCheck(doc, F5472.LINE_37_NO,  true);
  setCheck(doc, F5472.LINE_38A_YES, false); setCheck(doc, F5472.LINE_38A_NO, true);
  setCheck(doc, F5472.LINE_38B_YES, false); setCheck(doc, F5472.LINE_38B_NO, true);
  setCheck(doc, F5472.LINE_39_YES,  false); setCheck(doc, F5472.LINE_39_NO,  true);
  setCheck(doc, F5472.LINE_40_YES,  false); setCheck(doc, F5472.LINE_40_NO,  true);
  setCheck(doc, F5472.LINE_41_YES,  false); setCheck(doc, F5472.LINE_41_NO,  true);

  // ── Part VIII ─────────────────────────────────────────────────────────
  setCheck(doc, F5472.LINE_45_YES,  false); setCheck(doc, F5472.LINE_45_NO,  true);
  setCheck(doc, F5472.LINE_46_YES,  false); setCheck(doc, F5472.LINE_46_NO,  true);
  setCheck(doc, F5472.LINE_48C_YES, false); setCheck(doc, F5472.LINE_48C_NO, true);

  // ── Part IX ───────────────────────────────────────────────────────────
  setCheck(doc, F5472.LINE_49A_YES, false); setCheck(doc, F5472.LINE_49A_NO, true);
  setCheck(doc, F5472.LINE_49B_YES, false); setCheck(doc, F5472.LINE_49B_NO, true);
  setText(doc, F5472.LINE_50, '');
  setText(doc, F5472.LINE_51, '');
  setText(doc, F5472.LINE_52, '');
  setCheck(doc, F5472.LINE_53_YES, false); setCheck(doc, F5472.LINE_53_NO, true);

  doc.getForm().flatten();
  return doc.save();
}

// ─── Pro Forma Form 1120 filler ───────────────────────────────────────────────
//
// Actual field layout verified from the live 1120 PDF AcroForm dump:
//   PgHeader[0]:              f1_1 = begin date e.g. "January 1, 2025"
//                             f1_2 = end date   e.g. "December 31, 2025"
//                             f1_3 = date incorporated (required — MM/DD/YYYY)
//   NameFieldsReadOrder[0]:   f1_4 = corp name
//                             f1_5 = street address (NOT care-of)
//                             f1_6 = city
//                             f1_7 = state
//                             f1_8 = ZIP
//                             f1_9 = EIN
//                             f1_10= total assets (required)
//   Box A top checkboxes — must be explicitly UNCHECKED for foreign-owned single-member LLC:
//                             topmostSubform[0].Page1[0].c1_1[0] = Consolidated return
//                             topmostSubform[0].Page1[0].c1_2[0] = Life/nonlife consolidated
//                             topmostSubform[0].Page1[0].c1_3[0] = Personal holding co
//                             topmostSubform[0].Page1[0].c1_4[0] = Personal service corp
//                             topmostSubform[0].Page1[0].c1_5[0] = Schedule M-3 attached
//   A_ReadOrder[0]:           c1_1 = initial return
//                             c1_2 = final return
//                             c1_3 = name change
//                             c1_4 = address change
//                             c1_5 = amended return

export async function fillProForma1120(filing: Filing): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(FORM_1120_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  // Remove pages 2–6 (index 1 through end) to suppress blank schedules.
  // Must be done before field-setting so flatten() only touches Page 1.
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

  // PgHeader — full date strings e.g. "January 1, 2025" / "December 31, 2025"
  set('topmostSubform[0].Page1[0].PgHeader[0].f1_1[0]', `${begin.label}, ${begin.year}`);
  set('topmostSubform[0].Page1[0].PgHeader[0].f1_2[0]', `${end.label}, ${end.year}`);
  // Date incorporated — required on Pro Forma 1120 for foreign-owned entity
  set('topmostSubform[0].Page1[0].PgHeader[0].f1_3[0]', fmtDate(filing.date_of_incorporation));

  // NameFieldsReadOrder — corp name and split address fields
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_4[0]', filing.llc_name ?? '');
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_5[0]', fmtStreet(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_6[0]', fmtCity(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_7[0]', fmtState(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_8[0]', fmtZip(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_9[0]', fmtEin(filing.ein));
  // Total assets — required on Pro Forma 1120 for foreign-owned entity
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_10[0]', fmt(filing.total_assets));

  // Box A top checkboxes — explicitly uncheck all for foreign-owned single-member LLC.
  // These are at the Page1 level and are DISTINCT from the A_ReadOrder checkboxes below.
  // The PDF template pre-checks c1_1[0] (Consolidated return) by default — must force off.
  chk('topmostSubform[0].Page1[0].c1_1[0]', false); // Consolidated return        ← MUST be unchecked
  chk('topmostSubform[0].Page1[0].c1_2[0]', false); // Life/nonlife consolidated  ← MUST be unchecked
  chk('topmostSubform[0].Page1[0].c1_3[0]', false); // Personal holding co        ← MUST be unchecked
  chk('topmostSubform[0].Page1[0].c1_4[0]', false); // Personal service corp      ← MUST be unchecked
  chk('topmostSubform[0].Page1[0].c1_5[0]', false); // Schedule M-3 attached      ← MUST be unchecked

  // Box E checkboxes (initial, final, name change, address change, amended)
  const isFinal = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getFullYear()) === taxYear
  );
  // Initial return: true if initial_return flag OR incorporated in this tax year
  const isInitial = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getFullYear()) === taxYear
  );
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_1[0]', isInitial);
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_2[0]', isFinal);
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_3[0]', filing.name_change    ?? false);
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_4[0]', filing.address_change ?? false);
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_5[0]', false); // amended

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
  lines.push('The following transactions occurred between the foreign-owned U.S.');
  lines.push('disregarded entity and its foreign owner during the tax year:');
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
