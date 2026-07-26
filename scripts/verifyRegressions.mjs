/**
 * verifyRegressions — targeted checks for the two data risks introduced when
 * formation costs were added to the gross-payments set and the owner /
 * related-party business dropdowns were re-keyed from `biz_code` to
 * `biz_activity`.
 *
 * Runs against the built bundle-free source via Node's TypeScript stripping:
 *   node scripts/verifyRegressions.mjs
 *
 * Unlike the other verify*.mjs scripts these need no Supabase credentials and
 * they ASSERT — a failure exits non-zero.
 */

import { summarizeTransactions } from '../src/lib/filingMapping.ts';
import { RP_NAICS, resolveBizPreset } from '../src/app/pages/intake/constants.ts';

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
};

// ── Risk 2: formation costs must reach the gross-payments figure ────────────
// pdfGenerator's grossPaymentsForLines1f1h sums Part IV + Part V + formation
// costs + Part VI. The wizard's summary must agree or the user is shown a
// number the generated form contradicts.
console.log('\n— gross payments —');

const onlyFormation = summarizeTransactions([
  { transaction_type: 'formation_costs', amount_usd: 1500 },
]);
check('formation_costs counts toward formGross', onlyFormation.formGross, 1500);
check('formation_costs lands in the Money in bucket', onlyFormation.bucketIn.total, 1500);

const mixed = summarizeTransactions([
  { transaction_type: 'capital_contribution', amount_usd: 25000 },
  { transaction_type: 'formation_costs',      amount_usd: 2500 },
  { transaction_type: 'service_payment',      amount_usd: 15000 },
]);
check('mixed: totalEntered', mixed.totalEntered, 42500);
check('mixed: formGross now equals totalEntered', mixed.formGross, 42500);

const partVI = summarizeTransactions([
  { transaction_type: 'nonmonetary_transfer', amount_usd: 9000 },
]);
check('Part VI amount counts toward formGross', partVI.formGross, 9000);

// Amounts that are genuinely excluded should stay excluded.
const zeroish = summarizeTransactions([
  { transaction_type: 'capital_contribution', amount_usd: null },
  { transaction_type: 'distribution',         amount_usd: '0' },
]);
check('null / zero amounts contribute nothing', zeroish.formGross, 0);

// ── Risk 1: legacy business-activity records must still resolve ─────────────
// The dropdowns now key on the activity LABEL. A row written before that (or
// seeded from `owner_naics_code`) can carry the code with a blank activity.
console.log('\n— business activity resolution —');

const naive = (activity) => RP_NAICS.some((n) => n.label === activity);

const preset = RP_NAICS[0];
check('label-matched row resolves (naive)', naive(preset.label), true);
check('legacy code-only row FAILS under naive matching', naive(''), false);

// The real helper the UI now uses.
check('resilient: label-matched row resolves',
  resolveBizPreset(preset.label, preset.code)?.code, preset.code);
check('resilient: legacy code-only row resolves',
  resolveBizPreset('', preset.code)?.code, preset.code);
check('resilient: genuinely custom activity stays custom',
  resolveBizPreset('Camel husbandry', '112990'), undefined);
check('resilient: the "Other" sentinel (a single space) stays custom',
  resolveBizPreset(' ', ''), undefined);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
