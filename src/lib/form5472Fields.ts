/**
 * IRS Form 5472 — AcroForm field name map (per-revision)
 *
 * Field names verified by live PDF dump (scripts/audit-pdf-fields.mjs).
 * These are simple flat AcroForm names — NOT XFA dot-paths.
 *
 * TEMPLATE COVERAGE
 *   Tax year 2024+      -> public/pdf/Form-5472.pdf            (78 fields)
 *   Tax year 2023       -> public/pdf/Form-5472-2023.pdf       (78 fields)
 *   Tax year 2022       -> public/pdf/Form-5472-2022.pdf       (78 fields)
 *   Tax years 2019-2021 -> public/pdf/Form-5472-2019-2021.pdf  (74 fields)
 *
 * NOTES
 *   - The 78-field templates differ from the latest only in the RP_REFERENCE_ID
 *     field name ('Text Field0' vs 'RPRefID').
 *   - The 74-field 2019-2021 template predates Part VIII (cost-sharing). Fields
 *     PARTS_VIII_COUNT, CORP_DATE_OF_INCORPORATION ('Incorp Date'),
 *     LINE_20_LOAN_GUARANTEE_RECEIVED, and LINE_34_LOAN_GUARANTEE_PAID
 *     ('GuaranteePaid') are intentionally empty strings — setText() no-ops
 *     when the field name is ''.
 *   - Rows 5/6/7 (additional shareholders) are NOT present as separate fields;
 *     every template has one combined ShareholderNameAddress field for row 4.
 *   - Part VII Yes/No checkboxes are NOT present in any template.
 *
 * ADDING A NEW YEAR
 *   1. Drop the new AcroForm PDF into public/pdf/.
 *   2. Run `node scripts/audit-pdf-fields.mjs` and read the diff for the new PDF.
 *   3. If field names match the latest map, just register the new file in
 *      resolveTemplate() inside pdfGenerator.ts.
 *   4. If any names changed, add a new entry in F5472_BY_YEAR below.
 */

// Canonical (latest revision) field map. Newer revisions inherit from this
// and override only the keys that changed.
const F5472_LATEST = {

  // ── Header — Tax Year dates
  TAX_YEAR_BEGIN:       'BegDate',          // e.g. "January 1"
  TAX_YEAR_BEGIN_YEAR:  'BegYear',          // e.g. "2025"
  TAX_YEAR_END:         'EndDate',          // e.g. "December 31"
  TAX_YEAR_END_YEAR:    'EndYear',          // e.g. "2025"

  // ── Part I — Reporting Corporation
  CORP_NAME:            'CorporationName',
  CORP_ADDRESS:         'StreetAddress',
  CORP_EIN:             'EIN',
  CORP_CITY_STATE_ZIP:  'CityStateZIP',
  CORP_TOTAL_ASSETS:    'TotalAssets',
  CORP_ACTIVITY:        'CorpBusinessActivity',
  CORP_ACTIVITY_CODE:   'CorpBusActivityCode',

  CORP_GROSS_PAYMENTS:  'GrossPaymentsCurrent5472',  // 1f
  CORP_NUM_FORMS:       'Total5472',                 // 1g
  CORP_GROSS_ALL:       'GrossPaymentsAll5472',      // 1h

  CONSOLIDATED_FILING:      'ConsolFiling',    // checkbox 1i
  INITIAL_RETURN_YES:       'InitialYear',     // checkbox 1j
  PARTS_VIII_COUNT:         'PartVIIICount',   // 1k

  CORP_COUNTRY_OF_INC:          'CorpIncorpCountry',  // 1l
  CORP_DATE_OF_INCORPORATION:   'Incorp Date',         // 1m
  CORP_RESIDENT_COUNTRY:        'CorpResCountry',      // 1n
  CORP_COUNTRY_BUSINESS:        'CorpBusCountry',      // 1o

  FOREIGN_OWNS_50PCT:           'Atleast50%',          // checkbox 2
  CORP_IS_FOREIGN_OWNED_DE:     'Foreign-owned US DE', // checkbox 3

  // ── Part II — 25% Foreign Shareholders
  SURROGATE_CORP_CHECKBOX:      '',   // not present in this template — skip

  SHAREHOLDER_NAME:               'ShareholderNameAddress',
  SHAREHOLDER_US_TIN:             'ShareholderEINSSN',
  SHAREHOLDER_REFERENCE_ID:       'ShareholderRefID',
  SHAREHOLDER_FOREIGN_TIN:        'ShareholderFTIN',
  SHAREHOLDER_COUNTRY_BUSINESS:   'ShareholderBusCountry',
  SHAREHOLDER_COUNTRY_CITIZENSHIP:'ShareholderCitizenCountry',
  SHAREHOLDER_RESIDENT_COUNTRY:   'ShareholderResidentCountry',

  // ── Part III — Related Party
  RP_IS_FOREIGN_PERSON:       'RPForeignPerson',
  RP_IS_US_PERSON:            'RPUSPerson',

  RP_NAME:                    'RPNameAddress',
  RP_US_TIN:                  'RPUSTIN',
  RP_REFERENCE_ID:            'RPRefID',       // 2022+ revision; was 'Text Field0' in pre-2022
  RP_FOREIGN_TIN:             'RPFTIN',
  RP_ACTIVITY:                'RPBusinessActivity',
  RP_ACTIVITY_CODE:           'RPBusinessActivityCode',

  RP_RELATED_TO_CORP:         'RPReltoRepCorp',
  RP_RELATED_TO_SHAREHOLDER:  'RPReltoForShareholder',
  RP_IS_25PCT_SHAREHOLDER:    'RPForeignShareholder',

  RP_COUNTRY_BUSINESS:        'RPBusinessCountry',
  RP_RESIDENT_COUNTRY:        'RPResCountry',

  // ── Part IV — Monetary Transactions
  // Lines 9–22  = AMOUNTS RECEIVED by reporting corp
  // Lines 23–36 = AMOUNTS PAID by reporting corp

  PART_IV_ESTIMATES:              'Estimates',             // checkbox

  // Received
  LINE_9_SALES_RECEIVED:          'StockPurchase',         // sales received
  LINE_10_TANGIBLE_PROP_RECEIVED: 'TangPropSales',         // tangible prop received
  LINE_11_PCT_PAYMENTS_RECEIVED:  'PlatformContReceived',  // platform contrib received
  LINE_12_CST_PAYMENTS_RECEIVED:  'CostSharingReceived',   // cost sharing received
  LINE_13A_RENTS_RECEIVED:        'RentReceived',
  LINE_13B_ROYALTIES_RECEIVED:    'RoyaltyReceived',
  LINE_14_INTANGIBLE_RECEIVED:    'SaleofIntangibleProp',
  LINE_15_SERVICES_RECEIVED:      'ConsiderationReceived',
  LINE_16_COMMISSIONS_RECEIVED:   'CommissionsReceived',
  LINE_17A_BORROWED_BEGIN:        'LoanBorrowedBegBal',
  LINE_17B_BORROWED_END:          'AmountsBorrowed',
  LINE_18_INTEREST_RECEIVED:      'InterestReceived',
  LINE_19_INSURANCE_RECEIVED:     'InsPremiumReceived',
  LINE_20_LOAN_GUARANTEE_RECEIVED:'LoanGuaranteeReceived',
  LINE_21_OTHER_RECEIVED:         'OtherAmountRec',
  LINE_22_TOTAL_RECEIVED:         'TotalReceived',

  // Paid
  LINE_23_SALES_PAID:             'StockSales',
  LINE_24_TANGIBLE_PROP_PAID:     'TangPropPurchase',
  LINE_25_PCT_PAYMENTS_PAID:      'PlatformContPaid',
  LINE_26_CST_PAYMENTS_PAID:      'CostSharTransPaid',
  LINE_27A_RENTS_PAID:            'RentPaid',
  LINE_27B_ROYALTIES_PAID:        'RoyaltiesPaid',
  LINE_28_INTANGIBLE_PAID:        'PurchaseIntangibleProperty',
  LINE_29_SERVICES_PAID:          'ConsiderationPaid',
  LINE_30_COMMISSIONS_PAID:       'CommissionsPaid',
  LINE_31A_LOANED_BEGIN:          'LoanGivenBegBal',
  LINE_31B_LOANED_END:            'LoanGivenEndingBal',
  LINE_32_INTEREST_PAID:          'InterestPaid',
  LINE_33_INSURANCE_PAID:         'InsPremiumPaid',
  LINE_34_LOAN_GUARANTEE_PAID:    'GuaranteePaid',
  LINE_35_OTHER_PAID:             'OtherPayments',
  LINE_36_TOTAL_PAID:             'TotalPaid',

  // Part V — foreign-owned DE transactions (checkbox only)
  PART_V_CHECKBOX:   'TransactionsWithOwner',

  // Part VI — nonmonetary transactions (checkbox only)
  PART_VI_CHECKBOX:  'NonMonetoryTransactionsWithOwner',

  // Part VII Yes/No — NOT present in this template; skipped

} as const;

export type F5472FieldKey = keyof typeof F5472_LATEST;
export type F5472Map = Record<F5472FieldKey, string>;

// Per-revision overrides. Only specify keys whose AcroForm name differs from
// F5472_LATEST. An empty string means "field is absent in this revision —
// setText() will no-op."
// 2022 + 2023 use the same field names as the latest (2024+/2025) revision.
// Keep the constant for future divergences but leave it empty for now.
const OVERRIDES_2022_2023: Partial<F5472Map> = {};

const OVERRIDES_2019_2021: Partial<F5472Map> = {
  // Same RPRefID rename as 2022.
  RP_REFERENCE_ID: 'RPRefID',
  // Fields absent in the 2019-2021 PDF (Part VIII was added in the 2022 rev).
  PARTS_VIII_COUNT:              '',
  CORP_DATE_OF_INCORPORATION:    '',  // 'Incorp Date' absent
  LINE_20_LOAN_GUARANTEE_RECEIVED: '',
  LINE_34_LOAN_GUARANTEE_PAID:   '',  // 'GuaranteePaid' absent
};

function applyOverrides(base: F5472Map, overrides: Partial<F5472Map>): F5472Map {
  return { ...base, ...overrides };
}

/**
 * Resolve the field map for a given tax year. Defaults to the latest map for
 * years past the newest known PDF.
 */
export function getF5472Map(taxYear: number): F5472Map {
  if (taxYear <= 2021) return applyOverrides(F5472_LATEST, OVERRIDES_2019_2021);
  if (taxYear <= 2023) return applyOverrides(F5472_LATEST, OVERRIDES_2022_2023);
  return F5472_LATEST;
}

/**
 * Backwards-compatible export. Equivalent to getF5472Map(latestYear). Prefer
 * getF5472Map(year) in new code so the per-revision overrides take effect.
 */
export const F5472 = F5472_LATEST;
