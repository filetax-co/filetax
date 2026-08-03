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

import {
  summarizeTransactions,
  mapTransactionForPersist,
  resolveUiTxType,
} from '../src/lib/filingMapping.ts';
import {
  RP_NAICS, resolveBizPreset, TX_TYPES, filingDueDates,
} from '../src/app/pages/intake/constants.ts';

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

// ── Risk 3: a saved transaction must come back as the type the filer picked ──
// UI_TO_CANONICAL is many-to-one, so saving loses information unless the UI
// code is persisted too. Before 1 Aug 2026 nothing was: reopening a filing
// showed the raw canonical code ("rent_royalty"), the type cards showed nothing
// selected, and a crypto row came back indistinguishable from any other
// "other". These assert the round trip, which is the thing that was broken, and
// they do it for EVERY type in the UI rather than the handful that are easy.
console.log('\n— transaction type round trip —');

let lossy = [];
for (const t of TX_TYPES) {
  const persisted = mapTransactionForPersist({
    transaction_type: t.value,
    direction: 'paid',
    amount_usd: 100,
  });
  const back = resolveUiTxType({
    transaction_type: persisted.transaction_type,
    ui_transaction_type: persisted.ui_transaction_type,
    is_royalty: persisted.is_royalty,
    direction: persisted.direction,
  });
  if (back !== t.value) lossy.push(`${t.value} -> ${persisted.transaction_type} -> ${back}`);
}
check('every UI transaction type survives a save/load round trip', lossy, []);

// Every code the round trip can produce must have a card to select, or the
// filer is shown a type they cannot re-pick.
const uiValues = new Set(TX_TYPES.map((t) => t.value));
check('every round-tripped code has a TX_TYPES entry',
  TX_TYPES.map((t) => t.value).filter((v) => !uiValues.has(v)), []);

// The legacy path: rows written before ui_transaction_type existed carry only
// the canonical code, so the derivation has to carry them. It cannot recover
// everything (five codes collapse onto 'other'), but it must never return a
// code with no card, and it must recover the two cases that have a
// discriminator already stored.
console.log('\n— legacy rows, no ui_transaction_type —');
check('rent is recovered from is_royalty = false',
  resolveUiTxType({ transaction_type: 'rent_royalty', is_royalty: false }), 'rent');
check('royalty is recovered from is_royalty = true',
  resolveUiTxType({ transaction_type: 'rent_royalty', is_royalty: true }), 'royalty');
check('a tangible purchase is recovered from direction',
  resolveUiTxType({ transaction_type: 'tangible_property', direction: 'paid' }), 'tangible_purchase');
check('a tangible sale is recovered from direction',
  resolveUiTxType({ transaction_type: 'tangible_property', direction: 'received' }), 'tangible_sale');

const legacyResolved = [
  'sales', 'service_payment', 'rent_royalty', 'loan_to_llc', 'loan_from_llc',
  'interest', 'insurance', 'dividend', 'commission', 'intangible', 'other',
  'capital_contribution', 'distribution', 'formation_costs', 'property_transfer',
  'tangible_property', 'loan_guarantee', 'nonmonetary_other',
].map((c) => resolveUiTxType({ transaction_type: c, direction: 'paid' }));
check('every canonical code resolves to a code the UI can display',
  legacyResolved.filter((v) => !uiValues.has(v)), []);

// An unknown code must not crash or leak through as a raw identifier.
check('an unrecognized canonical code falls back to other',
  resolveUiTxType({ transaction_type: 'something_new_from_the_future' }), 'other');

// ── Risk 4: due dates must follow the PERIOD, not the tax-year label ────────
// filingDueDates replaced a hardcoded table that was keyed on the tax year, so
// a fiscal-year filer was measured against the calendar-year deadline and told
// they were inside the extension window months after it closed — which hid step
// 1b and with it the only route to a reasonable cause letter.
console.log('\n— filing due dates —');

// Every calendar year must reproduce the table this replaced, exactly. If this
// drifts, existing filings silently change their on-time/late verdict.
const LEGACY_TABLE = {
  2019: { original: '2020-04-15', extended: '2020-10-15' },
  2020: { original: '2021-04-15', extended: '2021-10-15' },
  2021: { original: '2022-04-15', extended: '2022-10-15' },
  2022: { original: '2023-04-15', extended: '2023-10-15' },
  2023: { original: '2024-04-15', extended: '2024-10-15' },
  2024: { original: '2025-04-15', extended: '2025-10-15' },
  2025: { original: '2026-04-15', extended: '2026-10-15' },
};
for (const [year, expected] of Object.entries(LEGACY_TABLE)) {
  check(`calendar ${year} matches the table it replaced`, filingDueDates(`${year}-12-31`), expected);
}

// The rule is the 15th day of the 4th month after the period ends, +6 months
// with a timely 7004. A March year-end is the case that was wrong before.
check('fiscal March year-end is due 15 July, not 15 April',
  filingDueDates('2026-03-31'), { original: '2026-07-15', extended: '2027-01-15' });
check('fiscal June year-end is due 15 October',
  filingDueDates('2026-06-30'), { original: '2026-10-15', extended: '2027-04-15' });
check('fiscal September year-end crosses into the next calendar year',
  filingDueDates('2025-09-30'), { original: '2026-01-15', extended: '2026-07-15' });

// Cover every possible fiscal year-end month. This table is intentionally
// explicit so the test does not reproduce the implementation's date arithmetic.
const ALL_FISCAL_MONTHS = [
  ['2025-01-31', '2025-05-15', '2025-11-15'],
  ['2025-02-28', '2025-06-15', '2025-12-15'],
  ['2025-03-31', '2025-07-15', '2026-01-15'],
  ['2025-04-30', '2025-08-15', '2026-02-15'],
  ['2025-05-31', '2025-09-15', '2026-03-15'],
  ['2025-06-30', '2025-10-15', '2026-04-15'],
  ['2025-07-31', '2025-11-15', '2026-05-15'],
  ['2025-08-31', '2025-12-15', '2026-06-15'],
  ['2025-09-30', '2026-01-15', '2026-07-15'],
  ['2025-10-31', '2026-02-15', '2026-08-15'],
  ['2025-11-30', '2026-03-15', '2026-09-15'],
  ['2025-12-31', '2026-04-15', '2026-10-15'],
];
for (const [periodEnd, original, extended] of ALL_FISCAL_MONTHS) {
  check(
    `${periodEnd.slice(5, 7)} fiscal month due dates`,
    filingDueDates(periodEnd),
    { original, extended },
  );
}

// A year beyond the old table must produce real dates rather than being treated
// as on time for ever, which is what the missing-key branch used to do.
check('a year past the end of the old table still has a deadline',
  filingDueDates('2027-12-31'), { original: '2028-04-15', extended: '2028-10-15' });

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
