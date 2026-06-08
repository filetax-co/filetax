/**
 * IRS Pro Forma Form 1120 (page 1) — per-year AcroForm field map
 *
 * Form 5472 attaches to a Pro Forma 1120 (page 1 only). The IRS releases a
 * new revision of Form 1120 each year and they routinely rename internal
 * AcroForm fields between revisions. The maps below were verified by live
 * dump (scripts/audit-pdf-fields.mjs).
 *
 * TEMPLATE COVERAGE
 *   Tax year 2024       -> public/pdf/Form-1120-2024.pdf
 *   Tax year 2023       -> public/pdf/Form-1120-2023.pdf
 *   Tax year 2022       -> public/pdf/Form-1120-2022.pdf
 *   Tax year 2021       -> public/pdf/Form-1120-2021.pdf
 *   Tax year 2020       -> public/pdf/Form-1120-2020.pdf
 *   Tax year 2019       -> public/pdf/Form-1120-2019.pdf
 *   Fallback (no year)  -> public/pdf/Form-1120-Page-1.pdf
 *
 * The "logical" key set is shared (CORP_NAME, CORP_ADDRESS, CITY_STATE_ZIP,
 * EIN, INITIAL_RETURN, ...). A field with name '' means the revision lacks
 * that field — setText/setCheck no-op when the field name is empty.
 *
 * ADDING A NEW YEAR
 *   1. Drop the AcroForm PDF into public/pdf/.
 *   2. Run `node scripts/audit-pdf-fields.mjs`.
 *   3. Register a new entry in F1120_BY_YEAR below using the dumped names.
 */

export type F1120FieldKey =
  | 'CORP_NAME'
  | 'CORP_ADDRESS'         // single street-address field
  | 'CORP_ADDRESS_LINE1'   // split style: street only
  | 'CORP_CITY'
  | 'CORP_STATE'
  | 'CORP_COUNTRY'
  | 'CORP_ZIP'
  | 'CORP_CITY_STATE_ZIP'  // combined style
  | 'EIN'
  | 'TOTAL_ASSETS'
  | 'DATE_INCORPORATED'
  | 'INITIAL_RETURN'
  | 'FINAL_RETURN'
  | 'NAME_CHANGE'
  | 'ADDRESS_CHANGE'
  | 'SIGNATURE'
  | 'DATE'
  | 'TITLE'
  | 'BEGINNING_DATE'
  | 'ENDING_DATE'
  | 'ENDING_YEAR';

export type F1120Map = Record<F1120FieldKey, string>;

function emptyMap(): F1120Map {
  return {
    CORP_NAME: '',
    CORP_ADDRESS: '',
    CORP_ADDRESS_LINE1: '',
    CORP_CITY: '',
    CORP_STATE: '',
    CORP_COUNTRY: '',
    CORP_ZIP: '',
    CORP_CITY_STATE_ZIP: '',
    EIN: '',
    TOTAL_ASSETS: '',
    DATE_INCORPORATED: '',
    INITIAL_RETURN: '',
    FINAL_RETURN: '',
    NAME_CHANGE: '',
    ADDRESS_CHANGE: '',
    SIGNATURE: '',
    DATE: '',
    TITLE: '',
    BEGINNING_DATE: '',
    ENDING_DATE: '',
    ENDING_YEAR: '',
  };
}

// Fallback "Form-1120-Page-1.pdf" — the canonical Pro Forma page-1 template.
const F1120_FALLBACK: F1120Map = {
  ...emptyMap(),
  CORP_NAME:          'CorporateName',
  CORP_ADDRESS_LINE1: 'AddressLine1',
  CORP_CITY:          'City',
  CORP_STATE:         'State',
  CORP_COUNTRY:       'Country',
  CORP_ZIP:           'Zipcode',
  EIN:                'EIN',
  INITIAL_RETURN:     'Initial Return',
  FINAL_RETURN:       'FinalReturn',
  NAME_CHANGE:        'NameChange',
  ADDRESS_CHANGE:     'AddressChange',
  SIGNATURE:          'Signature',
  DATE:               'Date',
  TITLE:              'Title',
  BEGINNING_DATE:     'BeginningDate',
  ENDING_DATE:        'EndingDate',
  ENDING_YEAR:        'EndingYear',
};

// 2019, 2020, 2021, 2022 all share the same field schema.
const F1120_2019_2022: F1120Map = {
  ...emptyMap(),
  CORP_NAME:           'CorporateName',
  CORP_ADDRESS:        'CorporateAddress',
  CORP_CITY_STATE_ZIP: 'CorporateCityStateZIP',
  EIN:                 'EIN',
  TOTAL_ASSETS:        'TotalAssets',
  DATE_INCORPORATED:   'DateIncorporated',
  // Field name has no space (vs the fallback 'Initial Return').
  INITIAL_RETURN:      'InitialReturn',
  FINAL_RETURN:        'FinalReturn',
  NAME_CHANGE:         'NameChange',
  ADDRESS_CHANGE:      'AddressChange',
  SIGNATURE:           'Signature',
  DATE:                'Date',
  TITLE:               'Title',
  BEGINNING_DATE:      'BeginningDate',
  ENDING_DATE:         'EndingDate',
  ENDING_YEAR:         'EndingYear',
};

// 2023 PDF has a typo: 'BeginnningDate' (three n's). The setter resolves
// against this typo intentionally so the field actually fills.
const F1120_2023: F1120Map = {
  ...F1120_2019_2022,
  BEGINNING_DATE: 'BeginnningDate',
};

// 2024 PDF was re-authored with an entirely different naming scheme. It does
// expose EndingDate and EndingYear, but NOT BeginningDate.
const F1120_2024: F1120Map = {
  ...emptyMap(),
  CORP_NAME:           'CompanyName',
  CORP_ADDRESS:        'CompanyAddress',
  CORP_CITY_STATE_ZIP: 'City_State_ZIP',
  EIN:                 'CompanyEIN',
  TOTAL_ASSETS:        'Total_Assets',
  DATE_INCORPORATED:   'IncorporationDate',
  INITIAL_RETURN:      'InitialReturn',
  FINAL_RETURN:        'FinalReturn',
  NAME_CHANGE:         'NameChange',
  ADDRESS_CHANGE:      'AddressChange',
  SIGNATURE:           'OfficerSignature',
  DATE:                'Date',
  TITLE:               'OfficerTitle',
  ENDING_DATE:         'EndingDate',
  ENDING_YEAR:         'EndingYear',
};

/**
 * Resolve the field map for a given tax year. Years past the newest known
 * PDF reuse the latest known map.
 */
export function getF1120Map(taxYear: number): F1120Map {
  // 2025 PDF (formerly named Form-1120-Page-1.pdf) re-uses the canonical
  // 17-field page-1 schema, so we point 2025 at F1120_FALLBACK.
  if (taxYear >= 2025) return F1120_FALLBACK;
  if (taxYear === 2024) return F1120_2024;
  if (taxYear === 2023) return F1120_2023;
  if (taxYear >= 2019 && taxYear <= 2022) return F1120_2019_2022;
  return F1120_FALLBACK;
}

export const F1120_FALLBACK_MAP = F1120_FALLBACK;
