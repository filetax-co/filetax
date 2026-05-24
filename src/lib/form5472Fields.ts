/**
 * IRS Form 5472 (Rev. December 2023) — AcroForm / XFA field name map
 *
 * Field names verified by reading the actual PDF text layer of the latest
 * IRS-issued Form 5472 (Rev. 12-2023).
 *
 * XFA container hierarchy (abbreviated):
 *   topmostSubform[0]
 *     .Page1[0]
 *       .Pg1Header[0]                          ← header date fields
 *         .PartI[0]
 *           .Line1a[0]                         ← corp name/address
 *             .Line1f_ReadOrder[0]             ← 1f gross payments, 1g count, 1h all-forms total
 *               .Line1i_ReadOrder[0]           ← 1i consolidated checkbox, 1j initial checkbox
 *                 .Line1j_ReadOrder[0]
 *                   .Line1l_ReadOrder[0]
 *                     .PartII[0]               ← 4a-7e shareholder rows
 *       .Page2[0]
 *         .Pg2Header[0]
 *           .PartIII[0]                        ← 8a-8g related party
 *             .PartIV[0]                       ← lines 9-36 monetary transactions
 *     .Page3[0]                                ← Part VII/VIII/IX
 */

const P1  = 'topmostSubform[0].Page1[0].Pg1Header[0].PartI[0].Line1a[0]';
const LF  = `${P1}.Line1f_ReadOrder[0]`;
const LI  = `${LF}.Line1i_ReadOrder[0]`;
const LJ  = `${LI}.Line1j_ReadOrder[0]`;
const LL  = `${LJ}.Line1l_ReadOrder[0]`;
const P2  = `${LL}.PartII[0].Page2[0].Pg2Header[0]`;
const P3  = `${P2}.PartIII[0]`;
const P4  = `${P3}.PartIV[0]`;
const PG3 = 'topmostSubform[0].Page3[0]';
const HDR = 'topmostSubform[0].Page1[0].Pg1Header[0]';

export const F5472 = {

  // ── Header — Tax Year dates
  TAX_YEAR_BEGIN:       `${HDR}.f1_1[0]`,  // "January 1" (month day)
  TAX_YEAR_BEGIN_YEAR:  `${HDR}.f1_2[0]`,  // "2025"
  TAX_YEAR_END:         `${HDR}.f1_3[0]`,  // "December 31" (month day)
  TAX_YEAR_END_YEAR:    `${HDR}.f1_4[0]`,  // "2025"

  // ── Part I — Reporting Corporation
  /** 1a — Name of reporting corporation */
  CORP_NAME:            `${P1}.f1_5[0]`,
  /** 1a — Number, street, room/suite */
  CORP_ADDRESS:         `${P1}.f1_6[0]`,
  /** 1b — EIN */
  CORP_EIN:             `${P1}.f1_7[0]`,
  /** 1a — City, state, ZIP (single combined line) */
  CORP_CITY_STATE_ZIP:  `${P1}.f1_8[0]`,
  /** 1c — Total assets */
  CORP_TOTAL_ASSETS:    `${P1}.f1_9[0]`,
  /** 1d — Principal business activity (description) */
  CORP_ACTIVITY:        `${P1}.f1_10[0]`,
  /** 1e — Principal business activity code */
  CORP_ACTIVITY_CODE:   `${P1}.f1_11[0]`,

  /** 1f — Total value of gross payments on THIS Form 5472 */
  CORP_GROSS_PAYMENTS:  `${LF}.f1_12[0]`,
  /** 1g — Total number of Forms 5472 filed */
  CORP_NUM_FORMS:       `${LF}.f1_13[0]`,
  /** 1h — Total value of gross payments on ALL Forms 5472 */
  CORP_GROSS_ALL:       `${LF}.f1_14[0]`,

  /** 1i — Consolidated filing of Form 5472 checkbox */
  CONSOLIDATED_FILING:  `${LI}.c1_1[0]`,
  /** 1j — Initial year for which U.S. reporting corporation is filing checkbox */
  INITIAL_RETURN_YES:   `${LI}.c1_2[0]`,
  /** 1k — Total number of Parts VIII attached */
  PARTS_VIII_COUNT:     `${LI}.f1_15[0]`,

  /** 1l — Country of incorporation */
  CORP_COUNTRY_OF_INC:  `${LJ}.f1_16[0]`,
  /** 1m — Date of incorporation */
  CORP_DATE_OF_INCORPORATION: `${LJ}.f1_17[0]`,
  /** 1n — Country(ies) under whose laws the reporting corp files as resident */
  CORP_RESIDENT_COUNTRY:`${LJ}.f1_18[0]`,
  /** 1o — Principal country(ies) where business is conducted */
  CORP_COUNTRY_BUSINESS:`${LJ}.f1_19[0]`,

  /**
   * Checkbox 2 — Foreign person owned ≥ 50% at any time during year.
   * Always TRUE for a foreign-owned U.S. DE.
   */
  FOREIGN_OWNS_50PCT:   `${LJ}.c1_3[0]`,

  /**
   * Checkbox 3 — Reporting corporation is a foreign-owned U.S. DE.
   * Always TRUE for our use case.
   */
  CORP_IS_FOREIGN_OWNED_DE: `${LJ}.c1_4[0]`,

  // ── Part II — 25% Foreign Shareholders
  /** Surrogate foreign corporation checkbox — always FALSE */
  SURROGATE_CORP_CHECKBOX: `${LL}.c1_5[0]`,

  // Row 4 — first direct 25% foreign shareholder
  SHAREHOLDER_NAME:               `${LL}.PartII[0].f1_20[0]`,
  SHAREHOLDER_US_TIN:             `${LL}.PartII[0].f1_21[0]`,
  SHAREHOLDER_REFERENCE_ID:       `${LL}.PartII[0].f1_22[0]`,
  SHAREHOLDER_FOREIGN_TIN:        `${LL}.PartII[0].f1_23[0]`,
  SHAREHOLDER_COUNTRY_BUSINESS:   `${LL}.PartII[0].f1_24[0]`,
  SHAREHOLDER_COUNTRY_CITIZENSHIP:`${LL}.PartII[0].f1_25[0]`,
  SHAREHOLDER_RESIDENT_COUNTRY:   `${LL}.PartII[0].f1_26[0]`,

  // Row 5 — second direct shareholder (blank)
  SHAREHOLDER2_NAME:          `${LL}.PartII[0].f1_27[0]`,
  SHAREHOLDER2_US_TIN:        `${LL}.PartII[0].f1_28[0]`,
  SHAREHOLDER2_REFERENCE_ID:  `${LL}.PartII[0].f1_29[0]`,
  SHAREHOLDER2_FOREIGN_TIN:   `${LL}.PartII[0].f1_30[0]`,
  SHAREHOLDER2_COUNTRY_BUSINESS:  `${LL}.PartII[0].f1_31[0]`,
  SHAREHOLDER2_COUNTRY_CITIZENSHIP:`${LL}.PartII[0].f1_32[0]`,
  SHAREHOLDER2_RESIDENT_COUNTRY:  `${LL}.PartII[0].f1_33[0]`,

  // Row 6 — ultimate indirect shareholder (blank)
  SHAREHOLDER3_NAME:          `${LL}.PartII[0].f1_34[0]`,
  SHAREHOLDER3_US_TIN:        `${LL}.PartII[0].f1_35[0]`,
  SHAREHOLDER3_REFERENCE_ID:  `${LL}.PartII[0].f1_36[0]`,
  SHAREHOLDER3_FOREIGN_TIN:   `${LL}.PartII[0].f1_37[0]`,
  SHAREHOLDER3_COUNTRY_BUSINESS:   `${LL}.PartII[0].f1_38[0]`,
  SHAREHOLDER3_COUNTRY_CITIZENSHIP:`${LL}.PartII[0].f1_39[0]`,
  SHAREHOLDER3_RESIDENT_COUNTRY:   `${LL}.PartII[0].f1_40[0]`,

  // Row 7 — second ultimate indirect shareholder (blank)
  SHAREHOLDER4_NAME:          `${LL}.PartII[0].f1_41[0]`,
  SHAREHOLDER4_US_TIN:        `${LL}.PartII[0].f1_42[0]`,
  SHAREHOLDER4_REFERENCE_ID:  `${LL}.PartII[0].f1_43[0]`,
  SHAREHOLDER4_FOREIGN_TIN:   `${LL}.PartII[0].f1_44[0]`,
  SHAREHOLDER4_COUNTRY_BUSINESS:   `${LL}.PartII[0].f1_45[0]`,
  SHAREHOLDER4_COUNTRY_CITIZENSHIP:`${LL}.PartII[0].f1_46[0]`,
  SHAREHOLDER4_RESIDENT_COUNTRY:   `${LL}.PartII[0].f1_47[0]`,

  // ── Part III — Related Party (Page 2)
  /** Is related party a foreign person? */
  RP_IS_FOREIGN_PERSON:  `${P3}.c2_1[0]`,
  /** Is related party a U.S. person? */
  RP_IS_US_PERSON:       `${P3}.c2_1[1]`,

  /** 8a — Name and address of related party */
  RP_NAME:               `${P3}.f2_1[0]`,
  /** 8b(1) — U.S. identifying number */
  RP_US_TIN:             `${P3}.f2_2[0]`,
  /** 8b(2) — Reference ID number */
  RP_REFERENCE_ID:       `${P3}.f2_3[0]`,
  /** 8b(3) — FTIN */
  RP_FOREIGN_TIN:        `${P3}.f2_4[0]`,
  /** 8c — Principal business activity */
  RP_ACTIVITY:           `${P3}.f2_5[0]`,
  /** 8d — Principal business activity code */
  RP_ACTIVITY_CODE:      `${P3}.f2_6[0]`,

  /**
   * 8e — Relationship checkboxes
   * c2_2 = Related to reporting corporation
   * c2_3 = Related to 25% foreign shareholder
   * c2_4 = 25% foreign shareholder
   */
  RP_RELATED_TO_CORP:          `${P3}.c2_2[0]`,
  RP_RELATED_TO_SHAREHOLDER:   `${P3}.c2_3[0]`,
  RP_IS_25PCT_SHAREHOLDER:     `${P3}.c2_4[0]`,

  /** 8f — Principal country(ies) where business is conducted */
  RP_COUNTRY_BUSINESS:         `${P3}.f2_7[0]`,
  /** 8g — Country(ies) under whose laws the RP files as resident */
  RP_RESIDENT_COUNTRY:         `${P3}.f2_8[0]`,

  // ── Part IV — Monetary Transactions (Rev. 12-2023 line numbering)
  // Lines 9–22 = AMOUNTS RECEIVED by reporting corp
  // Lines 23–36 = AMOUNTS PAID by reporting corp

  /** Estimates used checkbox */
  PART_IV_ESTIMATES:      `${P4}.c2_5[0]`,

  LINE_9_SALES_RECEIVED:              `${P4}.f2_9[0]`,
  LINE_10_TANGIBLE_PROP_RECEIVED:     `${P4}.f2_10[0]`,
  LINE_11_PCT_PAYMENTS_RECEIVED:      `${P4}.f2_11[0]`,
  LINE_12_CST_PAYMENTS_RECEIVED:      `${P4}.f2_12[0]`,
  LINE_13A_RENTS_RECEIVED:            `${P4}.f2_13[0]`,
  LINE_13B_ROYALTIES_RECEIVED:        `${P4}.f2_14[0]`,
  LINE_14_INTANGIBLE_RECEIVED:        `${P4}.f2_15[0]`,
  LINE_15_SERVICES_RECEIVED:          `${P4}.f2_16[0]`,
  LINE_16_COMMISSIONS_RECEIVED:       `${P4}.f2_17[0]`,
  LINE_17A_BORROWED_BEGIN:            `${P4}.f2_18[0]`,
  LINE_17B_BORROWED_END:              `${P4}.f2_19[0]`,
  LINE_18_INTEREST_RECEIVED:          `${P4}.f2_20[0]`,
  LINE_19_INSURANCE_RECEIVED:         `${P4}.f2_21[0]`,
  LINE_20_LOAN_GUARANTEE_RECEIVED:    `${P4}.f2_22[0]`,
  LINE_21_OTHER_RECEIVED:             `${P4}.f2_23[0]`,
  LINE_22_TOTAL_RECEIVED:             `${P4}.f2_24[0]`,

  LINE_23_SALES_PAID:                 `${P4}.f2_25[0]`,
  LINE_24_TANGIBLE_PROP_PAID:         `${P4}.f2_26[0]`,
  LINE_25_PCT_PAYMENTS_PAID:          `${P4}.f2_27[0]`,
  LINE_26_CST_PAYMENTS_PAID:          `${P4}.f2_28[0]`,
  LINE_27A_RENTS_PAID:                `${P4}.f2_29[0]`,
  LINE_27B_ROYALTIES_PAID:            `${P4}.f2_30[0]`,
  LINE_28_INTANGIBLE_PAID:            `${P4}.f2_31[0]`,
  LINE_29_SERVICES_PAID:              `${P4}.f2_32[0]`,
  LINE_30_COMMISSIONS_PAID:           `${P4}.f2_33[0]`,
  LINE_31A_LOANED_BEGIN:              `${P4}.f2_34[0]`,
  LINE_31B_LOANED_END:                `${P4}.f2_35[0]`,
  LINE_32_INTEREST_PAID:              `${P4}.f2_36[0]`,
  LINE_33_INSURANCE_PAID:             `${P4}.f2_37[0]`,
  LINE_34_LOAN_GUARANTEE_PAID:        `${P4}.f2_38[0]`,
  LINE_35_OTHER_PAID:                 `${P4}.f2_39[0]`,
  LINE_36_TOTAL_PAID:                 `${P4}.f2_40[0]`,

  /**
   * Part V — Foreign-owned U.S. DE reportable transactions
   * This is ONLY a checkbox; the actual description goes on an attached statement.
   */
  PART_V_CHECKBOX:    `${P4}.PartV[0].c2_6[0]`,

  /**
   * Part VI — Nonmonetary / less-than-full-consideration transactions
   * Checkbox only.
   */
  PART_VI_CHECKBOX:   `${P4}.PartVI[0].c2_7[0]`,

  // ── Page 3 — Part VII Additional Information (Yes/No)
  LINE_37_YES:  `${PG3}.c3_1[0]`,
  LINE_37_NO:   `${PG3}.c3_1[1]`,
  LINE_38A_YES: `${PG3}.c3_2[0]`,
  LINE_38A_NO:  `${PG3}.c3_2[1]`,
  LINE_38C_YES: `${PG3}.c3_3[0]`,
  LINE_38C_NO:  `${PG3}.c3_3[1]`,
  LINE_39_YES:  `${PG3}.c3_4[0]`,
  LINE_39_NO:   `${PG3}.c3_4[1]`,
  LINE_40A_YES: `${PG3}.c3_5[0]`,
  LINE_40A_NO:  `${PG3}.c3_5[1]`,
  LINE_40A_AMT: `${PG3}.f3_1[0]`,
  LINE_41A_YES: `${PG3}.c3_6[0]`,
  LINE_41A_NO:  `${PG3}.c3_6[1]`,
  LINE_41B_AMT: `${PG3}.f3_2[0]`,
  LINE_41C_AMT: `${PG3}.f3_3[0]`,
  LINE_41D_AMT: `${PG3}.f3_4[0]`,
  LINE_42A_YES: `${PG3}.c3_7[0]`,
  LINE_42A_NO:  `${PG3}.c3_7[1]`,
  LINE_42B_YES: `${PG3}.c3_8[0]`,
  LINE_42B_NO:  `${PG3}.c3_8[1]`,
  LINE_43A_YES: `${PG3}.c3_9[0]`,
  LINE_43A_NO:  `${PG3}.c3_9[1]`,
  LINE_43B1_AMT:`${PG3}.f3_5[0]`,
  LINE_43B2_AMT:`${PG3}.f3_6[0]`,

  // Part VIII — CSA
  LINE_44_CSA_DESC: `${PG3}.f3_7[0]`,
  LINE_45_YES:  `${PG3}.c3_10[0]`,
  LINE_45_NO:   `${PG3}.c3_10[1]`,
  LINE_46_YES:  `${PG3}.c3_11[0]`,
  LINE_46_NO:   `${PG3}.c3_11[1]`,
  LINE_47_PCT:  `${PG3}.f3_8[0]`,
  LINE_48A_AMT: `${PG3}.f3_9[0]`,
  LINE_48B_AMT: `${PG3}.f3_10[0]`,
  LINE_48C_YES: `${PG3}.c3_12[0]`,
  LINE_48C_NO:  `${PG3}.c3_12[1]`,
  LINE_49A_AMT: `${PG3}.f3_11[0]`,
  LINE_49B_AMT: `${PG3}.f3_12[0]`,

  // Part IX — Base Erosion
  LINE_50_AMT:  `${PG3}.f3_13[0]`,
  LINE_51_AMT:  `${PG3}.f3_14[0]`,
  LINE_52_AMT:  `${PG3}.f3_15[0]`,

} as const;

export type F5472FieldKey = keyof typeof F5472;
