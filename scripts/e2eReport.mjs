/**
 * e2eReport.mjs - turns a browser run log into the results workbook.
 *
 *   node scripts/e2eReport.mjs [runDir]
 *
 * Input  runDir/results.json   one record per scenario, appended as the run goes
 *        runDir/pdfs/*.pdf     the bytes the browser actually handed over
 *        testing/__scenarios100.json
 *
 * Output runDir/results.xlsx   four sheets: Summary, Results, Field check, PDFs
 *
 * The workbook is written by scripts/e2eReport.py (openpyxl); this file marshals
 * the data and shells out, so the JSON stays the single source of truth and the
 * spreadsheet can be regenerated at any point mid-run.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runDir = process.argv[2] ?? path.resolve(here, '../testing/run-2026-08-01');
const scenariosPath = path.resolve(here, '../testing/__scenarios100.json');

const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8')).scenarios;
const byId = Object.fromEntries(scenarios.map((s) => [s.scenario_id, s]));

// The driver mirrors its results through the PDF receiver, which writes them
// alongside the PDFs. Promote that file to the run directory so the workbook
// can be rebuilt at any point without touching the browser.
const dropped = path.join(runDir, 'pdfs', 'run__results.json');
if (existsSync(dropped)) {
  writeFileSync(path.join(runDir, 'results.json'), readFileSync(dropped));
}

const resultsPath = path.join(runDir, 'results.json');
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : [];

// ── PDFs on disk, grouped by the scenario tag the receiver wrote into the name
const pdfDir = path.join(runDir, 'pdfs');
const pdfs = existsSync(pdfDir)
  ? readdirSync(pdfDir).map((f) => {
      const [tag, ...rest] = f.split('__');
      return { file: f, scenario_id: Number(tag), name: rest.join('__'), bytes: statSync(path.join(pdfDir, f)).size };
    })
  : [];
const pdfsById = pdfs.reduce((m, p) => ((m[p.scenario_id] ??= []).push(p), m), {});

/** Flattens what the scenario asked for, so it can sit next to what came back. */
function entered(s) {
  const f = s.filing ?? s.shared_filing_fields ?? {};
  const o = s.owner ?? s.shared_owner_fields ?? {};
  const years = s.year_specific_filings
    ? s.year_specific_filings.map((y) => y.tax_year).join(', ')
    : String(f.tax_year ?? '');
  const txns = s.transactions ?? (s.year_specific_filings ?? []).flatMap((y) => y.transactions ?? []);
  return {
    llc_name: f.llc_name ?? '',
    ein: f.ein ?? '',
    state: f.state_of_formation ?? '',
    years,
    total_assets: f.total_assets ?? '',
    owner_name: o.owner_full_name ?? '',
    owner_country: o.owner_primary_country ?? '',
    signer_title: o.signer_title ?? '',
    rcl: (f.include_reasonable_cause ?? s.include_rcl) ? 'yes' : 'no',
    rcl_reasons: (f.reasonable_cause_reasons ?? s.reasonable_cause_reasons ?? []).join('; '),
    final_return: f.final_return ? 'yes' : 'no',
    parties: (s.related_parties ?? []).length,
    txn_count: txns.length,
    txn_types: [...new Set(txns.map((t) => t.transaction_type))].join('; '),
    txn_total: txns.reduce((n, t) => n + (Number(t.amount_usd) || 0), 0),
  };
}

const rows = scenarios.map((s) => {
  // A scenario can be run more than once - a bad-data scenario re-run after the
  // data was corrected, say. The LAST attempt is the current verdict; earlier
  // ones stay in results.json as evidence and are counted here, so a result that
  // only passed on a retry cannot look like a clean first pass.
  const attempts = results.filter((x) => x.scenario_id === s.scenario_id);
  const r = attempts[attempts.length - 1] ?? {};
  const e = entered(s);
  const files = pdfsById[s.scenario_id] ?? [];
  const negative = Boolean(s.expected_result);

  // A negative passes when it was rejected. A positive passes when it produced
  // a PDF and nothing in the field check came back mismatched.
  let outcome = r.outcome ?? 'not run';
  if (!r.outcome) outcome = 'not run';
  else if (negative) outcome = r.rejected ? 'PASS (rejected as expected)' : 'FAIL (was accepted)';

  return {
    scenario_id: s.scenario_id,
    title: s.title,
    branch: s.tests,
    kind: s.multi_year ? 'multi-year' : negative ? 'negative' : 'single-year',
    signature_mode: s.signature_mode,
    expected: s.expected_result ?? 'Completes and downloads a PDF',
    outcome,
    stage_reached: r.stage ?? '',
    error_text: (r.errors ?? []).join(' | ') || r.error || '',
    console_errors: (r.consoleErrors ?? []).join(' | '),
    filing_id: r.filingId ?? '',
    pdf_count: files.length,
    pdf_files: files.map((f) => f.name).join('; '),
    pdf_bytes: files.reduce((n, f) => n + f.bytes, 0),
    attempts: attempts.length,
    earlier_attempt: attempts.length > 1
      ? attempts.slice(0, -1).map((a) => `${a.outcome ?? '?'} (${a.stage ?? ''})`).join('; ')
      : '',
    signature_checked: r.signatureChecked ? 'yes' : 'no',
    signature_note: r.signatureNote ?? '',
    field_mismatches: (r.mismatches ?? []).length,
    notes: r.notes ?? '',
    ...Object.fromEntries(Object.entries(e).map(([k, v]) => [`in_${k}`, v])),
  };
});

// ── the full input record ─────────────────────────────────────────────────
// Every value the scenario carries, one row per field, flattened with its path
// intact. The Results sheet summarises the inputs; this is the record you can
// hold a generated PDF against and check line by line, including the fields no
// summary column would ever have room for.
const SECTION = {
  filing: 'Filing', shared_filing_fields: 'Filing (shared)',
  owner: 'Owner', shared_owner_fields: 'Owner (shared)',
  related_parties: 'Related parties', transactions: 'Transactions',
  year_specific_filings: 'Year-specific',
};

function flatten(value, prefix, into) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.length === 0) { into.push([prefix, '(none)']); return; }
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, into));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, into);
    return;
  }
  into.push([prefix, typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)]);
}

const inputRows = [];
for (const s of scenarios) {
  const skip = new Set(['scenario_id', 'title', 'tests', 'signature_mode', 'expected_result', 'multi_year']);
  // The scenario's own metadata first, so each block reads as a filing rather
  // than as a bag of fields.
  inputRows.push([s.scenario_id, s.title, 'Scenario', 'signature_mode', s.signature_mode]);
  inputRows.push([s.scenario_id, s.title, 'Scenario', 'branch under test', s.tests ?? '']);
  if (s.expected_result) inputRows.push([s.scenario_id, s.title, 'Scenario', 'expected_result', s.expected_result]);
  for (const [key, value] of Object.entries(s)) {
    if (skip.has(key)) continue;
    const pairs = [];
    flatten(value, '', pairs);
    const section = SECTION[key] ?? 'Other';
    for (const [path, v] of pairs) {
      inputRows.push([s.scenario_id, s.title, section, path || key, v]);
    }
  }
}

// ── field check: entered vs what the save / PDF came back with
const fieldRows = [];
for (const r of results) {
  for (const m of r.mismatches ?? []) {
    fieldRows.push({
      scenario_id: r.scenario_id,
      title: byId[r.scenario_id]?.title ?? '',
      field: m.field,
      entered: m.entered,
      saved: m.saved,
      source: m.source ?? 'saved row',
      severity: m.severity ?? 'HIGH',
    });
  }
  for (const m of r.matches ?? []) {
    fieldRows.push({
      scenario_id: r.scenario_id,
      title: byId[r.scenario_id]?.title ?? '',
      field: m.field,
      entered: m.entered,
      saved: m.saved,
      source: m.source ?? 'saved row',
      severity: 'match',
    });
  }
}

const run = results.filter((r) => r.outcome);
const summary = [
  ['Scenarios defined', scenarios.length],
  ['Run so far', run.length],
  ['Not yet run', scenarios.length - run.length],
  ['Passed', rows.filter((r) => String(r.outcome).startsWith('PASS')).length],
  ['Failed', rows.filter((r) => String(r.outcome).startsWith('FAIL')).length],
  ['Blocked / errored', rows.filter((r) => String(r.outcome).startsWith('BLOCKED') || String(r.outcome).startsWith('ERROR')).length],
  ['Negative scenarios', scenarios.filter((s) => s.expected_result).length],
  ['Multi-year scenarios', scenarios.filter((s) => s.multi_year).length],
  ['Drawn-signature scenarios', scenarios.filter((s) => s.signature_mode === 'drawn').length],
  ['Typed-name scenarios', scenarios.filter((s) => s.signature_mode === 'typed').length],
  ['PDFs captured', pdfs.length],
  ['Input values recorded', inputRows.length],
  ['Field mismatches found', fieldRows.filter((f) => f.severity !== 'match').length],
];

mkdirSync(runDir, { recursive: true });
const payload = path.join(runDir, '.report-input.json');
writeFileSync(payload, JSON.stringify({
  out: path.join(runDir, 'results.xlsx'),
  summary,
  rows,
  fieldRows,
  inputRows,
  pdfs: pdfs.map((p) => ({ scenario_id: p.scenario_id, file: p.name, bytes: p.bytes })),
}, null, 2));

execFileSync('python', [path.resolve(here, 'e2eReport.py'), payload], { stdio: 'inherit' });
console.log(`Workbook: ${path.join(runDir, 'results.xlsx')}`);
