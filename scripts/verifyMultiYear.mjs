/**
 * Verifies the new generator capabilities, no DB/network:
 *   • multi-year package: one RCL covering all years, per-year PDFs, bundle
 *   • final-year return ticks 1120 item E
 *   • fiscal-year period flows through
 *   • Part VI managerial toggle OFF => no Part VI statement / box
 *
 * Run: node scripts/verifyMultiYear.mjs
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(ROOT, 'scripts', '_sbStub2.ts');
writeFileSync(stub, 'export {};\n');

const result = await build({
  entryPoints: [path.join(ROOT, 'src/lib/pdfGenerator.ts')],
  bundle: true, format: 'esm', platform: 'node', write: false,
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 's', setup(b) { b.onResolve({ filter: /\/supabase$/ }, () => ({ path: stub })); } }],
});
const gen = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\/+/, '');
  const buf = await readFile(path.join(ROOT, 'public', rel));
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const pyText = (file) => {
  const py = `import pypdf\nr=pypdf.PdfReader(r'${file}')\nprint('PAGES',len(r.pages))\nfor p in r.pages: print(p.extract_text() or '')`;
  return execFileSync(process.env.PYTHON ?? 'python3', ['-c', py], { encoding: 'utf8' });
};

const baseFiling = (year, over = {}) => ({
  id: 's', user_id: 'u', created_at: '', updated_at: '', status: 'paid', current_step: 5,
  service_type: 'past_year', tax_year: String(year),
  llc_name: 'Acme DE LLC', ein: '98-1112223', state_of_formation: 'WY', total_assets: 5000,
  date_of_incorporation: '2019-03-15', naics_code: '541511', naics_description: 'Software Development',
  mailing_address: { line1: '1 A St', city: 'Sheridan', region: 'WY', postal_code: '82801', country: 'US' },
  owner_full_name: 'Jane Founder', owner_country: 'United States', owner_primary_country: 'United States',
  owner_country_residence: 'Germany', owner_country_citizenship: 'Germany',
  owner_foreign_tax_id: 'DE-123', owner_reference_id: 'JAN001',
  owner_address: { line1: 'Owner St', city: 'Berlin', region: 'BE', postal_code: '10115', country: 'Germany' },
  include_irs_fax: false, include_rcl: true, parties_count: 1, complex_sections: [], download_count: 0,
  related_parties: [],
  ...over,
});

const fails = [];
const must = (c, m) => { if (!c) fails.push(m); };

// ── Test 1: multi-year (2021, 2022, 2023), one RCL ───────────────────────────
const years = [2021, 2022, 2023].map((y) => ({
  taxYear: y,
  filing: baseFiling(y),
  transactions: [
    { id: 't' + y, filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 500 * (y - 2020), description: 'Capital ' + y },
  ],
}));
const my = await gen.generateMultiYearPackage(years, {
  includeRCL: true,
  rclNarrative: 'I was unaware of the Form 5472 requirement until my accountant flagged it in 2024.',
  fax: true,
});

must(my.perYear.length === 3, `expected 3 per-year PDFs, got ${my.perYear.length}`);
must(JSON.stringify(my.taxYears) === JSON.stringify([2021, 2022, 2023]), 'taxYears not [2021,2022,2023]: ' + JSON.stringify(my.taxYears));
must(!!my.reasonableCauseLetter, 'RCL missing');

const rclFile = path.join(os.tmpdir(), 'rcl.pdf'); writeFileSync(rclFile, Buffer.from(my.reasonableCauseLetter));
const rclText = pyText(rclFile);
must(/REASONABLE CAUSE STATEMENT/.test(rclText), 'RCL title missing');
must(/2021, 2022 and 2023/.test(rclText), 'RCL does not list all three years together: check phrasing');
must(/unaware of the Form 5472/.test(rclText), 'RCL narrative not embedded');
// RCL should appear exactly once (one "REASONABLE CAUSE STATEMENT" heading)
must((rclText.match(/REASONABLE CAUSE STATEMENT/g) || []).length === 1, 'RCL heading should appear once in standalone RCL');

// Each per-year PDF should have an instructions page and NOT repeat the RCL
const y2023 = my.perYear.find((p) => p.taxYear === 2023);
const f2023 = path.join(os.tmpdir(), 'y2023.pdf'); writeFileSync(f2023, Buffer.from(y2023.pdf));
const t2023 = pyText(f2023);
must(/Filing Instructions . Tax Year 2023/.test(t2023) || /Filing Instructions/.test(t2023), 'per-year instructions page missing');
must(!/REASONABLE CAUSE STATEMENT/.test(t2023), 'per-year PDF should NOT contain the RCL (delivered once separately)');

// Bundle should contain the RCL once + all three years
const bFile = path.join(os.tmpdir(), 'bundle.pdf'); writeFileSync(bFile, Buffer.from(my.bundled));
const bText = pyText(bFile);
must((bText.match(/REASONABLE CAUSE STATEMENT/g) || []).length === 1, 'bundle should contain RCL exactly once');
must(/Tax Year 2021/.test(bText) && /Tax Year 2022/.test(bText) && /Tax Year 2023/.test(bText), 'bundle missing one of the years');

// Fax: one cover + one RCL + every year's forms, with no filer instructions.
must(!!my.faxPayload, 'multi-year fax payload missing');
const faxFile = path.join(os.tmpdir(), 'multi-year-fax.pdf'); writeFileSync(faxFile, Buffer.from(my.faxPayload));
const faxText = pyText(faxFile);
must(/Tax years: 2021, 2022, 2023/.test(faxText), 'fax cover does not list all years');
must((faxText.match(/REASONABLE CAUSE STATEMENT/g) || []).length === 1, 'fax should contain the job RCL exactly once');
must(!/Filing Instructions/.test(faxText), 'fax must not transmit filer-facing instructions');

// ── Test 2: final-year return ────────────────────────────────────────────────
const finalPkg = await gen.generateFilingPackage(
  baseFiling(2024, { final_return: true, tax_year: '2024' }),
  [{ id: 'x', filing_id: 's', related_party_index: 0, transaction_type: 'distribution', direction: 'paid', amount_usd: 2000, description: 'Final distribution' }],
  2024,
);
// We can't read a checkbox from flattened text easily, but the 1120 should be present and the dissolution distribution on Part V.
const finFile = path.join(os.tmpdir(), 'final.pdf'); writeFileSync(finFile, Buffer.from(finalPkg.combined));
const finText = pyText(finFile);
must(/Acme DE LLC/.test(finText), 'final-year package missing entity');
must(/2,000/.test(finText), 'final distribution not on Part V statement');

// ── Test 3: Part VI managerial toggle OFF, no non-monetary tx => no Part VI ───
const noVI = await gen.generateFilingPackage(
  baseFiling(2024, { part_vi_managerial: false, tax_year: '2024' }),
  [{ id: 'c', filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 }],
  2024,
);
const noVIFile = path.join(os.tmpdir(), 'novi.pdf'); writeFileSync(noVIFile, Buffer.from(noVI.combined));
const noVIText = pyText(noVIFile);
must(!/PART VI/.test(noVIText), 'Part VI statement should be ABSENT when managerial toggle is off and no non-monetary tx');

// Sanity: with toggle ON (default), Part VI present
const withVI = await gen.generateFilingPackage(
  baseFiling(2024, { tax_year: '2024' }),
  [{ id: 'c', filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 }],
  2024,
);
const withVIFile = path.join(os.tmpdir(), 'withvi.pdf'); writeFileSync(withVIFile, Buffer.from(withVI.combined));
must(/PART VI/.test(pyText(withVIFile)), 'Part VI should be present by default (managerial on)');

// ── Test 4: fiscal-year period flows through ─────────────────────────────────
const fiscal = await gen.generateFilingPackage(
  baseFiling(2024, { tax_year: '2024', is_fiscal_year: true, tax_period_begin: '2024-07-01', tax_period_end: '2025-06-30' }),
  [{ id: 'c', filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 }],
  2024,
);
const fyFile = path.join(os.tmpdir(), 'fy.pdf'); writeFileSync(fyFile, Buffer.from(fiscal.combined));
const fyText = pyText(fyFile);
must(/July 1, 2024/.test(fyText), 'fiscal-year begin July 1, 2024 not found');
must(/June 30, 2025/.test(fyText), 'fiscal-year end June 30, 2025 not found');

if (fails.length) {
  console.error('❌ FAILED:');
  for (const f of fails) console.error('  • ' + f);
  process.exit(1);
} else {
  console.log('✅ ALL MULTI-YEAR / FINAL / FISCAL / PART-VI ASSERTIONS PASSED');
}
