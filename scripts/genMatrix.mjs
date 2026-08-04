/**
 * genMatrix - build a large combinatorial scenario file in the same shape as
 * filetax_test_scenarios_all100.json, so genAll100 + auditAll100 can run over
 * it unchanged.
 *
 *   node scripts/genMatrix.mjs [count] [outFile]
 *
 * The 100 hand-written scenarios cover the product's intended paths. This
 * covers the cross-product those 100 can only sample: every tax year against
 * every fiscal end month, every transaction type in both directions, against
 * owner and related parties, under every name/character set the form might be
 * asked to print.
 *
 * Deterministic: the same count always produces the same file, so a finding is
 * reproducible by scenario id.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const count = Number(process.argv[2] ?? 1000);
const outFile = process.argv[3] ?? path.resolve(here, '../../../Testing/filetax_matrix.json');
/**
 * `--latin1` restricts names to characters the current WinAnsi font can encode.
 * The generator throws on anything outside it, so without this switch roughly
 * two thirds of the matrix dies at the same single defect and the other
 * dimensions (years, periods, transaction types, party counts) go untested.
 */
const latin1Only = process.argv.includes('--latin1');

// Deterministic PRNG (mulberry32) - reproducible findings matter more here
// than statistical purity.
let seed = 0x5472c0de;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const money = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) / 100) * 100;

const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const FISCAL_END_MONTHS = [3, 6, 9, 12];

/**
 * Every UI transaction type the intake offers.
 *
 * `cost_sharing` and `platform_contribution` were removed on 5 August 2026,
 * because they force Form 5472 Part VII question 39 to Yes and require a Part
 * VIII this product does not produce. `inventory_purchase` was added the same
 * day: it is what makes line 23 reachable.
 */
const TX_TYPES = [
  'inventory_purchase', 'sales', 'tangible_purchase', 'tangible_sale',
  'service_payment', 'tech_services',
  'commission', 'rent', 'royalty', 'interest', 'loan_to_llc', 'loan_from_llc',
  'intangible', 'insurance',
  'loan_guarantee_fee', 'other', 'capital_contribution', 'distribution', 'dividend',
  'formation_costs', 'formation_tx', 'dissolution_tx', 'acquisition_tx',
  'disposition_tx', 'other_part_v', 'nonmonetary_transfer', 'less_than_fmv',
  'property_transfer_fmv', 'other_part_vi',
];

const RCL_REASONS = ['first_time_filing', 'not_informed', 'no_tax_liability', 'minimal_activity',
  'language_barrier', 'discovered_late', 'voluntary_filing', 'new_procedures'];

/**
 * Name sets. A US tax form is printed with WinAnsi fonts, so anything outside
 * Latin-1 is exactly where a generator is most likely to fail - these are the
 * cases worth hammering, not more ASCII.
 */
const NAME_SETS = {
  ascii:     ['James Carter', 'Maria Santos', 'Wei Ling Tan', 'John Smith'],
  accented:  ['José Álvarez-Núñez', 'François Lefèvre', 'Zoë Ødegård', 'Þórunn Guðmundsdóttir'],
  apostrophe:['Seán O’Brien', "D'Angelo D'Souza", 'Anne-Marie Saint-Jacques'],
  cyrillic:  ['Владимир Петров', 'Оксана Ковальчук'],
  cjk:       ['山田 太郎', '李伟明', '김민준'],
  arabic:    ['محمد بن سلمان', 'فاطمة الزهراء'],
  devanagari:['राजेश कुमार शर्मा'],
  long:      ['Bartholomew Fitzwilliam Montgomery-Ashcroft III',
              'Maximiliaan Johannes van der Bergh-Oosterhuis'],
};
const COMPANY_SETS = {
  ascii:    ['Bluewave Digital LLC', 'Northgate Consulting LLC', 'Redwood Systems LLC'],
  accented: ['Café Société Holdings LLC', 'Ñandú Ventures LLC'],
  long:     ['International Advanced Manufacturing And Distribution Holdings Company LLC'],
  punct:    ['O’Malley & Sons, LLC', 'Smith-Jones (Delaware) LLC'],
};

const LATIN1_SETS = ['ascii', 'accented', 'apostrophe', 'long'];
if (latin1Only) {
  for (const k of Object.keys(NAME_SETS)) if (!LATIN1_SETS.includes(k)) delete NAME_SETS[k];
}

const COUNTRIES = ['India', 'Singapore', 'United Kingdom', 'Brazil', 'Germany', 'Hong Kong',
  'Monaco', 'Qatar', 'Japan', 'Nigeria', 'United Arab Emirates', 'Canada'];
const STATES = ['WY', 'DE', 'FL', 'TX', 'CA', 'NY'];

const ein = (n) => `${String(10 + (n % 89)).padStart(2, '0')}-${String(1000000 + (n * 7919) % 8999999).padStart(7, '0')}`;
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const addressFor = (country) => country === 'US'
  ? { line1: '30 N Gould St Ste R', city: 'Sheridan', region: 'WY', postal_code: '82801', country: 'US' }
  : { line1: '12 Marina Boulevard', city: 'Central', region: '', postal_code: '018989', country };

const scenarios = [];
for (let i = 1; i <= count; i++) {
  const year = pick(YEARS);
  const isFiscal = chance(0.3);
  const fiscalEnd = isFiscal ? pick(FISCAL_END_MONTHS) : null;
  const nameSet = pick(Object.keys(NAME_SETS));
  const coSet = pick(Object.keys(COMPANY_SETS));
  const ownerName = pick(NAME_SETS[nameSet]);
  const llcName = pick(COMPANY_SETS[coSet]);
  const country = pick(COUNTRIES);
  const nParties = pick([0, 0, 0, 1, 1, 2, 3, 5]);
  const extension = chance(0.25);
  // An RCL and a timely extension are mutually exclusive by design.
  const wantRCL = !extension && chance(0.3);
  const initial = chance(0.12);
  const final = !initial && chance(0.12);

  const related_parties = Array.from({ length: nParties }, (_, k) => {
    const rpName = pick(NAME_SETS[pick(Object.keys(NAME_SETS))]);
    const rpCountry = pick(COUNTRIES);
    return {
      name: rpName,
      ref_number: `RP${String(i % 1000).padStart(3, '0')}${k}`,
      country: rpCountry,
      country_residence: rpCountry,
      country_citizenship: rpCountry,
      us_tin: chance(0.2) ? `9${String(80000000 + i).slice(0, 8)}` : '',
      foreign_tax_id: chance(0.7) ? `FTIN${i}${k}` : '',
      address: addressFor(rpCountry),
      biz_activity: pick(['Software Development', 'Consulting', 'Trading', 'Logistics']),
      biz_code: pick(['541511', '541611', '423990', '484121']),
    };
  });

  const nTx = pick([0, 1, 1, 2, 2, 3, 4]);
  const transactions = Array.from({ length: nTx }, () => {
    const type = pick(TX_TYPES);
    const isLoan = type === 'loan_to_llc' || type === 'loan_from_llc';
    return {
      related_party_index: nParties ? Math.floor(rnd() * (nParties + 1)) : 0,
      transaction_type: type,
      direction: type === 'loan_to_llc' ? 'received' : type === 'loan_from_llc' ? 'paid' : pick(['paid', 'received']),
      amount_usd: String(money(100, 2500000)),
      loan_begin_usd: isLoan && chance(0.6) ? String(money(0, 500000)) : '',
      description: pick([
        'Routine intercompany settlement',
        'Payment under the master services agreement - schedule 2',
        'Transfer of équipement at book value',
        '',
      ]),
      transaction_date: iso(year, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)),
    };
  });

  const incYear = initial ? year : year - 1 - Math.floor(rnd() * 4);
  scenarios.push({
    scenario_id: i,
    title: `matrix ${i}: ${year}${isFiscal ? ` FY end ${fiscalEnd}` : ''} · ${nameSet} owner · ${nParties} RP · ${nTx} tx`,
    tests: `charset=${nameSet}/${coSet} ext=${extension} rcl=${wantRCL} initial=${initial} final=${final}`,
    filing: {
      llc_name: llcName,
      ein: ein(i),
      state_of_formation: pick(STATES),
      tax_year: String(year),
      total_assets: money(0, 5000000),
      date_of_incorporation: iso(incYear, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)),
      entity_principal_country: country,
      mailing_address: addressFor('US'),
      naics_code: pick(['541511', '513210', '541611', '423990']),
      naics_description: pick(['Software Development', 'SaaS / Software Publisher', 'Consulting']),
      final_return: final,
      initial_return: initial,
      is_fiscal_year: isFiscal,
      ...(isFiscal ? { fiscal_end_month: fiscalEnd } : {}),
      extension_filed: extension,
      include_reasonable_cause: wantRCL,
      reasonable_cause_reasons: wantRCL
        ? RCL_REASONS.filter(() => chance(0.4)).slice(0, 8)
        : [],
    },
    owner: {
      owner_full_name: ownerName,
      owner_primary_country: country,
      owner_country_residence: country,
      owner_country_citizenship: country,
      owner_us_tin: chance(0.15) ? `9${String(70000000 + i).slice(0, 8)}` : '',
      owner_foreign_tax_id: chance(0.85) ? `OFT${i}` : '',
      owner_reference_id: `OWN${String(i).padStart(4, '0')}`,
      owner_business_activity: pick(['Software Developer / Programmer', 'Consultant', 'Trader']),
      owner_naics_code: pick(['541511', '541611', '423990']),
      owner_address: addressFor(country),
      signer_title: pick(['Managing Member', 'Member', 'Sole Owner']),
      signature_date: iso(year + 1, 7, 15),
    },
    related_parties,
    transactions,
    no_transactions_confirmed: nTx === 0,
    part_vi_managerial: chance(0.7),
  });
}

// At least one RCL reason when an RCL was requested, or the letter has nothing
// to say - that is a scenario-construction detail, not a product behaviour.
for (const s of scenarios) {
  if (s.filing.include_reasonable_cause && s.filing.reasonable_cause_reasons.length === 0) {
    s.filing.reasonable_cause_reasons = ['first_time_filing'];
  }
}

await writeFile(outFile, JSON.stringify({
  meta: { generated: 'genMatrix.mjs', count, seed: '0x5472c0de' },
  scenarios,
}, null, 1));
console.log(`wrote ${count} scenarios → ${outFile}`);
