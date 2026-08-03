/**
 * genScenarios3 — build scenarios 82..100, completing the set of 100.
 *
 *   node scripts/genScenarios3.mjs [outfile]
 *
 * Scenarios 1-30 and 31-81 between them already cover every transaction type,
 * every form template year, every NAICS-resolution path, loans in every
 * permutation, and multi-year jobs. What they barely touch is the part of the
 * product that is supposed to STOP you, and the state a filing lands in after
 * money changes hands. That is what this file adds:
 *
 *   • 82-89 — negative tests. Only 8 and 27 existed; these cover blank Step 1,
 *     a negative asset figure, a transaction date outside the tax year, a loan
 *     with no closing balance, an unacknowledged category-3 type, colliding
 *     hand-typed reference codes, an impossible signature date, and a
 *     whitespace-only owner name.
 *   • 90-97 — edges the happy paths skip: deleting a related party that
 *     transactions point at, a dormant zero-asset year, a December fiscal
 *     year-end (equals the calendar year), the RCL at both extremes (all eight
 *     reasons and exactly one), a corporate owner carrying a US EIN, very long
 *     transaction descriptions, and the newest year filed late.
 *   • 98-100 — whole journeys: a 3-year job that ends in dissolution, the same
 *     EIN and year filed twice, and a completed filing reopened for download.
 *
 * A scenario carrying `expected_result` is one the product should REJECT.
 * Passing it means the error appeared and nothing was saved — not that the
 * filing completed.
 *
 * Field names are the CANONICAL columns, matching the first two files.
 */
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'filetax_test_scenarios_v3.json';

// ── reusable fragments (same shapes as genScenarios.mjs) ────────────────────
const usAddr = (line1, city, region, postal_code) => ({
  line1, city, region, postal_code, country: 'US',
});
const wyoming = usAddr('30 N Gould St Ste R', 'Sheridan', 'WY', '82801');
const delaware = usAddr('1013 Centre Rd Ste 403-B', 'Wilmington', 'DE', '19805');

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
  signature_date: o.signed ?? '2026-07-26',
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
  S.push({ scenario_id: 81 + S.length + 1, title, tests, ...body });

// A generic passing owner, for scenarios whose interest is elsewhere.
const stdOwner = (over = {}) => owner({
  name: 'Rohit Sharma', country: 'India', ref: 'ROH001', ftin: 'AAAPS1234K',
  address: foreignAddr('9 Linking Rd', 'Mumbai', '400050', 'India', 'Maharashtra'),
  ...over,
});

// ── 82-89 · negative tests: the product must refuse these ───────────────────

add('NEGATIVE: Step 1 submitted completely blank',
  'validateStep1() must list EVERY missing required field at once, not just the first; nothing is written to filings',
  {
    filing: {
      llc_name: '', ein: '', state_of_formation: '', tax_year: '2024',
      total_assets: '', date_of_incorporation: '', entity_principal_country: '',
      mailing_address: { line1: '', city: '', region: '', postal_code: '', country: 'US' },
      naics_code: '', naics_description: '',
      final_return: false, is_fiscal_year: false,
      extension_filed: false, include_reasonable_cause: false, reasonable_cause_reasons: [],
    },
    owner: stdOwner(),
    related_parties: [],
    transactions: [],
    no_transactions_confirmed: true,
    part_vi_managerial: true,
    expected_result: 'VALIDATION SHOULD FAIL — error summary lists LLC name, EIN, state, assets, incorporation date, country and address; the page must scroll to the summary and no draft row may be created.',
  });

add('NEGATIVE: total assets is a negative number',
  'Total assets must reject a negative figure rather than printing a minus sign onto 1120 Schedule L / line 1a',
  {
    filing: filing({ name: 'Negative Assets LLC', ein: '81-3000001', year: '2024', doi: '2021-06-15', assets: -5000 }),
    owner: stdOwner(),
    related_parties: [],
    transactions: [tx('capital_contribution', 'received', 1000, { date: '2024-03-01' })],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    expected_result: 'VALIDATION SHOULD FAIL on Step 1. If it is instead accepted, check what the PDF prints — a negative total-assets figure is not a valid return.',
  });

add('NEGATIVE: transaction dated outside the tax year',
  'A 2024 filing carrying a 2026-dated transaction must be caught at Step 4, not silently printed',
  {
    filing: filing({ name: 'Timewarp Trading LLC', ein: '81-3000002', year: '2024', doi: '2020-01-10' }),
    owner: stdOwner(),
    related_parties: [rp('Dubai Logistics FZE', 'DUB002', 'United Arab Emirates')],
    transactions: [
      tx('service_payment', 'paid', 9000, { party: 1, date: '2026-04-01', desc: 'Dated two years after the tax year' }),
      tx('capital_contribution', 'received', 3000, { date: '2023-12-31', desc: 'Dated before the tax year' }),
    ],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    expected_result: 'VALIDATION SHOULD FAIL — or, at minimum, both rows must be flagged. Record which of the two the product catches; a date outside the period is the single most common data error in a catch-up filing.',
  });

add('NEGATIVE: loan row saved with no closing balance',
  'LOAN_TYPES require the closing balance (amount_usd); a beginning balance alone must not save',
  {
    filing: filing({ name: 'Halfloan Holdings LLC', ein: '81-3000003', year: '2024', doi: '2019-09-09' }),
    owner: stdOwner(),
    related_parties: [],
    transactions: [tx('loan_to_llc', 'received', '', { begin: 40000, date: '2024-12-31', desc: 'Closing balance deliberately blank' })],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    expected_result: 'VALIDATION SHOULD FAIL — "Add transaction" must refuse the row. Line 17b/31b carries the ending balance, so a blank one would print an empty loan.',
  });

add('NEGATIVE: category-3 transaction added without acknowledgment',
  'cat3Acknowledged gate — the intangible row must not be addable while the red category banner is unacknowledged (positive path is scenario 19)',
  {
    filing: filing({ name: 'Unacked IP LLC', ein: '81-3000004', year: '2024', doi: '2022-02-02', code: '533110', activity: 'Licensor of Intellectual Property' }),
    owner: stdOwner(),
    related_parties: [rp('Zurich IP Partners AG', 'ZUR002', 'Switzerland')],
    transactions: [tx('intangible', 'paid', 55000, { party: 1, date: '2024-08-08', desc: 'Patent licence — acknowledgment intentionally skipped' })],
    no_transactions_confirmed: false,
    cat3_acknowledged: false,
    part_vi_managerial: true,
    expected_result: 'The Add-transaction button must stay DISABLED until the acknowledgment is ticked. Tick it afterwards and confirm the same row then saves.',
  });

add('NEGATIVE: two related parties given the same reference code by hand',
  'Reference codes must be unique per filing — the auto-suggestion can be overtyped, so the collision has to be caught on save (contrast scenario 68, where the product assigns them)',
  {
    filing: filing({ name: 'Codeclash Ventures LLC', ein: '81-3000005', year: '2024', doi: '2020-11-11' }),
    owner: owner({ name: 'Maria Silva', country: 'Portugal', ref: 'MAR001', ftin: 'PT-123456789', address: foreignAddr('Rua Augusta 100', 'Lisboa', '1100-053', 'Portugal') }),
    related_parties: [
      rp('Martins Consulting Lda', 'MAR001', 'Portugal'),
      rp('Marques Trading Lda', 'MAR001', 'Portugal'),
    ],
    transactions: [
      tx('service_payment', 'paid', 4000, { party: 1, date: '2024-05-01' }),
      tx('commission', 'paid', 2500, { party: 2, date: '2024-06-01' }),
    ],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    expected_result: 'VALIDATION SHOULD FAIL — three parties share MAR001, including the owner. Each Form 5472 is identified by that code, so duplicates make the package ambiguous.',
  });

add('NEGATIVE: signature date before the end of the tax year',
  'A return cannot be signed before the period it reports on has closed; the date also prints on the 1120 signature line',
  {
    filing: filing({ name: 'Presigned Papers LLC', ein: '81-3000006', year: '2024', doi: '2021-01-05' }),
    owner: stdOwner({ signed: '2024-02-01' }),
    related_parties: [],
    transactions: [tx('distribution', 'paid', 6000, { date: '2024-09-09' })],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    expected_result: 'Signature date 2024-02-01 sits inside the 2024 tax year. Expect a validation error; if none appears, note it — the printed return would be signed before year-end.',
  });

add('NEGATIVE: owner name is whitespace only, owner country left unselected',
  'Trim before the required check — a name of spaces must not pass as present, and the country select must be genuinely required',
  {
    filing: filing({ name: 'Blankowner Corp LLC', ein: '81-3000007', year: '2024', doi: '2022-07-07' }),
    owner: {
      owner_full_name: '   ',
      owner_primary_country: '',
      owner_country_residence: '',
      owner_country_citizenship: '',
      owner_us_tin: '',
      owner_foreign_tax_id: '',
      owner_reference_id: '',
      owner_business_activity: '',
      owner_naics_code: '',
      owner_address: { line1: '', city: '', region: '', postal_code: '', country: '' },
      signer_title: 'Managing Member',
      signature_date: '',
    },
    related_parties: [],
    transactions: [],
    no_transactions_confirmed: true,
    part_vi_managerial: true,
    expected_result: 'VALIDATION SHOULD FAIL on Step 2 — Part II of the 5472 would otherwise print a blank owner.',
  });

// ── 90-97 · edges the happy paths skip ──────────────────────────────────────

add('Delete a related party that transactions already point at',
  'related_party_index must be re-mapped (or the orphaned rows removed) when a middle party is deleted — the danger is index 2 silently becoming someone else',
  {
    filing: filing({ name: 'Reindex Partners LLC', ein: '82-4000001', year: '2024', doi: '2019-04-04' }),
    owner: stdOwner(),
    related_parties: [
      rp('Alpha Services Ltd', 'ALP002', 'United Kingdom', { address: foreignAddr('10 Downing Rd', 'London', 'SW1A 2AA', 'United Kingdom') }),
      rp('Beta Trading GmbH', 'BET003', 'Germany', { address: foreignAddr('Hauptstrasse 5', 'Berlin', '10115', 'Germany') }),
      rp('Gamma Holdings Pte Ltd', 'GAM004', 'Singapore', { address: foreignAddr('1 Raffles Pl', 'Singapore', '048616', 'Singapore') }),
    ],
    transactions: [
      tx('service_payment', 'paid', 5000, { party: 1, date: '2024-03-03', desc: 'Alpha' }),
      tx('rent', 'paid', 12000, { party: 2, date: '2024-04-04', desc: 'Beta' }),
      tx('commission', 'paid', 3000, { party: 3, date: '2024-05-05', desc: 'Gamma' }),
    ],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    manual_step: 'Enter all three parties and all three transactions, then DELETE "Beta Trading GmbH" from Step 3. The rent row must either disappear or move with Beta — the commission row must still read Gamma, never Beta. Then check the generated package has two related-party 5472s and line 1g reads 3.',
  });

add('Dormant year: zero total assets, no transactions, no managerial disclosure',
  'A genuinely dormant LLC still owes the return — 0 must print as 0, not blank, and not be treated as a missing field',
  {
    filing: filing({ name: 'Dormant Shell LLC', ein: '82-4000002', year: '2023', doi: '2020-08-08', assets: 0, rcl: true, rclReasons: ['minimal_activity', 'no_tax_liability'] }),
    owner: stdOwner(),
    related_parties: [],
    transactions: [],
    no_transactions_confirmed: true,
    part_vi_managerial: false,
    note: 'Watch that a 0 in total assets is not rejected as empty — a falsy-check bug shows up here and nowhere else.',
  });

add('Fiscal year ending December — identical to the calendar year',
  'deriveFiscalPeriod with end month 12 must produce 01-01 to 12-31 and must not shift the period back a year',
  {
    filing: filing({ name: 'Decemberend Labs LLC', ein: '82-4000003', year: '2024', doi: '2021-03-15', fiscal: true, fiscalEndMonth: 12 }),
    owner: stdOwner(),
    related_parties: [],
    transactions: [tx('service_payment', 'received', 30000, { date: '2024-11-30', desc: 'Consulting income' })],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    note: 'Compare the printed period against any calendar-year scenario (e.g. 9). They must match exactly.',
  });

add('Reasonable-cause letter with ALL eight reasons selected',
  'The RCL must render every selected reason without running off the page or truncating the last paragraph',
  {
    filing: filing({
      name: 'Everyreason Holdings LLC', ein: '82-4000004', year: '2021', doi: '2019-02-02',
      rcl: true,
      rclReasons: ['first_time_filing', 'not_informed', 'no_tax_liability', 'minimal_activity', 'language_barrier', 'discovered_late', 'voluntary_filing', 'new_procedures'],
    }),
    owner: owner({ name: 'Nguyen Van Minh', country: 'Vietnam', ref: 'NGU001', ftin: 'VN-8899001', address: foreignAddr('12 Le Loi', 'Ho Chi Minh City', '700000', 'Vietnam') }),
    related_parties: [],
    transactions: [tx('capital_contribution', 'received', 2000, { date: '2021-05-05' })],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    note: 'Check page breaks in the RCL PDF, and that the $200 RCL line appears once in pricing, not once per reason.',
  });

add('Reasonable-cause letter with exactly one reason',
  'The opposite extreme — single-reason wording must read as a sentence, not as a one-item list with dangling punctuation',
  {
    filing: filing({ name: 'Onereason Ventures LLC', ein: '82-4000005', year: '2022', doi: '2021-12-01', rcl: true, rclReasons: ['first_time_filing'] }),
    owner: stdOwner(),
    related_parties: [],
    transactions: [tx('formation_costs', 'received', 750, { date: '2022-01-15', desc: 'Registered agent and state fee' })],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
  });

add('Owner is a foreign CORPORATION holding a US EIN',
  'The 25% owner need not be an individual — Part II must take a company name plus a US EIN in the US-TIN field (contrast scenario 12, an individual with an ITIN)',
  {
    filing: filing({ name: 'Subsidiary One LLC', ein: '82-4000006', year: '2024', doi: '2022-05-20', state: 'DE', address: delaware, country: 'Japan' }),
    owner: owner({
      name: 'Sakura Holdings Kabushiki Kaisha',
      country: 'Japan',
      ref: 'SAK001',
      usTin: '98-7654321',
      ftin: 'JP-CORP-4455',
      activity: 'Holding Company',
      code: '551112',
      address: foreignAddr('1-1 Marunouchi, Chiyoda-ku', 'Tokyo', '100-0005', 'Japan'),
      title: 'Representative Director',
    }),
    related_parties: [],
    transactions: [
      tx('capital_contribution', 'received', 250000, { date: '2024-01-31', desc: 'Parent funding' }),
      tx('service_payment', 'paid', 48000, { date: '2024-12-15', desc: 'Group management services' }),
    ],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    note: 'A company name is longer than a person name — check it does not clip in Part II, and that the signature block accepts "Representative Director".',
  });

add('FIELD OVERFLOW: very long transaction descriptions',
  'Scenario 79 stresses names and addresses; this stresses the description column in the wizard list, the review table and the Part IV/V statements',
  {
    filing: filing({ name: 'Verbose Descriptions LLC', ein: '82-4000007', year: '2024', doi: '2020-10-10' }),
    owner: stdOwner(),
    related_parties: [rp('Global Supply Chain Solutions International Limited', 'GLO002', 'Hong Kong', { address: foreignAddr('Unit 2201, 22/F, Tower B, Manulife Financial Centre, 223 Wai Yip Street', 'Kwun Tong, Kowloon', '', 'Hong Kong') })],
    transactions: [
      tx('service_payment', 'paid', 18000, { party: 1, date: '2024-02-14', desc: 'Monthly retainer for engineering, quality assurance, release management, localisation into eleven languages, and 24x7 on-call support for the customer-facing platform, per the master services agreement dated 1 January 2024 and its first amendment' }),
      tx('other', 'received', 4200, { date: '2024-07-01', desc: 'Reimbursement of travel, accommodation, visa and per-diem costs incurred while attending trade shows in Hannover, Shenzhen and Las Vegas on behalf of the LLC' }),
    ],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
  });

add('Newest tax year, filed late with no extension',
  'Scenario 1 covers 2025 still inside its extended window; this is 2025 with extension_filed = false, so the ORIGINAL deadline has passed and the RCL section must appear',
  {
    filing: filing({ name: 'Latest Year Late LLC', ein: '82-4000008', year: '2025', doi: '2023-06-30', ext: false, rcl: true, rclReasons: ['not_informed', 'discovered_late'] }),
    owner: stdOwner(),
    related_parties: [],
    transactions: [tx('distribution', 'paid', 9000, { date: '2025-12-20' })],
    no_transactions_confirmed: false,
    part_vi_managerial: true,
    note: 'Run this back-to-back with scenario 1 (same year, extension_filed = true). The only difference in the UI should be the RCL block appearing here and not there.',
  });

// ── 98-100 · whole journeys ─────────────────────────────────────────────────

S.push({
  scenario_id: 98,
  title: 'Multi-year job of 3 ending in dissolution',
  tests: 'A job whose LAST year is a final return: the final-return box belongs to 2024 only, and the dissolution transaction must not leak into the earlier years',
  job_id: 'TEST-JOB-0004',
  include_rcl: true,
  reasonable_cause_reasons: ['first_time_filing', 'discovered_late'],
  shared_filing_fields: {
    llc_name: 'Windup Ventures LLC', ein: '83-5000001', state_of_formation: 'WY',
    date_of_incorporation: '2021-09-01', entity_principal_country: 'Philippines',
    mailing_address: wyoming, naics_code: '541511', naics_description: 'Software Development',
  },
  shared_owner_fields: owner({
    name: 'Jose Antonio Cruz', country: 'Philippines', ref: 'JOS001', ftin: 'PH-556677',
    address: foreignAddr('88 Ayala Ave', 'Makati City', '1226', 'Philippines'),
  }),
  year_specific_filings: [
    { tax_year: '2022', total_assets: 14000, transactions: [tx('capital_contribution', 'received', 14000, { date: '2022-01-10' })] },
    { tax_year: '2023', total_assets: 9000, transactions: [tx('service_payment', 'received', 22000, { date: '2023-06-06' }), tx('distribution', 'paid', 27000, { date: '2023-12-01' })] },
    { tax_year: '2024', total_assets: 0, final_return: true, transactions: [tx('dissolution_tx', 'paid', 9000, { date: '2024-04-30', desc: 'Final wind-up distribution' })] },
  ],
  note: 'Check the 2022 and 2023 1120s do NOT have the final-return box ticked, and that the year tab strip still lets you move back to 2022 after finishing 2024.',
});

S.push({
  scenario_id: 99,
  title: 'Same EIN and tax year filed twice',
  tests: 'Duplicate detection — starting a second 2024 filing for an EIN that already has one must warn, or at least not corrupt the first',
  filing: filing({ name: 'Double Filed LLC', ein: '83-5000002', year: '2024', doi: '2021-02-18' }),
  owner: stdOwner(),
  related_parties: [],
  transactions: [tx('capital_contribution', 'received', 5000, { date: '2024-03-01' })],
  no_transactions_confirmed: false,
  part_vi_managerial: true,
  manual_step: 'Complete this filing end to end. Then start a NEW filing from the dashboard with the SAME EIN and the SAME tax year 2024, and change the total assets. Expected: a duplicate warning, or two clearly separate filings on the dashboard — what must NOT happen is the second overwriting the first, or the dashboard showing one row whose figures came from both.',
  expected_result: 'Record the actual behaviour. This is the one scenario in the set whose correct outcome is a product decision rather than a known rule.',
});

S.push({
  scenario_id: 100,
  title: 'Completed filing reopened: locked identity, package re-download',
  tests: 'End of the journey — a completed filing must route to generate/preview/download, keep identity fields locked, and re-download the same package without regenerating different numbers',
  filing: filing({
    name: 'Finished Business LLC', ein: '83-5000003', year: '2024', doi: '2020-03-03',
    assets: 88000, code: '541512', activity: 'IT Consulting',
    rcl: true, rclReasons: ['first_time_filing'],
  }),
  owner: owner({
    name: 'Elena Petrova', country: 'Bulgaria', ref: 'ELE001', ftin: 'BG-9900112',
    address: foreignAddr('15 Vitosha Blvd', 'Sofia', '1000', 'Bulgaria'),
  }),
  related_parties: [rp('Sofia Dev Studio EOOD', 'SOF002', 'Bulgaria', { address: foreignAddr('4 Alabin St', 'Sofia', '1000', 'Bulgaria') })],
  transactions: [
    tx('capital_contribution', 'received', 40000, { date: '2024-01-15' }),
    tx('service_payment', 'paid', 26000, { party: 1, date: '2024-08-08', desc: 'Outsourced development' }),
    tx('distribution', 'paid', 10000, { date: '2024-12-28' }),
  ],
  no_transactions_confirmed: false,
  part_vi_managerial: true,
  seed_status: 'completed',
  manual_step: 'Seed this one with --status completed. Open it: it must land on the download page, not step 1. Identity fields (LLC name, EIN, tax year, owner name, incorporation date) must be disabled. Download the package twice and diff the two PDFs — gross payments must be identical both times.',
});

// ── emit ────────────────────────────────────────────────────────────────────
const doc = {
  meta: {
    generated_for: 'filetax.co end-to-end testing — completes the set at 100',
    generated_on: '2026-07-26',
    scenario_id_range: `${S[0].scenario_id}-${S[S.length - 1].scenario_id}`,
    count: S.length,
    field_naming: 'Canonical column names, matching the first two files.',
    amount_fields_are_strings: 'amount_usd and loan_begin_usd are strings, as held in component state.',
    negative_tests:
      'A scenario with `expected_result` must be REJECTED by the product. It passes when the error appears and nothing is saved.',
    manual_steps:
      'A scenario with `manual_step` cannot be judged from the seeded data alone — the instruction there is the test.',
    coverage: [
      'blank Step 1, negative assets, out-of-period dates, incomplete loan rows',
      'the category-3 acknowledgment gate, colliding reference codes, impossible signature dates, whitespace-only names',
      'deleting a related party that transactions reference',
      'a dormant zero-asset year and a December fiscal year-end',
      'the reasonable-cause letter at both extremes: eight reasons and one',
      'a corporate owner with a US EIN, and long transaction descriptions',
      '2025 filed late without an extension (the mirror of scenario 1)',
      'a 3-year job ending in dissolution, a duplicate EIN/year filing, and a completed filing reopened for download',
    ],
  },
  scenarios: S,
};

writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`wrote ${out}`);
console.log(`scenarios: ${S.length} (ids ${S[0].scenario_id}-${S[S.length - 1].scenario_id})`);
console.log(`negative tests: ${S.filter((s) => s.expected_result).length}`);
console.log(`manual-step scenarios: ${S.filter((s) => s.manual_step).length}`);
