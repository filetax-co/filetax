/**
 * genScenarios100.mjs, authors testing/__scenarios100.json.
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
  // year it did not exist in, and the wizard rightly refuses, so a base date
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
  // These four names have to match the RelatedParty shape the wizard keeps in
  // state, because applyScenario assigns this object straight into it and the
  // whole array is then stored verbatim on filings.related_parties. They were
  // reference_id / business_activity / naics_code, none of which the wizard or
  // filingMapping.RawRelatedParty reads, and country_residence was missing
  // entirely, so every related party in every scenario reached the generator
  // with a blank reference number, business activity, business code and country
  // of tax residence, all four of which print on that party's Form 5472.
  ref_number: `RP${String(i + 1).padStart(3, '0')}`,
  country_residence: ['Singapore', 'Germany', 'United Arab Emirates', 'United Kingdom', 'Sweden'][i % 5],
  biz_activity: 'Management Consulting',
  biz_code: '541611',
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

/**
 * A date safely inside the filing period for a scenario's filing block.
 *
 * Mirrors deriveFiscalPeriod in Intake.tsx. Every transaction used to be dated
 * 2024-06-15 no matter which year the return covered, so a 2019 scenario
 * carried a 2024 transaction. That was invalid data the wizard simply never
 * checked; now that it does, the scenarios have to be right.
 */
function inPeriod(f) {
  const y = Number(f.tax_year);
  if (!Number.isFinite(y)) return '2024-06-15';
  const pad = (n) => String(n).padStart(2, '0');
  const m = f.fiscal_end_month;
  if (f.is_fiscal_year && m !== '' && m !== undefined && Number.isFinite(Number(m)) && Number(m) !== 12) {
    // Period begins the month after the fiscal end month, in the tax year.
    const beginMonth = Number(m) + 1;
    if (beginMonth > 12) return `${y}-12-15`;
    return `${y}-${pad(beginMonth)}-15`;
  }
  return `${y}-06-15`;
}

/** Single-year scenario shorthand. */
function one(title, tests, { filing = {}, owner = {}, parties = [], txns, ...rest } = {}, sig) {
  const builtFiling = baseFiling(filing);
  // Re-date any transaction still carrying the tx() default so it falls inside
  // the period actually being filed. A scenario that pins a date on purpose
  // (the two out-of-period negatives) keeps what it asked for.
  const dated = (list) => list.map((t) => (
    t.transaction_date === '2024-06-15' ? { ...t, transaction_date: inPeriod(builtFiling) } : t
  ));
  S(title, tests, {
    filing: builtFiling,
    owner: baseOwner(owner),
    related_parties: parties,
    transactions: dated(txns ?? [tx()]),
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    ...rest,
  }, sig);
}

// ══ A. Timing, extensions and lateness (1–12) ═════════════════════════════

// As of August 2026 the only year that is not already late is 2025 held open by
// a valid Form 7004, whose extended deadline is 15 October 2026. Everything else
// is late, and the wizard pre-selects the reasonable cause letter for it, so
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
one('LLC with US real estate or US-performed work', 'us_activity Yes, the 1040-NR warning banner must appear and the flow must still continue',
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
// Owners in the UAE, Cayman and the Bahamas are issued no tax ID at all. The
// field stays required, because the return needs an identifying number, but a
// passport number is accepted in its place. So the positive case is "no tax ID,
// passport instead", and a genuinely empty identifier is still a negative.
one('Owner has no foreign tax ID, passport number instead', 'The passport fallback on owner_foreign_tax_id',
  { owner: { owner_primary_country: 'United Arab Emirates', owner_country_residence: 'United Arab Emirates',
    owner_country_citizenship: 'United Arab Emirates', owner_foreign_tax_id: 'P4821996',
    owner_address: { line1: 'Office 1204, Boulevard Plaza Tower 1', city: 'Dubai', region: '', postal_code: '', country: 'United Arab Emirates' } } });
bad('Owner with no identifier at all', 'Neither a US TIN, a foreign tax ID, nor a passport number',
  'REJECTED at step 2; the return needs an identifying number for the owner',
  { owner: { owner_us_tin: '', owner_foreign_tax_id: '' } });
one('Non-Latin owner name', 'WinAnsi encoding path; Cyrillic must not throw in pdf-lib',
  { owner: { owner_full_name: 'Дмитрий Волков', owner_primary_country: 'Kazakhstan', owner_country_residence: 'Kazakhstan', owner_country_citizenship: 'Kazakhstan' } }, 'drawn');
one('CJK owner name', 'Encoding path for Chinese characters',
  { owner: { owner_full_name: '陈伟明', owner_primary_country: 'China', owner_country_residence: 'China', owner_country_citizenship: 'China' } }, 'drawn');
one('Very long owner name', 'Overflow behaviour in a fixed-width AcroForm field',
  { owner: { owner_full_name: 'Bartholomew Alexander Fitzgerald-Montgomery III' } });
one('Residence differs from citizenship', 'Three country fields diverge; each maps to its own line',
  { owner: { owner_primary_country: 'Germany', owner_country_residence: 'Portugal', owner_country_citizenship: 'India' } });
one('Owner resident in the United States', 'US residence with foreign citizenship, still a foreign owner',
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
one('Three related parties, one with no transactions', 'A party with nothing against it, is a 5472 still made?',
  { parties: [rp(0), rp(1), rp(2)], txns: [tx({ related_party_index: 0 }), tx({ related_party_index: 2, transaction_type: 'interest', amount_usd: '400' })] });
one('Five related parties', 'Package size; five 5472s in one PDF',
  { parties: [0, 1, 2, 3, 4].map((i) => rp(i)), txns: [0, 1, 2, 3, 4].map((i) => tx({ related_party_index: i, amount_usd: String(1000 * (i + 1)) })) }, 'drawn');
one('Related party that is a US person', 'US related party; US TIN present, country United States',
  { parties: [rp(0, { name: 'Harbor Point LLC', country: 'United States', us_tin: '84-1234567', foreign_tax_id: '', address: usAddr({ line1: '9 Beacon St', city: 'Boston', region: 'MA', postal_code: '02108' }) })], txns: [tx({ related_party_index: 0 })] });
one('Related party with no foreign tax ID', 'Blank identifier on the party, not the owner',
  { parties: [rp(0, { foreign_tax_id: '' })], txns: [tx({ related_party_index: 0 })] });
one('Related party with a very long name', 'Overflow in the party name field',
  { parties: [rp(0, { name: 'Internationale Handelsgesellschaft für Digitale Dienstleistungen mbH' })], txns: [tx({ related_party_index: 0 })] });
one('Related party sharing the owner name', 'Name collision, must not be silently merged with the owner',
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
one('Loan guarantee fee on a 2021 return', 'REGRESSION: line 20/34 absent in the 2019-2021 revision, must be disclosed under other amounts, never dropped from the total',
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
multi('Multi-year gated by the incorporation date', 'Incorporated 2022, years before 2022 must not be selectable',
  [yr(2024), yr(2023), yr(2022)], { filing: { date_of_incorporation: '2022-03-10' } }, 'typed');
multi('Multi-year with no RCL', 'include_rcl false across a catch-up job, allowed but unusual',
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
  'REJECTED, or the transaction is re-pointed, it must not silently attach to the owner',
  { parties: [], txns: [tx({ related_party_index: 3 })] }, 'typed');
bad('Transaction with no amount on a type that requires one', 'amountOptional false',
  'REJECTED at step 4; amount required for this transaction type',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, transaction_type: 'service_payment', amount_usd: '' })] }, 'typed');
bad('Negative transaction amount', 'Sign validation',
  'REJECTED, or normalised, a negative must never reach the return',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0, amount_usd: '-5000' })] }, 'typed');
bad('Total assets negative', 'Sign validation on step 1',
  'REJECTED at step 1',
  { filing: { total_assets: -100 } }, 'typed');
bad('Fiscal year ticked with no end month', 'is_fiscal_year requires fiscal_end_month',
  'REJECTED at step 1; fiscal year end month required',
  { filing: { is_fiscal_year: true, fiscal_end_month: '' } }, 'typed');

// ══ M. Negatives, second wave (101–125) ═══════════════════════════════════
//
// Added after the August 2026 run found that six of the twelve negatives above
// were NOT stopped: the wizard generated a full package for a negative total
// assets figure, a fiscal year with no end month, an unconfirmed empty
// transaction list, a transaction pointing past the end of the party list, and
// transactions with a blank or negative amount, those last two silently
// deleted rather than reported. These 25 push on the same surfaces, one
// variation each, so a regression names the exact rule that broke.

// ── amount and sign, the rule that leaked worst ──────────────────────────
bad('Negative amount on a purchase', 'Sign validation must not depend on the transaction type',
  'REJECTED at step 4; a negative amount must never reach the return',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'tangible_property', amount_usd: '-1' })] }, 'typed');
bad('Negative amount on rent', 'Sign validation on a Part IV royalty-family type',
  'REJECTED at step 4',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'rent', amount_usd: '-2500' })] }, 'typed');
bad('Negative loan beginning balance', 'loan_begin_usd is a separate field with its own sign rule',
  'REJECTED at step 4; a beginning balance cannot be negative',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'loan_to_llc', amount_usd: '5000', loan_begin_usd: '-900' })] }, 'typed');
bad('Amount that is not a number', 'Number() yields NaN; must not be stored as null and forgotten',
  'REJECTED at step 4; the amount is not a number',
  { parties: [rp(0)], txns: [tx({ amount_usd: 'twelve thousand' })] }, 'typed');
bad('Amount is only a minus sign', 'Partial input that parses to NaN',
  'REJECTED at step 4',
  { parties: [rp(0)], txns: [tx({ amount_usd: '-' })] }, 'typed');
bad('Blank amount on a royalty', 'Required-amount rule on a second monetary type',
  'REJECTED at step 4; amount required',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'royalty', amount_usd: '' })] }, 'typed');
bad('Blank amount on interest', 'Required-amount rule on a third monetary type',
  'REJECTED at step 4; amount required',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'interest', amount_usd: '' })] }, 'typed');
bad('Whitespace-only amount', 'A trimmed blank must count as blank, not as 0',
  'REJECTED at step 4; amount required',
  { parties: [rp(0)], txns: [tx({ amount_usd: '   ' })] }, 'typed');

// ── party wiring ─────────────────────────────────────────────────────────
bad('Transaction pointing one past the last party', 'Off-by-one on related_party_index',
  'REJECTED at step 4; the party does not exist',
  { parties: [rp(0)], txns: [tx({ related_party_index: 2 })] }, 'typed');
bad('Transaction with a negative party index', 'A negative index must not wrap or resolve to the owner',
  'REJECTED at step 4',
  { parties: [rp(0)], txns: [tx({ related_party_index: -1 })] }, 'typed');
bad('Two transactions, the second pointing at a missing party', 'A valid row must not mask an invalid one',
  'REJECTED at step 4; the second transaction is named',
  { parties: [rp(0)], txns: [tx({ related_party_index: 0 }), tx({ related_party_index: 5, amount_usd: '900' })] }, 'typed');
bad('No transactions confirmed AND a transaction present', 'The confirmation contradicts the data',
  'REJECTED; the box says there were none but one is listed',
  { parties: [rp(0)], txns: [tx()], no_transactions_confirmed: true }, 'typed');

// ── step 1 numeric and period rules ──────────────────────────────────────
bad('Total assets not a number', 'Number() yields NaN on step 1',
  'REJECTED at step 1; total assets must be a number',
  { filing: { total_assets: 'lots' } }, 'typed');
bad('Total assets negative by one cent', 'Boundary just below zero',
  'REJECTED at step 1',
  { filing: { total_assets: -0.01 } }, 'typed');
bad('Fiscal year with a month out of range', 'fiscal_end_month must be 1-12',
  'REJECTED at step 1; month out of range',
  { filing: { is_fiscal_year: true, fiscal_end_month: 13 } }, 'typed');
bad('Fiscal year with month zero', 'Zero is falsy and must not read as "not set"',
  'REJECTED at step 1; month out of range',
  { filing: { is_fiscal_year: true, fiscal_end_month: 0 } }, 'typed');
bad('Incorporated the day after the tax year ends', 'Boundary on the incorporation-date rule',
  'REJECTED at step 1',
  { filing: { tax_year: '2024', date_of_incorporation: '2025-01-01' } }, 'typed');
bad('Closure date before incorporation', 'Cross-field ordering of the two entity dates',
  'REJECTED at step 1; dissolved before it was formed',
  { filing: { tax_year: '2024', final_return: true, date_of_closure: '2024-03-01', date_of_incorporation: '2024-09-01' } }, 'typed');
bad('EIN with letters', 'EIN validation beyond the digit-count case',
  'REJECTED at step 1; EIN format',
  { filing: { ein: 'AB-1234567' } }, 'typed');
bad('EIN all zeroes', 'Structurally valid but an impossible EIN',
  'REJECTED at step 1',
  { filing: { ein: '00-0000000' } }, 'typed');

// ── identity and period, steps 1-3 ───────────────────────────────────────
bad('Owner name is only whitespace', 'A trimmed blank must count as blank',
  'REJECTED at step 2; owner name required',
  { owner: { owner_full_name: '   ' } }, 'typed');
bad('LLC name is only whitespace', 'The same trimmed-blank rule on step 1',
  'REJECTED at step 1; LLC name required',
  { filing: { llc_name: '   ' } }, 'typed');
bad('Related party with a blank legal name', 'The party sub-form has its own validator',
  'REJECTED at step 3; the related party cannot be saved nameless',
  { parties: [rp(0, { name: '' })], txns: [tx({ related_party_index: 1 })] }, 'typed');
bad('Related party with a blank country', 'Country is required on the party sub-form',
  'REJECTED at step 3',
  { parties: [rp(0, { country: '' })], txns: [tx({ related_party_index: 1 })] }, 'typed');
bad('Tax year in the future', 'A year that has not ended cannot be filed',
  'REJECTED at step 1; future tax year',
  { filing: { tax_year: '2027' } }, 'typed');


// == N. Third wave (126-200): 42 positives, 33 negatives ==================
//
// Aimed at surfaces nothing has driven yet. The positives concentrate on the
// transaction types and older form revisions with no coverage at all, because
// that is where the loan-guarantee-fee defect lived: a field absent from the
// 2019-2021 revision, written to anyway, silently dropped from the return
// while still counted in the total. The negatives concentrate on formats a
// real filer actually types (currency symbols, thousands separators) and on
// date orderings nothing currently checks.

const LONG_DESC = 'Quarterly cross-border management and administrative support services '
  + 'covering finance, legal, procurement and engineering, invoiced in arrears under the '
  + 'intercompany services agreement dated 1 January 2024 and settled by wire transfer '
  + 'within 30 days of each quarter end as required by the transfer pricing policy.';

// -- uncovered transaction types ------------------------------------------
one('Cost sharing arrangement', 'cost_sharing has no coverage',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'cost_sharing', amount_usd: '18000' })] }, 'drawn');
one('Platform contribution', 'platform_contribution has no coverage',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'platform_contribution', amount_usd: '25000' })] }, 'typed');
one('Other Part V with a written description', 'other_part_v free-text path',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'other_part_v', amount_usd: '4000', description: 'Owner settled a vendor invoice directly' })] }, 'drawn');
one('Other Part VI with a written description', 'other_part_vi free-text path',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'other_part_vi', amount_usd: '', description: 'Owner granted rent-free use of a warehouse' })] }, 'typed');
one('Property transfer at fair market value', 'property_transfer_fmv has no coverage',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'property_transfer_fmv', amount_usd: '60000' })] }, 'drawn');
one('Formation transaction', 'formation_tx Part V code',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'formation_tx', amount_usd: '1200' })] }, 'typed');
one('Dissolution transaction on a final return', 'dissolution_tx with final_return',
  { filing: { final_return: true, date_of_closure: '2024-11-30' }, parties: [rp(0)], txns: [tx({ transaction_type: 'dissolution_tx', amount_usd: '3000' })] }, 'drawn');
one('Acquisition transaction', 'acquisition_tx Part V code',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'acquisition_tx', amount_usd: '45000' })] }, 'typed');
one('Disposition transaction', 'disposition_tx Part V code',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'disposition_tx', amount_usd: '15000' })] }, 'drawn');
one('Digital asset against a related party', 'digital_asset on a non-owner party',
  { parties: [rp(0)], txns: [tx({ related_party_index: 1, transaction_type: 'digital_asset', amount_usd: '7500' })] }, 'typed');

// -- older revisions, which carry the revision-specific field gaps ---------
one('Loan guarantee fee on a 2020 return', 'REGRESSION: line 20/34 absent before 2022',
  { filing: { tax_year: '2020', include_reasonable_cause: true, reasonable_cause_reasons: ['not_informed'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'loan_guarantee_fee', amount_usd: '2200' })] }, 'drawn');
one('Loan guarantee fee on a 2019 return', 'Oldest revision, same absent line',
  { filing: { tax_year: '2019', include_reasonable_cause: true, reasonable_cause_reasons: ['not_informed'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'loan_guarantee_fee', amount_usd: '1800' })] }, 'typed');
one('Loan from the LLC on a 2021 return', 'Loan balances on the 2019-2021 revision',
  { filing: { tax_year: '2021', include_reasonable_cause: true, reasonable_cause_reasons: ['minimal_activity'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'loan_from_llc', amount_usd: '30000', loan_begin_usd: '12000' })] }, 'drawn');
one('Intangible property on a 2019 return', 'Part IV intangible line, oldest revision',
  { filing: { tax_year: '2019', include_reasonable_cause: true, reasonable_cause_reasons: ['first_time_filing'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'intangible', amount_usd: '9000' })] }, 'typed');
one('Insurance premium on a 2020 return', 'Part IV insurance line, older revision',
  { filing: { tax_year: '2020', include_reasonable_cause: true, reasonable_cause_reasons: ['no_tax_liability'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'insurance', amount_usd: '4400' })] }, 'drawn');
one('Commission on a 2021 return', 'Part IV commission line, older revision',
  { filing: { tax_year: '2021', include_reasonable_cause: true, reasonable_cause_reasons: ['language_barrier'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'commission', amount_usd: '6100' })] }, 'typed');
one('Technical services on a 2022 return', 'Part IV technical services, mid revision',
  { filing: { tax_year: '2022', include_reasonable_cause: true, reasonable_cause_reasons: ['discovered_late'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'tech_services', amount_usd: '13000' })] }, 'drawn');
one('Royalty on a 2019 return', 'Royalty split from rent, oldest revision',
  { filing: { tax_year: '2019', include_reasonable_cause: true, reasonable_cause_reasons: ['voluntary_filing'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'royalty', amount_usd: '5200' })] }, 'typed');
one('Rent on a 2020 return', 'Rent side of the same pair',
  { filing: { tax_year: '2020', include_reasonable_cause: true, reasonable_cause_reasons: ['minimal_activity'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'rent', amount_usd: '7700' })] }, 'drawn');
one('Interest on a 2021 return', 'Part IV interest line, older revision',
  { filing: { tax_year: '2021', include_reasonable_cause: true, reasonable_cause_reasons: ['new_procedures'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'interest', amount_usd: '2100' })] }, 'typed');
one('Sales on a 2022 return', 'Part IV sales line',
  { filing: { tax_year: '2022', include_reasonable_cause: true, reasonable_cause_reasons: ['first_time_filing'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'sales', amount_usd: '88000' })] }, 'drawn');
one('Tangible purchase on a 2019 return', 'Purchase direction on the oldest revision',
  { filing: { tax_year: '2019', include_reasonable_cause: true, reasonable_cause_reasons: ['not_informed'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'tangible_purchase', amount_usd: '31000' })] }, 'typed');
one('Tangible sale on a 2020 return', 'Sale direction on an older revision',
  { filing: { tax_year: '2020', include_reasonable_cause: true, reasonable_cause_reasons: ['no_tax_liability'] }, parties: [rp(0)], txns: [tx({ transaction_type: 'tangible_sale', direction: 'received', amount_usd: '27000' })] }, 'drawn');

// -- amount and period boundaries -----------------------------------------
one('Smallest reportable amount', 'One cent must survive rounding and formatting',
  { parties: [rp(0)], txns: [tx({ amount_usd: '0.01' })] }, 'typed');
one('Amount just under a billion', 'Field width and thousands formatting at the top end',
  { parties: [rp(0)], txns: [tx({ amount_usd: '999999999' })] }, 'drawn');
one('Loan balances both carrying cents', 'Cents on two numeric fields at once',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'loan_to_llc', amount_usd: '41234.56', loan_begin_usd: '10987.65' })] }, 'typed');
one('Fiscal year ending January', 'Short period wrapping the calendar boundary',
  { filing: { is_fiscal_year: true, fiscal_end_month: 1, include_reasonable_cause: true, reasonable_cause_reasons: ['first_time_filing'] } }, 'drawn');
one('Fiscal year ending March', 'A common non-calendar year end',
  { filing: { is_fiscal_year: true, fiscal_end_month: 3, include_reasonable_cause: true, reasonable_cause_reasons: ['minimal_activity'] } }, 'typed');
one('Fiscal year ending September', 'Late-in-year fiscal end',
  { filing: { is_fiscal_year: true, fiscal_end_month: 9, include_reasonable_cause: true, reasonable_cause_reasons: ['not_informed'] } }, 'drawn');
one('Fiscal year ending December', 'Equivalent to a calendar year; must not double-shift the period',
  { filing: { is_fiscal_year: true, fiscal_end_month: 12, include_reasonable_cause: true, reasonable_cause_reasons: ['no_tax_liability'] } }, 'typed');
one('Total assets exactly zero with transactions', 'Zero is a real answer, not a missing one',
  { filing: { total_assets: 0 }, parties: [rp(0)], txns: [tx()] }, 'drawn');

// -- entity shape ---------------------------------------------------------
one('Initial return, formed during the tax year', 'initial_return derived from the incorporation date',
  { filing: { tax_year: '2024', date_of_incorporation: '2024-02-15', include_reasonable_cause: true, reasonable_cause_reasons: ['first_time_filing'] }, parties: [rp(0)], txns: [tx()] }, 'typed');
one('Formed and closed inside the same tax year', 'Initial and final on one return',
  { filing: { tax_year: '2024', date_of_incorporation: '2024-02-15', final_return: true, date_of_closure: '2024-10-20', include_reasonable_cause: true, reasonable_cause_reasons: ['minimal_activity'] }, parties: [rp(0)], txns: [tx()] }, 'drawn');
one('Name change on a 2021 return', 'Form 1120 item E box on an older revision',
  { filing: { tax_year: '2021', name_change: true, include_reasonable_cause: true, reasonable_cause_reasons: ['not_informed'] } }, 'typed');
one('Address change on a 2020 return', 'The other item E box on an older revision',
  { filing: { tax_year: '2020', address_change: true, include_reasonable_cause: true, reasonable_cause_reasons: ['language_barrier'] } }, 'drawn');
one('Eight related parties in eight countries', 'Country handling across a wide party list',
  { parties: [0, 1, 2, 3, 4, 0, 1, 2].map((k, i) => rp(k, { name: `Party ${i + 1} Holdings Ltd`, ref_number: `RPX${i + 1}` })),
    txns: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tx({ related_party_index: i, amount_usd: String(1000 * i) })) }, 'typed');
one('Twelve related parties', 'Beyond the eight-party case; pagination of the 5472 set',
  { parties: Array.from({ length: 12 }, (_, i) => rp(i % 5, { name: `Wide Party ${i + 1} Ltd`, ref_number: `RPW${i + 1}` })),
    txns: Array.from({ length: 12 }, (_, i) => tx({ related_party_index: i + 1, amount_usd: String(500 * (i + 1)) })) }, 'drawn');
one('Forty transactions across three parties', 'Volume beyond the thirty-transaction case',
  { parties: [rp(0), rp(1), rp(2)],
    txns: Array.from({ length: 40 }, (_, i) => tx({ related_party_index: (i % 3) + 1, amount_usd: String(100 + i), description: `Line item ${i + 1}` })) }, 'typed');
one('Owner holding both a US ITIN and a foreign TIN', 'Both identifier fields populated at once',
  { owner: { owner_us_tin: '912-34-5678' } }, 'drawn');
one('Related party that is a US person with a US TIN', 'US party tier with an identifier',
  { parties: [rp(0, { name: 'Harbor Point LLC', country: 'US', country_residence: 'US', us_tin: '84-1234567', foreign_tax_id: '', address: { line1: '55 Water St', city: 'New York', region: 'NY', postal_code: '10041', country: 'US' } })],
    txns: [tx({ related_party_index: 1 })] }, 'typed');
one('Very long transaction description', 'Wrapping and truncation on the statement pages',
  { parties: [rp(0)], txns: [tx({ description: LONG_DESC })] }, 'drawn');
one('Part VI managerial declined but a Part VI transaction present', 'The flag and the data disagree in a legal way',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'nonmonetary_transfer', amount_usd: '' })], part_vi_managerial: false }, 'typed');
one('Part IV, Part V and Part VI in one filing', 'All three statement paths in a single package',
  { parties: [rp(0)], txns: [
    tx({ related_party_index: 1, transaction_type: 'service_payment', amount_usd: '12000' }),
    tx({ related_party_index: 0, transaction_type: 'distribution', amount_usd: '8000' }),
    tx({ related_party_index: 0, transaction_type: 'nonmonetary_transfer', amount_usd: '' }),
  ] }, 'drawn');

// -- negatives: amounts as a filer actually types them ---------------------
bad('Amount with a dollar sign', 'A pasted "$5000" must not become NaN or 5',
  'REJECTED at step 4, or the symbol is stripped; it must never silently become a different number',
  { parties: [rp(0)], txns: [tx({ amount_usd: '$5000' })] }, 'typed');
bad('Amount with a thousands separator', 'A pasted "5,000" must not parse as 5',
  'REJECTED at step 4, or normalised to 5000',
  { parties: [rp(0)], txns: [tx({ amount_usd: '5,000' })] }, 'typed');
bad('Amount in exponent notation', '5e3 is a valid JS number and a meaningless entry',
  'REJECTED at step 4',
  { parties: [rp(0)], txns: [tx({ amount_usd: '5e3' })] }, 'typed');
bad('Amount with four decimal places', 'Currency carries two; the rest must not silently round',
  'REJECTED at step 4, or rounded and shown as rounded',
  { parties: [rp(0)], txns: [tx({ amount_usd: '1234.5678' })] }, 'typed');
bad('Loan with a beginning balance and no closing balance', 'A loan needs both ends to be meaningful',
  'REJECTED at step 4; closing balance required for a loan',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'loan_to_llc', amount_usd: '', loan_begin_usd: '9000' })] }, 'typed');
bad('Transaction dated before the tax year', 'transaction_date must fall inside the period',
  'REJECTED; a 2023 transaction does not belong on a 2024 return',
  { filing: { tax_year: '2024' }, parties: [rp(0)], txns: [tx({ transaction_date: '2023-06-15' })] }, 'typed');
bad('Transaction dated after the tax year', 'The other end of the same rule',
  'REJECTED; a 2025 transaction does not belong on a 2024 return',
  { filing: { tax_year: '2024' }, parties: [rp(0)], txns: [tx({ transaction_date: '2025-06-15' })] }, 'typed');
bad('Transaction with a blank type', 'transaction_type is required',
  'REJECTED at step 4',
  { parties: [rp(0)], txns: [tx({ transaction_type: '' })] }, 'typed');
bad('Transaction with an unknown type code', 'An unrecognised code must not reach the return',
  'REJECTED, or mapped to other; never printed as a raw code',
  { parties: [rp(0)], txns: [tx({ transaction_type: 'not_a_real_type' })] }, 'typed');
bad('Transaction pointing at party 1 when none exist', 'Index 1 with an empty party list',
  'REJECTED at step 4',
  { parties: [], txns: [tx({ related_party_index: 1 })] }, 'typed');

// -- negatives: dates and identifiers -------------------------------------
bad('Closure date in the future', 'A return cannot report a dissolution that has not happened',
  'REJECTED at step 1',
  { filing: { tax_year: '2024', final_return: true, date_of_closure: '2027-05-01' } }, 'typed');
bad('Incorporation date in the future', 'Same rule on the other entity date',
  'REJECTED at step 1',
  { filing: { date_of_incorporation: '2027-01-01' } }, 'typed');
bad('Signature date in the future', 'A return cannot be signed on a date that has not arrived',
  'REJECTED; signature date is in the future',
  { owner: { signature_date: '2027-03-03' } }, 'typed');
bad('Signer title left blank', 'The signature block requires a title',
  'REJECTED; signer title required',
  { owner: { signer_title: '' } }, 'typed');
// Left blank on purpose: the reference code is SELF-GENERATING. An effect fills
// it from the owner name whenever it is empty, including when the name was
// prefilled rather than typed, so a blank one is a positive case, not a defect.
one('Owner reference code left blank, auto-generated', 'buildOwnerRef fills an empty reference code',
  { owner: { owner_reference_id: '' } }, 'typed');
bad('Business code with letters', 'NAICS is six digits',
  'REJECTED at step 1; business code must be numeric',
  { filing: { naics_code: '54AB11' } }, 'typed');
bad('Business code of the wrong length', 'NAICS is exactly six digits',
  'REJECTED at step 1',
  { filing: { naics_code: '5415' } }, 'typed');
bad('Total assets with a thousands separator', 'A pasted 42,000 must not parse as 42',
  'REJECTED at step 1, or normalised to 42000',
  { filing: { total_assets: '42,000' } }, 'typed');
bad('Tax year left blank', 'tax_year is required',
  'REJECTED at step 1',
  { filing: { tax_year: '' } }, 'typed');
bad('State of formation left blank', 'state_of_formation is required',
  'REJECTED at step 1',
  { filing: { state_of_formation: '' } }, 'typed');
bad('Mailing address with no street', 'isAddressComplete requires line1',
  'REJECTED at step 1',
  { filing: { mailing_address: usAddr({ line1: '' }) } }, 'typed');
bad('Mailing address with no city', 'isAddressComplete requires city',
  'REJECTED at step 1',
  { filing: { mailing_address: usAddr({ city: '' }) } }, 'typed');
bad('US mailing address with no state', 'Region is required for US addresses',
  'REJECTED at step 1',
  { filing: { mailing_address: usAddr({ region: '' }) } }, 'typed');
bad('Owner address with no country', 'Country is required on a foreign owner address',
  'REJECTED at step 2',
  { owner: { owner_address: foreignAddr({ country: '' }) } }, 'typed');
bad('EIN with ten digits', 'One digit too many',
  'REJECTED at step 1',
  { filing: { ein: '12-34567890' } }, 'typed');
bad('EIN written with spaces', 'A pasted 12 3456789',
  'REJECTED at step 1, or normalised to 12-3456789',
  { filing: { ein: '12 3456789' } }, 'typed');
bad('Fiscal end month as text', 'A non-numeric month must not derive a period',
  'REJECTED at step 1',
  { filing: { is_fiscal_year: true, fiscal_end_month: 'June' } }, 'typed');
bad('Two related parties sharing a reference code', 'Reference codes identify a party on the return',
  'REJECTED at step 3; reference codes must be unique',
  { parties: [rp(0, { ref_number: 'DUP001' }), rp(1, { ref_number: 'DUP001' })],
    txns: [tx({ related_party_index: 1 })] }, 'typed');
bad('Two related parties identical in every field', 'A duplicated party doubles the amounts on the return',
  'REJECTED, or merged; never two identical Forms 5472',
  { parties: [rp(0), rp(0)], txns: [tx({ related_party_index: 1 })] }, 'typed');
bad('Related party with no address', 'The party address prints on their Form 5472',
  'REJECTED at step 3',
  { parties: [rp(0, { address: {} })], txns: [tx({ related_party_index: 1 })] }, 'typed');
bad('Related party with no country of tax residence', 'country_residence prints on the party 5472',
  'REJECTED at step 3',
  { parties: [rp(0, { country_residence: '' })], txns: [tx({ related_party_index: 1 })] }, 'typed');
bad('Owner country of citizenship left blank', 'Required on step 2',
  'REJECTED at step 2',
  { owner: { owner_country_citizenship: '' } }, 'typed');


// ── emit ──────────────────────────────────────────────────────────────────

// Give every scenario its own entity, EIN and owner, and stamp the scenario
// number on the front. A hundred filings called "Bluewave Digital LLC" are
// indistinguishable in the dashboard, in the saved rows and on the generated
// PDFs, so tracing a defect back to the scenario that produced it is guesswork
//, and identical data also hides any bug that only shows up when two filings
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

// 100 original, 25 negatives added after the August 2026 run, then 75 more.
if (scenarios.length !== 200) {
  console.error(`Expected 200 scenarios, built ${scenarios.length}. Fix the file before running.`);
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
