// src/app/pages/intake/constants.ts

// Step 1b is a conditional sub-step that only appears when the original
// filing deadline has already passed.
export type IntakeStep = 1 | '1b' | 2 | 3 | 4 | 5;

export const TAX_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019];

/**
 * The oldest tax year this product will prepare.
 *
 * The Form 5472 requirement for a foreign-owned disregarded entity began for
 * tax years beginning on or after 2017. 2019 is OUR supported floor, chosen
 * rather than derived, and every surface that offers a year has to agree with
 * it. It was written out separately in `MultiYearStart` and in
 * `PenaltyCalculator`, which is how a "we support back to 2019" line ends up
 * beside a picker offering 2018.
 */
export const EARLIEST_TAX_YEAR = 2019;

export const STEP_LABELS: Record<string, string> = {
  1: 'LLC Details',
  '1b': 'Filing Status',
  2: 'Owner Details',
  3: 'Related Parties',
  4: 'Transactions',
  5: 'Review',
};

/**
 * When a return covering a period ending on `periodEndISO` is due.
 *
 * DERIVED, NOT TABULATED
 *
 * This used to be a hardcoded table keyed on the tax year alone. Two things
 * were wrong with that. It ran out at 2025, and the lookup that used it treated
 * a year it did not contain as ON TIME, so the first filing of a newly added
 * year would have been silently declared timely for ever. And because the key
 * was the year, a FISCAL-year filer was measured against the calendar-year
 * deadline: a March year-end 2025 return covers April 2025 to March 2026 and is
 * due 15 July 2026, but the table said 15 April 2026, so the filer was told they
 * were still inside the extension window when they were already three months
 * late - and step 1b, which is the only route to a reasonable cause letter,
 * never appeared.
 *
 * The rule itself is simple and has no exceptions worth tabulating: Form 1120,
 * and with it the Form 5472 that must be attached to it, is due on the 15th day
 * of the 4th month after the tax period ends. That is 3.5 months for a
 * calendar-year filer, giving the familiar 15 April. A timely Form 7004 adds a
 * further 6 months, giving 15 October.
 *
 * WEEKENDS AND HOLIDAYS ARE DELIBERATELY NOT MODELLED
 *
 * A statutory due date falling on a Saturday, Sunday or DC holiday moves to the
 * next business day, which would push some of these out by one to three days.
 * That is not modelled, because the federal holiday calendar (Emancipation Day
 * in particular, which is what makes April 18 a real 1120 deadline in some
 * years) cannot be derived without a holiday table that would need the same
 * annual maintenance this change exists to remove.
 *
 * Erring early is the safe direction. Being a day or two eager to call a return
 * late means offering a reasonable cause letter to someone who may not need one,
 * which costs them a page. Being late to call it late means withholding the
 * letter from someone who does, which costs them the penalty defence. This is
 * a prompt about lateness, not the filer's authoritative deadline, and the
 * instructions page prints the real date.
 */
export function filingDueDates(periodEndISO: string): { original: string; extended: string } {
  const [y, m, d] = periodEndISO.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`filingDueDates: bad period end "${periodEndISO}"`);

  // 15th day of the 4th month after the month the period ends in. Month is
  // 1-based here and 0-based in Date, so `m` alone already means "the month
  // after", and +3 more gets to the fourth.
  const original = new Date(Date.UTC(y, m + 3, 15));
  const extended = new Date(Date.UTC(y, m + 9, 15));
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  return { original: iso(original), extended: iso(extended) };
}

/**
 * The period end a saved filing's deadline actually runs from.
 *
 * A final return's period ends on the dissolution date, so its deadline is the
 * 15th day of the 4th month after THAT, not after 31 December. An LLC dissolved
 * 30 June 2025 is due 15 October 2025, not 15 April 2026, and a dashboard
 * keyed on the tax year alone showed the later date and called a late filing
 * on time.
 *
 * Mirrors resolvePeriod() in pdfGenerator.ts and effectiveTaxPeriodWindow() in
 * Intake.tsx, including the comparison operators: the closure date is taken
 * only when it falls STRICTLY inside the nominal period, so a closure on the
 * first or last day leaves the period unchanged rather than printing a one-day
 * year, and a dissolution recorded against a later year cannot extend this one.
 * The generator already truncated the printed period this way; nothing that
 * computes a deadline did.
 *
 * Takes loose values rather than a Filing so the regression suite can call it
 * without pulling a React page into Node.
 */
export function effectivePeriodEnd(
  taxYear: number | string | null | undefined,
  nominalBeginISO: string | null | undefined,
  nominalEndISO: string | null | undefined,
  finalReturn: boolean | null | undefined,
  dissolutionISO: string | null | undefined,
): string | null {
  const year = Number(taxYear);
  if (!year) return null;
  const begin = nominalBeginISO || `${year}-01-01`;
  const end = nominalEndISO || `${year}-12-31`;
  return finalReturn === true && dissolutionISO && dissolutionISO > begin && dissolutionISO < end
    ? dissolutionISO
    : end;
}

/**
 * Calendar-year due dates by tax year, kept for the dashboard, which shows a
 * deadline per year and has no period to hand. Fiscal filers must go through
 * filingDueDates() with their real period end.
 */
export const FILING_DUE_DATES: Record<number, { original: string; extended: string }> =
  Object.fromEntries(TAX_YEARS.map((y) => [y, filingDueDates(`${y}-12-31`)]));

export type FilingTimingStatus = 'on_time' | 'within_extension' | 'delayed';

// ── Reasonable cause reasons ──────────────────────────────────────────────
// These appear in Step 1b when filing is late.
export const REASONABLE_CAUSE_REASONS: { value: string; label: string; hint: string }[] = [
  {
    value: 'first_time_filing',
    label: 'This is my first time filing in the US',
    hint: 'No prior US tax compliance experience as a foreign-owned LLC.',
  },
  {
    value: 'not_informed',
    label: 'The formation service that set up my LLC never told me Form 5472 was required',
    hint: 'You relied on the online service or agent that formed the entity, and it did not mention this filing.',
  },
  {
    value: 'no_tax_liability',
    label: 'I thought no US tax meant no filing needed',
    hint: 'Believed that zero US tax liability meant no forms were due.',
  },
  {
    value: 'minimal_activity',
    label: 'The LLC had little or no activity during the year',
    hint: 'Business was dormant or had very limited transactions.',
  },
  {
    value: 'language_barrier',
    label: 'Language barrier or unfamiliarity with US tax rules',
    hint: 'English is not my first language; US tax system was unfamiliar.',
  },
  {
    value: 'discovered_late',
    label: 'I only found out about this requirement recently',
    hint: 'Discovered the obligation through a professional review or self-research after the deadline.',
  },
  {
    value: 'voluntary_filing',
    label: 'I am filing voluntarily as soon as I found out',
    hint: 'Coming forward proactively rather than waiting for IRS contact.',
  },
  {
    value: 'new_procedures',
    label: 'I have set up procedures to stay compliant going forward',
    hint: 'New internal controls or professional relationships in place for future years.',
  },
];

// ── TX_TYPES ──────────────────────────────────────────────────────────────
// Each entry has:
//   value, internal key stored in DB
//   label, short label shown on the card
//   sentence, plain-English sentence; uses {party} and {amount} as placeholders
//   category, 1 = DIY-safe, 2 = may need CPA, 3 = refer to CPA
//   part, 'IV' | 'V' | 'VI'
//   showDirection, whether to show the paid/received dropdown (Part IV monetary flows only)
//   fixedDirection, the direction this type ALWAYS has, or the default the
//                    dropdown opens on when `showDirection` is also set.
//
//                    Direction is not cosmetic: for every Part IV type it picks
//                    which side of the form the amount lands on (a purchase of
//                    goods is line 24, a sale is line 10). Types with no
//                    dropdown used to be written as 'received' unconditionally,
//                    which put every `tangible_purchase` on the sales line and
//                    every dissolution payout on "other amounts received". A
//                    type whose direction is knowable states it here; a type
//                    whose direction is genuinely the filer's to say sets
//                    `showDirection` and, optionally, the sensible default.
//   amountLabel, custom label for the amount field
//   amountHint, optional hint shown under amount
//   amountOptional, true if amount can be omitted
//   notThis, plain-English NEGATIVE definition: what this is NOT.
//                    Picking the wrong type produces a wrong return rather
//                    than an error, and the pairs people actually confuse
//                    (a capital contribution called a loan, a service fee
//                    called a royalty) land in different Parts of the form.
//                    Saying what does not count prevents more damage than
//                    restating what does.
//   ownerCategory, tier to use when the counterparty IS the sole owner.
//                    Transactions between a disregarded entity and its own
//                    owner are not recognised for income tax purposes; they
//                    are reportable only because 26 CFR 301.7701-2(c)(2)(vi)
//                    makes the LLC a corporation for section 6038A alone. So
//                    an owner loan is a bookkeeping entry, while the same
//                    type against a non-owner related party is a real loan
//                    with interest and sourcing consequences. Falls back to
//                    `category` when unset.

export const TX_TYPES: {
  value: string;
  label: string;
  sentence: string;
  category: 1 | 2 | 3;
  ownerCategory?: 1 | 2 | 3;
  part: 'IV' | 'V' | 'VI';
  showDirection: boolean;
  fixedDirection?: 'paid' | 'received';
  amountLabel?: string;
  amountHint?: string;
  amountOptional?: boolean;
  notThis?: string;
}[] = [

  // ── Part IV, Goods & property ─────────────────────────────────────────
  //
  // FOUR cards, because Form 5472 splits goods twice: by direction, and by
  // whether the goods are STOCK IN TRADE (inventory, held for resale) or
  // tangible property other than stock in trade.
  //
  //     line 9  inventory sold        line 23  inventory bought
  //     line 10 other property sold   line 24  other property bought
  //
  // There used to be three cards, and two of them were wrong. `tangible_purchase`
  // read "Purchase of goods OR INVENTORY" and printed on line 24, whose own
  // caption says "other than stock in trade", so every inventory purchase was
  // reported on the line that exists to exclude it. Line 23 was unreachable:
  // the only card mapping to canonical `sales` was the SALE card, which carries
  // fixedDirection 'received'. And the sell side contradicted itself, since
  // "Sale of goods or inventory" (line 10) and "Sale of stock in trade" (line 9)
  // both accepted an inventory sale, so the line depended on which card the
  // filer happened to open.
  //
  // The labels now name the distinction rather than the direction alone, and
  // each card says what it is NOT, because this is a pair filers confuse and
  // picking the wrong one produces a wrong return rather than an error.
  {
    value: 'inventory_purchase',
    label: 'Purchase of inventory (goods for resale)',
    sentence: 'The LLC bought inventory, goods held for resale, from {party}',
    category: 1,
    part: 'IV',
    showDirection: false,
    // Line 23, purchases of stock in trade (inventory).
    fixedDirection: 'paid',
    notThis:
      'Equipment, machinery, computers, furniture or vehicles the LLC bought to use rather than to resell are not inventory. Use "Purchase of equipment or other property" for those.',
  },
  {
    value: 'sales',
    label: 'Sale of inventory (goods for resale)',
    sentence: 'The LLC sold inventory, goods held for resale, to {party}',
    category: 2,
    part: 'IV',
    showDirection: false,
    // Line 9, sales of stock in trade. The code stays `sales` because saved rows
    // carry it in ui_transaction_type; only the label changed.
    fixedDirection: 'received',
    notThis:
      'Selling equipment or other property the LLC used in its own business is not a sale of inventory. Use "Sale of equipment or other property" for that.',
  },
  {
    value: 'tangible_purchase',
    label: 'Purchase of equipment or other property',
    sentence: 'The LLC bought equipment or other tangible property from {party}',
    category: 1,
    part: 'IV',
    showDirection: false,
    // Line 24, purchases of tangible property OTHER THAN stock in trade.
    fixedDirection: 'paid',
    notThis:
      'Goods the LLC bought to resell are inventory, not equipment. Use "Purchase of inventory" for those. Software, licences and other intangibles do not belong here either.',
  },
  {
    value: 'tangible_sale',
    label: 'Sale of equipment or other property',
    sentence: 'The LLC sold equipment or other tangible property to {party}',
    category: 2,
    part: 'IV',
    showDirection: false,
    // Line 10, sales of tangible property OTHER THAN stock in trade.
    fixedDirection: 'received',
    notThis:
      'Goods the LLC held to resell are inventory, not equipment. Use "Sale of inventory" for those.',
  },

  // ── Part IV, Services ─────────────────────────────────────────────────
  {
    value: 'service_payment',
    label: 'Payment for services',
    sentence: 'The LLC paid {party} for services rendered',
    category: 2,
    part: 'IV',
    showDirection: true,
  },
  {
    value: 'tech_services',
    label: 'Technical or management services',
    sentence: 'The LLC paid {party} for technical, management, or scientific work',
    category: 2,
    part: 'IV',
    showDirection: true,
  },
  {
    value: 'commission',
    label: 'Commission paid or received',
    sentence: 'The LLC paid or received a commission with {party}',
    category: 2,
    part: 'IV',
    showDirection: true,
  },

  // ── Part IV, Rent, royalty, interest ─────────────────────────────────
  {
    value: 'rent',
    label: 'Rent paid or received',
    sentence: 'The LLC paid or received rent involving {party}',
    category: 2,
    part: 'IV',
    showDirection: true,
  },
  {
    value: 'royalty',
    label: 'Royalty paid or received',
    sentence: 'The LLC paid or received royalties involving {party}',
    category: 2,
    part: 'IV',
    showDirection: true,
    notThis:
      'Paying for software the LLC simply uses, such as a subscription, is not a royalty. Nor is paying a contractor for their work. A royalty is payment for the right to use intellectual property that someone else owns.',
  },
  {
    value: 'interest',
    label: 'Interest paid or received',
    sentence: 'The LLC paid or received interest involving {party}',
    category: 2,
    part: 'IV',
    showDirection: true,
  },

  // ── Part IV, Loans ────────────────────────────────────────────────────
  {
    value: 'loan_to_llc',
    label: 'Loan to the LLC',
    sentence: '{party} lent money to the LLC, enter the year-end closing balance',
    category: 2,
    ownerCategory: 1,
    part: 'IV',
    showDirection: false,
    amountLabel: 'Closing balance (USD)',
    amountHint: 'The outstanding loan balance at the end of the tax year',
    notThis:
      'Putting your own cash into the LLC, or taking profit out, is not a loan. A loan needs an agreed repayment date and an interest rate. If there is no such agreement, use "Capital contribution by owner" or "Distribution to owner" instead.',
  },
  {
    value: 'loan_from_llc',
    label: 'Loan from the LLC',
    sentence: 'The LLC lent money to {party}, enter the year-end closing balance',
    category: 2,
    ownerCategory: 1,
    part: 'IV',
    showDirection: false,
    amountLabel: 'Closing balance (USD)',
    amountHint: 'The outstanding loan balance at the end of the tax year',
    notThis:
      'Taking profit out of the LLC is not a loan. A loan needs an agreed repayment date and an interest rate. If there is no such agreement, use "Distribution to owner" instead.',
  },

  // ── Part IV, Complex / CPA-level ─────────────────────────────────────
  {
    value: 'intangible',
    label: 'Sale or license of intellectual property',
    sentence: 'The LLC transferred or licensed IP (patents, trademarks, software) with {party}',
    category: 3,
    part: 'IV',
    showDirection: true,
    notThis:
      'Buying or subscribing to software the LLC uses is not an IP transfer. This is for handing over, or licensing out, IP the LLC or the related party owns.',
  },
  // `cost_sharing` and `platform_contribution` WERE HERE AND WERE REMOVED
  // 5 August 2026. Do not add them back without also building Part VIII.
  //
  // Part VII question 39 asks whether the reporting corporation is a party to a
  // cost sharing arrangement, and 1k asks how many Parts VIII are attached. This
  // product answers Part VII all-No and attaches no Part VIII, which is right for
  // every structure it serves EXCEPT these two types, where the answer is not a
  // judgement call: a CSA makes 39 Yes by definition, and a platform contribution
  // only exists inside a CSA. Offering the cards therefore promised a return the
  // generator cannot produce, and produced a WRONG one rather than an incomplete
  // one: both collapsed to canonical `other` and printed on line 21/35 with 39
  // left No.
  //
  // Removing them costs nothing that worked, because no filer got a correct CSA
  // return before either. A filer who genuinely has one is now stopped at the
  // eligibility gate, which is the honest outcome: a cost sharing arrangement is
  // a transfer-pricing engagement, not a form-filling job.
  //
  // The two codes stay in UI_TO_CANONICAL so rows saved before this still read
  // back, and `resolveUiTxType` shows them as "Other", which is what they have
  // always printed as.
  {
    value: 'insurance',
    label: 'Insurance or reinsurance premium',
    sentence: 'The LLC paid or received an insurance or reinsurance premium with {party}',
    category: 3,
    part: 'IV',
    showDirection: true,
  },
  {
    value: 'loan_guarantee_fee',
    label: 'Loan guarantee fee',
    sentence: 'The LLC paid or received a fee for a loan guarantee involving {party}',
    category: 3,
    part: 'IV',
    showDirection: true,
  },
  {
    value: 'digital_asset',
    label: 'Cryptocurrency or other digital assets',
    sentence: 'The LLC paid or received cryptocurrency, NFTs, or other digital tokens with {party}',
    category: 2,
    part: 'IV',
    showDirection: true,
    amountHint: 'Use the US dollar value at the time of each transaction, not the value today.',
    notThis:
      'Holding crypto in a wallet, with nothing moving between you and the LLC during the year, is not reportable here.',
  },
  {
    value: 'other',
    label: 'Other amount',
    sentence: 'Another type of monetary amount was exchanged between the LLC and {party}',
    category: 3,
    part: 'IV',
    showDirection: true,
  },

  // ── Part V, Contributions, distributions & entity events ─────────────
  // Most common items first (contributions/distributions), rare structural events last.
  // Direction is hidden entirely for Part V.
  {
    value: 'capital_contribution',
    label: 'Capital contribution by owner',
    sentence: 'You put money or assets into the LLC as a capital contribution',
    category: 1,
    part: 'V',
    showDirection: false,
    amountOptional: false,
  },
  {
    value: 'distribution',
    label: 'Distribution to owner',
    sentence: 'The LLC paid money or assets out to you',
    category: 1,
    part: 'V',
    showDirection: false,
    amountOptional: false,
  },
  {
    value: 'dividend',
    label: 'Dividend paid',
    sentence: 'The LLC paid a dividend to you',
    category: 1,
    part: 'V',
    showDirection: false,
    amountOptional: false,
  },
  {
    value: 'formation_costs',
    label: 'Formation costs paid by owner',
    sentence: "You paid the LLC's setup costs (state filing fees, registered agent, etc.)",
    category: 1,
    part: 'V',
    showDirection: false,
    amountOptional: false,
  },
  {
    value: 'formation_tx',
    label: 'LLC formation',
    sentence: 'The LLC was formed, this records the structural transaction with {party}',
    category: 1,
    part: 'V',
    showDirection: false,
    amountHint: 'Amount contributed at formation (optional)',
    amountOptional: true,
  },
  {
    value: 'dissolution_tx',
    label: 'LLC dissolution or liquidation',
    sentence: 'The LLC was dissolved or wound down, involving {party}',
    category: 2,
    part: 'V',
    // A wind-down against the OWNER is a liquidating distribution and belongs in
    // the Part V statement, where direction is not asked. Against any other
    // related party it is a Part IV "other amount", and what is being reported
    // is a payout, so the default is 'paid'. It is still asked, because the LLC
    // can also be on the receiving end of a wind-down settlement and the answer
    // decides line 21 against line 35.
    showDirection: true,
    fixedDirection: 'paid',
    amountOptional: true,
  },
  {
    value: 'acquisition_tx',
    label: 'Acquisition of another entity',
    sentence: 'The LLC acquired or took over another company, involving {party}',
    category: 3,
    part: 'V',
    showDirection: false,
    // The LLC pays to acquire.
    fixedDirection: 'paid',
    amountOptional: true,
  },
  {
    value: 'disposition_tx',
    label: 'Sale or disposal of the LLC',
    sentence: 'The LLC was sold, transferred, or disposed of, involving {party}',
    category: 3,
    part: 'V',
    showDirection: false,
    // Proceeds come in on a disposal.
    fixedDirection: 'received',
    amountOptional: true,
  },
  {
    value: 'other_part_v',
    label: 'Other structural transaction',
    sentence: 'Another structural event occurred between the LLC and {party}',
    category: 3,
    part: 'V',
    showDirection: false,
    amountOptional: true,
  },

  // ── Part VI, Nonmonetary / less-than-FMV ─────────────────────────────
  {
    value: 'nonmonetary_transfer',
    label: 'Transfer of assets without cash',
    sentence: 'The LLC transferred assets to or from {party} without a cash payment',
    category: 3,
    part: 'VI',
    showDirection: false,
    amountOptional: true,
  },
  {
    value: 'less_than_fmv',
    label: 'Transaction below fair market value',
    sentence: 'The LLC or {party} received something worth less than its fair market value',
    category: 3,
    part: 'VI',
    showDirection: false,
    amountOptional: true,
  },
  {
    value: 'property_transfer_fmv',
    label: 'Property transferred below fair market value',
    sentence: 'Property was transferred between the LLC and {party} below its actual market price',
    category: 3,
    part: 'VI',
    showDirection: false,
    amountOptional: true,
  },
  {
    value: 'other_part_vi',
    label: 'Other non-cash or below-value transaction',
    sentence: 'Another non-cash or below-market transaction occurred between the LLC and {party}',
    category: 3,
    part: 'VI',
    showDirection: false,
    amountOptional: true,
  },
];

// ── Two-tier transaction entry ────────────────────────────────────────────
// SIMPLE_TX: the handful of everyday owner↔LLC dealings that cover ~90% of
// filings, shown as one-tap options by default. Each maps to an existing
// TX_TYPES value, so nothing downstream changes.
//
// DETAILED_TX_GROUPS: everything else (the less-common Part IV / V / VI types),
// revealed only when the user opens "Record a different transaction".
//
// Wording here is intentionally our own plain-English voice.

export type QuickTx = {
  value: string;            // existing TX_TYPES value
  label: string;            // plain-language card label
  /** Forced direction for the underlying row, when the type has no direction toggle. */
  direction?: 'paid' | 'received';
};

// Owner counterparty: first-person shortcuts that cover ~90% of filings.
export const SIMPLE_TX: QuickTx[] = [
  { value: 'capital_contribution', label: 'I added money to the LLC',     direction: 'received' },
  { value: 'distribution',         label: 'I took money out of the LLC',  direction: 'paid' },
  { value: 'loan_to_llc',          label: 'I lent money to the LLC',      direction: 'received' },
  { value: 'loan_from_llc',        label: 'The LLC lent money to me',     direction: 'paid' },
  { value: 'formation_costs',      label: "I paid the LLC's setup costs", direction: 'received' },
  { value: 'dividend',             label: 'The LLC paid me a dividend',   direction: 'paid' },
];

// Related-party counterparty: neutral options worded for the LLC dealing with
// that party (never first-person "I"). Capital contributions and distributions
// are owner-only concepts, so they are NOT offered here.
export const RELATED_PARTY_TX: QuickTx[] = [
  { value: 'service_payment',      label: 'Services' },
  { value: 'rent',                 label: 'Rent' },
  { value: 'royalty',              label: 'Royalty' },
  { value: 'interest',             label: 'Interest' },
  // The two loan options were removed 5 August 2026. This list is the NON-OWNER
  // list, and a loan with a related party who is not the owner forces Form 5472
  // Part VII question 42a or 42b to Yes, which cannot be answered here. See
  // NON_OWNER_BLOCKED_TX_TYPES. The owner's list, SIMPLE_TX, keeps both, because
  // against the sole owner a loan is a bookkeeping entry rather than a loan.
  // One ambiguous "Purchase of goods or inventory" used to stand here and put
  // every inventory purchase on line 24, the line whose caption excludes it.
  // The quick list has to ask the same question the detailed cards do, because
  // a filer who never opens the detailed list would otherwise never be asked.
  { value: 'inventory_purchase',   label: 'Purchase of goods for resale' },
  { value: 'tangible_purchase',    label: 'Purchase of equipment or other property' },
  { value: 'other',                label: 'Other' },
];

export const SIMPLE_TX_VALUES = new Set([...SIMPLE_TX, ...RELATED_PARTY_TX].map((s) => s.value));

export type DetailedTxGroup = {
  key: string;
  label: string;
  /** Shown in muted text after the group label; e.g. a CPA-review hint. */
  note?: string;
  values: string[];   // TX_TYPES values in this group
};

export const DETAILED_TX_GROUPS: DetailedTxGroup[] = [
  {
    key: 'payments',
    label: 'Payments & services',
    values: ['service_payment', 'tech_services', 'commission', 'rent', 'royalty', 'interest', 'inventory_purchase', 'sales', 'tangible_purchase', 'tangible_sale'],
  },
  {
    key: 'complex',
    label: 'IP, insurance and other dealings',
    // Cost sharing and platform contribution are deliberately absent: they force
    // Part VII question 39 to Yes and a Part VIII this product does not produce.
    values: ['intangible', 'insurance', 'loan_guarantee_fee', 'nonmonetary_transfer', 'less_than_fmv', 'property_transfer_fmv', 'other_part_vi', 'other'],
  },
  {
    key: 'entity_events',
    label: 'Formation, dissolution & ownership changes',
    values: ['formation_tx', 'dissolution_tx', 'acquisition_tx', 'disposition_tx', 'other_part_v'],
  },
];

// ── Sets for special-case UI logic ────────────────────────────────────────

// Only pure loan types now (capital_contribution / distribution moved to Part V)
export const LOAN_TYPES = new Set([
  'loan_to_llc',
  'loan_from_llc',
]);

export const ROYALTY_TYPES = new Set(['rent', 'royalty']);

export const PART_V_TYPES = new Set([
  'capital_contribution',
  'distribution',
  'dividend',
  'formation_costs',
  'formation_tx',
  'dissolution_tx',
  'acquisition_tx',
  'disposition_tx',
  'other_part_v',
]);

export const PART_VI_TYPES = new Set([
  'nonmonetary_transfer',
  'less_than_fmv',
  'property_transfer_fmv',
  'other_part_vi',
]);

// Transaction types that show the direction dropdown (Part IV monetary flows only)
export const DIRECTION_TYPES = new Set(
  TX_TYPES.filter((t) => t.showDirection).map((t) => t.value),
);

/**
 * The direction to store for a type the filer is not asked about, and the value
 * the dropdown opens on for a type they are.
 *
 * Every selector calls this instead of falling back to 'received'. Returning
 * 'received' for an unknown code preserves the old behaviour for anything not
 * yet classified, but every type whose side of Form 5472 is knowable now
 * declares it on its TX_TYPES entry.
 */
export function defaultDirectionFor(txType: string): 'paid' | 'received' {
  return TX_TYPES.find((t) => t.value === txType)?.fixedDirection ?? 'received';
}

/**
 * Whether to put the "Who paid?" question in front of the filer.
 *
 * `showDirection` on the type is the general answer, but one type depends on
 * the counterparty. A wind-down against the OWNER is a liquidating distribution
 * reported in the Part V statement, and Part V reads no direction at all, so
 * asking produces an answer that decides nothing. Against any other related
 * party the same event is a Part IV "other amount", where the answer picks
 * line 21 or line 35, and there it has to be asked.
 */
export function asksDirection(txType: string, isOwner: boolean): boolean {
  if (txType === 'dissolution_tx') return !isOwner;
  return DIRECTION_TYPES.has(txType);
}

/**
 * Types that may only be recorded against the owner (related_party_index 0).
 *
 * Part V and Part VI statements are built for the owner alone, so a type that
 * exists only inside one of those statements has nowhere to go on another
 * party's Form 5472. `dissolution_tx` is deliberately absent: a wind-down can
 * involve a non-owner related party, and for that party it is reported as a
 * Part IV amount rather than in a statement.
 */
export const OWNER_ONLY_TX_TYPES = new Set(
  [...PART_V_TYPES, ...PART_VI_TYPES].filter((v) => v !== 'dissolution_tx'),
);

/**
 * Types that may NOT be recorded against a related party other than the owner.
 *
 * Different reason from `OWNER_ONLY_TX_TYPES`, which is about a type having no
 * form to print on. These have somewhere to print; the problem is Form 5472
 * PART VII. A loan between the LLC and a related party who is not the sole owner
 * forces question 42a or 42b to Yes, and Part VII cannot be answered Yes here at
 * all: the checkboxes are absent from every template's AcroForm, so there is no
 * field to set. Offering the type would mean filing a known Yes as a No.
 *
 * Against the OWNER the same type is fine and stays. A disregarded entity and
 * its sole owner are the same taxpayer, so an owner loan is a bookkeeping entry
 * rather than a loan, which is why `ownerCategory` puts it at tier 1.
 *
 * Note "we charged no interest" does not take a non-owner loan out of scope: a
 * rate of zero is outside the safe-haven range rather than absent from it.
 */
export const NON_OWNER_BLOCKED_TX_TYPES = new Set([
  'loan_to_llc',
  'loan_from_llc',
]);

// ── Transaction categories (accordion grouping in Step 4) ─────────────────
export const TX_CATEGORIES: {
  key: string;
  label: string;
  description: string;
  parts: Array<'IV' | 'V' | 'VI'>;
  values: string[];
  /**
   * Shown inside the category once it is open, above the type cards.
   *
   * For saying what is NOT in a category. A filer looking for something we do
   * not offer will otherwise pick the nearest card, and "Other" is always near
   * enough, so silence produces a wrong return rather than a question.
   */
  note?: string;
}[] = [
  {
    key: 'goods',
    label: 'Goods & inventory',
    description: 'Physical products, stock-in-trade, tangible items bought or sold',
    parts: ['IV'],
    // Inventory pair first, then the equipment pair: inventory is the common
    // case and the two read as a set when they sit together.
    values: ['inventory_purchase', 'sales', 'tangible_purchase', 'tangible_sale'],
  },
  {
    key: 'services',
    label: 'Services & commissions',
    description: 'Work performed, management, technical help, commissions',
    parts: ['IV'],
    values: ['service_payment', 'tech_services', 'commission'],
  },
  {
    key: 'rent_royalty',
    label: 'Rent, royalties & interest',
    description: 'Rental payments, IP royalties, interest on money',
    parts: ['IV'],
    values: ['rent', 'royalty', 'interest'],
  },
  {
    key: 'loans',
    label: 'Loans & financing',
    description: 'Money lent or borrowed between the LLC and its related parties',
    parts: ['IV'],
    values: ['loan_to_llc', 'loan_from_llc'],
  },
  {
    key: 'digital',
    label: 'Cryptocurrency & digital assets',
    description: 'Crypto, NFTs, or other tokens moving between the LLC and a related party',
    parts: ['IV'],
    values: ['digital_asset'],
  },
  {
    key: 'complex',
    label: 'IP, insurance & other',
    // The description named cost-sharing while the cards for it are gone.
    description: 'Intellectual property transfers, insurance, and other items',
    parts: ['IV'],
    values: ['intangible', 'insurance', 'loan_guarantee_fee', 'other'],
    // Without this, a filer with a cost sharing arrangement picks "Other" and
    // files exactly the return the removed cards used to produce: line 21 or 35
    // with Part VII question 39 answered No and no Part VIII attached.
    note: 'Cost sharing arrangements and platform contribution transactions are not filed here. They have to be reported in Part VIII of Form 5472, which needs a professional to prepare. Email support@filetax.co if you have one, and do not record it as "Other".',
  },
  {
    key: 'structural',
    label: 'Contributions, distributions & entity events',
    description: 'Money put into or taken out of the LLC, plus formation, dissolution, or ownership changes',
    parts: ['V'],
    values: [
      'capital_contribution',
      'distribution',
      'dividend',
      'formation_costs',
      'formation_tx',
      'dissolution_tx',
      'acquisition_tx',
      'disposition_tx',
      'other_part_v',
    ],
  },
  {
    key: 'nonmonetary',
    label: 'Non-cash or below-value transactions (Part VI)',
    description: 'Assets transferred without payment, or deals done below fair market value',
    parts: ['VI'],
    values: ['nonmonetary_transfer', 'less_than_fmv', 'property_transfer_fmv', 'other_part_vi'],
  },
];

// ── US States ─────────────────────────────────────────────────────────────
export const US_STATES: { value: string; label: string }[] = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'PR', label: 'Puerto Rico' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

// ── Countries ─────────────────────────────────────────────────────────────
export const COUNTRIES: { value: string; label: string }[] = [
  { value: 'United States', label: 'United States' },
  { value: 'Afghanistan', label: 'Afghanistan' },
  { value: 'Albania', label: 'Albania' },
  { value: 'Algeria', label: 'Algeria' },
  { value: 'Andorra', label: 'Andorra' },
  { value: 'Angola', label: 'Angola' },
  { value: 'Antigua and Barbuda', label: 'Antigua and Barbuda' },
  { value: 'Argentina', label: 'Argentina' },
  { value: 'Armenia', label: 'Armenia' },
  { value: 'Australia', label: 'Australia' },
  { value: 'Austria', label: 'Austria' },
  { value: 'Azerbaijan', label: 'Azerbaijan' },
  { value: 'Bahamas', label: 'Bahamas' },
  { value: 'Bahrain', label: 'Bahrain' },
  { value: 'Bangladesh', label: 'Bangladesh' },
  { value: 'Barbados', label: 'Barbados' },
  { value: 'Belarus', label: 'Belarus' },
  { value: 'Belgium', label: 'Belgium' },
  { value: 'Belize', label: 'Belize' },
  { value: 'Benin', label: 'Benin' },
  { value: 'Bhutan', label: 'Bhutan' },
  { value: 'Bolivia', label: 'Bolivia' },
  { value: 'Bosnia and Herzegovina', label: 'Bosnia and Herzegovina' },
  { value: 'Botswana', label: 'Botswana' },
  { value: 'Brazil', label: 'Brazil' },
  { value: 'Brunei', label: 'Brunei' },
  { value: 'Bulgaria', label: 'Bulgaria' },
  { value: 'Burkina Faso', label: 'Burkina Faso' },
  { value: 'Burundi', label: 'Burundi' },
  { value: 'Cabo Verde', label: 'Cabo Verde' },
  { value: 'Cambodia', label: 'Cambodia' },
  { value: 'Cameroon', label: 'Cameroon' },
  { value: 'Canada', label: 'Canada' },
  { value: 'Central African Republic', label: 'Central African Republic' },
  { value: 'Chad', label: 'Chad' },
  { value: 'Chile', label: 'Chile' },
  { value: 'China', label: 'China' },
  { value: 'Colombia', label: 'Colombia' },
  { value: 'Comoros', label: 'Comoros' },
  { value: 'Congo (Democratic Republic)', label: 'Congo (Democratic Republic)' },
  { value: 'Congo (Republic)', label: 'Congo (Republic)' },
  { value: 'Costa Rica', label: 'Costa Rica' },
  { value: 'Croatia', label: 'Croatia' },
  { value: 'Cuba', label: 'Cuba' },
  { value: 'Cyprus', label: 'Cyprus' },
  { value: 'Czech Republic', label: 'Czech Republic' },
  { value: 'Denmark', label: 'Denmark' },
  { value: 'Djibouti', label: 'Djibouti' },
  { value: 'Dominica', label: 'Dominica' },
  { value: 'Dominican Republic', label: 'Dominican Republic' },
  { value: 'Ecuador', label: 'Ecuador' },
  { value: 'Egypt', label: 'Egypt' },
  { value: 'El Salvador', label: 'El Salvador' },
  { value: 'Equatorial Guinea', label: 'Equatorial Guinea' },
  { value: 'Eritrea', label: 'Eritrea' },
  { value: 'Estonia', label: 'Estonia' },
  { value: 'Eswatini', label: 'Eswatini' },
  { value: 'Ethiopia', label: 'Ethiopia' },
  { value: 'Fiji', label: 'Fiji' },
  { value: 'Finland', label: 'Finland' },
  { value: 'France', label: 'France' },
  { value: 'Gabon', label: 'Gabon' },
  { value: 'Gambia', label: 'Gambia' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Germany', label: 'Germany' },
  { value: 'Ghana', label: 'Ghana' },
  { value: 'Greece', label: 'Greece' },
  { value: 'Grenada', label: 'Grenada' },
  { value: 'Guatemala', label: 'Guatemala' },
  { value: 'Guinea', label: 'Guinea' },
  { value: 'Guinea-Bissau', label: 'Guinea-Bissau' },
  { value: 'Guyana', label: 'Guyana' },
  { value: 'Haiti', label: 'Haiti' },
  { value: 'Honduras', label: 'Honduras' },
  { value: 'Hong Kong', label: 'Hong Kong' },
  { value: 'Hungary', label: 'Hungary' },
  { value: 'Iceland', label: 'Iceland' },
  { value: 'India', label: 'India' },
  { value: 'Indonesia', label: 'Indonesia' },
  { value: 'Iran', label: 'Iran' },
  { value: 'Iraq', label: 'Iraq' },
  { value: 'Ireland', label: 'Ireland' },
  { value: 'Israel', label: 'Israel' },
  { value: 'Italy', label: 'Italy' },
  { value: 'Jamaica', label: 'Jamaica' },
  { value: 'Japan', label: 'Japan' },
  { value: 'Jordan', label: 'Jordan' },
  { value: 'Kazakhstan', label: 'Kazakhstan' },
  { value: 'Kenya', label: 'Kenya' },
  { value: 'Kiribati', label: 'Kiribati' },
  { value: 'Kosovo', label: 'Kosovo' },
  { value: 'Kuwait', label: 'Kuwait' },
  { value: 'Kyrgyzstan', label: 'Kyrgyzstan' },
  { value: 'Laos', label: 'Laos' },
  { value: 'Latvia', label: 'Latvia' },
  { value: 'Lebanon', label: 'Lebanon' },
  { value: 'Lesotho', label: 'Lesotho' },
  { value: 'Liberia', label: 'Liberia' },
  { value: 'Libya', label: 'Libya' },
  { value: 'Liechtenstein', label: 'Liechtenstein' },
  { value: 'Lithuania', label: 'Lithuania' },
  { value: 'Luxembourg', label: 'Luxembourg' },
  { value: 'Madagascar', label: 'Madagascar' },
  { value: 'Macau', label: 'Macau' },
  { value: 'Malawi', label: 'Malawi' },
  { value: 'Malaysia', label: 'Malaysia' },
  { value: 'Maldives', label: 'Maldives' },
  { value: 'Mali', label: 'Mali' },
  { value: 'Malta', label: 'Malta' },
  { value: 'Marshall Islands', label: 'Marshall Islands' },
  { value: 'Mauritania', label: 'Mauritania' },
  { value: 'Mauritius', label: 'Mauritius' },
  { value: 'Mexico', label: 'Mexico' },
  { value: 'Micronesia', label: 'Micronesia' },
  { value: 'Moldova', label: 'Moldova' },
  { value: 'Monaco', label: 'Monaco' },
  { value: 'Mongolia', label: 'Mongolia' },
  { value: 'Montenegro', label: 'Montenegro' },
  { value: 'Morocco', label: 'Morocco' },
  { value: 'Mozambique', label: 'Mozambique' },
  { value: 'Myanmar', label: 'Myanmar' },
  { value: 'Namibia', label: 'Namibia' },
  { value: 'Nauru', label: 'Nauru' },
  { value: 'Nepal', label: 'Nepal' },
  { value: 'Netherlands', label: 'Netherlands' },
  { value: 'New Zealand', label: 'New Zealand' },
  { value: 'Nicaragua', label: 'Nicaragua' },
  { value: 'Niger', label: 'Niger' },
  { value: 'Nigeria', label: 'Nigeria' },
  { value: 'North Korea', label: 'North Korea' },
  { value: 'North Macedonia', label: 'North Macedonia' },
  { value: 'Norway', label: 'Norway' },
  { value: 'Oman', label: 'Oman' },
  { value: 'Pakistan', label: 'Pakistan' },
  { value: 'Palau', label: 'Palau' },
  { value: 'Palestine', label: 'Palestine' },
  { value: 'Panama', label: 'Panama' },
  { value: 'Papua New Guinea', label: 'Papua New Guinea' },
  { value: 'Paraguay', label: 'Paraguay' },
  { value: 'Peru', label: 'Peru' },
  { value: 'Philippines', label: 'Philippines' },
  { value: 'Poland', label: 'Poland' },
  { value: 'Portugal', label: 'Portugal' },
  { value: 'Qatar', label: 'Qatar' },
  { value: 'Romania', label: 'Romania' },
  { value: 'Russia', label: 'Russia' },
  { value: 'Rwanda', label: 'Rwanda' },
  { value: 'Saint Kitts and Nevis', label: 'Saint Kitts and Nevis' },
  { value: 'Saint Lucia', label: 'Saint Lucia' },
  { value: 'Saint Vincent and the Grenadines', label: 'Saint Vincent and the Grenadines' },
  { value: 'Samoa', label: 'Samoa' },
  { value: 'San Marino', label: 'San Marino' },
  { value: 'Sao Tome and Principe', label: 'Sao Tome and Principe' },
  { value: 'Saudi Arabia', label: 'Saudi Arabia' },
  { value: 'Senegal', label: 'Senegal' },
  { value: 'Serbia', label: 'Serbia' },
  { value: 'Seychelles', label: 'Seychelles' },
  { value: 'Sierra Leone', label: 'Sierra Leone' },
  { value: 'Singapore', label: 'Singapore' },
  { value: 'Slovakia', label: 'Slovakia' },
  { value: 'Slovenia', label: 'Slovenia' },
  { value: 'Solomon Islands', label: 'Solomon Islands' },
  { value: 'Somalia', label: 'Somalia' },
  { value: 'South Africa', label: 'South Africa' },
  { value: 'South Korea', label: 'South Korea' },
  { value: 'South Sudan', label: 'South Sudan' },
  { value: 'Spain', label: 'Spain' },
  { value: 'Sri Lanka', label: 'Sri Lanka' },
  { value: 'Sudan', label: 'Sudan' },
  { value: 'Suriname', label: 'Suriname' },
  { value: 'Sweden', label: 'Sweden' },
  { value: 'Switzerland', label: 'Switzerland' },
  { value: 'Syria', label: 'Syria' },
  { value: 'Taiwan', label: 'Taiwan' },
  { value: 'Tajikistan', label: 'Tajikistan' },
  { value: 'Tanzania', label: 'Tanzania' },
  { value: 'Thailand', label: 'Thailand' },
  { value: 'Timor-Leste', label: 'Timor-Leste' },
  { value: 'Togo', label: 'Togo' },
  { value: 'Tonga', label: 'Tonga' },
  { value: 'Trinidad and Tobago', label: 'Trinidad and Tobago' },
  { value: 'Tunisia', label: 'Tunisia' },
  { value: 'Turkey', label: 'Turkey' },
  { value: 'Turkmenistan', label: 'Turkmenistan' },
  { value: 'Tuvalu', label: 'Tuvalu' },
  { value: 'Uganda', label: 'Uganda' },
  { value: 'Ukraine', label: 'Ukraine' },
  { value: 'United Arab Emirates', label: 'United Arab Emirates' },
  { value: 'United Kingdom', label: 'United Kingdom' },
  { value: 'Uruguay', label: 'Uruguay' },
  { value: 'Uzbekistan', label: 'Uzbekistan' },
  { value: 'Vanuatu', label: 'Vanuatu' },
  { value: 'Vatican City', label: 'Vatican City' },
  { value: 'Venezuela', label: 'Venezuela' },
  { value: 'Vietnam', label: 'Vietnam' },
  { value: 'Yemen', label: 'Yemen' },
  { value: 'Zambia', label: 'Zambia' },
  { value: 'Zimbabwe', label: 'Zimbabwe' },
];

// ── LLC Business Activities (Step 1, entity's own activity) ─────────────
export const BIZ_ACTIVITIES: { code: string; label: string }[] = [
  { code: '541511', label: 'Software Development' },
  { code: '513210', label: 'SaaS / Software Publisher' },
  { code: '541511', label: 'AI / Machine Learning Services' },
  { code: '541512', label: 'IT Consulting' },
  { code: '518210', label: 'Cloud / Hosting / DevOps' },
  { code: '541519', label: 'Cybersecurity' },
  { code: '541519', label: 'Data Analytics' },
  { code: '541611', label: 'Business Consulting' },
  { code: '541611', label: 'Management Consulting' },
  { code: '541613', label: 'Marketing Consulting' },
  { code: '541810', label: 'Digital Marketing Agency' },
  { code: '541430', label: 'Graphic Design' },
  { code: '541430', label: 'Web Design' },
  { code: '455219', label: 'Online Store (Shopify, WooCommerce, etc.)' },
  { code: '455219', label: 'Amazon FBA / Marketplace Seller' },
  { code: '425120', label: 'Import / Export' },
  { code: '423990', label: 'Wholesale Trade' },
  { code: '611420', label: 'Online Education / Courses' },
  { code: '561499', label: 'Business Support Services' },
  { code: '551112', label: 'Holding Company' },
  { code: '523999', label: 'Finance / Investment' },
  { code: '531390', label: 'Real Estate' },
  { code: '541990', label: 'Other Professional Services' },
];

// ── RP_NAICS (Steps 2 & 3, owner and related party business type) ────────
export const RP_NAICS: { code: string; label: string; hint: string }[] = [
  {
    code: '541511',
    label: 'Software Developer / Programmer',
    hint: 'Freelance developers, agencies, AI engineers',
  },
  {
    code: '513210',
    label: 'SaaS Founder / Software Company',
    hint: 'SaaS startups, mobile apps',
  },
  {
    code: '541512',
    label: 'IT Consultant',
    hint: 'Technology consultants',
  },
  {
    code: '518210',
    label: 'Cloud / DevOps / Infrastructure',
    hint: 'Cloud engineers',
  },
  {
    code: '541519',
    label: 'Cybersecurity / Data / AI Services',
    hint: 'AI consultants, cybersecurity',
  },
  {
    code: '541611',
    label: 'Business Consultant',
    hint: 'General consulting',
  },
  {
    code: '541613',
    label: 'Marketing Consultant',
    hint: 'Marketing professionals',
  },
  {
    code: '541810',
    label: 'Digital Marketing Agency',
    hint: 'Advertising agencies',
  },
  {
    code: '541430',
    label: 'Graphic / UI-UX Designer',
    hint: 'Designers',
  },
  {
    code: '455219',
    label: 'E-commerce Seller',
    hint: 'Shopify, Amazon, Etsy',
  },
  {
    code: '425120',
    label: 'Import / Export Trader',
    hint: 'Trading businesses',
  },
  {
    code: '423990',
    label: 'Wholesale Business',
    hint: 'Product wholesalers',
  },
  {
    code: '611420',
    label: 'Online Education / Coach',
    hint: 'Coaches, course creators',
  },
  {
    code: '561499',
    label: 'Business Support Services',
    hint: 'VA agencies, outsourcing',
  },
  {
    code: '551112',
    label: 'Holding Company / Investor',
    hint: 'Investment holding companies',
  },
  {
    code: '523999',
    label: 'Finance / Investment',
    hint: 'Financial services',
  },
  {
    code: '531390',
    label: 'Real Estate',
    hint: 'Property-related businesses',
  },
  {
    code: '541990',
    label: 'Other Professional Services',
    hint: 'Catch-all for professionals',
  },
];

/**
 * Resolve a stored business activity + code back to its RP_NAICS preset.
 *
 * The owner / related-party dropdowns key on the activity LABEL so that a
 * manually-typed activity has somewhere to live. That alone would regress
 * older records: `owner_business_activity` and `owner_business_code` are
 * separate DB columns, and a row seeded from `owner_naics_code` can carry the
 * code with a blank activity. Matching on the label only, such a row would
 * render as "Select type", or, once touched, as "Other (enter manually)", * which reads as data loss on a filing that is already paid and locked.
 *
 * So: prefer the label, fall back to the code when the activity is blank.
 *
 * Returns undefined for a genuinely custom activity, and for the single-space
 * sentinel the UI parks in the field when the filer picks "Other".
 */
export function resolveBizPreset(
  activity: string | null | undefined,
  code: string | null | undefined,
): { code: string; label: string; hint: string } | undefined {
  const a = (activity ?? '').trim();
  const c = (code ?? '').trim();
  const byLabel = RP_NAICS.find((n) => n.label === a);
  if (byLabel) return byLabel;
  if (!a && c) return RP_NAICS.find((n) => n.code === c);
  return undefined;
}
