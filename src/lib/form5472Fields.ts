/**
 * IRS Form 5472 (Rev. December 2023) — AcroForm field name map
 *
 * Field names extracted directly from the live IRS PDF using pdf-lib:
 * https://www.irs.gov/pub/irs-pdf/f5472.pdf
 *
 * Each key maps a semantic name used in our app to the exact
 * internal AcroForm field name inside the PDF.
 *
 * Verified via: node -e "..." output on 2026-05-23
 *
 * Note on radio/checkbox pairs:
 *   [0] = first option (Yes / option A)
 *   [1] = second option (No / option B)
 *   These share the same base name — setting one does NOT auto-unset the other.
 *   Always set both explicitly.
 *
 * PAGE 1 field layout (confirmed from live PDF dump):
 *   f1_1  = tax year begin month/day         e.g. "January 1"
 *   f1_2  = tax year begin year              e.g. "2025"
 *   f1_3  = tax year end month/day           e.g. "December 31"
 *   f1_4  = tax year end year                e.g. "2025"
 *   f1_5  = corp name
 *   f1_6  = corp street address
 *   f1_7  = corp city, state, ZIP
 *   f1_8  = corp EIN
 *   f1_9  = corp total assets (1c)
 *   f1_10 = principal business activity (1e)
 *   f1_11 = NAICS code (1f first field)
 *   f1_12 = gross payments on this form (1f second/overflow field — Line1f_ReadOrder)
 *   f1_13 = state/country of incorporation (1g)
 *   f1_14 = number of Forms 5472 filed with this 1120 (1h)
 *   c1_1  = initial return checkbox (1i)
 *   c1_2  = final return checkbox   (1j)
 *   f1_15 = initial return tax year (1k)
 *   f1_16 = date of incorporation   (1l)
 *   f1_17 = total Forms 5472 attached (1m)
 *   f1_18 = (reserved / not used)
 *   f1_19 = country(ies) under whose laws reporting corp files as resident (1o)
 *   c1_3  = related party is a foreign person (Part III top / line 3)
 *   c1_4  = related party is a U.S. person
 *   c1_5  = reporting corp is a foreign-owned U.S. DE (line 3 checkbox)
 *
 * Part II — 25% Foreign Shareholder (direct — FIRST shareholder row only)
 *   f1_20 = 4a  name of direct 25% foreign shareholder
 *   f1_21 = 4c  principal country(ies) where business is conducted
 *   f1_22 = 4d  country of citizenship / organization / incorporation
 *   f1_23 = 4e  country(ies) under whose laws shareholder files as resident
 *   f1_24 = 5a  street address  (second direct shareholder row — MUST BE BLANK)
 *   f1_25 = 5a  city/state/ZIP  (second direct shareholder row — MUST BE BLANK)
 *   f1_26 = 4b(1) U.S. identifying number (SSN/ITIN/EIN)
 *   f1_27 = 4b(2) reference ID number
 *   f1_28 = 4b(3) foreign tax identifying number (FTIN)
 *   f1_29 = 5b(1) U.S. identifying number  (SECOND shareholder — MUST BE BLANK)
 *   f1_30 = 5b(2) reference ID             (SECOND shareholder — MUST BE BLANK)
 *   — 5b(3) FTIN and 5c/5d are overflow fields further down (also blank)
 *
 * Part III (Page 1 portion — section 6/7, ultimate indirect shareholder)
 *   f1_31 = 6a  name of ultimate indirect 25% foreign shareholder (MUST BE BLANK)
 *   f1_32 = 6a  country                                           (MUST BE BLANK)
 *   f1_33–f1_37 = 6b/6c/6d/6e fields                             (MUST BE BLANK)
 *
 * PAGE 2 — Part III section 8 (the actual Related Party section used by us)
 *   c2_1[0] = 8  foreign person | c2_1[1] = U.S. person
 *   f2_1    = 8a name
 *   f2_2    = 8b(1) US TIN
 *   f2_3    = 8b(2) reference ID
 *   f2_4    = 8b(3) foreign TIN
 *   f2_5    = 8c  principal business activity
 *   f2_6    = 8d  country of residence
 *   c2_2[0] = 8e  25% foreign shareholder
 *   c2_3[0] = 8e  related to 25% foreign shareholder
 *   c2_4[0] = 8e  both
 *
 * IMPORTANT — c2_5 dual-use:
 *   c2_5[0] appears TWICE in the form logic:
 *   1. As the Part IV "applies" checkbox (PartIV[0].c2_5[0]).
 *   2. As the "Related to reporting corporation" pre-checked box in Part III 8e
 *      (Page2[0].c2_5[0]) — must be explicitly UNCHECKED for a direct shareholder
 *      who IS the reporting corp owner.
 *   These are DIFFERENT fields at different XFA paths — see below.
 *
 *   f2_7    = 8f  country under whose laws RP files as resident
 *   f2_8    = 8g  country of incorporation
 */

// ─────────────────────────────────────────────────────────────
// PAGE 1 — Header / Part I / Part II / Part III (section 6/7)
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
  /** 1a — City, state, ZIP  (3rd field in Line1a group) */
  CORP_CITY_STATE_ZIP:
    'topmostSubform[0].Page1[0].Line1a[0].f1_7[0]',
  /** 1b — EIN */
  CORP_EIN:
    'topmostSubform[0].Page1[0].f1_8[0]',
  /** 1c — Total assets */
  CORP_TOTAL_ASSETS:
    'topmostSubform[0].Page1[0].f1_9[0]',
  /** 1e — Principal business activity */
  CORP_ACTIVITY:
    'topmostSubform[0].Page1[0].f1_10[0]',
  /** 1f — NAICS code (first field on line 1f) */
  CORP_NAICS:
    'topmostSubform[0].Page1[0].f1_11[0]',
  /**
   * 1f — Gross payments on this Form 5472 (second/overflow field on the 1f line).
   * Capital contributions (Part V) and Part IV totals both feed into this.
   * Write the total gross payments amount here — NOT the NAICS code.
   */
  CORP_GROSS_PAYMENTS:
    'topmostSubform[0].Page1[0].Line1f_ReadOrder[0].f1_12[0]',
  /** 1g — State/country of incorporation — e.g. "Delaware" */
  CORP_STATE_OF_FORMATION:
    'topmostSubform[0].Page1[0].f1_13[0]',
  /** 1h — Number of Forms 5472 filed with this return — always "1" */
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
  /** 1m — Total number of Forms 5472 attached — always "1" */
  CORP_FORMS_COUNT:
    'topmostSubform[0].Page1[0].f1_17[0]',

  /** Checkbox 3 — Related party is a foreign person */
  RELATED_PARTY_IS_FOREIGN:
    'topmostSubform[0].Page1[0].c1_3[0]',
  /** Checkbox 3 — Related party is a U.S. person */
  RELATED_PARTY_IS_US:
    'topmostSubform[0].Page1[0].c1_4[0]',

  /** c1_5[0] — Reporting corporation is a foreign-owned U.S. DE */
  CORP_IS_FOREIGN_OWNED_DE:
    'topmostSubform[0].Page1[0].c1_5[0]',

  /** 1o — Country under whose laws reporting corp files as resident */
  CORP_RESIDENT_COUNTRY:
    'topmostSubform[0].Page1[0].f1_19[0]',

  // ── Part II — 25% Foreign Shareholder ───────────────────────
  // Row 4: DIRECT shareholder — name, country fields, and TIN fields
  /** 4a — Name of direct 25% foreign shareholder */
  SHAREHOLDER_NAME:
    'topmostSubform[0].Page1[0].f1_20[0]',
  /** 4c — Principal country(ies) where shareholder conducts business */
  SHAREHOLDER_COUNTRY_BUSINESS:
    'topmostSubform[0].Page1[0].f1_21[0]',
  /** 4d — Country of citizenship / organization / incorporation */
  SHAREHOLDER_COUNTRY_CITIZENSHIP:
    'topmostSubform[0].Page1[0].f1_22[0]',
  /** 4e — Country(ies) under whose laws shareholder files as resident */
  SHAREHOLDER_RESIDENT_COUNTRY:
    'topmostSubform[0].Page1[0].f1_23[0]',

  /**
   * 4b(1) — U.S. identifying number (SSN / ITIN / EIN) of direct shareholder.
   * Field f1_26 — verified from live PDF dump.
   * NOTE: f1_24 and f1_25 are the 5a address fields for the SECOND shareholder row.
   *       Do NOT use f1_24/f1_25 for TIN data.
   */
  SHAREHOLDER_US_TIN:
    'topmostSubform[0].Page1[0].f1_26[0]',
  /** 4b(2) — Reference ID number of direct shareholder */
  SHAREHOLDER_REFERENCE_ID:
    'topmostSubform[0].Page1[0].f1_27[0]',
  /** 4b(3) — Foreign tax identifying number (FTIN) of direct shareholder */
  SHAREHOLDER_FOREIGN_TIN:
    'topmostSubform[0].Page1[0].f1_28[0]',

  /**
   * Row 5: SECOND direct shareholder — must be explicitly blanked.
   * These map to the 5a address row and 5b TIN row for a second shareholder.
   * We only ever have one shareholder, so these must all be empty strings.
   */
  SHAREHOLDER2_ADDRESS:
    'topmostSubform[0].Page1[0].f1_24[0]',
  SHAREHOLDER2_CITY_STATE_ZIP:
    'topmostSubform[0].Page1[0].f1_25[0]',
  SHAREHOLDER2_US_TIN:
    'topmostSubform[0].Page1[0].f1_29[0]',
  SHAREHOLDER2_REFERENCE_ID:
    'topmostSubform[0].Page1[0].f1_30[0]',

  /**
   * Part II top — "surrogate foreign corporation under §7874" checkbox.
   * Must be explicitly UNCHECKED — never applies to Indian individual owner of DE LLC.
   * Field is at the top of the Part II section header.
   */
  PART_II_SURROGATE_CORP_CHECKBOX:
    'topmostSubform[0].Page1[0].c1_6[0]',

  // ── Section 6 / 7 — Ultimate indirect shareholder (Page 1 portion)
  // These fields (f1_31–f1_37) appear BELOW Part II and are for a DIFFERENT entity
  // (the ultimate indirect 25% foreign shareholder, sections 6 and 7).
  // We only have a direct shareholder, so ALL of these must be blank.
  SECTION6_NAME:         'topmostSubform[0].Page1[0].f1_31[0]',
  SECTION6_COUNTRY:      'topmostSubform[0].Page1[0].f1_32[0]',
  SECTION6_FIELD3:       'topmostSubform[0].Page1[0].f1_33[0]',
  SECTION6_FIELD4:       'topmostSubform[0].Page1[0].f1_34[0]',
  SECTION6_US_TIN:       'topmostSubform[0].Page1[0].f1_35[0]',
  SECTION6_REFERENCE_ID: 'topmostSubform[0].Page1[0].f1_36[0]',
  SECTION6_FOREIGN_TIN:  'topmostSubform[0].Page1[0].f1_37[0]',

  // ─────────────────────────────────────────────────────────────
  // PAGE 2 — Part III (cont.) + Part IV + Part V/VI flags
  // ─────────────────────────────────────────────────────────────

  /**
   * Part III 8 — Related party type radio pair (Page 2 top)
   * c2_1[0] = foreign person  |  c2_1[1] = U.S. person
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
   * Part III 8e — Relationship checkboxes (three options, pick exactly one)
   * c2_2[0] = 25% foreign shareholder
   * c2_3[0] = related to 25% foreign shareholder (NOT the shareholder themselves)
   * c2_4[0] = 25% foreign shareholder AND related to reporting corp
   */
  RP2_IS_25PCT_SHAREHOLDER:
    'topmostSubform[0].Page2[0].c2_2[0]',
  RP2_IS_RELATED_TO_SHAREHOLDER:
    'topmostSubform[0].Page2[0].c2_3[0]',
  RP2_IS_25PCT_AND_RELATED:
    'topmostSubform[0].Page2[0].c2_4[0]',

  /**
   * Part III 8e — "Related to reporting corporation" pre-checked box.
   * This is Page2[0].c2_5[0] — a SEPARATE field from PartIV[0].c2_5[0].
   * Must be explicitly UNCHECKED when the related party IS the direct 25%
   * shareholder (i.e. when RP2_IS_25PCT_SHAREHOLDER is checked).
   * Leaving this un-addressed causes the PDF template's pre-checked state
   * to bleed through after flatten().
   */
  RP2_RELATED_TO_CORP_UNCHECK:
    'topmostSubform[0].Page2[0].c2_5[0]',

  /** Part III 8f — Country under whose laws RP files as resident */
  RP2_RESIDENT_COUNTRY:
    'topmostSubform[0].Page2[0].f2_7[0]',
  /** Part III 8g — Country under whose laws RP is incorporated */
  RP2_COUNTRY_OF_INCORPORATION:
    'topmostSubform[0].Page2[0].f2_8[0]',

  // ── Part IV — Monetary Transactions ─────────────────────────
  /**
   * Part IV — checkbox: mark if Part IV applies.
   * NOTE: This is PartIV[0].c2_5[0] — distinct from Page2[0].c2_5[0]
   * which is the "Related to reporting corporation" checkbox above.
   */
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
  /** Line 17b — Interest received amount (overflow) */
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
  /** Line 24 — Amounts paid for use of intangible property */
  LINE_24_INTANGIBLE_PAID:
    'topmostSubform[0].Page2[0].f2_26[0]',
  /** Line 25 — Amounts received for use of intangible property */
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
  PART_V_LINE_1: 'topmostSubform[0].Page2[0].f2_33[0]',
  PART_V_LINE_2: 'topmostSubform[0].Page2[0].f2_34[0]',
  PART_V_LINE_3: 'topmostSubform[0].Page2[0].f2_35[0]',
  PART_V_LINE_4: 'topmostSubform[0].Page2[0].f2_36[0]',
  PART_V_LINE_5: 'topmostSubform[0].Page2[0].f2_37[0]',
  PART_V_LINE_6: 'topmostSubform[0].Page2[0].f2_38[0]',
  PART_V_LINE_7: 'topmostSubform[0].Page2[0].f2_39[0]',
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

  /** Line 37 — cost sharing arrangement? */
  LINE_37_YES: 'topmostSubform[0].Page3[0].c3_1[0]',
  LINE_37_NO:  'topmostSubform[0].Page3[0].c3_1[1]',

  /** Line 38a — base erosion payments? */
  LINE_38A_YES: 'topmostSubform[0].Page3[0].c3_2[0]',
  LINE_38A_NO:  'topmostSubform[0].Page3[0].c3_2[1]',

  /** Line 38b — base erosion tax benefits? */
  LINE_38B_YES: 'topmostSubform[0].Page3[0].c3_3[0]',
  LINE_38B_NO:  'topmostSubform[0].Page3[0].c3_3[1]',

  /** Line 39 — foreign-related party in U.S. partnership? */
  LINE_39_YES: 'topmostSubform[0].Page3[0].c3_4[0]',
  LINE_39_NO:  'topmostSubform[0].Page3[0].c3_4[1]',

  /** Line 40 — section 871(m) amount paid? */
  LINE_40_YES: 'topmostSubform[0].Page3[0].c3_5[0]',
  LINE_40_NO:  'topmostSubform[0].Page3[0].c3_5[1]',
  LINE_40_DESC: 'topmostSubform[0].Page3[0].f3_1[0]',

  /** Line 41 — foreign corporation own 5% or more? */
  LINE_41_YES: 'topmostSubform[0].Page3[0].c3_6[0]',
  LINE_41_NO:  'topmostSubform[0].Page3[0].c3_6[1]',
  LINE_41_NAME:    'topmostSubform[0].Page3[0].f3_2[0]',
  LINE_41_EIN:     'topmostSubform[0].Page3[0].f3_3[0]',
  LINE_41_COUNTRY: 'topmostSubform[0].Page3[0].f3_4[0]',

  // ── Part VIII ────────────────────────────────────────────────
  /** Line 45 — Form 3520 required? */
  LINE_45_YES: 'topmostSubform[0].Page3[0].c3_7[0]',
  LINE_45_NO:  'topmostSubform[0].Page3[0].c3_7[1]',

  /** Line 46 — Form 8621 required? */
  LINE_46_YES: 'topmostSubform[0].Page3[0].c3_8[0]',
  LINE_46_NO:  'topmostSubform[0].Page3[0].c3_8[1]',

  /** Line 48c — Form 8858 required? */
  LINE_48C_YES: 'topmostSubform[0].Page3[0].c3_9[0]',
  LINE_48C_NO:  'topmostSubform[0].Page3[0].c3_9[1]',

  LINE_46_DESC:  'topmostSubform[0].Page3[0].f3_5[0]',
  LINE_47_AMT:   'topmostSubform[0].Page3[0].f3_6[0]',
  LINE_48_AMT:   'topmostSubform[0].Page3[0].f3_7[0]',
  LINE_48A_AMT:  'topmostSubform[0].Page3[0].f3_8[0]',
  LINE_48B_AMT:  'topmostSubform[0].Page3[0].f3_9[0]',
  LINE_48C_AMT:  'topmostSubform[0].Page3[0].f3_10[0]',

  // ── Part IX ──────────────────────────────────────────────────
  LINE_49A_YES: 'topmostSubform[0].Page3[0].c3_10[0]',
  LINE_49A_NO:  'topmostSubform[0].Page3[0].c3_10[1]',

  LINE_49B_YES: 'topmostSubform[0].Page3[0].c3_11[0]',
  LINE_49B_NO:  'topmostSubform[0].Page3[0].c3_11[1]',

  LINE_50: 'topmostSubform[0].Page3[0].f3_11[0]',
  LINE_51: 'topmostSubform[0].Page3[0].f3_12[0]',
  LINE_52: 'topmostSubform[0].Page3[0].f3_13[0]',

  LINE_53_YES: 'topmostSubform[0].Page3[0].c3_12[0]',
  LINE_53_NO:  'topmostSubform[0].Page3[0].c3_12[1]',

  LINE_54: 'topmostSubform[0].Page3[0].f3_14[0]',
  LINE_55: 'topmostSubform[0].Page3[0].f3_15[0]',
  LINE_56: 'topmostSubform[0].Page3[0].f3_16[0]',
  LINE_57: 'topmostSubform[0].Page3[0].f3_17[0]',
  LINE_58: 'topmostSubform[0].Page3[0].f3_18[0]',

  /** Page 3 final checkbox (signature area) */
  SIGNATURE_CHECKBOX: 'topmostSubform[0].Page3[0].c2_12[0]',

} as const;

export type F5472FieldKey = keyof typeof F5472;
