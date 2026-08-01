/**
 * genScenarios100.mjs — authors testing/__scenarios100.json.
 *
 * 100 scenarios written against the CURRENT portal, August 2026. Each one names
 * the branch it is there to exercise, so a failure points at a behaviour rather
 * than at a blob of JSON. Nothing here is random: a random scenario that fails
 * cannot be reasoned about, and a random scenario that passes proves nothing in
 * particular.
 *
 * Schema follows Intake.applyScenario:
 *   single year  -> { filing, owner, related_parties, transactions, ... }
 *   multi year   -> { shared_filing_fields, shared_owner_fields, year_specific_filings[] }
 *
 * Two fields are ours, read by the driver rather than by the wizard:
 *   signature_mode  'drawn'  -> draw on the SignaturePad before generating
 *                   'typed'  -> leave the pad blank, the typed name is the fallback
 *   expected_result present  -> the scenario MUST be rejected; it passes when the
 *                              error appears and nothing is saved
 *
 * Run: node scripts/genScenarios100.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'testing', '__scenarios100.json');

// ── building blocks ───────────────────────────────────────────────────────

const usAddr = (over = {}) => ({
  line1: '30 N Gould St Ste R', city: 'Sheridan', region: 'WY',
  postal_code: '82801', country: 'US', ...over,
});
const foreignAddr = (over = {}) => ({
  line1: '12 MG Road', city: 'Bengaluru', region: 'Karnataka',
  postal_code: '560001', country: 'India', ...over,
});

const baseFiling = (over = {}) => ({
  llc_name: 'Bluewave Digital LLC',
  ein: '35-1122334',
  state_of_formation: 'WY',
  tax_year: '2024',
  total_assets: 42000,
  // Before the oldest selectable tax year (2019). An entity cannot file for a
  // year it did not exist in, and the wizard rightly refuses — so a base date
  // inside the range silently makes every older-year scenario untestable.
  // Scenarios that test the incorporation date itself override this.
  date_of_incorporation: '2018-06-01',
  entity_principal_country: 'India',
  mailing_address: usAddr(),
  naics_code: '541511',
  naics_description: 'Software Development',
  final_return: false,
  is_fiscal_year: false,
  extension_filed: false,
  include_reasonable_cause: false,
  reasonable_cause_reasons: [],
  ...over,
});

const baseOwner = (over = {}) => ({
  owner_full_name: 'Aarav Mehta',
  owner_primary_country: 'India',
  owner_country_residence: 'India',
  owner_country_citizenship: 'India',
  owner_us_tin: '',
  owner_foreign_tax_id: 'ABCDE1234F',
  owner_reference_id: 'AAR001',
  owner_business_activity: 'Software Developer / Programmer',
  owner_naics_code: '541511',
  owner_address: foreignAddr(),
  signer_title: 'Managing Member',
  signature_date: '2026-08-01',
  ...over,
});

/** A related party that is NOT the owner (drives the non-owner tier). */
const rp = (i, over = {}) => ({
  name: ['Mehta Holdings Pte Ltd', 'Aurora Labs GmbH', 'Sunrise Trading FZE',
    'Kestrel Media Ltd', 'Nordwind Consulting AB'][i % 5],
  is_owner: false,
  relationship: 'foreign_related_party',
  country: ['Singapore', 'Germany', 'United Arab Emirates', 'United Kingdom', 'Sweden'][i % 5],
  address: { line1: `${10 + i} Marina Blvd`, city: 'Singapore', region: '', postal_code: '018956', country: 'Singapore' },
  us_tin: '',
  foreign_tax_id: `FTIN${1000 + i}`,
  reference_id: `RP${String(i + 1).padStart(3, '0')}`,
  business_activity: 'Management Consulting',
  naics_code: '541611',
  ...over,
});

const tx = (over = {}) => ({
  related_party_index: 0,
  transaction_type: 'service_payment',
  direction: 'paid',
  amount_usd: '12000',
  loan_begin_usd: '',
  description: 'Consulting services',
  transaction_date: '2024-06-15',
  ...over,
});

const ALL_RCL = ['first_time_filing', 'not_informed', 'no_tax_liability', 'minimal_activity',
  'language_barrier', 'discovered_late', 'voluntary_filing', 'new_procedures'];

const scenarios = [];
let nextId = 1;

/** Registers one scenario. `sig` alternates unless pinned. */
function S(title, tests, body, sig) {
  const id = nextId++;
  scenarios.push({
    scenario_id: id,
    title,
    tests,
    signature_mode: sig ?? (id % 2 === 0 ? 'drawn' : 'typed'),
    ...body,
  });
}

/** Single-year scenario shorthand. */
function one(title, tests, { filing = {}, owner = {}, parties = [], txns, ...rest } = {}, sig) {
  S(title, tests, {
    filing: baseFiling(filing),
    owner: baseOwner(owner),
    related_parties: parties,
    transactions: txns ?? [tx()],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    ...rest,
  }, sig);
}

// ══ A. Timing, extensions and lateness (1–12) ═════════════════════════════

// As of August 2026 the only year that is not already late is 2025 held open by
// a valid Form 7004, whose extended deadline is 15 October 2026. Everything else
// is late, and the wizard pre-selects the reasonable cause letter for it — so
// "declined the letter" is a real branch that has to be clicked, not assumed.
one('2025 late, no extension, letter declined', 'Late by the 15 Apr 2026 deadline; the pre-selected RCL is switched back off',
  { filing: { tax_year: '2025', extension_filed: false, include_reasonable_cause: false } }, 'typed');
one('2025 within the extension window', 'onTimeViaExtension branch; 1b shown, RCL section not',
  { filing: { tax_year: '2025', extension_filed: true } }, 'drawn');
one('2024 late, RCL requested', 'isLateForRcl true; RCL generated and signed',
  { filing: { tax_year: '2024', include_reasonable_cause: true, reasonable_cause_reasons: ['first_time_filing'] } }, 'drawn');
one('2024 late, RCL declined', 'Late but include_reasonable_cause false; no RCL page in the package',
  { filing: { tax_year: '2024', include_reasonable_cause: false } }, 'typed');
one('2024 late with an extension that has also expired', 'extension_filed true but past 2025-10-15; still late',
  { filing: { tax_year: '2024', extension_filed: true, include_reasonable_cause: true, reasonable_cause_reasons: ['discovered_late'] } });
one('2023 late', 'Due-date table row 2023; three years of penalty exposure',
  { filing: { tax_year: '2023', include_reasonable_cause: true, reasonable_cause_reasons: ['not_informed'] } });
one('2022 late', 'Due-date table row 2022',
  { filing: { tax_year: '2022', include_reasonable_cause: true, reasonable_cause_reasons: ['minimal_activity'] } });
one('2021 late', 'Due-date table row 2021; 2019-2021 form revision boundary',
  { filing: { tax_year: '2021', include_reasonable_cause: true, reasonable_cause_reasons: ['no_tax_liability'] } });
one('2020 late', 'Due-date table row 2020; older 5472 revision',
  { filing: { tax_year: '2020', include_reasonable_cause: true, reasonable_cause_reasons: ['language_barrier'] } });
one('2019 late, the oldest selectable year', 'Boundary of TAX_YEARS; oldest revision templates',
  { filing: { tax_year: '2019', include_reasonable_cause: true, reasonable_cause_reasons: ['voluntary_filing'] } });
one('Fiscal year ending June', 'is_fiscal_year with fiscal_end_month 6; short-period labelling',
  { filing: { tax_year: '2024', is_fiscal_year: true, fiscal_end_month: 6, include_reasonable_cause: true, reasonable_cause_reasons: ['first_time_filing'] } });

// ══ B. Reasonable cause reasons (13–20) ═══════════════════════════════════

ALL_RCL.forEach((reason, i) => {
  one(`RCL reason: ${reason}`, `Single reason ${reason} renders its own paragraph in the letter`,
    { filing: { tax_year: '2023', include_reasonable_cause: true, reasonable_cause_reasons: [reason] } },
    i % 2 === 0 ? 'drawn' : 'typed');
});

// ══ C. Entity shape (21–32) ═══════════════════════════════════════════════

one('All eight RCL reasons at once', 'Longest possible letter; page-break behaviour in the RCL',
  { filing: { tax_year: '2022', include_reasonable_cause: true, reasonable_cause_reasons: ALL_RCL } }, 'drawn');
one('Final return with a closure date', 'final_return + date_of_closure; period ends on dissolution',
  { filing: { tax_year: '2024', final_return: true, date_of_closure: '2024-09-30' } }, 'drawn');
one('Final return closing in January', 'One-month short period',
  { filing: { tax_year: '2024', final_return: true, date_of_closure: '2024-01-31' } });
one('Initial return, incorporated mid-year', 'DOI inside the tax year; short initial period',
  { filing: { tax_year: '2024', date_of_incorporation: '2024-05-20' } });
one('Name change ticked', 'name_change checkbox reaches box B on the 1120',
  { filing: { tax_year: '2024', name_change: true } });
one('Address change ticked', 'address_change checkbox reaches the 1120',
  { filing: { tax_year: '2024', address_change: true } });
one('Name and address change together', 'Both boxes on one return',
  { filing: { tax_year: '2024', name_change: true, address_change: true } });
one('Total assets zero', 'Dormant entity; 0 must print as 0, not blank',
  { filing: { tax_year: '2024', total_assets: 0 }, txns: [], no_transactions_confirmed: true });
one('Total assets in the hundreds of millions', 'Column width / number formatting at 12 digits',
  { filing: { tax_year: '2024', total_assets: 987654321 } });
one('LLC with US real estate or US-performed work', 'us_activity Yes — the 1040-NR warning banner must appear and the flow must still continue',
  { filing: { tax_year: '2024' }, us_activity: true }, 'drawn');
one('Foreign mailing address for the LLC', 'Non-US entity address; country line on the 5472',
  { filing: { tax_year: '2024', mailing_address: foreignAddr({ line1: '88 Kowloon Rd', city: 'Hong Kong', region: '', postal_code: '', country: 'Hong Kong' }) } });

// ══ D. States and formation (33–38) ═══════════════════════════════════════

['DE', 'NM'].forEach((st, i) => {
  one(`Formed in ${st}`, `state_of_formation ${st} round-trips to the return`,
    { filing: { tax_year: '2024', state_of_formation: st } }, i % 2 === 0 ? 'typed' : 'drawn');
});

// ══ E. Owner variants (39–50) ═════════════════════════════════════════════

one('Owner holds a US ITIN', 'owner_us_tin populated; both TIN fields present',
  { owner: { owner_us_tin: '912-34-5678' } });
one('Owner has no foreign tax ID', 'owner_foreign_tax_id blank; must not print "undefined"',
  { owner: { owner_foreign_tax_id: '' } });
one('Owner has neither a US TIN nor a foreign TIN', 'Both identifiers absent — the common real case',
  { owner: { owner_us_tin: '', owner_foreign_tax_id: '' } });
one('Non-Latin owner name', 'WinAnsi encoding path; Cyrillic must not throw in pdf-lib',
  { owner: { owner_full_name: 'Дмитрий Волков', owner_primary_country: 'Kazakhstan', owner_country_residence: 'Kazakhstan', owner_country_citizenship: 'Kazakhstan' } }, 'drawn');
one('CJK owner name', 'Encoding path for Chinese characters',
  { owner: { owner_full_name: '陈伟明', owner_primary_country: 'China', owner_country_residence: 'China', owner_country_citizenship: 'China' } }, 'drawn');
one('Very long owner name', 'Overflow behaviour in a fixed-width AcroForm field',
  { owner: { owner_full_name: 'Bartholomew Alexander Fitzgerald-Montgomery III' } });
one('Residence differs from citizenship', 'Three country fields diverge; each maps to its own line',
  { owner: { owner_primary_country: 'Germany', owner_country_residence: 'Portugal', owner_country_citizenship: 'India' } });
one('Owner resident in the United States', 'US residence with foreign citizenship — still a foreign owner',
  { owner: { owner_country_residence: 'United States', owner_address: usAddr({ line1: '400 Market St', city: 'Philadelphia', region: 'PA', postal_code: '19106' }) } });
one('Signer title: Member', 'signer_title other than the default reaches the signature block',
  { owner: { signer_title: 'Member' } }, 'drawn');
one('Signature date far from today', 'signature_date is used verbatim, not overwritten with today',
  { owner: { signature_date: '2026-01-05' } });

// ══ F. Related parties (51–62) ════════════════════════════════════════════

one('No related party other than the owner', 'Owner-only filing; the most common shape', { parties: [] });
one('One non-owner related party', 'Non-owner tier applies (ownerCategory not used)',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0 })] });
one('Two related parties', 'Two 5472s must be produced, one per party',
  { parties: [rp(0), rp(1)], txns: [tx({ related_party_index: 0 }), tx({ related_party_index: 1, transaction_type: 'rent', amount_usd: '9000' })] }, 'drawn');
one('Three related parties, one with no transactions', 'A party with nothing against it — is a 5472 still made?',
  { parties: [rp(0), rp(1), rp(2)], txns: [tx({ related_party_index: 0 }), tx({ related_party_index: 2, transaction_type: 'interest', amount_usd: '400' })] });
one('Five related parties', 'Package size; five 5472s in one PDF',
  { parties: [0, 1, 2, 3, 4].map((i) => rp(i)), txns: [0, 1, 2, 3, 4].map((i) => tx({ related_party_index: i, amount_usd: String(1000 * (i + 1)) })) }, 'drawn');
one('Related party that is a US person', 'US related party; US TIN present, country United States',
  { parties: [rp(0, { name: 'Harbor Point LLC', country: 'United States', us_tin: '84-1234567', foreign_tax_id: '', address: usAddr({ line1: '9 Beacon St', city: 'Boston', region: 'MA', postal_code: '02108' }) })], txns: [tx({ related_party_index: 0 })] });
one('Related party with no foreign tax ID', 'Blank identifier on the party, not the owner',
  { parties: [rp(0, { foreign_tax_id: '' })], txns: [tx({ related_party_index: 0 })] });
one('Related party with a very long name', 'Overflow in the party name field',
  { parties: [rp(0, { name: 'Internationale Handelsgesellschaft für Digitale Dienstleistungen mbH' })], txns: [tx({ related_party_index: 0 })] });
one('Related party sharing the owner name', 'Name collision — must not be silently merged with the owner',
  { parties: [rp(0, { name: 'Aarav Mehta', country: 'India' })], txns: [tx({ related_party_index: 0 })] });
one('Eight related parties', 'Upper end of realistic party counts; continuation behaviour',
  { parties: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rp(i)), txns: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => tx({ related_party_index: i, amount_usd: '2500' })) }, 'drawn');

// ══ G. Transactions, Part IV (63–74) ══════════════════════════════════════

const partIV = [
  ['tangible_purchase', 'Purchase of goods', 'paid'],
  ['tangible_sale', 'Sale of goods', 'received'],
  ['service_payment', 'Services', 'paid'],
  ['tech_services', 'Technical services', 'paid'],
  ['commission', 'Commission', 'paid'],
  ['rent', 'Rent', 'paid'],
  ['royalty', 'Royalty', 'paid'],
  ['interest', 'Interest', 'received'],
  ['insurance', 'Insurance premium', 'paid'],
  ['intangible', 'Intangible property', 'paid'],
];
partIV.forEach(([type, label, dir], i) => {
  one(`Part IV: ${label}`, `transaction_type ${type} lands on its own Part IV line, direction ${dir}`,
    { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: type, direction: dir, amount_usd: String(5000 + i * 1000), description: label })] },
    i % 2 === 0 ? 'typed' : 'drawn');
});

// ══ H. Loans, guarantees, digital assets (75–82) ══════════════════════════

one('Loan to the LLC with a beginning balance', 'loan_begin_usd populated; both balance columns',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'loan_to_llc', direction: 'received', amount_usd: '50000', loan_begin_usd: '20000', description: 'Shareholder loan' })] }, 'drawn');
one('Loan from the LLC with a beginning balance', 'Opposite direction loan',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'loan_from_llc', direction: 'paid', amount_usd: '15000', loan_begin_usd: '5000' })] });
one('Loan with a zero beginning balance', 'loan_begin_usd of 0 must print 0, not blank',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'loan_to_llc', direction: 'received', amount_usd: '8000', loan_begin_usd: '0' })] });
one('Loan guarantee fee on a 2024 return', 'Line 20/34 exists in this revision',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'loan_guarantee_fee', direction: 'paid', amount_usd: '3000' })] }, 'drawn');
one('Loan guarantee fee on a 2021 return', 'REGRESSION: line 20/34 absent in the 2019-2021 revision — must be disclosed under other amounts, never dropped from the total',
  { filing: { tax_year: '2021', include_reasonable_cause: true, reasonable_cause_reasons: ['discovered_late'] }, parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'loan_guarantee_fee', direction: 'paid', amount_usd: '3000', transaction_date: '2021-06-15' })] }, 'drawn');
one('Digital asset transfer', 'digital_asset type; tiering and Part placement',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'digital_asset', direction: 'paid', amount_usd: '25000', description: 'USDC transfer' })] }, 'drawn');
one('Digital asset against the owner', 'Owner counterparty uses ownerCategory, not category',
  { txns: [tx({ transaction_type: 'digital_asset', direction: 'paid', amount_usd: '25000' })] }, 'drawn');
one('Other, with a written description', 'Free-text "other" amount carries its description',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'other', amount_usd: '1200', description: 'Reimbursed travel costs' })] });

// ══ I. Parts V and VI (83–90) ═════════════════════════════════════════════

one('Capital contribution from the owner', 'Part V; owner tier',
  { txns: [tx({ transaction_type: 'capital_contribution', direction: 'received', amount_usd: '30000', description: 'Initial capital' })] });
one('Distribution to the owner', 'Part V distribution',
  { txns: [tx({ transaction_type: 'distribution', direction: 'paid', amount_usd: '18000' })] }, 'drawn');
one('Dividend to the owner', 'Part V dividend',
  { txns: [tx({ transaction_type: 'dividend', direction: 'paid', amount_usd: '7500' })] });
one('Formation costs paid by the owner', 'Part V formation_costs',
  { txns: [tx({ transaction_type: 'formation_costs', direction: 'received', amount_usd: '850', transaction_date: '2024-01-08' })] });
one('Dissolution transaction on a final return', 'dissolution_tx alongside final_return',
  { filing: { final_return: true, date_of_closure: '2024-11-30' }, txns: [tx({ transaction_type: 'dissolution_tx', direction: 'paid', amount_usd: '2000', transaction_date: '2024-11-30' })] }, 'drawn');
one('Non-monetary transfer', 'Part VI; no amount required',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'nonmonetary_transfer', amount_usd: '', description: 'Transferred design assets' })], part_vi_managerial: true });
one('Transfer for less than fair market value', 'Part VI less_than_fmv',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'less_than_fmv', amount_usd: '4000', description: 'Equipment at below FMV' })] });
one('Part VI with managerial involvement declined', 'part_vi_managerial false flips the Part VI question',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'property_transfer_fmv', amount_usd: '9000' })], part_vi_managerial: false }, 'drawn');

// ══ J. Volume and amount edges (91–93) ════════════════════════════════════

one('Thirty transactions against one party', 'Continuation / aggregation when lines exceed the form',
  {
    parties: [rp(0)],
    txns: Array.from({ length: 30 }, (_, i) => tx({
      related_party_index: 0,
      transaction_type: partIV[i % partIV.length][0],
      direction: partIV[i % partIV.length][2],
      amount_usd: String(100 * (i + 1)),
      description: `Line ${i + 1}`,
      transaction_date: `2024-${String((i % 12) + 1).padStart(2, '0')}-10`,
    })),
  }, 'drawn');
one('Amount with cents', 'Rounding to whole dollars',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, amount_usd: '1234.56' })] });
one('No reportable transactions, confirmed', 'no_transactions_confirmed true; a 5472 is still required',
  { txns: [], no_transactions_confirmed: true }, 'drawn');

// ══ K. Multi-year jobs (94–98) ════════════════════════════════════════════

function multi(title, tests, years, over = {}, sig) {
  S(title, tests, {
    shared_filing_fields: baseFiling(over.filing ?? {}),
    shared_owner_fields: baseOwner(over.owner ?? {}),
    include_rcl: over.include_rcl ?? true,
    reasonable_cause_reasons: over.reasonable_cause_reasons ?? ['first_time_filing', 'not_informed'],
    related_parties: over.parties ?? [],
    year_specific_filings: years,
    part_vi_managerial: true,
    multi_year: true,
  }, sig);
}

const yr = (y, over = {}) => ({
  tax_year: String(y),
  total_assets: 30000 + (y - 2019) * 5000,
  final_return: false,
  no_transactions_confirmed: false,
  transactions: [tx({ transaction_type: 'capital_contribution', direction: 'received', amount_usd: String(10000 + (y - 2019) * 1000), transaction_date: `${y}-04-10` })],
  ...over,
});

multi('Two-year catch-up, 2024 and 2023', 'filing_jobs row with two tax_years; one shared RCL across both',
  [yr(2024), yr(2023)], {}, 'drawn');
multi('Three-year catch-up, 2024–2022', 'Three filings fan out from one job',
  [yr(2024), yr(2023), yr(2022)], {}, 'typed');
multi('Five-year catch-up, 2024–2020', 'Five filings; RCL collected once, not per year',
  [yr(2024), yr(2023), yr(2022), yr(2021), yr(2020)], {}, 'drawn');
multi('Seven-year catch-up, 2025–2019', 'Every selectable year at once; the maximum job',
  [2025, 2024, 2023, 2022, 2021, 2020, 2019].map((y) => yr(y)), {}, 'drawn');
multi('Multi-year where the last year is a final return', 'Mixed year shapes inside one job; only 2024 closes',
  [yr(2024, { final_return: true, date_of_closure: '2024-08-31' }), yr(2023), yr(2022)], {}, 'drawn');
multi('Multi-year gated by the incorporation date', 'Incorporated 2022 — years before 2022 must not be selectable',
  [yr(2024), yr(2023), yr(2022)], { filing: { date_of_incorporation: '2022-03-10' } }, 'typed');
multi('Multi-year with no RCL', 'include_rcl false across a catch-up job — allowed but unusual',
  [yr(2023), yr(2022)], { include_rcl: false, reasonable_cause_reasons: [] }, 'typed');

// ══ L. Negatives, must be rejected (rest) ═════════════════════════════════

function bad(title, tests, expected, body, sig) {
  one(title, tests, body, sig);
  scenarios[scenarios.length - 1].expected_result = expected;
}

bad('EIN in the wrong format', 'EIN validation on step 1',
  'REJECTED at step 1 with an EIN format error; nothing saved',
  { filing: { ein: '1234567' } }, 'typed');
bad('LLC name left blank', 'Required-field validation on step 1',
  'REJECTED at step 1; "Please complete the following" lists the LLC name',
  { filing: { llc_name: '' } }, 'typed');
bad('Owner name left blank', 'Required-field validation on step 2',
  'REJECTED at step 2; owner name listed',
  { owner: { owner_full_name: '' } }, 'typed');
bad('Incorporated after the tax year ended', 'Cross-field date validation',
  'REJECTED; an entity cannot file for a year before it existed',
  { filing: { tax_year: '2023', date_of_incorporation: '2025-06-01' } }, 'typed');
bad('Final return with no closure date', 'final_return requires date_of_closure',
  'REJECTED at step 1; closure date required when the final-return box is ticked',
  { filing: { final_return: true, date_of_closure: '' } }, 'typed');
bad('Closure date outside the tax year', 'date_of_closure must fall in the period',
  'REJECTED; closure date is not inside the tax year',
  { filing: { tax_year: '2024', final_return: true, date_of_closure: '2025-06-30' } }, 'typed');
bad('No transactions and not confirmed', 'The confirmation checkbox is the gate on step 4',
  'REJECTED at step 4 until the no-transactions box is ticked',
  { txns: [], no_transactions_confirmed: false }, 'typed');
bad('Transaction pointing at a party that does not exist', 'related_party_index out of range',
  'REJECTED, or the transaction is re-pointed — it must not silently attach to the owner',
  { parties: [], txns: [tx({ related_party_index: 3 })] }, 'typed');
bad('Transaction with no amount on a type that requires one', 'amountOptional false',
  'REJECTED at step 4; amount required for this transaction type',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'service_payment', amount_usd: '' })] }, 'typed');
bad('Negative transaction amount', 'Sign validation',
  'REJECTED, or normalised — a negative must never reach the return',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, amount_usd: '-5000' })] }, 'typed');
bad('Total assets negative', 'Sign validation on step 1',
  'REJECTED at step 1',
  { filing: { total_assets: -100 } }, 'typed');
bad('Fiscal year ticked with no end month', 'is_fiscal_year requires fiscal_end_month',
  'REJECTED at step 1; fiscal year end month required',
  { filing: { is_fiscal_year: true, fiscal_end_month: '' } }, 'typed');

// ── emit ──────────────────────────────────────────────────────────────────

// Give every scenario its own entity, EIN and owner, and stamp the scenario
// number on the front. A hundred filings called "Bluewave Digital LLC" are
// indistinguishable in the dashboard, in the saved rows and on the generated
// PDFs, so tracing a defect back to the scenario that produced it is guesswork
// — and identical data also hides any bug that only shows up when two filings
// differ. The number rides on the data itself, so it survives into every
// artefact.
//
// Only values still at their base default are replaced. A scenario that set a
// name deliberately (the non-Latin and CJK encoding tests, the overflow test,
// the negative that needs a BLANK name) keeps what it asked for.
const ENTITY_WORDS_A = ['Bluewave', 'Northgate', 'Cedar Fork', 'Highvale', 'Marlow', 'Ironbridge',
  'Quietwater', 'Sablefield', 'Redgrove', 'Halcyon', 'Wexford', 'Brightlin',
  'Copperline', 'Duneside', 'Everbrook', 'Fernhollow', 'Granthill', 'Larkspur',
  'Meridian', 'Oakhaven'];
const ENTITY_WORDS_B = ['Digital', 'Ventures', 'Labs', 'Trading', 'Systems',
  'Holdings', 'Studios', 'Partners', 'Analytics', 'Commerce'];
const OWNER_NAMES = ['Aarav Mehta', 'Sofia Almeida', 'Lucas Bergström', 'Priya Raghunathan',
  'Tomas Novak', 'Ines Duarte', 'Rahul Kapoor', 'Elena Marchetti',
  'Kwame Boateng', 'Yuki Tanaka', 'Omar Haddad', 'Mateo Rossi',
  'Anja Lindqvist', 'Nadia Farouk', 'Diego Salazar', 'Hana Kovacs',
  'Ravi Subramanian', 'Clara Jensen', 'Pavel Sokolov', 'Amira Nasser'];

for (const s of scenarios) {
  const i = s.scenario_id - 1;
  const n = String(s.scenario_id).padStart(3, '0');
  const entity = `${ENTITY_WORDS_A[i % ENTITY_WORDS_A.length]} ${ENTITY_WORDS_B[Math.floor(i / ENTITY_WORDS_A.length) % ENTITY_WORDS_B.length]} LLC`;
  // Valid XX-XXXXXXX, unique per scenario.
  const ein = `${String(20 + (i % 70)).padStart(2, '0')}-${String(1000000 + s.scenario_id * 7919).slice(0, 7)}`;

  for (const key of ['filing', 'shared_filing_fields']) {
    const f = s[key];
    if (!f) continue;
    if (f.llc_name === 'Bluewave Digital LLC') f.llc_name = `S${n} ${entity}`;
    if (f.ein === '35-1122334') f.ein = ein;
  }
  for (const key of ['owner', 'shared_owner_fields']) {
    const o = s[key];
    if (!o) continue;
    if (o.owner_full_name === 'Aarav Mehta') o.owner_full_name = OWNER_NAMES[i % OWNER_NAMES.length];
    if (o.owner_reference_id === 'AAR001') o.owner_reference_id = `REF${n}`;
  }
}

if (scenarios.length !== 100) {
  console.error(`Expected 100 scenarios, built ${scenarios.length}. Fix the file before running.`);
  process.exit(1);
}

const doc = {
  meta: {
    generated: new Date().toISOString(),
    count: scenarios.length,
    portal: 'Desktop/CNL 5472/5472',
    note: 'Authored against the portal as at August 2026. signature_mode and expected_result are read by the driver, not by the wizard.',
    negatives: scenarios.filter((s) => s.expected_result).length,
    multi_year: scenarios.filter((s) => s.multi_year).length,
    drawn: scenarios.filter((s) => s.signature_mode === 'drawn').length,
    typed: scenarios.filter((s) => s.signature_mode === 'typed').length,
  },
  scenarios,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`Wrote ${out}`);
console.log(JSON.stringify(doc.meta, null, 2));
