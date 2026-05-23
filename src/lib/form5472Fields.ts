/**
 * IRS Form 5472 (Rev. December 2023) — AcroForm field name map
 *
 * Field names extracted directly from the live IRS PDF using pdf-lib:
 * https://www.irs.gov/pub/irs-pdf/f5472.pdf
 *
 * Each key maps a semantic name used in our app to the exact
 * internal AcroForm field name inside the PDF.
 *
 * Naming convention:  topmostSubform[0].Page{N}[0].{fieldId}
 *
 * Note on radio/checkbox pairs:
 *   [0] = first option (Yes / option A)
 *   [1] = second option (No / option B)
 *   These share the same base name — setting one does NOT auto-unset the other.
 *   Always set both explicitly.
 */

// ─────────────────────────────────────────────────────────────
// PAGE 1 — Header / Part I / Part II / Part III (start)
// ─────────────────────────────────────────────────────────────
export const F5472 = {

  // ── Header — Tax Year ────────────────────────────────────────
  /** Tax year begin month/day — e.g. "January 1" */
  TAX_YEAR_BEGIN:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_1[0]',
  /** Tax year begin year — e.g. "2025" */
  TAX_YEAR_BEGIN_YEAR:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_2[0]',
  /** Tax year end month/day — e.g. "December 31" */
  TAX_YEAR_END:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_3[0]',
  /** Tax year end year — e.g. "2025" */
  TAX_YEAR_END_YEAR:
    'topmostSubform[0].Page1[0].Pg1Header[0].f1_4[0]',

  // ── Part I — Reporting Corporation ──────────────────────────
  /** 1a — Name of reporting corporation */
  CORP_NAME:
    'topmostSubform[0].Page1[0].Line1a[0].f1_5[0]',
  /** 1a — Street address */
  CORP_ADDRESS:
    'topmostSubform[0].Page1[0].Line1a[0].f1_6[0]',
  /** 1d — Total assets */
  CORP_TOTAL_ASSETS:
    'topmostSubform[0].Page1[0].Line1a[0].f1_7[0]',
  /** 1b — EIN */
  CORP_EIN:
    'topmostSubform[0].Page1[0].f1_8[0]',
  /** 1c — City, state, ZIP */
  CORP_CITY_STATE_ZIP:
    'topmostSubform[0].Page1[0].f1_9[0]',
  /** 1e — Principal business activity */
  CORP_ACTIVITY:
    'topmostSubform[0].Page1[0].f1_10[0]',
  /** 1f — NAICS code (first field) */
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

  /** 1i — Initial return (checkbox) */
  INITIAL_RETURN_YES:
    'topmostSubform[0].Page1[0].Line1i_ReadOrder[0].c1_1[0]',
  /** 1j — Final return (checkbox) */
  FINAL_RETURN_YES:
    'topmostSubform[0].Page1[0].Line1j_ReadOrder[0].c1_2[0]',

  /** 1k — Tax year of initial return */
  INITIAL_RETURN_YEAR:
    'topmostSubform[0].Page1[0].f1_15[0]',
  /** 1l — Date of incorporation */
  CORP_DATE_OF_INCORPORATION:
    'topmostSubform[0].Page1[0].f1_16[0]',
  /** 1m — Total number of Forms 5472 attached */
  CORP_FORMS_COUNT:
    'topmostSubform[0].Page1[0].f1_17[0]',

  /**
   * 1n — Related party is a foreign person (checkbox [0])
   * Always set this to true for foreign-owned single-member LLCs.
   */
  RELATED_PARTY_IS_FOREIGN:
    'topmostSubform[0].Page1[0].c1_3[0]',
  /**
   * 1n — Related party is a U.S. person (checkbox [1])
   * Set false for foreign-owned single-member LLCs.
   */
  RELATED_PARTY_IS_US:
    'topmostSubform[0].Page1[0].c1_4[0]',

  /**
   * c1_5[0] — additional checkbox on Page 1 (line 1o area)
   * Appears to be the "Reporting corporation is a foreign-owned U.S. DE" indicator.
   */
  CORP_IS_FOREIGN_OWNED_DE:
    'topmostSubform[0].Page1[0].c1_5[0]',

  /** 1o — Country under whose laws reporting corp files as resident */
  CORP_RESIDENT_COUNTRY:
    'topmostSubform[0].Page1[0].f1_19[0]',

  // ── Part II — 25% Foreign Shareholder ───────────────────────
  /** 4a — Name of direct 25% foreign shareholder */
  SHAREHOLDER_NAME:
    'topmostSubform[0].Page1[0].f1_20[0]',
  /** 4c — Country(ies) of citizenship / incorporation */
  SHAREHOLDER_COUNTRY_CITIZENSHIP:
    'topmostSubform[0].Page1[0].f1_21[0]',
  /** 4d — Country of residence for tax purposes */
  SHAREHOLDER_COUNTRY_RESIDENCE:
    'topmostSubform[0].Page1[0].f1_22[0]',
  /** 4e — Country under whose laws shareholder files as resident */
  SHAREHOLDER_RESIDENT_COUNTRY:
    'topmostSubform[0].Page1[0].f1_23[0]',
  /** 5a — Street address of direct 25% foreign shareholder */
  SHAREHOLDER_ADDRESS:
    'topmostSubform[0].Page1[0].f1_24[0]',
  /** 5a — City/state/ZIP of direct 25% foreign shareholder */
  SHAREHOLDER_CITY_STATE_ZIP:
    'topmostSubform[0].Page1[0].f1_25[0]',
  /** 5b(1) — US identifying number (SSN / ITIN / EIN) */
  SHAREHOLDER_US_TIN:
    'topmostSubform[0].Page1[0].f1_28[0]',
  /** 5b(2) — Reference ID number */
  SHAREHOLDER_REFERENCE_ID:
    'topmostSubform[0].Page1[0].f1_29[0]',
  /** 5b(3) — Foreign tax identifying number */
  SHAREHOLDER_FOREIGN_TIN:
    'topmostSubform[0].Page1[0].f1_30[0]',

  // ── Part III — Related Party (Page 1 portion) ───────────────
  /** 6a — Name of related party */
  RELATED_PARTY_NAME:
    'topmostSubform[0].Page1[0].f1_31[0]',
  /** 6a — Country of incorporation / principal place of business */
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
  // PAGE 2 — Part III (cont.) + Part IV + Part V/VI flags
  // ─────────────────────────────────────────────────────────────

  /**
   * Part III 8 — Related party type radio pair (Page 2 top)
   * c2_1[0] = foreign person  |  c2_1[1] = U.S. person
   * Always set both explicitly.
   */
  RP2_IS_FOREIGN_PERSON:
    'topmostSubform[0].Page2[0].c2_1[0]',
  RP2_IS_US_PERSON:
    'topmostSubform[0].Page2[0].c2_1[1]',

  /** Part III 8a — Name of related party (Page 2) */
  RP2_NAME:
    'topmostSubform[0].Page2[0].f2_1[0]',
  /** Part III 8b(1) — US TIN */
  RP2_US_TIN:
    'topmostSubform[0].Page2[0].f2_2[0]',
  /** Part III 8b(2) — Reference ID */
  RP2_REFERENCE_ID:
    'topmostSubform[0].Page2[0].f2_3[0]',
  /** Part III 8b(3) — Foreign TIN */
  RP2_FOREIGN_TIN:
    'topmostSubform[0].Page2[0].f2_4[0]',
  /** Part III 8c — Principal business activity */
  RP2_ACTIVITY:
    'topmostSubform[0].Page2[0].f2_5[0]',
  /** Part III 8d — Country of residence */
  RP2_COUNTRY_RESIDENCE:
    'topmostSubform[0].Page2[0].f2_6[0]',

  /**
   * Part III 8e — Relationship checkboxes (three options, pick one)
   * c2_2[0] = 25% foreign shareholder
   * c2_3[0] = related to 25% foreign shareholder
   * c2_4[0] = 25% foreign shareholder AND related
   * For a foreign-owned SMLLC the owner IS the 25% shareholder → c2_2[0] = true.
   */
  RP2_IS_25PCT_SHAREHOLDER:
    'topmostSubform[0].Page2[0].c2_2[0]',
  RP2_IS_RELATED_TO_SHAREHOLDER:
    'topmostSubform[0].Page2[0].c2_3[0]',
  RP2_IS_25PCT_AND_RELATED:
    'topmostSubform[0].Page2[0].c2_4[0]',

  /** Part III 8f — Country under whose laws RP files as resident */
  RP2_RESIDENT_COUNTRY:
    'topmostSubform[0].Page2[0].f2_7[0]',
  /** Part III 8g — Country under whose laws RP is incorporated */
  RP2_COUNTRY_OF_INCORPORATION:
    'topmostSubform[0].Page2[0].f2_8[0]',

  // ── Part IV — Monetary Transactions ─────────────────────────
  /** Part IV — checkbox: mark if Part IV applies */
  PART_IV_APPLIES:
    'topmostSubform[0].Page2[0].PartIV[0].c2_5[0]',

  /** Line 9  — Sales of inventory (amount received by LLC) */
  LINE_9_SALES_RECEIVED:
    'topmostSubform[0].Page2[0].f2_9[0]',
  /** Line 10 — Purchases of inventory (amount paid by LLC) */
  LINE_10_PURCHASES_PAID:
    'topmostSubform[0].Page2[0].f2_10[0]',
  /** Line 11 — Services rendered to related party */
  LINE_11_SERVICES_RENDERED:
    'topmostSubform[0].Page2[0].f2_11[0]',
  /** Line 12 — Services received from related party */
  LINE_12_SERVICES_RECEIVED:
    'topmostSubform[0].Page2[0].f2_12[0]',
  /** Line 13a — Rents/royalties received */
  LINE_13A_RENTS_RECEIVED:
    'topmostSubform[0].Page2[0].f2_13[0]',
  /** Line 13b — Rents/royalties paid */
  LINE_13B_RENTS_PAID:
    'topmostSubform[0].Page2[0].f2_14[0]',
  /** Line 14 — Amounts borrowed from related party */
  LINE_14_BORROWED:
    'topmostSubform[0].Page2[0].f2_15[0]',
  /** Line 15 — Amounts loaned to related party */
  LINE_15_LOANED:
    'topmostSubform[0].Page2[0].f2_16[0]',
  /** Line 16 — Interest paid to related party */
  LINE_16_INTEREST_PAID:
    'topmostSubform[0].Page2[0].f2_17[0]',
  /** Line 17a — Interest received from related party */
  LINE_17A_INTEREST_RECEIVED:
    'topmostSubform[0].Page2[0].f2_18[0]',
  /** Line 17b — Interest received amount */
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
  /** Line 22 — Commissions paid */
  LINE_22_COMMISSION_PAID:
    'topmostSubform[0].Page2[0].f2_24[0]',
  /** Line 23 — Commissions received */
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
  /** Line 28 — Total paid (sum of lines 9–27) */
  LINE_28_TOTAL_PAID:
    'topmostSubform[0].Page2[0].f2_31[0]',
  /** Line 29 — Total received (sum of lines 9–27) */
  LINE_29_TOTAL_RECEIVED:
    'topmostSubform[0].Page2[0].f2_32[0]',

  // f2_33 – f2_40 are additional Part IV overflow / Part V text fields
  /** Part V — additional transaction description line 1 */
  PART_V_LINE_1: 'topmostSubform[0].Page2[0].f2_33[0]',
  /** Part V — additional transaction description line 2 */
  PART_V_LINE_2: 'topmostSubform[0].Page2[0].f2_34[0]',
  /** Part V — additional transaction description line 3 */
  PART_V_LINE_3: 'topmostSubform[0].Page2[0].f2_35[0]',
  /** Part V — additional transaction description line 4 */
  PART_V_LINE_4: 'topmostSubform[0].Page2[0].f2_36[0]',
  /** Part V — additional transaction description line 5 */
  PART_V_LINE_5: 'topmostSubform[0].Page2[0].f2_37[0]',
  /** Part V — additional transaction description line 6 */
  PART_V_LINE_6: 'topmostSubform[0].Page2[0].f2_38[0]',
  /** Part V — additional transaction description line 7 */
  PART_V_LINE_7: 'topmostSubform[0].Page2[0].f2_39[0]',
  /** Part V — additional transaction description line 8 */
  PART_V_LINE_8: 'topmostSubform[0].Page2[0].f2_40[0]',

  // ── Part V / VI flags ────────────────────────────────────────
  /** Part V — checkbox: mark if Part V applies (DE-specific transactions) */
  PART_V_APPLIES:
    'topmostSubform[0].Page2[0].PartV[0].c2_6[0]',
  /** Part VI — checkbox: mark if Part VI applies */
  PART_VI_APPLIES:
    'topmostSubform[0].Page2[0].PartVI[0].c2_7[0]',

  // ─────────────────────────────────────────────────────────────
  // PAGE 3 — Part VII + Part VIII + Part IX
  // ─────────────────────────────────────────────────────────────

  /**
   * Part VII — Yes/No pairs for lines 37–43a
   * Pattern: c3_N[0] = Yes, c3_N[1] = No
   * Always set both explicitly.
   */
  /** Line 37 — Was the reporting corporation a participant in any cost sharing arrangement? */
  LINE_37_YES: 'topmostSubform[0].Page3[0].c3_1[0]',
  LINE_37_NO:  'topmostSubform[0].Page3[0].c3_1[1]',

  /** Line 38a — Did the reporting corporation pay or accrue any base erosion payments? */
  LINE_38A_YES: 'topmostSubform[0].Page3[0].c3_2[0]',
  LINE_38A_NO:  'topmostSubform[0].Page3[0].c3_2[1]',

  /** Line 38b — Did it pay or accrue any base erosion tax benefits? */
  LINE_38B_YES: 'topmostSubform[0].Page3[0].c3_3[0]',
  LINE_38B_NO:  'topmostSubform[0].Page3[0].c3_3[1]',

  /** Line 39 — Was any foreign-related party a participant in a U.S. partnership? */
  LINE_39_YES: 'topmostSubform[0].Page3[0].c3_4[0]',
  LINE_39_NO:  'topmostSubform[0].Page3[0].c3_4[1]',

  /** Line 40 — Was any amount described in section 871(m) paid? */
  LINE_40_YES: 'topmostSubform[0].Page3[0].c3_5[0]',
  LINE_40_NO:  'topmostSubform[0].Page3[0].c3_5[1]',

  /** Line 40 — text field (describe) */
  LINE_40_DESC: 'topmostSubform[0].Page3[0].f3_1[0]',

  /** Line 41 — Did any foreign corporation own 5% or more? */
  LINE_41_YES: 'topmostSubform[0].Page3[0].c3_6[0]',
  LINE_41_NO:  'topmostSubform[0].Page3[0].c3_6[1]',

  /** Line 41 — text fields (name, EIN/ref, country) */
  LINE_41_NAME:    'topmostSubform[0].Page3[0].f3_2[0]',
  LINE_41_EIN:     'topmostSubform[0].Page3[0].f3_3[0]',
  LINE_41_COUNTRY: 'topmostSubform[0].Page3[0].f3_4[0]',

  // ── Part VIII — Additional Yes/No questions ──────────────────
  /**
   * c3_7 – c3_9 pairs: [0] = Yes, [1] = No
   */
  /** Line 45 — Was a Form 3520 required? */
  LINE_45_YES: 'topmostSubform[0].Page3[0].c3_7[0]',
  LINE_45_NO:  'topmostSubform[0].Page3[0].c3_7[1]',

  /** Line 46 — Was a Form 8621 required? */
  LINE_46_YES: 'topmostSubform[0].Page3[0].c3_8[0]',
  LINE_46_NO:  'topmostSubform[0].Page3[0].c3_8[1]',

  /** Line 48c — Was a Form 8858 required? */
  LINE_48C_YES: 'topmostSubform[0].Page3[0].c3_9[0]',
  LINE_48C_NO:  'topmostSubform[0].Page3[0].c3_9[1]',

  /** Part VIII text fields */
  LINE_46_DESC:  'topmostSubform[0].Page3[0].f3_5[0]',
  LINE_47_AMT:   'topmostSubform[0].Page3[0].f3_6[0]',
  LINE_48_AMT:   'topmostSubform[0].Page3[0].f3_7[0]',
  LINE_48A_AMT:  'topmostSubform[0].Page3[0].f3_8[0]',
  LINE_48B_AMT:  'topmostSubform[0].Page3[0].f3_9[0]',
  LINE_48C_AMT:  'topmostSubform[0].Page3[0].f3_10[0]',

  // ── Part IX — Additional Yes/No pairs ───────────────────────
  /** c3_10 pair */
  LINE_49A_YES: 'topmostSubform[0].Page3[0].c3_10[0]',
  LINE_49A_NO:  'topmostSubform[0].Page3[0].c3_10[1]',

  /** c3_11 pair */
  LINE_49B_YES: 'topmostSubform[0].Page3[0].c3_11[0]',
  LINE_49B_NO:  'topmostSubform[0].Page3[0].c3_11[1]',

  /** Part IX text fields — lines 50–53 */
  LINE_50: 'topmostSubform[0].Page3[0].f3_11[0]',
  LINE_51: 'topmostSubform[0].Page3[0].f3_12[0]',
  LINE_52: 'topmostSubform[0].Page3[0].f3_13[0]',

  /** c3_12 pair */
  LINE_53_YES: 'topmostSubform[0].Page3[0].c3_12[0]',
  LINE_53_NO:  'topmostSubform[0].Page3[0].c3_12[1]',

  /** Lines 54–56 text fields */
  LINE_54: 'topmostSubform[0].Page3[0].f3_14[0]',
  LINE_55: 'topmostSubform[0].Page3[0].f3_15[0]',
  LINE_56: 'topmostSubform[0].Page3[0].f3_16[0]',
  LINE_57: 'topmostSubform[0].Page3[0].f3_17[0]',
  LINE_58: 'topmostSubform[0].Page3[0].f3_18[0]',

  /** Page 3 final checkbox (signature area) */
  SIGNATURE_CHECKBOX: 'topmostSubform[0].Page3[0].c2_12[0]',

} as const;

export type F5472FieldKey = keyof typeof F5472;
