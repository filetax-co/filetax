/**
 * mergeScenarios — combine the three scenario files into one set of 100.
 *
 *   node scripts/mergeScenarios.mjs <in1> <in2> <in3> <out>
 *
 * Defaults to the Testing folder alongside the repo:
 *
 *   node scripts/mergeScenarios.mjs
 *
 * Checks as it goes: ids must be 1..100 with no gaps and no duplicates, and no
 * two scenarios may share an EIN unless they deliberately test that (99 does).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TESTING = path.resolve(process.cwd(), '../../Testing');
const [a, b, c, out] = [
  process.argv[2] ?? path.join(TESTING, 'filetax_test_scenarios.json'),
  process.argv[3] ?? path.join(TESTING, 'filetax_test_scenarios_v2.json'),
  process.argv[4] ?? path.join(TESTING, 'filetax_test_scenarios_v3.json'),
  process.argv[5] ?? path.join(TESTING, 'filetax_test_scenarios_all100.json'),
];

const load = (f) => {
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  return doc.scenarios ?? doc;
};

const scenarios = [...load(a), ...load(b), ...load(c)].sort(
  (x, y) => x.scenario_id - y.scenario_id,
);

// ── integrity ───────────────────────────────────────────────────────────────
const problems = [];
scenarios.forEach((s, i) => {
  if (s.scenario_id !== i + 1) problems.push(`id ${s.scenario_id} is at position ${i + 1}`);
  if (!s.title) problems.push(`scenario ${s.scenario_id} has no title`);
});
if (scenarios.length !== 100) problems.push(`expected 100 scenarios, got ${scenarios.length}`);

const einOf = (s) => s.filing?.ein ?? s.shared_filing_fields?.ein;
const byEin = new Map();
for (const s of scenarios) {
  const ein = einOf(s);
  if (!ein) continue;
  byEin.set(ein, [...(byEin.get(ein) ?? []), s.scenario_id]);
}
const dupEins = [...byEin].filter(([, ids]) => ids.length > 1);

if (problems.length) {
  console.error('INTEGRITY PROBLEMS:');
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

const doc = {
  meta: {
    generated_for: 'filetax.co — the complete 100-scenario end-to-end set',
    generated_on: new Date().toISOString().slice(0, 10),
    count: scenarios.length,
    sources: [path.basename(a), path.basename(b), path.basename(c)],
    how_to_run: [
      'Per scenario, through the real form: paste one scenario object into the DEV scenario loader on the intake page (see PHASE_TEST_PLAN.md), then click through the wizard yourself.',
      'In bulk, straight into the database: npm run seed -- --file <this file> --user-id <uuid> --only 42',
    ],
    negative_tests:
      'A scenario carrying `expected_result` must be REJECTED. It passes when the error appears and nothing is saved.',
    manual_steps:
      'A scenario carrying `manual_step` needs the action described there — seeded data alone cannot prove it.',
    note_on_dates:
      'Due-date logic is computed live from today vs FILING_DUE_DATES. As of 2026-07-26 every tax year is past its ORIGINAL deadline; 2025 is the only year still inside its EXTENDED window (to 2026-10-15).',
  },
  scenarios,
};

writeFileSync(out, JSON.stringify(doc, null, 2));

console.log(`wrote ${out}`);
console.log(`scenarios: ${scenarios.length} (ids 1-${scenarios[scenarios.length - 1].scenario_id})`);
console.log(`negative tests: ${scenarios.filter((s) => s.expected_result).length}`);
console.log(`manual-step scenarios: ${scenarios.filter((s) => s.manual_step).length}`);
console.log(`multi-year jobs: ${scenarios.filter((s) => s.year_specific_filings).length}`);
if (dupEins.length) {
  console.log('shared EINs (expected only where a scenario tests duplicates):');
  for (const [ein, ids] of dupEins) console.log(`  ${ein} → scenarios ${ids.join(', ')}`);
}
