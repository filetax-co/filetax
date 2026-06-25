// src/app/pages/intake/constants.ts

// Step 1b is a conditional sub-step that only appears when the original
// filing deadline has already passed.
export type IntakeStep = 1 | '1b' | 2 | 3 | 4 | 5;

export const TAX_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019];

export const STEP_LABELS: Record<string, string> = {
  1: 'LLC Details',
  '1b': 'Filing Status',
  2: 'Owner Details',
  3: 'Related Parties',
  4: 'Transactions',
  5: 'Review',
};

export const FILING_DUE_DATES: Record<
  number,
  { original: string; extended: string }
> = {
  2025: { original: '2026-04-15', extended: '2026-10-15' },
  2024: { original: '2025-04-15', extended: '2025-10-15' },
  2023: { original: '2024-04-15', extended: '2024-10-15' },
  2022: { original: '2023-04-15', extended: '2023-10-15' },
  2021: { original: '2022-04-15', extended: '2022-10-15' },
  2020: { original: '2021-04-15', extended: '2021-10-15' },
  2019: { original: '2020-04-15', extended: '2020-10-15' },
};

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
    value: 'relied_on_non_us_advisor',
    label: 'I relied on a non-US accountant or formation service',
    hint: 'Was guided by someone unfamiliar with US filing requirements.',
  },
  {
    value: 'not_informed',
    label: 'Nobody told me Form 5472 was required',
    hint: 'Formation agent, bank, or advisor did not mention this filing.',
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
    value: 'incomplete_records',
    label: 'Records or information were delayed or incomplete',
    hint: 'Could not file on time due to missing or late documentation.',
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
//   value          — internal key stored in DB
//   label          — short label shown on the card
//   sentence       — plain-English sentence; uses {party} and {amount} as placeholders
//   category       — 1 = DIY-safe, 2 = may need CPA, 3 = refer to CPA
//   part           — 'IV' | 'V' | 'VI'
//   showDirection  — whether to show the paid/received dropdown (Part IV monetary flows only)
//   amountLabel    — custom label for the amount field
//   amountHint     — optional hint shown under amount
//   amountOptional — true if amount can be omitted

export const TX_TYPES: {
  value: string;
  label: string;
  sentence: string;
  category: 1 | 2 | 3;
  part: 'IV' | 'V' | 'VI';
  showDirection: boolean;
  amountLabel?: string;
  amountHint?: string;
  amountOptional?: boolean;
}[] = [

  // ── Part IV — Goods & property ─────────────────────────────────────────
  {
    value: 'tangible_purchase',
    label: 'Purchase of goods or inventory',
    sentence: 'The LLC bought physical goods or inventory from {party}',
    category: 1,
    part: 'IV',
    showDirection: false,
  },
  {
    value: 'tangible_sale',
    label: 'Sale of goods or inventory',
    sentence: 'The LLC sold physical goods or inventory to {party}',
    category: 2,
    part: 'IV',
    showDirection: false,
  },
  {
    value: 'sales',
    label: 'Sale of stock in trade',
    sentence: 'The LLC sold stock in trade to {party}',
    category: 2,
    part: 'IV',
    showDirection: false,
  },

  // ── Part IV — Services ─────────────────────────────────────────────────
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

  // ── Part IV — Rent, royalty, interest ─────────────────────────────────
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
  },
  {
    value: 'interest',
    label: 'Interest paid or received',
    sentence: 'The LLC paid or received interest involving {party}',
    category: 2,
    part: 'IV',
    showDirection: true,
  },

  // ── Part IV — Loans ────────────────────────────────────────────────────
  {
    value: 'loan_to_llc',
    label: 'Loan to the LLC',
    sentence: '{party} lent money to the LLC — enter the year-end closing balance',
    category: 2,
    part: 'IV',
    showDirection: false,
    amountLabel: 'Closing balance (USD)',
    amountHint: 'The outstanding loan balance at the end of the tax year',
  },
  {
    value: 'loan_from_llc',
    label: 'Loan from the LLC',
    sentence: 'The LLC lent money to {party} — enter the year-end closing balance',
    category: 2,
    part: 'IV',
    showDirection: false,
    amountLabel: 'Closing balance (USD)',
    amountHint: 'The outstanding loan balance at the end of the tax year',
  },

  // ── Part IV — Complex / CPA-level ─────────────────────────────────────
  {
    value: 'intangible',
    label: 'Sale or license of intellectual property',
    sentence: 'The LLC transferred or licensed IP (patents, trademarks, software) with {party}',
    category: 3,
    part: 'IV',
    showDirection: true,
  },
  {
    value: 'platform_contribution',
    label: 'Platform contribution transaction (PCT)',
    sentence: 'A platform contribution transaction (PCT) occurred between the LLC and {party}',
    category: 3,
    part: 'IV',
    showDirection: false,
  },
  {
    value: 'cost_sharing',
    label: 'Cost-sharing arrangement',
    sentence: 'The LLC and {party} shared costs for developing intangible assets together',
    category: 3,
    part: 'IV',
    showDirection: false,
  },
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
    value: 'other',
    label: 'Other amount',
    sentence: 'Another type of monetary amount was exchanged between the LLC and {party}',
    category: 3,
    part: 'IV',
    showDirection: true,
  },

  // ── Part V — Contributions, distributions & entity events ─────────────
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
    sentence: 'The LLC was formed — this records the structural transaction with {party}',
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
    showDirection: false,
    amountOptional: true,
  },
  {
    value: 'acquisition_tx',
    label: 'Acquisition of another entity',
    sentence: 'The LLC acquired or took over another company, involving {party}',
    category: 3,
    part: 'V',
    showDirection: false,
    amountOptional: true,
  },
  {
    value: 'disposition_tx',
    label: 'Sale or disposal of the LLC',
    sentence: 'The LLC was sold, transferred, or disposed of, involving {party}',
    category: 3,
    part: 'V',
    showDirection: false,
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

  // ── Part VI — Nonmonetary / less-than-FMV ─────────────────────────────
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

// ── Transaction categories (accordion grouping in Step 4) ─────────────────
export const TX_CATEGORIES: {
  key: string;
  label: string;
  description: string;
  parts: Array<'IV' | 'V' | 'VI'>;
  values: string[];
}[] = [
  {
    key: 'goods',
    label: 'Goods & inventory',
    description: 'Physical products, stock-in-trade, tangible items bought or sold',
    parts: ['IV'],
    values: ['tangible_purchase', 'tangible_sale', 'sales'],
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
    key: 'complex',
    label: 'IP, insurance & other',
    description: 'Intellectual property transfers, insurance, cost-sharing, and other complex items — CPA review recommended',
    parts: ['IV'],
    values: ['intangible', 'platform_contribution', 'cost_sharing', 'insurance', 'loan_guarantee_fee', 'other'],
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
  { value: 'Congo', label: 'Congo' },
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
  { value: 'Norway', label: 'Norway' },
  { value: 'Oman', label: 'Oman' },
  { value: 'Pakistan', label: 'Pakistan' },
  { value: 'Palau', label: 'Palau' },
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
  { value: 'Venezuela', label: 'Venezuela' },
  { value: 'Vietnam', label: 'Vietnam' },
  { value: 'Yemen', label: 'Yemen' },
  { value: 'Zambia', label: 'Zambia' },
  { value: 'Zimbabwe', label: 'Zimbabwe' },
];

// ── LLC Business Activities (Step 1 — entity's own activity) ─────────────
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

// ── RP_NAICS (Steps 2 & 3 — owner and related party business type) ────────
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
