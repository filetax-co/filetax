/**
 * genScenarios - build scenarios 31..80, complementing the original 30.
 *
 *   node scripts/genScenarios.mjs [outfile]
 *
 * Coverage targeted here is what the first 30 do NOT reach:
 *   • tax years 2019/2020/2021 (the 2019-2021 and 2022 form templates)
 *   • the 14 transaction types never exercised (dividend, insurance,
 *     loan_guarantee_fee, sales, cost_sharing, platform_contribution,
 *     acquisition/disposition/other_part_v, less_than_fmv,
 *     property_transfer_fmv, other_part_vi, other, tech_services)
 *   • fiscal year-ends other than June, and fiscal x initial/final return
 *   • formation costs reconciling into 1f/1h (the bug fixed 2026-07-26)
 *   • manual "Other" NAICS entry, and legacy rows carrying a code with a
 *     blank activity (the resolveBizPreset path)
 *   • non-US LLC mailing address, and countries with no state/region
 *   • the first-3-letters reference-code rule across many parties
 *   • field-overflow and character-set stress on the PDF
 *   • loan begin/end permutations (repayment, unchanged, both directions)
 *   • multi-year jobs of 2 and 5 years, with and without an RCL
 *
 * Field names are the CANONICAL columns (same convention as the original
 * file), and amounts are strings, matching component state.
 */
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'filetax_test_scenarios_v2.json';

// ── reusable fragments ──────────────────────────────────────────────────────
const usAddr = (line1, city, region, postal_code) => ({
  line1, city, region, postal_code, country: 'US',
});
const wyoming = usAddr('30 N Gould St Ste R', 'Sheridan', 'WY', '82801');
const delaware = usAddr('1013 Centre Rd Ste 403-B', 'Wilmington', 'DE', '19805');

/** Foreign address; region deliberately blank for countries that have none. */
const foreignAddr = (line1, city, postal_code, country, region = '') => ({
  line1, city, region, postal_code, country,
});

const owner = (o) => ({
  owner_full_name: o.name,
  owner_primary_country: o.country,
  owner_country_residence: o.residence ?? o.country,
  owner_country_citizenship: o.citizenship ?? o.country,
  owner_us_tin: o.usTin ?? '',
  owner_foreign_tax_id: o.ftin ?? 'NONE',
  owner_reference_id: o.ref,
  owner_business_activity: o.activity ?? 'Software Developer / Programmer',
  owner_naics_code: o.code ?? '541511',
  owner_address: o.address,
  signer_title: o.title ?? 'Managing Member',
  signature_date: o.signed ?? '2026-07-05',
});

const filing = (f) => ({
  llc_name: f.name,
  ein: f.ein,
  state_of_formation: f.state ?? 'WY',
  tax_year: f.year,
  total_assets: f.assets ?? 25000,
  date_of_incorporation: f.doi,
  entity_principal_country: f.country ?? 'India',
  mailing_address: f.address ?? wyoming,
  naics_code: f.code ?? '541511',
  naics_description: f.activity ?? 'Software Development',
  final_return: f.final ?? false,
  is_fiscal_year: f.fiscal ?? false,
  ...(f.fiscalEndMonth ? { fiscal_end_month: f.fiscalEndMonth } : {}),
  extension_filed: f.ext ?? false,
  include_reasonable_cause: f.rcl ?? false,
  reasonable_cause_reasons: f.rclReasons ?? [],
});

const tx = (type, dir, amt, opts = {}) => ({
  related_party_index: opts.party ?? 0,
  transaction_type: type,
  direction: dir,
  amount_usd: String(amt),
  loan_begin_usd: opts.begin != null ? String(opts.begin) : '',
  description: opts.desc ?? '',
  transaction_date: opts.date ?? '',
});

const rp = (n, ref, country, opts = {}) => ({
  name: n,
  ref_number: ref,
  country,
  country_residence: opts.residence ?? country,
  us_tin: opts.usTin ?? '',
  foreign_tax_id: opts.ftin ?? 'NONE',
  address: opts.address ?? foreignAddr('1 Example Rd', 'Cityville', '00000', country),
  biz_activity: opts.activity ?? 'IT Consultant',
  biz_code: opts.code ?? '541512',
});

const S = [];
const add = (title, tests, body) =>
  S.push({ scenario_id: 30 + S.length + 1, title, tests, ...body });

// ── 31-36 · older form templates (2019-2021 share one PDF; 2022 its own) ────
for (const [i, year] of ['2019', '2020', '2021', '2022'].entries()) {
  add(
    `Tax year ${year} - older Form 5472 template`,
    `get5472PdfUrl/get1120PdfUrl select the ${year} template; period defaults to the full calendar year`,
    {
      filing: filing({
        name: `Legacy Filings ${year} LLC`, ein: `4${i}-1000${i}00`, year,
        doi: '2018-05-04', assets: 12000 + i * 500,
        rcl: true, rclReasons: ['discovered_late', 'not_informed'],
      }),
      owner: owner({
        name: 'Ana Beatriz Souza', country: 'Brazil', ref: 'ANA001',
        ftin: 'BR-998877', address: foreignAddr('Av. Paulista 1000', 'Sao Paulo', '01310-100', 'Brazil', 'SP'),
      }),
      related_parties: [],
      transactions: [tx('capital_contribution', 'received', 5000, { date: `${year}-02-01`, desc: 'Owner capital' })],
      no_transactions_confirmed: false,
      part_vi_managerial: true,
    },
  );
}

add('Oldest year with a related party and Part IV activity',
  '2019 template renders Part IV lines and a second 5472 for the related party',
  {
    filing: filing({ name: 'Antique Holdings LLC', ein: '45-2019001', year: '2019', doi: '2016-01-20', rcl: true, rclReasons: ['first_time_filing'] }),
    owner: owner({ name: 'Chen Wei', country: 'China', ref: 'CHE001', ftin: 'CN-4410', address: foreignAddr('88 Nanjing Rd', 'Shanghai', '200001', 'China') }),
    related_parties: [rp('Shanghai Trading Co', 'SHA002', 'China')],
    transactions: [
      tx('service_payment', 'paid', 8000, { party: 1, date: '2019-06-30', desc: 'Consulting' }),
      tx('sales', 'received', 22000, { party: 1, date: '2019-09-15', desc: 'Goods sold to affiliate' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('2021 fiscal year ending March (period spans two calendar years)',
  'deriveFiscalPeriod: 2021-04-01 through 2022-03-31 on both 1120 and 5472',
  {
    filing: filing({ name: 'Marchpoint Systems LLC', ein: '46-2021003', year: '2021', doi: '2019-11-11', fiscal: true, fiscalEndMonth: 3, rcl: true, rclReasons: ['no_tax_liability'] }),
    owner: owner({ name: 'Yuki Tanaka', country: 'Japan', ref: 'YUK001', ftin: 'JP-2231', address: foreignAddr('2-1 Marunouchi', 'Tokyo', '100-0005', 'Japan') }),
    related_parties: [],
    transactions: [tx('distribution', 'paid', 9000, { date: '2021-12-20', desc: 'Owner draw' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

// ── 38-51 · the 14 transaction types never exercised ────────────────────────
const untested = [
  ['dividend', 'paid', 12000, 'Dividend to foreign owner - Part V'],
  ['insurance', 'paid', 3400, 'Insurance premium paid to related party - Part IV line 20/34'],
  ['loan_guarantee_fee', 'paid', 1500, 'Loan guarantee fee - Part IV'],
  ['sales', 'received', 65000, 'Sale of inventory - Part IV line 9'],
  ['inventory_purchase', 'paid', 47000, 'Purchase of inventory - Part IV line 23'],
  // Retired 5 Aug 2026, kept as legacy rows: both still have to generate.
  ['cost_sharing', 'paid', 18000, 'Cost-sharing payment, RETIRED type - maps to "other"'],
  ['platform_contribution', 'paid', 26000, 'Platform contribution, RETIRED type - maps to "other"'],
  ['acquisition_tx', 'received', 40000, 'Acquisition of an interest - maps to capital_contribution'],
  ['disposition_tx', 'paid', 31000, 'Disposition of an interest - maps to distribution'],
  ['other_part_v', 'received', 7000, 'Other Part V monetary event'],
  ['less_than_fmv', 'paid', 5000, 'Transfer at less than fair market value - Part VI'],
  ['property_transfer_fmv', 'paid', 15000, 'Property transfer at FMV - Part VI'],
  ['other_part_vi', 'paid', 2500, 'Other non-monetary arrangement - Part VI'],
  ['other', 'received', 4200, 'Other amount received - Part IV line 21'],
  ['tech_services', 'paid', 9800, 'Technical services - maps to service_payment'],
];
untested.forEach(([type, dir, amt, desc], i) => {
  add(`Transaction type coverage: ${type}`, desc, {
    filing: filing({ name: `TxType ${type} LLC`, ein: `47-30${String(i).padStart(4, '0')}`, year: '2024', doi: '2020-02-02', rcl: false }),
    owner: owner({ name: 'Diego Fernandez', country: 'Spain', ref: 'DIE001', ftin: 'ES-7788', address: foreignAddr('Calle Mayor 5', 'Madrid', '28013', 'Spain') }),
    related_parties: [],
    transactions: [tx(type, dir, amt, { date: '2024-05-05', desc })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });
});

// ── 52-56 · formation costs & gross-payments reconciliation ─────────────────
add('Formation costs ONLY - regression guard for the 1f/1h fix',
  'formation_costs must appear in Part V and in gross payments; wizard total must equal formGross',
  {
    filing: filing({ name: 'Formation Only LLC', ein: '48-5200001', year: '2025', doi: '2025-01-05', assets: 0 }),
    owner: owner({ name: 'Wei Ling Tan', country: 'Singapore', ref: 'WEI001', ftin: 'SG-S1234567D', address: foreignAddr('1 Marina Blvd', 'Singapore', '018989', 'Singapore') }),
    related_parties: [],
    transactions: [tx('formation_costs', 'paid', 1200, { date: '2025-01-06', desc: 'Registered agent + state fee paid by owner' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('The reported mismatch: contribution + formation costs + services',
  'Reproduces total 42,500 vs gross 30,000 - both figures must now read 42,500',
  {
    filing: filing({ name: 'Fresh Start Ventures LLC', ein: '48-5200002', year: '2025', doi: '2019-10-01', country: 'Brazil' }),
    owner: owner({ name: 'Wei Ling Tan', country: 'Singapore', ref: 'WEI001', ftin: 'SG-S1234567D', address: foreignAddr('1 Marina Blvd', 'Singapore', '018989', 'Singapore') }),
    related_parties: [],
    transactions: [
      tx('capital_contribution', 'received', 15000, { date: '2025-01-15', desc: 'Owner capital' }),
      tx('formation_costs', 'paid', 12500, { date: '2025-01-20', desc: 'Setup costs paid by owner' }),
      tx('service_payment', 'paid', 15000, { date: '2025-06-01', desc: 'Owner services' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Part VI amount rolls into gross payments',
  'property_transfer with a recorded amount must reach 1f/1h via part_vi_amount',
  {
    filing: filing({ name: 'Inkind Transfers LLC', ein: '48-5200003', year: '2024', doi: '2021-07-07' }),
    owner: owner({ name: 'Fatima Al Mansouri', country: 'United Arab Emirates', ref: 'FAT001', ftin: 'AE-5566', address: foreignAddr('Sheikh Zayed Rd', 'Dubai', '00000', 'United Arab Emirates') }),
    related_parties: [],
    transactions: [
      tx('nonmonetary_transfer', 'paid', 9000, { date: '2024-03-03', desc: 'Equipment contributed, consideration recorded' }),
      tx('capital_contribution', 'received', 1000, { date: '2024-01-02', desc: 'Seed capital' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Formation costs across two related parties',
  'formation_costs is a Part V (owner) concept - a non-owner party must not create a Part V statement',
  {
    filing: filing({ name: 'Split Setup LLC', ein: '48-5200004', year: '2024', doi: '2024-02-14' }),
    owner: owner({ name: 'Marco Rossi', country: 'Italy', ref: 'MAR001', ftin: 'IT-3344', address: foreignAddr('Via Roma 1', 'Milan', '20121', 'Italy', 'MI') }),
    related_parties: [rp('Rossi Holdings Srl', 'ROS002', 'Italy')],
    transactions: [
      tx('formation_costs', 'paid', 2000, { date: '2024-02-15', desc: 'Owner paid formation' }),
      tx('service_payment', 'paid', 4000, { party: 1, date: '2024-08-01', desc: 'Affiliate services' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Zero-dollar formation cost (a $1 contribution is still reportable)',
  'Small/zero amounts must not be dropped from Part V or the summary',
  {
    filing: filing({ name: 'One Dollar LLC', ein: '48-5200005', year: '2025', doi: '2025-03-01', assets: 1 }),
    owner: owner({ name: 'Nguyen Van An', country: 'Vietnam', ref: 'NGU001', ftin: 'VN-1010', address: foreignAddr('12 Le Loi', 'Ho Chi Minh City', '700000', 'Vietnam') }),
    related_parties: [],
    transactions: [tx('capital_contribution', 'received', 1, { date: '2025-03-01', desc: 'Nominal capital' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

// ── 57-61 · business-activity resolution (resolveBizPreset) ─────────────────
add('Manual "Other" business activity on the LLC',
  'entityBizActivity is free text and entityBizCode typed by hand',
  {
    filing: filing({ name: 'Camel Husbandry LLC', ein: '49-5700001', year: '2024', doi: '2022-04-04', code: '112990', activity: 'Camel husbandry and export' }),
    owner: owner({ name: 'Omar Haddad', country: 'Jordan', ref: 'OMA001', ftin: 'JO-2020', address: foreignAddr('Rainbow St 4', 'Amman', '11118', 'Jordan') }),
    related_parties: [], transactions: [tx('distribution', 'paid', 3000, { date: '2024-11-11' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Manual "Other" business for the OWNER and a related party',
  'Owner and RP business activity/code entered by hand rather than picked',
  {
    filing: filing({ name: 'Bespoke Trades LLC', ein: '49-5700002', year: '2024', doi: '2021-09-09' }),
    owner: owner({ name: 'Ingrid Larsen', country: 'Norway', ref: 'ING001', ftin: 'NO-6060', activity: 'Artisanal cheese maker', code: '311513', address: foreignAddr('Karl Johans gate 1', 'Oslo', '0154', 'Norway') }),
    related_parties: [rp('Larsen Dairy AS', 'LAR002', 'Norway', { activity: 'Dairy wholesaler', code: '424430' })],
    transactions: [tx('tangible_purchase', 'received', 14000, { party: 1, date: '2024-04-04', desc: 'Inventory from affiliate' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('LEGACY ROW: owner business code present, activity blank',
  'resolveBizPreset must recover the preset from owner_naics_code - must NOT show "Other"',
  {
    filing: filing({ name: 'Legacy Activity LLC', ein: '49-5700003', year: '2023', doi: '2020-06-06' }),
    owner: { ...owner({ name: 'Priya Nair', country: 'India', ref: 'PRI001', ftin: 'IN-ABCDE1234F', address: foreignAddr('MG Road 22', 'Bengaluru', '560001', 'India', 'KA') }), owner_business_activity: '', owner_naics_code: '541511' },
    related_parties: [], transactions: [tx('service_payment', 'paid', 5000, { date: '2023-07-07' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('LEGACY ROW: related party code present, activity blank',
  'Same recovery on the related-party form',
  {
    filing: filing({ name: 'Legacy RP Activity LLC', ein: '49-5700004', year: '2023', doi: '2020-06-06' }),
    owner: owner({ name: 'Priya Nair', country: 'India', ref: 'PRI001', ftin: 'IN-ABCDE1234F', address: foreignAddr('MG Road 22', 'Bengaluru', '560001', 'India', 'KA') }),
    related_parties: [{ ...rp('Nair Systems Pvt Ltd', 'NAI002', 'India'), biz_activity: '', biz_code: '541512' }],
    transactions: [tx('commission', 'paid', 2200, { party: 1, date: '2023-08-08' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Unrecognised business code that matches no preset',
  'Falls through to free text without corrupting the code field',
  {
    filing: filing({ name: 'Unknown Code LLC', ein: '49-5700005', year: '2024', doi: '2022-12-01', code: '999999', activity: 'Unclassified' }),
    owner: owner({ name: 'Sofia Petrova', country: 'Bulgaria', ref: 'SOF001', ftin: 'BG-8080', activity: 'Unclassified trade', code: '999999', address: foreignAddr('Vitosha Blvd 2', 'Sofia', '1000', 'Bulgaria') }),
    related_parties: [], transactions: [tx('other', 'paid', 600, { date: '2024-02-02' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

// ── 62-66 · addresses & regions ─────────────────────────────────────────────
const noRegionCountries = [
  ['Hong Kong', 'Central', '999077', 'HON'],
  ['Monaco', 'Monte Carlo', '98000', 'MON'],
  ['Qatar', 'Doha', '00000', 'QAT'],
];
noRegionCountries.forEach(([country, city, zip, pfx], i) => {
  add(`Owner in ${country} - no state/region concept`,
    'State/region must be optional and must not block validation',
    {
      filing: filing({ name: `${country} Owner LLC`, ein: `50-62000${i}`, year: '2025', doi: '2023-03-03' }),
      owner: owner({ name: `Owner Of ${country}`, country, ref: `${pfx}001`, ftin: `${pfx}-1234`, address: foreignAddr('1 Harbour View', city, zip, country) }),
      related_parties: [], transactions: [tx('distribution', 'paid', 2000, { date: '2025-04-04' })],
      no_transactions_confirmed: false, part_vi_managerial: true,
    });
});

add('NON-US LLC mailing address (forceUS removed)',
  'The LLC mailing address may now be foreign with a blank region',
  {
    filing: filing({ name: 'Offshore Mail LLC', ein: '50-6200004', year: '2025', doi: '2022-08-08', address: foreignAddr('8 Raffles Place', 'Singapore', '048624', 'Singapore') }),
    owner: owner({ name: 'Wei Ling Tan', country: 'Singapore', ref: 'WEI001', ftin: 'SG-S1234567D', address: foreignAddr('1 Marina Blvd', 'Singapore', '018989', 'Singapore') }),
    related_parties: [], transactions: [tx('capital_contribution', 'received', 5000, { date: '2025-01-01' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Mailing state differs from state of formation',
  'buildCityStateZip must print the mailing state, not fall back to formation state',
  {
    filing: filing({ name: 'Crossstate Mail LLC', ein: '50-6200005', year: '2024', doi: '2021-01-01', state: 'DE', address: usAddr('500 7th Ave', 'New York', 'NY', '10018') }),
    owner: owner({ name: 'Lucas Meyer', country: 'Germany', ref: 'LUC001', ftin: 'DE-9090', address: foreignAddr('Unter den Linden 1', 'Berlin', '10117', 'Germany') }),
    related_parties: [], transactions: [tx('rent', 'paid', 24000, { date: '2024-12-31', desc: 'Office rent' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

// ── 67-70 · many parties, reference codes, 1g count ─────────────────────────
add('Five related parties - reference codes and the 1g form count',
  'Codes follow first-3-letters + 00n; one Form 5472 per party; 1g must read 6',
  {
    filing: filing({ name: 'Manyparties Group LLC', ein: '51-6700001', year: '2024', doi: '2019-01-01', assets: 500000 }),
    owner: owner({ name: 'Alexandre Dubois', country: 'France', ref: 'ALE001', ftin: 'FR-1122', address: foreignAddr('10 Rue de Rivoli', 'Paris', '75001', 'France') }),
    related_parties: [
      rp('Bertrand Logistics SA', 'BER002', 'France'),
      rp('Cardoso Imports Lda', 'CAR003', 'Portugal'),
      rp('Deniz Textiles AS', 'DEN004', 'Turkey'),
      rp('Eriksson Consulting AB', 'ERI005', 'Sweden'),
      rp('Fujimoto Trading KK', 'FUJ006', 'Japan'),
    ],
    transactions: [
      tx('service_payment', 'paid', 11000, { party: 1, date: '2024-02-01' }),
      tx('tangible_purchase', 'received', 23000, { party: 2, date: '2024-03-01' }),
      tx('royalty', 'paid', 8000, { party: 3, date: '2024-04-01' }),
      tx('interest', 'received', 1500, { party: 4, date: '2024-05-01' }),
      tx('commission', 'paid', 3000, { party: 5, date: '2024-06-01' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Related party with neither US TIN nor foreign TIN',
  'Both identifier fields blank must still render a valid 5472',
  {
    filing: filing({ name: 'Noid Party LLC', ein: '51-6700002', year: '2024', doi: '2022-02-02' }),
    owner: owner({ name: 'Hassan Karim', country: 'Egypt', ref: 'HAS001', ftin: 'EG-3131', address: foreignAddr('Tahrir Sq 1', 'Cairo', '11511', 'Egypt') }),
    related_parties: [rp('Unregistered Family Trust', 'UNR002', 'Egypt', { ftin: '', usTin: '' })],
    transactions: [tx('distribution', 'paid', 4000, { party: 1, date: '2024-09-09' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Two parties sharing the same first three letters',
  'Reference codes must stay unique: SMI002 and SMI003',
  {
    filing: filing({ name: 'Smith Collision LLC', ein: '51-6700003', year: '2024', doi: '2020-10-10' }),
    owner: owner({ name: 'Smithson Alpha', country: 'Ireland', ref: 'SMI001', ftin: 'IE-4141', address: foreignAddr('Grafton St 1', 'Dublin', 'D02', 'Ireland') }),
    related_parties: [rp('Smithson Beta Ltd', 'SMI002', 'Ireland'), rp('Smithson Gamma Ltd', 'SMI003', 'Ireland')],
    transactions: [
      tx('service_payment', 'paid', 1000, { party: 1, date: '2024-01-01' }),
      tx('service_payment', 'paid', 2000, { party: 2, date: '2024-01-02' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Multiple transactions of the SAME type to the SAME party',
  'Amounts must aggregate onto one Part IV line rather than overwrite',
  {
    filing: filing({ name: 'Repeat Lines LLC', ein: '51-6700004', year: '2024', doi: '2021-05-05' }),
    owner: owner({ name: 'Elena Ivanova', country: 'Kazakhstan', ref: 'ELE001', ftin: 'KZ-5151', address: foreignAddr('Dostyk Ave 1', 'Almaty', '050010', 'Kazakhstan') }),
    related_parties: [],
    transactions: [
      tx('service_payment', 'paid', 1000, { date: '2024-01-10' }),
      tx('service_payment', 'paid', 2000, { date: '2024-04-10' }),
      tx('service_payment', 'paid', 3500, { date: '2024-07-10' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

// ── 71-74 · loan permutations ───────────────────────────────────────────────
add('Loan repaid in full during the year (begin > end = 0)',
  'Line 17b/31b carries the ENDING balance; a repaid loan reports 0',
  {
    filing: filing({ name: 'Repaid Loan LLC', ein: '52-7100001', year: '2024', doi: '2021-01-01' }),
    owner: owner({ name: 'Tomas Novak', country: 'Czechia', ref: 'TOM001', ftin: 'CZ-6161', address: foreignAddr('Wenceslas Sq 1', 'Prague', '11000', 'Czechia') }),
    related_parties: [],
    transactions: [tx('loan_to_llc', 'received', 0, { begin: 50000, date: '2024-12-31', desc: 'Owner loan fully repaid' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Loan unchanged all year (begin = end)',
  'Beginning balance must not be double-counted in gross payments',
  {
    filing: filing({ name: 'Static Loan LLC', ein: '52-7100002', year: '2024', doi: '2020-01-01' }),
    owner: owner({ name: 'Aisha Bello', country: 'Nigeria', ref: 'AIS001', ftin: 'NG-7171', address: foreignAddr('Awolowo Rd 3', 'Lagos', '101233', 'Nigeria') }),
    related_parties: [],
    transactions: [tx('loan_to_llc', 'received', 30000, { begin: 30000, date: '2024-12-31', desc: 'Unchanged owner loan' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Loans in BOTH directions, each with a beginning balance',
  '17a/17b and 31a/31b populated simultaneously',
  {
    filing: filing({ name: 'Bothways Lending LLC', ein: '52-7100003', year: '2024', doi: '2019-06-06', assets: 90000 }),
    owner: owner({ name: 'Rafael Duarte', country: 'Portugal', ref: 'RAF001', ftin: 'PT-8181', address: foreignAddr('Rua Augusta 1', 'Lisbon', '1100-048', 'Portugal') }),
    related_parties: [],
    transactions: [
      tx('loan_to_llc', 'received', 45000, { begin: 20000, date: '2024-12-31', desc: 'Owner lent to LLC' }),
      tx('loan_from_llc', 'paid', 12000, { begin: 5000, date: '2024-12-31', desc: 'LLC lent to owner' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Loan plus the interest paid on it',
  'Loan balance and interest are separate Part IV lines',
  {
    filing: filing({ name: 'Interest Bearing LLC', ein: '52-7100004', year: '2024', doi: '2021-03-03' }),
    owner: owner({ name: 'Mateusz Kowalski', country: 'Poland', ref: 'MAT001', ftin: 'PL-9191', address: foreignAddr('Nowy Swiat 1', 'Warsaw', '00-029', 'Poland') }),
    related_parties: [],
    transactions: [
      tx('loan_to_llc', 'received', 100000, { begin: 100000, date: '2024-12-31' }),
      tx('interest', 'paid', 6500, { date: '2024-12-31', desc: 'Interest on owner loan' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

// ── 75-77 · rent vs royalty, and Part VI variants ───────────────────────────
add('Rent and royalty separated (distinct canonical codes)',
  'Rent must land on line 13a/27a and royalty on 13b/27b, from their own codes',
  {
    filing: filing({ name: 'Rentroyalty Split LLC', ein: '53-7500001', year: '2024', doi: '2020-04-04' }),
    owner: owner({ name: 'Isabella Conti', country: 'Italy', ref: 'ISA001', ftin: 'IT-1212', address: foreignAddr('Via Condotti 8', 'Rome', '00187', 'Italy', 'RM') }),
    related_parties: [],
    transactions: [
      tx('rent', 'paid', 18000, { date: '2024-06-30', desc: 'Warehouse rent' }),
      tx('royalty', 'paid', 7000, { date: '2024-06-30', desc: 'Trademark royalty' }),
    ],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Part VI managerial ON with no other transactions',
  'Part VI statement alone; no Part IV or Part V pages',
  {
    filing: filing({ name: 'Managerial Only LLC', ein: '53-7500002', year: '2025', doi: '2023-01-01', assets: 0 }),
    owner: owner({ name: 'Kwame Mensah', country: 'Ghana', ref: 'KWA001', ftin: 'GH-1313', address: foreignAddr('Oxford St 1', 'Accra', '00233', 'Ghana') }),
    related_parties: [], transactions: [],
    no_transactions_confirmed: true, part_vi_managerial: true,
  });

add('Absolute minimum: no transactions AND managerial disclosure off',
  'The leanest package the generator can emit - must still produce 1120 + 5472',
  {
    filing: filing({ name: 'Bare Minimum LLC', ein: '53-7500003', year: '2025', doi: '2023-01-01', assets: 0 }),
    owner: owner({ name: 'Leila Haddad', country: 'Morocco', ref: 'LEI001', ftin: 'MA-1414', address: foreignAddr('Blvd Mohammed V', 'Casablanca', '20000', 'Morocco') }),
    related_parties: [], transactions: [],
    no_transactions_confirmed: true, part_vi_managerial: false,
  });

// ── 78-80 · fiscal/initial/final combinations, stress, multi-year ───────────
add('Fiscal year AND initial return (short first period)',
  'Period begins at the incorporation date, not the fiscal start',
  {
    filing: filing({ name: 'Shortyear Fiscal LLC', ein: '54-7800001', year: '2024', doi: '2024-11-15', fiscal: true, fiscalEndMonth: 9 }),
    owner: owner({ name: 'Bilal Ahmed', country: 'Pakistan', ref: 'BIL001', ftin: 'PK-1515', address: foreignAddr('Mall Rd 9', 'Lahore', '54000', 'Pakistan') }),
    related_parties: [], transactions: [tx('formation_tx', 'received', 2500, { date: '2024-11-16', desc: 'Formation contribution' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('Fiscal year AND final return (dissolved mid fiscal period)',
  'Final-return box plus a fiscal period on the same 1120',
  {
    filing: filing({ name: 'Windingdown Fiscal LLC', ein: '54-7800002', year: '2023', doi: '2018-02-02', fiscal: true, fiscalEndMonth: 6, final: true, rcl: true, rclReasons: ['minimal_activity', 'no_tax_liability'] }),
    owner: owner({ name: 'Camille Laurent', country: 'Belgium', ref: 'CAM001', ftin: 'BE-1616', address: foreignAddr('Rue Neuve 1', 'Brussels', '1000', 'Belgium') }),
    related_parties: [],
    transactions: [tx('dissolution_tx', 'paid', 47000, { date: '2024-06-30', desc: 'Final wind-down distribution' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

add('FIELD OVERFLOW: long names, long address, accented and apostrophe characters',
  'Text must not clip or corrupt in AcroForm fields at 8pt',
  {
    filing: filing({
      name: "Внешнеэкономическая O'Brien-Müller International Holdings & Trading Company LLC",
      ein: '55-8000001', year: '2025', doi: '2020-01-01', assets: 123456789,
      activity: 'Wholesale distribution of specialised industrial machinery and related aftermarket components',
      address: usAddr('12345 Northwest Industrial Business Park Boulevard Suite 4000', 'Saint Petersburg', 'FL', '33716'),
    }),
    owner: owner({
      name: "María José O'Brien-Müller de la Fuente Rodríguez",
      country: 'Spain', ref: 'MAR001', ftin: 'ES-X1234567Z-EXTENDED-IDENTIFIER',
      activity: 'Specialised industrial machinery wholesale and aftermarket support services',
      address: foreignAddr("Calle de l'Almirall Cervera 128, Escalera B, Piso 4, Puerta 2", 'Valencia', '46011', 'Spain', 'Comunidad Valenciana'),
      title: 'Managing Member and Authorised Representative',
    }),
    related_parties: [rp("Société Générale d'Investissement Étranger SARL", 'SOC002', 'France')],
    transactions: [tx('sales', 'received', 9876543.21, { party: 1, date: '2025-12-31', desc: 'Bulk machinery sale with extended contractual terms and multi-year warranty provisions' })],
    no_transactions_confirmed: false, part_vi_managerial: true,
  });

// multi-year jobs
S.push({
  scenario_id: 30 + S.length + 1,
  title: 'Multi-year catch-up: 2 years, no reasonable-cause letter',
  tests: 'Shortest job. Chronological order 2023 then 2024; tax year locked once the job exists',
  job_id: 'TEST-JOB-0002',
  include_rcl: false,
  reasonable_cause_reasons: [],
  shared_filing_fields: { llc_name: 'Twoyear Catchup LLC', ein: '56-9000001', state_of_formation: 'WY', date_of_incorporation: '2022-01-01', entity_principal_country: 'India', mailing_address: wyoming, naics_code: '541511', naics_description: 'Software Development' },
  shared_owner_fields: owner({ name: 'Rohit Sharma', country: 'India', ref: 'ROH001', ftin: 'IN-ROHIT1234', address: foreignAddr('Linking Rd 5', 'Mumbai', '400050', 'India', 'MH') }),
  year_specific_filings: [
    { tax_year: '2023', total_assets: 10000, transactions: [tx('capital_contribution', 'received', 10000, { date: '2023-01-15' })] },
    { tax_year: '2024', total_assets: 18000, transactions: [tx('distribution', 'paid', 4000, { date: '2024-11-01' })] },
  ],
  note: 'One instructions page per year; no RCL anywhere in the bundle.',
});

S.push({
  scenario_id: 30 + S.length + 1,
  title: 'Multi-year catch-up: 5 years with a single shared reasonable-cause letter',
  tests: 'One RCL covers 2019-2023; reasons collected once at job setup, never repeated per year',
  job_id: 'TEST-JOB-0003',
  include_rcl: true,
  reasonable_cause_reasons: ['first_time_filing', 'not_informed', 'language_barrier', 'discovered_late'],
  shared_filing_fields: { llc_name: 'Fiveyear Catchup LLC', ein: '56-9000002', state_of_formation: 'NM', date_of_incorporation: '2018-03-03', entity_principal_country: 'Indonesia', mailing_address: usAddr('1209 Mountain Road Pl NE', 'Albuquerque', 'NM', '87110'), naics_code: '513210', naics_description: 'SaaS / Software Publisher' },
  shared_owner_fields: owner({ name: 'Siti Rahayu', country: 'Indonesia', ref: 'SIT001', ftin: 'ID-SITI9988', address: foreignAddr('Jl. Sudirman 1', 'Jakarta', '10220', 'Indonesia') }),
  year_specific_filings: [
    { tax_year: '2019', total_assets: 2000, transactions: [tx('formation_costs', 'paid', 800, { date: '2019-03-04' })] },
    { tax_year: '2020', total_assets: 5000, transactions: [] , no_transactions_confirmed: true },
    { tax_year: '2021', total_assets: 9000, transactions: [tx('service_payment', 'paid', 6000, { date: '2021-05-05' })] },
    { tax_year: '2022', total_assets: 15000, transactions: [tx('loan_to_llc', 'received', 12000, { begin: 0, date: '2022-12-31' })] },
    { tax_year: '2023', total_assets: 21000, transactions: [tx('distribution', 'paid', 7000, { date: '2023-10-10' }), tx('dividend', 'paid', 3000, { date: '2023-12-01' })] },
  ],
  note: 'RCL appears once at the front of the bundle, not per year. 2020 exercises a zero-transaction year inside a job.',
});

// ── emit ────────────────────────────────────────────────────────────────────
const doc = {
  meta: {
    generated_for: 'filetax.co end-to-end testing - supplements scenarios 1-30',
    generated_on: '2026-07-26',
    scenario_id_range: `${S[0].scenario_id}-${S[S.length - 1].scenario_id}`,
    count: S.length,
    field_naming: 'Canonical column names, matching the original file.',
    amount_fields_are_strings: 'amount_usd and loan_begin_usd are strings, as held in component state.',
    note_on_dates:
      'Due-date logic is computed live from today vs FILING_DUE_DATES. As of 2026-07-26 every year in TAX_YEARS is past its ORIGINAL deadline, so Step 1b always shows. 2025 is the only year still inside its EXTENDED window (to 2026-10-15).',
    note_on_negative_tests:
      'This set contains no deliberately invalid data - scenarios 8 and 27 in the original file already cover those. Everything here should complete successfully.',
    coverage: [
      'tax years 2019-2022 (older 5472/1120 templates)',
      'the 14 transaction types unused by scenarios 1-30',
      'formation costs reconciling into 1f/1h, and Part VI amounts in gross payments',
      'manual "Other" NAICS entry, and legacy rows with a code but no activity',
      'countries with no state/region, and a non-US LLC mailing address',
      'five related parties, colliding reference-code prefixes, repeated same-type lines',
      'loan permutations: repaid, unchanged, both directions, loan plus interest',
      'rent vs royalty split, Part VI only, and the minimum viable filing',
      'fiscal x initial return, fiscal x final return',
      'field overflow with accented and apostrophe characters',
      'multi-year jobs of 2 and 5 years, with and without a shared RCL',
    ],
  },
  scenarios: S,
};

writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`wrote ${out}`);
console.log(`scenarios: ${S.length} (ids ${S[0].scenario_id}-${S[S.length - 1].scenario_id})`);
const flat = S.filter((s) => s.transactions);
console.log(`transaction types covered: ${[...new Set(flat.flatMap((s) => s.transactions.map((t) => t.transaction_type)))].sort().join(', ')}`);
console.log(`tax years covered: ${[...new Set(S.filter((s) => s.filing).map((s) => s.filing.tax_year))].sort().join(', ')}`);
