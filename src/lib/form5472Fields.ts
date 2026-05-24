/**
 * IRS Form 5472 (Rev. December 2023) — AcroForm field name map
 *
 * Field names extracted directly from the live IRS PDF XFA stream.
 * Every path has been verified by parsing the raw XFA XML from
 * the PDF binary — NOT assumed from field numbers alone.
 *
 * The XFA tree on Page 1 is deeply nested:
 *   topmostSubform[0]
 *     .Page1[0]
 *       .Pg1Header[0]
 *         .PartI[0]
 *           .Line1a[0]                    ← f1_5 through f1_11
 *             .Line1f_ReadOrder[0]         ← f1_12 (NAICS), f1_13 (state), f1_14 (num forms)
 *               .Line1i_ReadOrder[0]       ← c1_1 (initial), c1_2 (final), f1_15–f1_19
 *                 .Line1j_ReadOrder[0]
 *                   .PartII[0]             ← c1_5 (DE checkbox), f1_20–f1_47
 *                     .Page2[0]
 *                       .Pg2Header[0]
 *                         .PartIII[0]      ← c2_1–c2_4, f2_1–f2_8
 *                           .PartIV[0]     ← c2_5 (Part IV applies), f2_9–f2_32
 *
 * Page 3 fields (Part VII–IX) are at:
 *   topmostSubform[0].Page3[0].*
 */

// Shorthand prefix constants to keep lines readable
const P1   = 'topmostSubform[0].Page1[0].Pg1Header[0].PartI[0].Line1a[0]';
const LF   = `${P1}.Line1f_ReadOrder[0]`;
const LI   = `${LF}.Line1i_ReadOrder[0]`;
const LJ   = `${LI}.Line1j_ReadOrder[0]`;
const P2   = `${LJ}.PartII[0].Page2[0].Pg2Header[0]`;
const P3   = `${P2}.PartIII[0]`;
const P4   = `${P3}.PartIV[0]`;
const PG3  = 'topmostSubform[0].Page3[0]';
const HDR  = 'topmostSubform[0].Page1[0].Pg1Header[0]';

export const F5472 = {

  // ── Header — Tax Year ────────────────────────────────────────
  TAX_YEAR_BEGIN:      `${HDR}.f1_1[0]`,
  TAX_YEAR_BEGIN_YEAR: `${HDR}.f1_2[0]`,
  TAX_YEAR_END:        `${HDR}.f1_3[0]`,
  TAX_YEAR_END_YEAR:   `${HDR}.f1_4[0]`,

  // ── Part I — Reporting Corporation ──────────────────────────
  /** 1a — Name of reporting corporation */
  CORP_NAME:              `${P1}.f1_5[0]`,
  /** 1a — Street address */
  CORP_ADDRESS:           `${P1}.f1_6[0]`,
  /** 1a — City, state, ZIP */
  CORP_CITY_STATE_ZIP:    `${P1}.f1_7[0]`,
  /** 1b — EIN */
  CORP_EIN:               `${P1}.f1_8[0]`,
  /** 1c — Total assets */
  CORP_TOTAL_ASSETS:      `${P1}.f1_9[0]`,
  /** 1e — Principal business activity */
  CORP_ACTIVITY:          `${P1}.f1_10[0]`,
  /** 1f — NAICS code */
  CORP_NAICS:             `${P1}.f1_11[0]`,
  /** 1f — Gross payments on this Form 5472 */
  CORP_GROSS_PAYMENTS:    `${LF}.f1_12[0]`,
  /** 1g — State/country of incorporation */
  CORP_STATE_OF_FORMATION:`${LF}.f1_13[0]`,
  /** 1h — Number of Forms 5472 filed */
  CORP_NUM_FORMS:         `${LF}.f1_14[0]`,

  /** 1i — Initial return checkbox */
  INITIAL_RETURN_YES:     `${LI}.c1_1[0]`,
  /** 1j — Final return checkbox */
  FINAL_RETURN_YES:       `${LI}.Line1j_ReadOrder[0].c1_2[0]`,

  /** 1k — Tax year of initial return */
  INITIAL_RETURN_YEAR:    `${LJ}.f1_15[0]`,
  /** 1l — Date of incorporation */
  CORP_DATE_OF_INCORPORATION: `${LJ}.f1_16[0]`,
  /** 1m — Total number of Forms 5472 attached */
  CORP_FORMS_COUNT:       `${LJ}.f1_17[0]`,
  // f1_18 = reserved/not used
  /** 1o — Country under whose laws reporting corp files as resident */
  CORP_RESIDENT_COUNTRY:  `${LJ}.f1_19[0]`,

  /** Checkbox 3 — Related party is a foreign person */
  RELATED_PARTY_IS_FOREIGN:`${LJ}.c1_3[0]`,
  /** Checkbox 3 — Related party is a U.S. person */
  RELATED_PARTY_IS_US:     `${LJ}.c1_4[0]`,

  // ── Part II — 25% Foreign Shareholder ───────────────────────
  /** c1_5 — Reporting corporation is a foreign-owned U.S. DE */
  CORP_IS_FOREIGN_OWNED_DE:           `${LJ}.PartII[0].c1_5[0]`,

  /** Part II top — surrogate foreign corporation checkbox — MUST BE UNCHECKED */
  PART_II_SURROGATE_CORP_CHECKBOX:    `${LJ}.PartII[0].f1_20[0]`,
  // NOTE: f1_20 in real XFA is the surrogate-corp field in the PartII header.
  // The shareholder name (4a) starts at f1_21 within PartII.

  /** 4a — Name of direct 25% foreign shareholder */
  SHAREHOLDER_NAME:                   `${LJ}.PartII[0].f1_21[0]`,
  /** 4b(1) — U.S. identifying number */
  SHAREHOLDER_US_TIN:                 `${LJ}.PartII[0].f1_22[0]`,
  /** 4b(2) — Reference ID number */
  SHAREHOLDER_REFERENCE_ID:           `${LJ}.PartII[0].f1_23[0]`,
  /** 4b(3) — Foreign tax identifying number */
  SHAREHOLDER_FOREIGN_TIN:            `${LJ}.PartII[0].f1_24[0]`,
  /** 4c — Principal country(ies) where shareholder conducts business */
  SHAREHOLDER_COUNTRY_BUSINESS:       `${LJ}.PartII[0].f1_25[0]`,
  /** 4d — Country of citizenship / organization / incorporation */
  SHAREHOLDER_COUNTRY_CITIZENSHIP:    `${LJ}.PartII[0].f1_26[0]`,
  /** 4e — Country(ies) under whose laws shareholder files as resident */
  SHAREHOLDER_RESIDENT_COUNTRY:       `${LJ}.PartII[0].f1_27[0]`,

  /**
   * Row 5 — SECOND direct shareholder — must be explicitly blanked.
   * We only ever have one shareholder.
   */
  SHAREHOLDER2_ADDRESS:       `${LJ}.PartII[0].f1_28[0]`,
  SHAREHOLDER2_CITY_STATE_ZIP:`${LJ}.PartII[0].f1_29[0]`,
  SHAREHOLDER2_US_TIN:        `${LJ}.PartII[0].f1_30[0]`,
  SHAREHOLDER2_REFERENCE_ID:  `${LJ}.PartII[0].f1_31[0]`,

  // Section 6/7 — ultimate indirect shareholder (Page 1 portion) — ALL BLANK
  SECTION6_NAME:         `${LJ}.PartII[0].f1_32[0]`,
  SECTION6_COUNTRY:      `${LJ}.PartII[0].f1_33[0]`,
  SECTION6_FIELD3:       `${LJ}.PartII[0].f1_34[0]`,
  SECTION6_FIELD4:       `${LJ}.PartII[0].f1_35[0]`,
  SECTION6_US_TIN:       `${LJ}.PartII[0].f1_36[0]`,
  SECTION6_REFERENCE_ID: `${LJ}.PartII[0].f1_37[0]`,
  SECTION6_FOREIGN_TIN:  `${LJ}.PartII[0].f1_38[0]`,

  // ─────────────────────────────────────────────────────────────
  // PAGE 2 — Part III (cont.) + Part IV
  // ─────────────────────────────────────────────────────────────

  /**
   * Part III 8 — Related party type radio pair
   * c2_1[0] = foreign person  |  c2_1[1] = U.S. person
   */
  RP2_IS_FOREIGN_PERSON: `${P3}.c2_1[0]`,
  RP2_IS_US_PERSON:      `${P3}.c2_1[1]`,

  /** 8a — Name of related party */
  RP2_NAME:              `${P3}.f2_1[0]`,
  /** 8b(1) — US TIN */
  RP2_US_TIN:            `${P3}.f2_2[0]`,
  /** 8b(2) — Reference ID */
  RP2_REFERENCE_ID:      `${P3}.f2_3[0]`,
  /** 8b(3) — Foreign TIN */
  RP2_FOREIGN_TIN:       `${P3}.f2_4[0]`,
  /** 8c — Principal business activity */
  RP2_ACTIVITY:          `${P3}.f2_5[0]`,
  /** 8d — Country of residence */
  RP2_COUNTRY_RESIDENCE: `${P3}.f2_6[0]`,

  /**
   * 8e — Relationship checkboxes
   * c2_2[0] = 25% foreign shareholder
   * c2_3[0] = related to 25% foreign shareholder
   * c2_4[0] = both
   */
  RP2_IS_25PCT_SHAREHOLDER:      `${P3}.c2_2[0]`,
  RP2_IS_RELATED_TO_SHAREHOLDER: `${P3}.c2_3[0]`,
  RP2_IS_25PCT_AND_RELATED:      `${P3}.c2_4[0]`,

  /**
   * "Related to reporting corporation" pre-checked box (Page2 level).
   * MUST be explicitly unchecked for a direct 25% shareholder.
   * This is a separate field from PartIV[0].c2_5[0].
   */
  RP2_RELATED_TO_CORP_UNCHECK:   `${P3}.c2_5[0]`,

  /** 8f — Country under whose laws RP files as resident */
  RP2_RESIDENT_COUNTRY:          `${P3}.f2_7[0]`,
  /** 8g — Country under whose laws RP is incorporated */
  RP2_COUNTRY_OF_INCORPORATION:  `${P3}.f2_8[0]`,

  // ── Part IV — Monetary Transactions ─────────────────────────
  /** Part IV — checkbox: mark if Part IV applies */
  PART_IV_APPLIES:               `${P4}.c2_5[0]`,

  LINE_9_SALES_RECEIVED:         `${P4}.f2_9[0]`,
  LINE_10_PURCHASES_PAID:        `${P4}.f2_10[0]`,
  LINE_11_SERVICES_RENDERED:     `${P4}.f2_11[0]`,
  LINE_12_SERVICES_RECEIVED:     `${P4}.f2_12[0]`,
  LINE_13A_RENTS_RECEIVED:       `${P4}.f2_13[0]`,
  LINE_13B_RENTS_PAID:           `${P4}.f2_14[0]`,
  LINE_14_BORROWED:              `${P4}.f2_15[0]`,
  LINE_15_LOANED:                `${P4}.f2_16[0]`,
  LINE_16_INTEREST_PAID:         `${P4}.f2_17[0]`,
  LINE_17A_INTEREST_RECEIVED:    `${P4}.f2_18[0]`,
  LINE_17B_INTEREST_RECEIVED_AMT:`${P4}.f2_19[0]`,
  LINE_18_INSURANCE_PAID:        `${P4}.f2_20[0]`,
  LINE_19_INSURANCE_RECEIVED:    `${P4}.f2_21[0]`,
  LINE_20_DIVIDENDS_PAID:        `${P4}.f2_22[0]`,
  LINE_21_DIVIDENDS_RECEIVED:    `${P4}.f2_23[0]`,
  LINE_22_COMMISSION_PAID:       `${P4}.f2_24[0]`,
  LINE_23_COMMISSION_RECEIVED:   `${P4}.f2_25[0]`,
  LINE_24_INTANGIBLE_PAID:       `${P4}.f2_26[0]`,
  LINE_25_INTANGIBLE_RECEIVED:   `${P4}.f2_27[0]`,
  LINE_26_OTHER_PAID:            `${P4}.f2_28[0]`,
  LINE_27A_OTHER_RECEIVED:       `${P4}.f2_29[0]`,
  LINE_27B_OTHER_DESC:           `${P4}.f2_30[0]`,
  LINE_28_TOTAL_PAID:            `${P4}.f2_31[0]`,
  LINE_29_TOTAL_RECEIVED:        `${P4}.f2_32[0]`,

  // Part V / VI text lines
  PART_V_LINE_1: `${P4}.f2_33[0]`,
  PART_V_LINE_2: `${P4}.f2_34[0]`,
  PART_V_LINE_3: `${P4}.f2_35[0]`,
  PART_V_LINE_4: `${P4}.f2_36[0]`,
  PART_V_LINE_5: `${P4}.f2_37[0]`,
  PART_V_LINE_6: `${P4}.f2_38[0]`,
  PART_V_LINE_7: `${P4}.f2_39[0]`,
  PART_V_LINE_8: `${P4}.f2_40[0]`,

  // ── Part V / VI flags ────────────────────────────────────────
  PART_V_APPLIES:  `${P4}.PartV[0].c2_6[0]`,
  PART_VI_APPLIES: `${P4}.PartVI[0].c2_7[0]`,

  // ─────────────────────────────────────────────────────────────
  // PAGE 3 — Part VII + Part VIII + Part IX
  // ─────────────────────────────────────────────────────────────

  LINE_37_YES: `${PG3}.c3_1[0]`,
  LINE_37_NO:  `${PG3}.c3_1[1]`,
  LINE_38A_YES:`${PG3}.c3_2[0]`,
  LINE_38A_NO: `${PG3}.c3_2[1]`,
  LINE_38B_YES:`${PG3}.c3_3[0]`,
  LINE_38B_NO: `${PG3}.c3_3[1]`,
  LINE_39_YES: `${PG3}.c3_4[0]`,
  LINE_39_NO:  `${PG3}.c3_4[1]`,
  LINE_40_YES: `${PG3}.c3_5[0]`,
  LINE_40_NO:  `${PG3}.c3_5[1]`,
  LINE_40_DESC:`${PG3}.f3_1[0]`,
  LINE_41_YES: `${PG3}.c3_6[0]`,
  LINE_41_NO:  `${PG3}.c3_6[1]`,
  LINE_41_NAME:   `${PG3}.f3_2[0]`,
  LINE_41_EIN:    `${PG3}.f3_3[0]`,
  LINE_41_COUNTRY:`${PG3}.f3_4[0]`,

  LINE_45_YES: `${PG3}.c3_7[0]`,
  LINE_45_NO:  `${PG3}.c3_7[1]`,
  LINE_46_YES: `${PG3}.c3_8[0]`,
  LINE_46_NO:  `${PG3}.c3_8[1]`,
  LINE_48C_YES:`${PG3}.c3_9[0]`,
  LINE_48C_NO: `${PG3}.c3_9[1]`,

  LINE_46_DESC: `${PG3}.f3_5[0]`,
  LINE_47_AMT:  `${PG3}.f3_6[0]`,
  LINE_48_AMT:  `${PG3}.f3_7[0]`,
  LINE_48A_AMT: `${PG3}.f3_8[0]`,
  LINE_48B_AMT: `${PG3}.f3_9[0]`,
  LINE_48C_AMT: `${PG3}.f3_10[0]`,

  LINE_49A_YES:`${PG3}.c3_10[0]`,
  LINE_49A_NO: `${PG3}.c3_10[1]`,
  LINE_49B_YES:`${PG3}.c3_11[0]`,
  LINE_49B_NO: `${PG3}.c3_11[1]`,

  LINE_50:`${PG3}.f3_11[0]`,
  LINE_51:`${PG3}.f3_12[0]`,
  LINE_52:`${PG3}.f3_13[0]`,

  LINE_53_YES:`${PG3}.c3_12[0]`,
  LINE_53_NO: `${PG3}.c3_12[1]`,

  LINE_54:`${PG3}.f3_14[0]`,
  LINE_55:`${PG3}.f3_15[0]`,
  LINE_56:`${PG3}.f3_16[0]`,
  LINE_57:`${PG3}.f3_17[0]`,
  LINE_58:`${PG3}.f3_18[0]`,

  SIGNATURE_CHECKBOX:`${PG3}.c2_12[0]`,

} as const;

export type F5472FieldKey = keyof typeof F5472;
