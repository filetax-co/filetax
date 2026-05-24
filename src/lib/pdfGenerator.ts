/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs.
 * PDFs are served from /pdf/ (public/pdf/) to avoid CORS.
 *
 * ── Form 5472 field notes ──────────────────────────────────────────────────────
 * 1c  = CORP_TOTAL_ASSETS  (f1_9)
 * 1e  = CORP_ACTIVITY      (f1_10)
 * 1f  = CORP_NAICS         (f1_11) — NAICS code; CORP_GROSS_PAYMENTS (f1_12) = gross payments total
 * 1g  = CORP_STATE_OF_FORMATION (f1_13) — always 'Delaware'
 * 1h  = CORP_NUM_FORMS     (f1_14) — always '1'
 * 1i  = INITIAL_RETURN_YES checkbox
 * 1j  = FINAL_RETURN_YES   checkbox
 * 1k  = INITIAL_RETURN_YEAR text
 * 1l  = CORP_DATE_OF_INCORPORATION (f1_16)
 * 1m  = CORP_FORMS_COUNT   (f1_17) — always '1'
 * 1o  = CORP_RESIDENT_COUNTRY (f1_19) — 'United States'
 *
 * Part II — Direct 25% shareholder (one shareholder only)
 *   4a  = SHAREHOLDER_NAME         (f1_20)
 *   4b(1) = SHAREHOLDER_US_TIN     (f1_26) ← was incorrectly f1_28
 *   4b(2) = SHAREHOLDER_REFERENCE_ID (f1_27) ← was incorrectly f1_29
 *   4b(3) = SHAREHOLDER_FOREIGN_TIN (f1_28) ← was incorrectly f1_30
 *   4c  = SHAREHOLDER_COUNTRY_BUSINESS (f1_21)
 *   4d  = SHAREHOLDER_COUNTRY_CITIZENSHIP (f1_22) — blank only if same as 4e
 *   4e  = SHAREHOLDER_RESIDENT_COUNTRY (f1_23)
 *   5a  = SHAREHOLDER2_ADDRESS / SHAREHOLDER2_CITY_STATE_ZIP → MUST BE BLANK
 *   5b  = SHAREHOLDER2_US_TIN / SHAREHOLDER2_REFERENCE_ID   → MUST BE BLANK
 *
 * Part II top checkbox — PART_II_SURROGATE_CORP_CHECKBOX (c1_6) → MUST BE UNCHECKED
 *
 * Section 6/7 (ultimate indirect shareholder, Page 1 f1_31–f1_37) → ALL BLANK
 *
 * Part III 8e relationship — exactly ONE of c2_2/c2_3/c2_4 checked; other two unchecked
 *   c2_2[0] = 25% foreign shareholder (use this for direct Indian individual owner)
 *   c2_3[0] = related to 25% foreign shareholder (uncheck for direct owner)
 *   c2_4[0] = both (uncheck for direct owner)
 *
 * Part III — RP2_RELATED_TO_CORP_UNCHECK (Page2[0].c2_5[0])
 *   This "Related to reporting corporation" box is PRE-CHECKED in the IRS template.
 *   It is a DIFFERENT field from PartIV[0].c2_5[0] (the Part IV applies checkbox).
 *   Must be explicitly UNCHECKED for a direct 25% shareholder.
 *
 * ── Pro Forma 1120 field notes ──────────────────────────────────────────────
 * PgHeader:
 *   f1_1 = tax year begin month/day   e.g. "January 1"   (NO year — template appends it)
 *   f1_2 = tax year begin year        e.g. "2025"
 *   f1_3 = tax year end month/day     e.g. "December 31" (NO year — template appends it)
 *   f1_3b= tax year end year          e.g. "2025"  ← separate field
 *   f1_4 = date incorporated          MM/DD/YYYY  ← LEAVE BLANK on Pro Forma for foreign-owned DE
 * NameFieldsReadOrder (verified field indices — 0-based within this sub-form):
 *   f1_4 = corp name        ← index 4 within NameFieldsReadOrder
 *   f1_5 = street address
 *   f1_6 = city
 *   f1_7 = state
 *   f1_8 = ZIP
 *   f1_9 = country          ← blank for US domestic address
 *   f1_10= EIN
 *   f1_11= total assets     ← required on Pro Forma for foreign-owned entity
 * Box A top checkboxes — all must be explicitly UNCHECKED:
 *   topmostSubform[0].Page1[0].c1_1[0] through c1_5[0]
 * Box E checkboxes:
 *   A_ReadOrder: c1_1=initial, c1_2=final, c1_3=name change, c1_4=addr change
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

// ─── Helpers ──────────────────────────────────────────────────────────────────────

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
 * Uses UTC getters to avoid the off-by-one that occurs when a date stored as
 * "YYYY-MM-DD" is parsed as UTC midnight and then rendered in a local time
 * zone west of UTC (e.g. 2024-01-15 → Jan 14 in US Eastern time).
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
 * Returns separate label (month/day) and year so each fills its own PDF field.
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
      return {
        label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`,
        year: taxYear,
      };
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

// ─── Part V categories ────────────────────────────────────────────────────────────────

export const PART_V_CATEGORIES = [
  'capital_contribution',
  'distribution',
  'formation_costs',
  'property_transfer',
  'nonmonetary_other',
] as const;

// ─── Transaction aggregator ───────────────────────────────────────────────────────────────

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

// ─── Form 5472 filler ─────────────────────────────────────────────────────────────────

export async function fillForm5472(
  filing: Filing,
  transactions: Transaction[]
): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(FORM_5472_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const txn = aggregateTransactions(transactions);
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  // ── Header — Tax Year ────────────────────────────────────────────────
  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);
  setText(doc, F5472.TAX_YEAR_BEGIN,      begin.label);
  setText(doc, F5472.TAX_YEAR_BEGIN_YEAR, begin.year);
  setText(doc, F5472.TAX_YEAR_END,        end.label);
  setText(doc, F5472.TAX_YEAR_END_YEAR,   end.year);

  // ── Part I — Reporting Corporation ───────────────────────────────────
  setText(doc, F5472.CORP_NAME,           filing.llc_name ?? '');
  setText(doc, F5472.CORP_ADDRESS,        fmtStreet(filing.mailing_address));
  setText(doc, F5472.CORP_CITY_STATE_ZIP, fmtCityStateZip(filing.mailing_address));
  setText(doc, F5472.CORP_EIN,            fmtEin(filing.ein));
  setText(doc, F5472.CORP_TOTAL_ASSETS,   fmt(filing.total_assets));

  // 1e — Principal business activity
  setText(doc, F5472.CORP_ACTIVITY, filing.naics_description ?? '');

  // 1f — NAICS code (f1_11). Gross payments total goes in CORP_GROSS_PAYMENTS (f1_12).
  setText(doc, F5472.CORP_NAICS, filing.naics_code ? String(filing.naics_code) : '');

  // 1g — State/country of incorporation: always 'Delaware' (f1_13)
  setText(doc, F5472.CORP_STATE_OF_FORMATION, 'Delaware');

  // 1h — Number of Forms 5472 filed with this return: always '1' (f1_14)
  setText(doc, F5472.CORP_NUM_FORMS, '1');

  // 1i — Initial return: flag OR auto-detect from incorporation year
  const isInitial5472 = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getUTCFullYear()) === taxYear
  );
  setCheck(doc, F5472.INITIAL_RETURN_YES, isInitial5472);

  // 1j — Final return
  const isFinal5472 = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getUTCFullYear()) === taxYear
  );
  setCheck(doc, F5472.FINAL_RETURN_YES, isFinal5472);

  // 1k — Tax year of initial return
  if (isInitial5472) {
    setText(doc, F5472.INITIAL_RETURN_YEAR, taxYear);
  }

  // 1l — Date of incorporation (f1_16)
  setText(doc, F5472.CORP_DATE_OF_INCORPORATION, fmtDate(filing.date_of_incorporation));

  // 1m — Total number of Forms 5472 attached (f1_17): always '1'
  setText(doc, F5472.CORP_FORMS_COUNT, '1');

  // 1n — Foreign-owned U.S. DE checkbox (c1_5)
  setCheck(doc, F5472.CORP_IS_FOREIGN_OWNED_DE, true);

  // 1o — Country under whose laws reporting corp is resident (f1_19)
  setText(doc, F5472.CORP_RESIDENT_COUNTRY, 'United States');

  // 1f gross payments — total of all Part IV + Part V amounts on this form.
  // Always write this field (IRS expects '0' not blank when there are transactions).
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
  setText(doc, F5472.CORP_GROSS_PAYMENTS, fmt(grossPaymentsTotal));

  // ── Checkbox 3 — Related party is a foreign person ────────────────────
  setCheck(doc, F5472.RELATED_PARTY_IS_FOREIGN, true);
  setCheck(doc, F5472.RELATED_PARTY_IS_US,      false);

  // ── Part II — Surrogate foreign corporation checkbox ──────────────────
  // Must be UNCHECKED — never applies to Indian individual owner of DE LLC.
  setCheck(doc, F5472.PART_II_SURROGATE_CORP_CHECKBOX, false);

  // ── Part II — 25% Foreign Shareholder (direct — row 4 only) ───────────
  // 4a — Name
  setText(doc, F5472.SHAREHOLDER_NAME, filing.owner_full_name ?? '');

  // 4b(1)/(2)/(3) — TIN fields for the DIRECT shareholder (f1_26/f1_27/f1_28)
  setText(doc, F5472.SHAREHOLDER_US_TIN,       filing.owner_us_tin        ?? '');
  setText(doc, F5472.SHAREHOLDER_REFERENCE_ID, filing.owner_reference_id  ?? '');
  setText(doc, F5472.SHAREHOLDER_FOREIGN_TIN,  filing.owner_foreign_tax_id ?? '');

  // 4c — Principal country where business is conducted
  setText(doc, F5472.SHAREHOLDER_COUNTRY_BUSINESS, filing.owner_country_citizenship ?? '');
  // 4d — Country of citizenship / incorporation.
  // IRS instructions: leave blank ONLY if identical to 4e. We populate it from the
  // filing data and let the caller supply the correct value; an individual owner
  // will naturally have this set to their country of citizenship.
  setText(doc, F5472.SHAREHOLDER_COUNTRY_CITIZENSHIP, filing.owner_country_citizenship ?? '');
  // 4e — Country under whose laws shareholder files as resident
  setText(doc, F5472.SHAREHOLDER_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // ── EXPLICITLY BLANK the second-shareholder row (5a/5b) ─────────────────
  // We have only one direct shareholder. f1_24/f1_25/f1_29/f1_30 are the
  // "second shareholder" address and TIN fields — must all be empty strings.
  setText(doc, F5472.SHAREHOLDER2_ADDRESS,      '');
  setText(doc, F5472.SHAREHOLDER2_CITY_STATE_ZIP, '');
  setText(doc, F5472.SHAREHOLDER2_US_TIN,       '');
  setText(doc, F5472.SHAREHOLDER2_REFERENCE_ID, '');

  // ── EXPLICITLY BLANK section 6/7 (ultimate indirect shareholder) ──────
  // These f1_31–f1_37 fields on Page 1 are for a different entity — must be blank.
  setText(doc, F5472.SECTION6_NAME,         '');
  setText(doc, F5472.SECTION6_COUNTRY,      '');
  setText(doc, F5472.SECTION6_FIELD3,       '');
  setText(doc, F5472.SECTION6_FIELD4,       '');
  setText(doc, F5472.SECTION6_US_TIN,       '');
  setText(doc, F5472.SECTION6_REFERENCE_ID, '');
  setText(doc, F5472.SECTION6_FOREIGN_TIN,  '');

  // ── Part III — Related Party (Page 2 / 8a–8g) ───────────────────────
  setCheck(doc, F5472.RP2_IS_FOREIGN_PERSON, true);
  setCheck(doc, F5472.RP2_IS_US_PERSON,      false);

  setText(doc, F5472.RP2_NAME,         filing.owner_full_name    ?? '');
  setText(doc, F5472.RP2_US_TIN,       filing.owner_us_tin       ?? '');
  setText(doc, F5472.RP2_REFERENCE_ID, filing.owner_reference_id ?? '');
  setText(doc, F5472.RP2_FOREIGN_TIN,  filing.owner_foreign_tax_id ?? '');

  // 8c — Principal business activity: blank for an individual owner
  // (individual owners have no business activity description to report).
  setText(doc, F5472.RP2_ACTIVITY, filing.owner_business_activity ?? '');
  // 8d — Country of residence: required for a foreign individual related party.
  setText(doc, F5472.RP2_COUNTRY_RESIDENCE, filing.owner_country_residence ?? '');

  // 8e — Relationship checkboxes: exactly ONE checked; all others explicitly unchecked.
  // For a direct Indian individual owner of a DE LLC, c2_2 (25% shareholder) is correct.
  const isDirectShareholder = !(filing.rp_is_related_only ?? false) && !(filing.rp_is_both ?? false);
  const isRelatedOnly       = (filing.rp_is_related_only ?? false) && !(filing.rp_is_both ?? false);
  const isBoth              = filing.rp_is_both ?? false;
  setCheck(doc, F5472.RP2_IS_25PCT_SHAREHOLDER,      isDirectShareholder);
  setCheck(doc, F5472.RP2_IS_RELATED_TO_SHAREHOLDER, isRelatedOnly);  // uncheck for direct owner
  setCheck(doc, F5472.RP2_IS_25PCT_AND_RELATED,       isBoth);         // uncheck for direct owner

  // "Related to reporting corporation" pre-checked box (Page2[0].c2_5[0]).
  // This is a SEPARATE field from the Part IV applies checkbox (PartIV[0].c2_5[0]).
  // Must be UNCHECKED for a direct 25% shareholder who owns the reporting corp.
  setCheck(doc, F5472.RP2_RELATED_TO_CORP_UNCHECK, false);

  // 8f — Country under whose laws related party files as resident
  setText(doc, F5472.RP2_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // 8g — Country of incorporation / principal place of business
  setText(doc, F5472.RP2_COUNTRY_OF_INCORPORATION,
    filing.owner_country_citizenship ?? filing.owner_country_residence ?? '');

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
    setText(doc, F5472.LINE_28_TOTAL_PAID,          fmt(partIVTotalPaid));
    setText(doc, F5472.LINE_29_TOTAL_RECEIVED,      fmt(partIVTotalReceived));
  }

  // ── Part V / VI ──────────────────────────────────────────────────────────────
  setCheck(doc, F5472.PART_V_APPLIES,  txn.hasPartV);
  setCheck(doc, F5472.PART_VI_APPLIES, false);

  // ── Part VII — Yes/No questions (default No) ──────────────────────────
  setCheck(doc, F5472.LINE_37_YES,  false); setCheck(doc, F5472.LINE_37_NO,  true);
  setCheck(doc, F5472.LINE_38A_YES, false); setCheck(doc, F5472.LINE_38A_NO, true);
  setCheck(doc, F5472.LINE_38B_YES, false); setCheck(doc, F5472.LINE_38B_NO, true);
  setCheck(doc, F5472.LINE_39_YES,  false); setCheck(doc, F5472.LINE_39_NO,  true);
  setCheck(doc, F5472.LINE_40_YES,  false); setCheck(doc, F5472.LINE_40_NO,  true);
  setCheck(doc, F5472.LINE_41_YES,  false); setCheck(doc, F5472.LINE_41_NO,  true);

  // ── Part VIII ───────────────────────────────────────────────────────────────
  setCheck(doc, F5472.LINE_45_YES,  false); setCheck(doc, F5472.LINE_45_NO,  true);
  setCheck(doc, F5472.LINE_46_YES,  false); setCheck(doc, F5472.LINE_46_NO,  true);
  setCheck(doc, F5472.LINE_48C_YES, false); setCheck(doc, F5472.LINE_48C_NO, true);

  // ── Part IX ────────────────────────────────────────────────────────────────
  setCheck(doc, F5472.LINE_49A_YES, false); setCheck(doc, F5472.LINE_49A_NO, true);
  setCheck(doc, F5472.LINE_49B_YES, false); setCheck(doc, F5472.LINE_49B_NO, true);
  setText(doc, F5472.LINE_50, '');
  setText(doc, F5472.LINE_51, '');
  setText(doc, F5472.LINE_52, '');
  setCheck(doc, F5472.LINE_53_YES, false); setCheck(doc, F5472.LINE_53_NO, true);

  doc.getForm().flatten();
  return doc.save();
}

// ─── Pro Forma Form 1120 filler ─────────────────────────────────────────────────────
//
// The 1120 template splits the tax year header into FOUR separate fields:
//   PgHeader f1_1 = begin month/day  e.g. "January 1"   (template appends ", YYYY")
//   PgHeader f1_2 = begin year       e.g. "2025"
//   PgHeader f1_3 = end month/day    e.g. "December 31" (template appends ", YYYY")
//   PgHeader f1_3b= end year         e.g. "2025"  (separate small field)
//   PgHeader f1_4 = date incorporated MM/DD/YYYY  — LEAVE BLANK on Pro Forma
//                   (Pro Forma 1120 for a foreign-owned disregarded entity does not
//                    require a date-incorporated entry on the header line)
//
// NameFieldsReadOrder address order (verified from live PDF):
//   f1_4 = corp name
//   f1_5 = street address
//   f1_6 = city
//   f1_7 = state
//   f1_8 = ZIP
//   f1_9 = country  (blank for US domestic address)
//   f1_10= EIN
//   f1_11= total assets  (required on Pro Forma for foreign-owned entity)

export async function fillProForma1120(filing: Filing): Promise<Uint8Array> {
  const bytes = await fetchPdfBytes(FORM_1120_PATH);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  // Remove pages 2–6 before field-setting so flatten() only touches Page 1.
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

  // ── PgHeader — Tax year dates ─────────────────────────────────────────
  // The 1120 template has FOUR separate fields for the header dates.
  // f1_1 = begin month/day ONLY (e.g. "January 1") — the template prints ", YYYY" after it.
  // f1_2 = begin year (e.g. "2025").
  // f1_3 = end month/day ONLY (e.g. "December 31").
  // f1_3b = end year (separate small standalone field).
  // Writing a full string like "January 1, 2025" into f1_1 duplicates the year.
  set('topmostSubform[0].Page1[0].PgHeader[0].f1_1[0]', begin.label);  // "January 1"
  set('topmostSubform[0].Page1[0].PgHeader[0].f1_2[0]', begin.year);   // "2025"
  set('topmostSubform[0].Page1[0].PgHeader[0].f1_3[0]', end.label);    // "December 31"
  // End-year: f1_3b is the correct field in current IRS PDF versions.
  // If it doesn't exist (older template), we skip rather than clobbering f1_4
  // (which is date-incorporated, not year).
  try {
    form.getTextField('topmostSubform[0].Page1[0].PgHeader[0].f1_3b[0]').setText(end.year);
  } catch {
    console.warn('[proForma1120] f1_3b not found — end-year field skipped');
  }

  // ── PgHeader — Date incorporated ───────────────────────────────────
  // Pro Forma 1120 for a foreign-owned disregarded entity: leave blank.
  // The date-incorporated line on the full Form 1120 is for domestic C-corps;
  // a DE/LLC filing a Pro Forma does not complete this field.
  set('topmostSubform[0].Page1[0].PgHeader[0].f1_4[0]', '');

  // ── NameFieldsReadOrder — Corp identity and address ───────────────────
  // Field indices verified against the live IRS f1120.pdf AcroForm:
  //   f1_4 = corp name  (index 4 in the NameFieldsReadOrder sub-form)
  //   f1_5 = street address
  //   f1_6 = city
  //   f1_7 = state
  //   f1_8 = ZIP
  //   f1_9 = country (blank for US domestic address)
  //   f1_10= EIN
  //   f1_11= total assets  (required on Pro Forma for foreign-owned entity)
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_4[0]',  filing.llc_name ?? '');
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_5[0]',  fmtStreet(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_6[0]',  fmtCity(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_7[0]',  fmtState(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_8[0]',  fmtZip(filing.mailing_address));
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_9[0]',  '');           // country — blank for US
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_10[0]', fmtEin(filing.ein));
  // Total assets: required on Pro Forma 1120 for a foreign-owned single-member LLC.
  set('topmostSubform[0].Page1[0].NameFieldsReadOrder[0].f1_11[0]', fmt(filing.total_assets));

  // ── Box A top checkboxes — all must be explicitly UNCHECKED ─────────────
  // The PDF template pre-checks c1_1[0] (Consolidated return) by default.
  // These are at the Page1 level, NOT inside A_ReadOrder.
  chk('topmostSubform[0].Page1[0].c1_1[0]', false); // Consolidated return
  chk('topmostSubform[0].Page1[0].c1_2[0]', false); // Life/nonlife consolidated
  chk('topmostSubform[0].Page1[0].c1_3[0]', false); // Personal holding co
  chk('topmostSubform[0].Page1[0].c1_4[0]', false); // Personal service corp
  chk('topmostSubform[0].Page1[0].c1_5[0]', false); // Schedule M-3 attached

  // ── Box E checkboxes (initial, final, name change, address change) ───────
  const isFinal = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getUTCFullYear()) === taxYear
  );
  const isInitial = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getUTCFullYear()) === taxYear
  );
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_1[0]', isInitial);
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_2[0]', isFinal);
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_3[0]', filing.name_change    ?? false);
  chk('topmostSubform[0].Page1[0].A_ReadOrder[0].c1_4[0]', filing.address_change ?? false);

  doc.getForm().flatten();
  return doc.save();
}
