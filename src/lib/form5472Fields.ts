/**
 * IRS Form 5472 (Rev. December 2023) — AcroForm field name map
 *
 * Field names were extracted from the live IRS PDF:
 * https://www.irs.gov/pub/irs-pdf/f5472.pdf
 *
 * Each key maps a semantic name used in our app to the exact
 * internal AcroForm field name inside the PDF.
 *
 * Naming convention:  topmostSubform[0].Page{N}[0].{fieldId}
 * We use the short alias (last segment) in comments for readability.
 */

// ─────────────────────────────────────────────────────────────
// PAGE 1 — Header / Tax Year
// ─────────────────────────────────────────────────────────────
export const F5472 = {
  // Header — tax year
  /** Tax year begin — e.g. "January 1" */
  TAX_YEAR_BEGIN:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_1[0]',
  /** Tax year begin year — e.g. "2025" */
  TAX_YEAR_BEGIN_YEAR:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_2[0]',
  /** Tax year end — e.g. "December 31" */
  TAX_YEAR_END:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_3[0]',
  /** Tax year end year — e.g. "2025" */
  TAX_YEAR_END_YEAR:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_4[0]',

  // ── Part I — Reporting Corporation ──────────────────────────
  /** 1a — Name of reporting corporation */
  CORP_NAME:
    'topmostSubform[0].Page1[0].Line1a[0].f1_5[0]',
  /** 1a — Address (street) */
  CORP_ADDRESS:
    'topmostSubform[0].Page1[0].Line1a[0].f1_6[0]',
  /** 1d — Total assets */
  CORP_TOTAL_ASSETS:
    'topmostSubform[0].Page1[0].Line1a[0].f1_7[0]',
  /** 1b — EIN */
  CORP_EIN:
    'topmostSubform[0].Page1[0].f1_8[0]',
  /** 1c — City/state/ZIP */
  CORP_CITY_STATE_ZIP:
    'topmostSubform[0].Page1[0].f1_9[0]',
  /** 1e — Principal business activity */
  CORP_ACTIVITY:
    'topmostSubform[0].Page1[0].f1_10[0]',
  /** 1f — NAICS code */
  CORP_NAICS:
    'topmostSubform[0].Page1[0].f1_11[0]',
  /** 1f — NAICS code (second field on same line) */
  CORP_NAICS_2:
    'topmostSubform[0].Page1[0].Line1f_ReadOrder[0].f1_12[0]',
  /** 1g — Country/state of incorporation */
  CORP_STATE_OF_FORMATION:
    'topmostSubform[0].Page1[0].f1_13[0]',
  /** 1h — Number of Forms 5472 filed */
  CORP_NUM_FORMS:
    'topmostSubform[0].Page1[0].f1_14[0]',
  /** 1i — Initial return checkbox (Yes) */
  INITIAL_RETURN_YES:
    'topmostSubform[0].Page1[0].Line1i_ReadOrder[0].c1_1[0]',
  /** 1j — Final return checkbox */
  FINAL_RETURN_YES:
    'topmostSubform[0].Page1[0].Line1j_ReadOrder[0].c1_2[0]',
  /** 1k — Tax year for which this is the initial return */
  INITIAL_RETURN_YEAR:
    'topmostSubform[0].Page1[0].f1_15[0]',
  /** 1l — Date of incorporation */
  CORP_DATE_OF_INCORPORATION:
    'topmostSubform[0].Page1[0].f1_16[0]',
  /** 1m — Number of Forms 5472 filed (total count field) */
  CORP_FORMS_COUNT:
    'topmostSubform[0].Page1[0].f1_17[0]',
  /** 1n — Foreign related party is (checkbox: foreign person) */
  RELATED_PARTY_IS_FOREIGN:
    'topmostSubform[0].Page1[0].c1_3[0]',
  /** 1n — Foreign related party is (checkbox: U.S. person) */
  RELATED_PARTY_IS_US:
    'topmostSubform[0].Page1[0].c1_4[0]',
  /** 1o — Country under whose laws reporting corp files as resident */
  CORP_RESIDENT_COUNTRY:
    'topmostSubform[0].Page1[0].f1_19[0]',

  // ── Part II — 25% Foreign Shareholder ───────────────────────
  /** 4a — Name of direct 25% foreign shareholder */
  SHAREHOLDER_NAME:
    'topmostSubform[0].Page1[0].f1_20[0]',
  /** 4c — Country(ies) of citizenship/incorporation */
  SHAREHOLDER_COUNTRY_CITIZENSHIP:
    'topmostSubform[0].Page1[0].f1_21[0]',
  /** 4d — Country of residence */
  SHAREHOLDER_COUNTRY_RESIDENCE:
    'topmostSubform[0].Page1[0].f1_22[0]',
  /** 4e — Country under whose laws shareholder files as resident */
  SHAREHOLDER_RESIDENT_COUNTRY:
    'topmostSubform[0].Page1[0].f1_23[0]',
  /** 5a — Address of direct 25% foreign shareholder */
  SHAREHOLDER_ADDRESS:
    'topmostSubform[0].Page1[0].f1_24[0]',
  /** 5a — City/state/ZIP of direct 25% foreign shareholder */
  SHAREHOLDER_CITY_STATE_ZIP:
    'topmostSubform[0].Page1[0].f1_25[0]',
  /** 5b(1) — US identifying number (ITIN/SSN/EIN) */
  SHAREHOLDER_US_TIN:
    'topmostSubform[0].Page1[0].f1_28[0]',
  /** 5b(2) — Reference ID number */
  SHAREHOLDER_REFERENCE_ID:
    'topmostSubform[0].Page1[0].f1_29[0]',
  /** 5b(3) — Foreign tax identifying number */
  SHAREHOLDER_FOREIGN_TIN:
    'topmostSubform[0].Page1[0].f1_30[0]',

  // ── Part III — Related Party ─────────────────────────────────
  /** 6a — Name of related party */
  RELATED_PARTY_NAME:
    'topmostSubform[0].Page1[0].f1_31[0]',
  /** 6a — Country of incorporation/principal place of business */
  RELATED_PARTY_COUNTRY:
    'topmostSubform[0].Page1[0].f1_32[0]',
  /** 6b(1) — US identifying number of related party */
  RELATED_PARTY_US_TIN:
    'topmostSubform[0].Page1[0].f1_35[0]',
  /** 6b(2) — Reference ID number of related party */
  RELATED_PARTY_REFERENCE_ID:
    'topmostSubform[0].Page1[0].f1_36[0]',
  /** 6b(3) — Foreign tax identifying number of related party */
  RELATED_PARTY_FOREIGN_TIN:
    'topmostSubform[0].Page1[0].f1_37[0]',

  // ─────────────────────────────────────────────────────────────
  // PAGE 2 — Part IV Monetary Transactions + Part V/VI flags
  // ─────────────────────────────────────────────────────────────

  /** Part III 8a — Name of related party (Page 2 continuation) */
  RP2_NAME:
    'topmostSubform[0].Page2[0].f2_1[0]',
  /** Part III 8b(1) — US TIN of related party */
  RP2_US_TIN:
    'topmostSubform[0].Page2[0].f2_2[0]',
  /** Part III 8b(2) — Reference ID */
  RP2_REFERENCE_ID:
    'topmostSubform[0].Page2[0].f2_3[0]',
  /** Part III 8b(3) — Foreign TIN */
  RP2_FOREIGN_TIN:
    'topmostSubform[0].Page2[0].f2_4[0]',
  /** Part III 8c — Principal business activity description */
  RP2_ACTIVITY:
    'topmostSubform[0].Page2[0].f2_5[0]',
  /** Part III 8d — Country of residence */
  RP2_COUNTRY_RESIDENCE:
    'topmostSubform[0].Page2[0].f2_6[0]',
  /** Part III 8e — Relationship: 25% foreign shareholder checkbox */
  RP2_IS_25PCT_SHAREHOLDER:
    'topmostSubform[0].Page2[0].c2_2[0]',
  /** Part III 8e — Relationship: related to 25% foreign shareholder */
  RP2_IS_RELATED_TO_SHAREHOLDER:
    'topmostSubform[0].Page2[0].c2_3[0]',
  /** Part III 8e — Relationship: 25% foreign shareholder + related */
  RP2_IS_25PCT_AND_RELATED:
    'topmostSubform[0].Page2[0].c2_4[0]',
  /** Part III 8f — Country under whose laws RP files as resident */
  RP2_RESIDENT_COUNTRY:
    'topmostSubform[0].Page2[0].f2_7[0]',

  // ── Part IV — Monetary Transactions ─────────────────────────
  /** Part IV checkbox — mark if Part IV applies */
  PART_IV_APPLIES:
    'topmostSubform[0].Page2[0].PartIV[0].c2_5[0]',

  /** Line 9  — Sales of inventory (LLC received) */
  LINE_9_SALES_RECEIVED:
    'topmostSubform[0].Page2[0].f2_9[0]',
  /** Line 10 — Purchases of inventory (LLC paid) */
  LINE_10_PURCHASES_PAID:
    'topmostSubform[0].Page2[0].f2_10[0]',
  /** Line 11 — Services rendered to RP */
  LINE_11_SERVICES_RENDERED:
    'topmostSubform[0].Page2[0].f2_11[0]',
  /** Line 12 — Services received from RP */
  LINE_12_SERVICES_RECEIVED:
    'topmostSubform[0].Page2[0].f2_12[0]',
  /** Line 13a — Rents/royalties received */
  LINE_13A_RENTS_RECEIVED:
    'topmostSubform[0].Page2[0].f2_13[0]',
  /** Line 13b — Rents/royalties paid */
  LINE_13B_RENTS_PAID:
    'topmostSubform[0].Page2[0].f2_14[0]',
  /** Line 14 — Amounts borrowed from RP */
  LINE_14_BORROWED:
    'topmostSubform[0].Page2[0].f2_15[0]',
  /** Line 15 — Amounts loaned to RP */
  LINE_15_LOANED:
    'topmostSubform[0].Page2[0].f2_16[0]',
  /** Line 16 — Interest paid to RP */
  LINE_16_INTEREST_PAID:
    'topmostSubform[0].Page2[0].f2_17[0]',
  /** Line 17a — Interest received from RP */
  LINE_17A_INTEREST_RECEIVED:
    'topmostSubform[0].Page2[0].f2_18[0]',
  /** Line 17b — Amount of interest received */
  LINE_17B_INTEREST_RECEIVED_AMT:
    'topmostSubform[0].Page2[0].f2_19[0]',
  /** Line 18 — Premiums paid for insurance/reinsurance */
  LINE_18_INSURANCE_PAID:
    'topmostSubform[0].Page2[0].f2_20[0]',
  /** Line 19 — Premiums received for insurance/reinsurance */
  LINE_19_INSURANCE_RECEIVED:
    'topmostSubform[0].Page2[0].f2_21[0]',
  /** Line 20 — Dividends paid */
  LINE_20_DIVIDENDS_PAID:
    'topmostSubform[0].Page2[0].f2_22[0]',
  /** Line 21 — Dividends received */
  LINE_21_DIVIDENDS_RECEIVED:
    'topmostSubform[0].Page2[0].f2_23[0]',
  /** Line 22 — Commission paid */
  LINE_22_COMMISSION_PAID:
    'topmostSubform[0].Page2[0].f2_24[0]',
  /** Line 23 — Commission received */
  LINE_23_COMMISSION_RECEIVED:
    'topmostSubform[0].Page2[0].f2_25[0]',
  /** Line 24 — Amounts paid to RP for use of intangible property */
  LINE_24_INTANGIBLE_PAID:
    'topmostSubform[0].Page2[0].f2_26[0]',
  /** Line 25 — Amounts received from RP for use of intangible property */
  LINE_25_INTANGIBLE_RECEIVED:
    'topmostSubform[0].Page2[0].f2_27[0]',
  /** Line 26 — Other amounts paid */
  LINE_26_OTHER_PAID:
    'topmostSubform[0].Page2[0].f2_28[0]',
  /** Line 27a — Other amounts received */
  LINE_27A_OTHER_RECEIVED:
    'topmostSubform[0].Page2[0].f2_29[0]',
  /** Line 27b — Description of other amounts */
  LINE_27B_OTHER_DESC:
    'topmostSubform[0].Page2[0].f2_30[0]',
  /** Line 28 — Total of lines 9–27 (paid) */
  LINE_28_TOTAL_PAID:
    'topmostSubform[0].Page2[0].f2_31[0]',
  /** Line 29 — Total of lines 9–27 (received) */
  LINE_29_TOTAL_RECEIVED:
    'topmostSubform[0].Page2[0].f2_32[0]',

  // ── Part V / VI flags ────────────────────────────────────────
  /** Part V checkbox — mark if Part V applies (DE-specific transactions) */
  PART_V_APPLIES:
    'topmostSubform[0].Page2[0].PartV[0].c2_6[0]',
  /** Part VI checkbox — mark if Part VI applies */
  PART_VI_APPLIES:
    'topmostSubform[0].Page2[0].PartVI[0].c2_7[0]',
} as const;

export type F5472FieldKey = keyof typeof F5472;
