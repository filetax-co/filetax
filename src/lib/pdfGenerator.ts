/**
 * PDF Generation Layer — Form 5472 + Pro Forma 1120
 *
 * Uses pdf-lib to fill the official IRS AcroForm PDFs. PDFs are served from
 * /pdf/ (public/pdf/) to avoid CORS.
 *
 * Templates are now PER TAX YEAR. The template path AND the AcroForm field
 * names are resolved per year:
 *
 *   Tax year  | Form 5472 PDF                  | Pro Forma 1120 PDF
 *   ----------|--------------------------------|-----------------------
 *   2024+     | public/pdf/Form-5472.pdf       | public/pdf/Form-1120-2024.pdf
 *   2023      | public/pdf/Form-5472-2023.pdf  | public/pdf/Form-1120-2023.pdf
 *   2022      | public/pdf/Form-5472-2022.pdf  | public/pdf/Form-1120-2022.pdf
 *   2019-2021 | public/pdf/Form-5472-2019-2021.pdf | public/pdf/Form-1120-YYYY.pdf
 *   fallback  | public/pdf/Form-5472.pdf       | public/pdf/Form-1120-Page-1.pdf
 *
 * Field-name maps live in src/lib/form5472Fields.ts (F5472, getF5472Map) and
 * src/lib/form1120Fields.ts (getF1120Map). To add a new year:
 *
 *   1. Drop the AcroForm PDF into public/pdf/.
 *   2. Run `node scripts/audit-pdf-fields.mjs` to see which expected fields
 *      are missing in the new PDF.
 *   3. Update resolveForm5472Path / resolveForm1120Path below, and add a
 *      per-year override in form5472Fields.ts / form1120Fields.ts as needed.
 *
 * Field names are simple flat AcroForm names (NOT XFA dot-paths). Verified
 * by live PDF dump — see scripts/audit-pdf-fields.mjs.
 *
 * ── Form 5472 field map ────────────────────────────────────────────────────────────────────────────
 * See form5472Fields.ts (F5472 constants) for the complete mapping.
 *
 * ── Form 1120 Page 1 field map ────────────────────────────────────────────────────────────────
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
 * TextField    Date            — today's date in MM/DD/YYYY format (IRS Eastern Time)
 * TextField    Title           — filing.signer_title ?? "Owner" (default)
 * TextField    BeginningDate   — month+day only, e.g. "January 1" (year auto-filled by form)
 * TextField    EndingDate      — e.g. "December 31"
 * TextField    EndingYear      — last 2 digits only, e.g. "25" (form pre-prints "20")
 */

import { PDFDocument, PDFCheckBox, PDFTextField, rgb, StandardFonts } from 'pdf-lib';
import { F5472, getF5472Map, type F5472Map } from './form5472Fields';
import { getF1120Map, type F1120Map } from './form1120Fields';
import type { Filing, Transaction, Address } from './supabase';

// Re-exported so legacy imports keep working.
export { F5472 } from './form5472Fields';

// ── IRS mailing address ────────────────────────────────────────────────────────────────────────────
const IRS_MAILING_ADDRESS = [
  'Internal Revenue Service',
  '1973 Rulon White Blvd',
  'M/S 6112 Attn: PIN Unit',
  'Ogden, UT 84201',
];

// ── Per-year template path resolvers ──────────────────────────────────────────
// Files must exist under public/pdf/. Returning a missing path will surface a
// 404 with a helpful message in fetchPdfBytes().
const PDF_BASE = `${import.meta.env.BASE_URL}pdf/`;

function resolveForm5472Path(taxYear: number): string {
  if (taxYear <= 2021) return `${PDF_BASE}Form-5472-2019-2021.pdf`;
  if (taxYear === 2022) return `${PDF_BASE}Form-5472-2022.pdf`;
  if (taxYear === 2023) return `${PDF_BASE}Form-5472-2023.pdf`;
  return `${PDF_BASE}Form-5472.pdf`;
}

function resolveForm1120Path(taxYear: number): string {
  if (taxYear === 2019) return `${PDF_BASE}Form-1120-2019.pdf`;
  if (taxYear === 2020) return `${PDF_BASE}Form-1120-2020.pdf`;
  if (taxYear === 2021) return `${PDF_BASE}Form-1120-2021.pdf`;
  if (taxYear === 2022) return `${PDF_BASE}Form-1120-2022.pdf`;
  if (taxYear === 2023) return `${PDF_BASE}Form-1120-2023.pdf`;
  if (taxYear === 2024) return `${PDF_BASE}Form-1120-2024.pdf`;
  if (taxYear >= 2025)  return `${PDF_BASE}Form-1120-2025.pdf`;
  // Pre-2019 fallback: also lands on the 2025 PDF (closest to the canonical
  // page-1 schema). Users filing pre-2019 returns should not exist in
  // practice since EARLIEST_SUPPORTED_TAX_YEAR is 2019.
  return `${PDF_BASE}Form-1120-2025.pdf`;
}

// Earliest tax year we ship a PDF for. Used by the filing wizard to clamp the
// tax-year selector — keep in sync with resolveForm5472Path coverage.
export const EARLIEST_SUPPORTED_TAX_YEAR = 2019;

function parseTaxYear(year: string | null | undefined): number {
  const n = parseInt((year ?? '').toString(), 10);
  if (!Number.isFinite(n) || n < EARLIEST_SUPPORTED_TAX_YEAR) {
    return new Date().getFullYear() - 1;
  }
  return n;
}

const pdfCache: Record<string, ArrayBuffer> = {};

async function fetchPdfBytes(path: string): Promise<ArrayBuffer> {
  if (pdfCache[path]) return pdfCache[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error(
    `Could not load PDF template at ${path} (${res.status}). ` +
    `Ensure the corresponding file exists under public/pdf/. ` +
    `See resolveForm5472Path / resolveForm1120Path in src/lib/pdfGenerator.ts ` +
    `for the per-year mapping.`
  );
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) throw new Error(
    `PDF at ${path} is too small (${bytes.byteLength} bytes). Re-upload the template.`
  );
  pdfCache[path] = bytes;
  return bytes;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────

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
 * Today's date formatted as MM/DD/YYYY in IRS Eastern Time (America/New_York).
 *
 * The IRS is headquartered in Washington D.C. and processes returns using
 * Eastern Time. Using ET rather than the user's local clock ensures the
 * signature date matches the IRS-jurisdiction date regardless of where the
 * filer is located (e.g., India, Europe).
 *
 * Intl.DateTimeFormat is universally supported in modern browsers and Node.
 */
function todayFormatted(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month:    '2-digit',
    day:      '2-digit',
    year:     'numeric',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('month')}/${get('day')}/${get('year')}`;
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

/**
 * Name + address combined for a single AcroForm field.
 * Produces:  "Full Name - Street, City, Region, Postal, Country"
 * If no address data is available, returns just the name.
 */
function fmtNameAddress(
  name: string | null | undefined,
  addr: Address | null | undefined
): string {
  const namePart = name ?? '';
  if (!addr) return namePart;
  const parts = [
    addr.line1,
    addr.line2,
    addr.city,
    addr.region,
    addr.postal_code,
    addr.country ?? null,
  ].filter(Boolean).join(', ');
  return parts ? `${namePart} - ${parts}` : namePart;
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

/**
 * Build tax period begin: month-day label and year as separate strings.
 *
 * Priority order:
 *  1. If date_of_incorporation falls within taxYear -> use that date as the
 *     period begin (handles initial returns regardless of the initial_return flag).
 *  2. If tax_period_begin is explicitly set -> use that.
 *  3. Default -> January 1 of taxYear.
 *
 * Uses UTC getters throughout.
 */
function resolvePeriodBegin(
  filing: Filing,
  taxYear: string
): { label: string; year: string } {
  // 1. Incorporation date in the tax year -> use it as the beginning date
  if (filing.date_of_incorporation) {
    const d = new Date(filing.date_of_incorporation);
    if (!isNaN(d.getTime()) && String(d.getUTCFullYear()) === taxYear) {
      return {
        label: `${MONTH_NAMES[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`,
        year: taxYear,
      };
    }
  }
  // 2. Explicit tax_period_begin stored on the filing
  if (filing.tax_period_begin) {
    const [yearStr, monthStr, dayStr] = filing.tax_period_begin.split('-');
    const month = parseInt(monthStr, 10);
    const day   = parseInt(dayStr, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { label: `${MONTH_NAMES[month - 1]} ${String(day).padStart(2, '0')}`, year: yearStr };
    }
  }
  // 3. Default - January 1
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
      return { label: `${MONTH_NAMES[month - 1]} ${String(day).padStart(2, '0')}`, year: yearStr };
    }
  }
  return { label: 'December 31', year: taxYear };
}

// ─── Transaction aggregator ───────────────────────────────────────────────────────────────────

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
  // Line 17a (beginning balance) intentionally not collected — always zero.
  borrowed_end: number;   // Line 17b — ending balance of amounts owed to related party
  interest_received: number;
  insurance_received: number;
  loan_guarantee_received: number;
  other_received: number;
  total_received: number; // Line 22 = sum of lines 9–21 (17b used, 17a omitted)
  sales_paid: number;
  tangible_prop_paid: number;
  rents_paid: number;
  royalties_paid: number;
  intangible_paid: number;
  services_paid: number;
  commissions_paid: number;
  // Line 31a (beginning balance) intentionally not collected — always zero.
  loaned_end: number;     // Line 31b — ending balance of amounts owed by related party
  interest_paid: number;
  insurance_paid: number;
  loan_guarantee_paid: number;
  other_paid: number;
  total_paid: number;     // Line 36 = sum of lines 23–35 (31b used, 31a omitted)
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
    borrowed_end: 0,
    interest_received: 0, insurance_received: 0,
    loan_guarantee_received: 0, other_received: 0, total_received: 0,
    sales_paid: 0, tangible_prop_paid: 0,
    rents_paid: 0, royalties_paid: 0,
    intangible_paid: 0, services_paid: 0,
    commissions_paid: 0,
    loaned_end: 0,
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
        // Recorded as the ending balance the LLC owes back to the owner (line 17b).
        t.borrowed_end += amt; t.hasPartIV = true; break;
      case 'loan_from_llc':
        // Recorded as the ending balance the owner owes to the LLC (line 31b).
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
      case 'nonmonetary_other':
        t.hasPartV = true; break;
    }
  }

  // Line 22 = sum of lines 9–21.
  // Line 17 uses only the ENDING balance (17b). Beginning balance (17a) is
  // not collected by the wizard and is excluded from this total.
  t.total_received =
    t.sales_received +           // line 9
    t.tangible_prop_received +   // line 10
    // lines 11, 12 (PCT/CST) always zero for SMLLC
    t.rents_received +           // line 13a
    t.royalties_received +       // line 13b
    t.intangible_received +      // line 14
    t.services_received +        // line 15
    t.commissions_received +     // line 16
    t.borrowed_end +             // line 17b (ending balance — part of lines 1f on the form)
    t.interest_received +        // line 18
    t.insurance_received +       // line 19
    t.loan_guarantee_received +  // line 20
    t.other_received;            // line 21

  // Line 36 = sum of lines 23–35.
  // Line 31 uses only the ENDING balance (31b). Beginning balance (31a) is
  // not collected by the wizard and is excluded from this total.
  t.total_paid =
    t.sales_paid +               // line 23
    t.tangible_prop_paid +       // line 24
    // lines 25, 26 (PCT/CST) always zero for SMLLC
    t.rents_paid +               // line 27a
    t.royalties_paid +           // line 27b
    t.intangible_paid +          // line 28
    t.services_paid +            // line 29
    t.commissions_paid +         // line 30
    t.loaned_end +               // line 31b (ending balance — part of lines 1h on the form)
    t.interest_paid +            // line 32
    t.insurance_paid +           // line 33
    t.loan_guarantee_paid +      // line 34
    t.other_paid;                // line 35

  return t;
}

// ─── Form 5472 filler ──────────────────────────────────────────────────────────────────────────────

export async function fillForm5472(
  filing: Filing,
  transactions: Transaction[]
): Promise<Uint8Array> {
  const taxYear    = filing.tax_year ?? String(new Date().getFullYear() - 1);
  const taxYearNum = parseTaxYear(taxYear);
  const F: F5472Map = getF5472Map(taxYearNum);

  const bytes = await fetchPdfBytes(resolveForm5472Path(taxYearNum));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const txn = aggregateTransactions(transactions);

  const isInitial = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getUTCFullYear()) === taxYear
  );

  // ── Header: tax year
  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);
  setText(doc, F.TAX_YEAR_BEGIN,      begin.label, 8);
  setText(doc, F.TAX_YEAR_BEGIN_YEAR, begin.year,  8);
  setText(doc, F.TAX_YEAR_END,        end.label,   8);
  setText(doc, F.TAX_YEAR_END_YEAR,   end.year,    8);

  // ── Part I - Reporting Corporation
  setText(doc, F.CORP_NAME,           filing.llc_name ?? '');
  setText(doc, F.CORP_ADDRESS,        fmtStreet(filing.mailing_address));
  setText(doc, F.CORP_EIN,            fmtEin(filing.ein));
  setText(doc, F.CORP_CITY_STATE_ZIP, fmtCityStateZip(filing.mailing_address));
  setText(doc, F.CORP_TOTAL_ASSETS,   fmt(filing.total_assets));
  setText(doc, F.CORP_ACTIVITY,      filing.naics_description ?? '', 8);
  setText(doc, F.CORP_ACTIVITY_CODE, filing.naics_code ? String(filing.naics_code) : '', 8);
  try {
    if (F.CORP_ACTIVITY) {
      const actField = doc.getForm().getField(F.CORP_ACTIVITY);
      if (actField instanceof PDFTextField) actField.setFontSize(8);
    }
    if (F.CORP_ACTIVITY_CODE) {
      const actCodeField = doc.getForm().getField(F.CORP_ACTIVITY_CODE);
      if (actCodeField instanceof PDFTextField) actCodeField.setFontSize(8);
    }
  } catch { /* field not found - already warned in setText */ }

  const grossTotal = txn.total_received + txn.total_paid +
    txn.capital_contribution + txn.distribution +
    txn.formation_costs + txn.property_transfer;
  setText(doc, F.CORP_GROSS_PAYMENTS, fmt(grossTotal));
  setText(doc, F.CORP_NUM_FORMS,      '1');
  setText(doc, F.CORP_GROSS_ALL,      fmt(grossTotal));

  setCheck(doc, F.CONSOLIDATED_FILING, false);
  setCheck(doc, F.INITIAL_RETURN_YES,  isInitial);
  setText(doc,  F.PARTS_VIII_COUNT,   '0');

  setText(doc, F.CORP_COUNTRY_OF_INC,         'United States');
  setText(doc, F.CORP_DATE_OF_INCORPORATION,  fmtDate(filing.date_of_incorporation));
  // The reporting corporation IS the US LLC. Both its country of residence
  // and its country of business are always the United States.
  setText(doc, F.CORP_RESIDENT_COUNTRY,       'United States');
  setText(doc, F.CORP_COUNTRY_BUSINESS,       'United States');

  setCheck(doc, F.FOREIGN_OWNS_50PCT,       true);
  // For a foreign-owned SMLLC the correct Part I checkbox is the
  // "25% foreign-owned disregarded entity" box (box 3).
  setCheck(doc, F.CORP_IS_FOREIGN_OWNED_DE, true);

  // ── Part II - 25% Foreign Shareholder (row 4)
  // For an SMLLC the 100% foreign owner IS the sole 25% shareholder.
  setText(doc, F.SHAREHOLDER_NAME,
    fmtNameAddress(filing.owner_full_name, filing.owner_address ?? filing.mailing_address),
    8
  );
  setText(doc, F.SHAREHOLDER_US_TIN,              filing.owner_us_tin ?? '');
  setText(doc, F.SHAREHOLDER_REFERENCE_ID,        filing.owner_reference_id ?? '');
  setText(doc, F.SHAREHOLDER_FOREIGN_TIN,         filing.owner_foreign_tax_id ?? '');
  setText(doc, F.SHAREHOLDER_COUNTRY_BUSINESS,    filing.owner_country_residence ?? '');
  setText(doc, F.SHAREHOLDER_COUNTRY_CITIZENSHIP, filing.owner_country_citizenship ?? '');
  setText(doc, F.SHAREHOLDER_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // ── Part III - Related Party (line 8e checkboxes)
  //
  // For a foreign-owned SMLLC the logic is always:
  //   Box 2 (related to 25% foreign shareholder) — tick YES
  //   Box 3 (IS the 25% foreign shareholder)     — tick YES
  //   Box 1 (related to reporting corporation)   — tick NO
  //
  // The owner IS the sole 25% shareholder AND is related to themselves as
  // such. There is no complex multi-layer structure for a plain SMLLC, so
  // "related to reporting corporation" (box 1) is never used here.
  setCheck(doc, F.RP_IS_FOREIGN_PERSON, true);
  setCheck(doc, F.RP_IS_US_PERSON,      false);
  setText(doc, F.RP_NAME,
    fmtNameAddress(filing.owner_full_name, filing.owner_address ?? filing.mailing_address),
    8
  );
  setText(doc, F.RP_US_TIN,         filing.owner_us_tin ?? '');
  setText(doc, F.RP_REFERENCE_ID,   filing.owner_reference_id ?? '');
  setText(doc, F.RP_FOREIGN_TIN,    filing.owner_foreign_tax_id ?? '');
  setText(doc, F.RP_ACTIVITY,      filing.owner_business_activity ?? filing.naics_description ?? '', 8);
  setText(doc, F.RP_ACTIVITY_CODE, filing.naics_code ? String(filing.naics_code) : '', 8);
  try {
    if (F.RP_ACTIVITY) {
      const rpActField = doc.getForm().getField(F.RP_ACTIVITY);
      if (rpActField instanceof PDFTextField) rpActField.setFontSize(8);
    }
    if (F.RP_ACTIVITY_CODE) {
      const rpActCodeField = doc.getForm().getField(F.RP_ACTIVITY_CODE);
      if (rpActCodeField instanceof PDFTextField) rpActCodeField.setFontSize(8);
    }
  } catch { /* field not found */ }

  // Line 8e: the related party IS the 25% shareholder (box 3) AND is
  // related to the 25% shareholder (box 2). Box 1 (related to reporting
  // corporation) is always false for the SMLLC use-case.
  setCheck(doc, F.RP_RELATED_TO_CORP,        false); // box 1 — never for SMLLC
  setCheck(doc, F.RP_RELATED_TO_SHAREHOLDER, true);  // box 2 — always tick
  setCheck(doc, F.RP_IS_25PCT_SHAREHOLDER,   true);  // box 3 — always tick

  setText(doc, F.RP_COUNTRY_BUSINESS,
    filing.owner_country_residence ?? '');
  setText(doc, F.RP_RESIDENT_COUNTRY,
    filing.owner_resident_country ?? filing.owner_country_residence ?? '');

  // ── Part IV - Monetary Transactions
  if (txn.hasPartIV) {
    // ── Received block (lines 9–21 → total line 22) ──
    setText(doc, F.LINE_9_SALES_RECEIVED,           fmt(txn.sales_received));
    setText(doc, F.LINE_10_TANGIBLE_PROP_RECEIVED,  fmt(txn.tangible_prop_received));
    setText(doc, F.LINE_11_PCT_PAYMENTS_RECEIVED,   '');
    setText(doc, F.LINE_12_CST_PAYMENTS_RECEIVED,   '');
    setText(doc, F.LINE_13A_RENTS_RECEIVED,         fmt(txn.rents_received));
    setText(doc, F.LINE_13B_ROYALTIES_RECEIVED,     fmt(txn.royalties_received));
    setText(doc, F.LINE_14_INTANGIBLE_RECEIVED,     fmt(txn.intangible_received));
    setText(doc, F.LINE_15_SERVICES_RECEIVED,       fmt(txn.services_received));
    setText(doc, F.LINE_16_COMMISSIONS_RECEIVED,    fmt(txn.commissions_received));
    // Line 17a (beginning balance) is not collected — leave blank.
    // Line 17b (ending balance) feeds into line 22 and is part of "1f" on
    // the summary schedule.
    setText(doc, F.LINE_17B_BORROWED_END,           fmt(txn.borrowed_end));
    setText(doc, F.LINE_18_INTEREST_RECEIVED,       fmt(txn.interest_received));
    setText(doc, F.LINE_19_INSURANCE_RECEIVED,      fmt(txn.insurance_received));
    setText(doc, F.LINE_20_LOAN_GUARANTEE_RECEIVED, fmt(txn.loan_guarantee_received));
    setText(doc, F.LINE_21_OTHER_RECEIVED,          fmt(txn.other_received));
    // Line 22 = sum of lines 9–21 (17b included, 17a omitted).
    setText(doc, F.LINE_22_TOTAL_RECEIVED,          fmt(txn.total_received));

    // ── Paid block (lines 23–35 → total line 36) ──
    setText(doc, F.LINE_23_SALES_PAID,              fmt(txn.sales_paid));
    setText(doc, F.LINE_24_TANGIBLE_PROP_PAID,      fmt(txn.tangible_prop_paid));
    setText(doc, F.LINE_25_PCT_PAYMENTS_PAID,       '');
    setText(doc, F.LINE_26_CST_PAYMENTS_PAID,       '');
    setText(doc, F.LINE_27A_RENTS_PAID,             fmt(txn.rents_paid));
    setText(doc, F.LINE_27B_ROYALTIES_PAID,         fmt(txn.royalties_paid));
    setText(doc, F.LINE_28_INTANGIBLE_PAID,         fmt(txn.intangible_paid));
    setText(doc, F.LINE_29_SERVICES_PAID,           fmt(txn.services_paid));
    setText(doc, F.LINE_30_COMMISSIONS_PAID,        fmt(txn.commissions_paid));
    // Line 31a (beginning balance) is not collected — leave blank.
    // Line 31b (ending balance) feeds into line 36 and is part of "1h" on
    // the summary schedule.
    setText(doc, F.LINE_31B_LOANED_END,             fmt(txn.loaned_end));
    setText(doc, F.LINE_32_INTEREST_PAID,           fmt(txn.interest_paid));
    setText(doc, F.LINE_33_INSURANCE_PAID,          fmt(txn.insurance_paid));
    setText(doc, F.LINE_34_LOAN_GUARANTEE_PAID,     fmt(txn.loan_guarantee_paid));
    setText(doc, F.LINE_35_OTHER_PAID,              fmt(txn.other_paid));
    // Line 36 = sum of lines 23–35 (31b included, 31a omitted).
    setText(doc, F.LINE_36_TOTAL_PAID,              fmt(txn.total_paid));
  }

  // ── Part V / VI checkboxes
  setCheck(doc, F.PART_V_CHECKBOX,  txn.hasPartV);
  setCheck(doc, F.PART_VI_CHECKBOX, true);

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  doc.getForm().updateFieldAppearances(helvetica);

  doc.getForm().flatten();
  return doc.save();
}

// ─── Pro Forma Form 1120 (page 1 only) filler ────────────────────────────────────────────

export async function fillProForma1120(filing: Filing): Promise<Uint8Array> {
  const taxYear    = filing.tax_year ?? String(new Date().getFullYear() - 1);
  const taxYearNum = parseTaxYear(taxYear);
  const F1120: F1120Map = getF1120Map(taxYearNum);

  const bytes = await fetchPdfBytes(resolveForm1120Path(taxYearNum));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const set = (name: string, val: string, fs?: number) => setText(doc, name, val, fs);
  const chk = (name: string, val: boolean) => setCheck(doc, name, val);

  const begin = resolvePeriodBegin(filing, taxYear);
  const end   = resolvePeriodEnd(filing, taxYear);

  set(F1120.BEGINNING_DATE, begin.label,        8);
  set(F1120.ENDING_DATE,    end.label,          8);
  set(F1120.ENDING_YEAR,    end.year.slice(-2), 8);

  set(F1120.CORP_NAME, filing.llc_name ?? '');
  set(F1120.EIN,       fmtEin(filing.ein));

  set(F1120.CORP_ADDRESS,        fmtStreet(filing.mailing_address));
  set(F1120.CORP_CITY_STATE_ZIP, fmtCityStateZip(filing.mailing_address));
  set(F1120.CORP_ADDRESS_LINE1,  fmtStreet(filing.mailing_address));
  set(F1120.CORP_CITY,           filing.mailing_address?.city ?? '');
  set(F1120.CORP_STATE,          filing.mailing_address?.region ?? '');
  set(F1120.CORP_COUNTRY,        filing.mailing_address?.country ?? '');
  set(F1120.CORP_ZIP,            filing.mailing_address?.postal_code ?? '');

  set(F1120.TOTAL_ASSETS,      fmt(filing.total_assets));
  set(F1120.DATE_INCORPORATED, fmtDate(filing.date_of_incorporation));

  const isFinal = !!(
    filing.date_of_closure &&
    String(new Date(filing.date_of_closure).getUTCFullYear()) === taxYear
  );
  const isInitial = filing.initial_return === true || !!(
    filing.date_of_incorporation &&
    String(new Date(filing.date_of_incorporation).getUTCFullYear()) === taxYear
  );
  chk(F1120.INITIAL_RETURN, isInitial);
  chk(F1120.FINAL_RETURN,   isFinal);
  chk(F1120.NAME_CHANGE,    filing.name_change    ?? false);
  chk(F1120.ADDRESS_CHANGE, filing.address_change ?? false);

  set(F1120.SIGNATURE, filing.owner_full_name ?? '');
  // Date field uses IRS Eastern Time so the signature date matches IRS
  // jurisdiction regardless of where the filer generates the PDF.
  set(F1120.DATE,      todayFormatted());
  set(F1120.TITLE,     filing.signer_title ?? 'Owner');

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  doc.getForm().updateFieldAppearances(helvetica);

  doc.getForm().flatten();
  return doc.save();
}

// ─── Combined Statements PDF (Part VI + Part V) ──────────────────────────────────────────────

export async function generateStatementsPdf(
  filing: Filing,
  transactions: Transaction[]
): Promise<Uint8Array> {
  const txn = aggregateTransactions(transactions);
  const taxYear = filing.tax_year ?? String(new Date().getFullYear() - 1);

  const pdfDoc = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

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

  function makePageDrawer(page: ReturnType<typeof pdfDoc.addPage>) {
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

    return { page, margin, drawLine, drawWrapped, drawDivider, getY: () => y, setY: (v: number) => { y = v; } };
  }

  // ── PAGE 1: Part VI Statement
  {
    const p1 = makePageDrawer(pdfDoc.addPage([612, 792]));
    const { drawLine, drawWrapped, drawDivider, page, margin, getY, setY } = p1;

    drawLine('ATTACHMENT TO FORM 5472 - PART VI STATEMENT', boldFont, 10);
    drawLine('Disclosure of Non-Arm\'s Length Service Transaction', boldFont, 10);
    drawLine('Treas. Reg. § 1.6038A-2(b)(7)(ix)', font, 9);
    drawDivider();

    drawLine(`Tax Year:                ${taxYear}`, font, 10);
    drawLine(`Reporting Corporation:   ${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`, font, 10);
    drawLine(`Foreign Related Party:   ${filing.owner_full_name ?? ''}`, font, 10);
    drawDivider();

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

    let y = getY();
    y -= 18;
    setY(y);
    page.drawLine({
      start: { x: margin, y },
      end:   { x: margin + 220, y },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });
    setY(y - 14);
    drawLine(`${filing.owner_full_name ?? ''}  -  Date: ${todayFormatted()}`, font, 9);

    const footerY = 72 - 18;
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

  // ── PAGE 2: Part V Statement
  if (txn.hasPartV) {
    const p2 = makePageDrawer(pdfDoc.addPage([612, 792]));
    const { drawLine, drawWrapped, drawDivider } = p2;

    drawLine('ATTACHMENT TO FORM 5472 - PART V STATEMENT', boldFont, 10);
    drawLine('Non-Monetary and Less-Than-Arm\'s-Length Transactions', boldFont, 10);
    drawDivider();

    drawLine(`Tax Year:                ${taxYear}`, font, 10);
    drawLine(`Reporting Corporation:   ${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`, font, 10);
    drawLine(`Foreign Owner:           ${filing.owner_full_name ?? ''}`, font, 10);
    drawDivider();

    drawWrapped(
      'The following non-monetary or less-than-arm\'s-length transactions occurred ' +
      'between the foreign-owned U.S. disregarded entity and its foreign owner ' +
      'during the tax year, reported pursuant to Treas. Reg. § 1.6038A-2(b)(7):',
      font, 10
    );
    p2.setY(p2.getY() - 4);

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

// ─── Cover Letter ──────────────────────────────────────────────────────────────────────────────────

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

  drawLine('Internal Revenue Service', font, 10);
  for (const line of IRS_MAILING_ADDRESS.slice(1)) {
    drawLine(line, font, 10);
  }
  drawBlank(2);

  drawLine(
    `Re:  Form 5472 Filing Package - Tax Year ${taxYear}`,
    boldFont, 10
  );
  drawLine(
    `     ${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`,
    font, 10
  );
  drawBlank(1);

  drawLine('To Whom It May Concern:', font, 10);
  drawBlank(1);

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

  drawLine('Enclosed:', boldFont, 10);
  drawBlank(0.5, 10);
  drawLine('1.  Pro Forma Form 1120 (cover return)', font, 10, 12);
  drawLine('2.  Form 5472 - Information Return of a 25% Foreign-Owned U.S. Corporation', font, 10, 12);
  drawLine('3.  Part VI Statement - Treas. Reg. § 1.6038A-2(b)(7)(ix)', font, 10, 12);
  drawLine('4.  Part V Statement (if applicable) - Non-Monetary Transactions', font, 10, 12);
  drawBlank(2);

  drawWrapped(
    'Please do not hesitate to contact the undersigned if additional information is required.',
    font, 10
  );
  drawBlank(3);

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

// ─── Filing Instructions page ─────────────────────────────────────────────────────────────────────

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

  drawLine('FILING INSTRUCTIONS', boldFont, 12);
  drawLine(`Form 5472 Package - Tax Year ${taxYear}`, font, 10);
  drawLine(`${filing.llc_name ?? ''} (EIN: ${fmtEin(filing.ein)})`, font, 10);
  drawDivider();

  drawLine('Step 1 - Assemble the Package', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    'Print all documents in this package. Arrange in the following order:',
    font, 10
  );
  drawLine('1.  This cover letter', font, 10, 12);
  drawLine('2.  Pro Forma Form 1120', font, 10, 12);
  drawLine('3.  Form 5472', font, 10, 12);
  drawLine('4.  Part VI Statement', font, 10, 12);
  drawLine('5.  Part V Statement (if included)', font, 10, 12);
  drawBlank(1);

  drawLine('Step 2 - Sign the Documents', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    'The owner/officer must sign and date the Pro Forma Form 1120 in the ' +
    'Signature section. No signature is required on Form 5472 itself.',
    font, 10
  );
  drawBlank(1);

  drawLine('Step 3 - Mail the Package', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    'Send the complete signed package via certified mail or private delivery ' +
    'service (UPS, FedEx, DHL) to:',
    font, 10
  );
  drawBlank(0.5);
  for (const line of IRS_MAILING_ADDRESS) {
    drawLine(line, boldFont, 10, 12);
  }
  drawBlank(1);

  drawLine('Step 4 - Retain a Copy', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    'Keep a complete copy of the filed package (including the certified mail receipt ' +
    'or delivery confirmation) for at least 6 years.',
    font, 10
  );
  drawBlank(1);

  drawLine('Important Deadlines', boldFont, 10);
  drawBlank(0.5);
  drawWrapped(
    `Form 5472 (attached to Pro Forma Form 1120) is due by April 15, ${Number(taxYear) + 1} ` +
    `for calendar-year filers. A 6-month extension may be requested by filing Form 7004 ` +
    `on or before the due date. Failure to timely file may result in a $25,000 penalty ` +
    `per form per tax year.`,
    font, 10
  );

  return pdfDoc.save();
}

// ─── Assemble full filing package ───────────────────────────────────────────────────────────────────
//
// Page order:
//   1. Cover Letter
//   2. Filing Instructions  <- only if delivery method is NOT fax
//   3. Pro Forma Form 1120
//   4. Form 5472
//   5. Statements (Part VI always; Part V if applicable)
//
// Pass deliveryMethod = 'fax' to suppress the instructions page.
// ───────────────────────────────────────────────────────────────────────────────────

export async function assembleFilingPackage(
  filing: Filing,
  transactions: Transaction[],
  deliveryMethod: 'mail' | 'fax' | string = 'mail'
): Promise<Uint8Array> {
  const isFax = deliveryMethod === 'fax';

  const [
    coverBytes,
    instructionsBytes,
    form1120Bytes,
    form5472Bytes,
    statementsBytes,
  ] = await Promise.all([
    generateCoverLetter(filing),
    isFax ? Promise.resolve(null) : generateFilingInstructions(filing),
    fillProForma1120(filing),
    fillForm5472(filing, transactions),
    generateStatementsPdf(filing, transactions),
  ]);

  const merged = await PDFDocument.create();

  async function appendBytes(src: Uint8Array | null): Promise<void> {
    if (!src) return;
    const srcDoc = await PDFDocument.load(src);
    const pages  = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  await appendBytes(coverBytes);
  if (!isFax) await appendBytes(instructionsBytes);
  await appendBytes(form1120Bytes);
  await appendBytes(form5472Bytes);
  await appendBytes(statementsBytes);

  return merged.save();
}
