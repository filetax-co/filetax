/**
 * End-to-end matrix test - runs the REAL generator over many realistic filings
 * and asserts the produced PDF text. No DB, no network (local PDF templates).
 *
 * Scenarios:
 *   A. Simple current-year, owner-only, one contribution
 *   B. No-TIN owner (FTIN = "None"), distribution + service payment
 *   C. Multi related party (owner + 2), mixed Part IV/V transactions
 *   D. Fiscal year (Jul–Jun), loan with begin+end balance
 *   E. Final return + dividend
 *   F. Part VI managerial toggle OFF, only a contribution → no Part VI
 *   G. Extension filed → Form 7004 in package
 *   H. No reportable transactions
 *   I. Royalty vs rent split (separate canonical codes)
 *
 * Run: node scripts/verifyE2E.mjs
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(ROOT, 'scripts', '_sbE2E.ts');
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

const text = (bytes, label) => {
  const f = path.join(os.tmpdir(), 'e2e-' + label + '.pdf');
  writeFileSync(f, Buffer.from(bytes));
  const py = `import pypdf\nr=pypdf.PdfReader(r'${f}')\nprint('\\n'.join((p.extract_text() or '') for p in r.pages))`;
  return execFileSync('python3', ['-c', py], { encoding: 'utf8' });
};

const base = (over = {}) => ({
  id: 's', user_id: 'u', created_at: '', updated_at: '', status: 'paid', current_step: 5,
  service_type: 'current_year', tax_year: '2024',
  llc_name: 'Acme LLC', ein: '12-3456789', state_of_formation: 'WY', total_assets: 5000,
  date_of_incorporation: '2020-05-01', naics_code: '541511', naics_description: 'Software Development',
  mailing_address: { line1: '1 Main St', city: 'Sheridan', region: 'WY', postal_code: '82801', country: 'US' },
  owner_full_name: 'Alex Doe', owner_country: 'United States', owner_primary_country: 'United States',
  owner_country_residence: 'Germany', owner_country_citizenship: 'Germany',
  owner_foreign_tax_id: 'DE12345', owner_reference_id: 'ALE001',
  owner_address: { line1: 'Owner St', city: 'Berlin', region: 'BE', postal_code: '10115', country: 'Germany' },
  include_irs_fax: false, include_rcl: false, parties_count: 1, complex_sections: [], download_count: 0,
  related_parties: [], part_vi_managerial: true,
  ...over,
});
const tx = (o) => ({ id: Math.random().toString(36).slice(2), filing_id: 's', related_party_index: 0, direction: 'received', ...o });

const fails = [];
const must = (c, m) => { if (!c) fails.push(m); };
let ran = 0;

// ── A. simple ────────────────────────────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(base(), [tx({ transaction_type: 'capital_contribution', amount_usd: 2000 })], 2024);
  const t = text(pkg.combined, 'A');
  must(/Acme LLC/.test(t), 'A: LLC name');
  must(/12-3456789/.test(t), 'A: EIN');
  must(/2,000/.test(t), 'A: contribution on Part V');
  must(pkg.formCount === 1, `A: formCount 1, got ${pkg.formCount}`);
  must(!/\d{2}\/\d{2}\/\d{4}/.test(t), 'A: no numeric dates');
  ran++;
}

// ── B. no-TIN owner ────────────────────────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(
    base({ owner_foreign_tax_id: 'None' }),
    [tx({ transaction_type: 'distribution', direction: 'paid', amount_usd: 800 }),
     tx({ transaction_type: 'service_payment', direction: 'received', amount_usd: 150 })],
    2024);
  const t = text(pkg.combined, 'B');
  must(/None/.test(t), 'B: FTIN None printed');
  must(/800/.test(t), 'B: distribution shown');
  must(/150/.test(t), 'B: service payment shown');
  ran++;
}

// ── C. multi related party ──────────────────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(
    base({ related_parties: [
      { name: 'Beta Corp', ref_number: 'BET002', country: 'France', country_residence: 'France', foreign_tax_id: 'FR99', biz_activity: 'Consulting', biz_code: '541611', address: { line1: 'x', city: 'Paris', region: 'IDF', postal_code: '75001', country: 'France' } },
    ]}),
    [tx({ transaction_type: 'capital_contribution', amount_usd: 1000, related_party_index: 0 }),
     tx({ transaction_type: 'service_payment', direction: 'received', amount_usd: 300, related_party_index: 1 })],
    2024);
  const t = text(pkg.combined, 'C');
  must(/Beta Corp/.test(t), 'C: related party 5472 present');
  must(/BET002/.test(t), 'C: related party ref id');
  must(pkg.formCount === 2, `C: formCount 2 (owner+Beta), got ${pkg.formCount}`);
  ran++;
}

// ── D. fiscal year + loan begin/end ──────────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(
    base({ is_fiscal_year: true, tax_period_begin: '2024-07-01', tax_period_end: '2025-06-30' }),
    [tx({ transaction_type: 'loan_to_llc', amount_usd: 10000, loan_begin_usd: 4000 })],
    2024);
  const t = text(pkg.combined, 'D');
  must(/July 1, 2024/.test(t), 'D: fiscal begin');
  must(/June 30, 2025/.test(t), 'D: fiscal end');
  must(/10000|10,000/.test(t), 'D: loan end balance');
  must(/4000|4,000/.test(t), 'D: loan begin balance');
  ran++;
}

// ── E. final return + dividend ───────────────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(
    base({ final_return: true }),
    [tx({ transaction_type: 'dividend', direction: 'paid', amount_usd: 1500 })],
    2024);
  const t = text(pkg.combined, 'E');
  must(/1,500/.test(t), 'E: dividend amount');
  ran++;
}

// ── F. Part VI managerial OFF, contribution only → no Part VI ─────────────────────
{
  const pkg = await gen.generateFilingPackage(
    base({ part_vi_managerial: false }),
    [tx({ transaction_type: 'capital_contribution', amount_usd: 500 })],
    2024);
  const t = text(pkg.combined, 'F');
  must(!/PART VI/.test(t), 'F: no Part VI when managerial off + no nonmonetary tx');
  ran++;
}

// ── G. extension filed → 7004 in package ─────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(
    base({ extension_filed: true }),
    [tx({ transaction_type: 'capital_contribution', amount_usd: 500 })],
    2024);
  must(!!pkg.form7004, 'G: form7004 present when extension_filed');
  const t = text(pkg.combined, 'G');
  must(/Acme LLC/.test(t), 'G: package renders');
  ran++;
}

// ── H. no reportable transactions ────────────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(base({ no_transactions_confirmed: true }), [], 2024);
  const t = text(pkg.combined, 'H');
  must(/Acme LLC/.test(t), 'H: package still generates with zero transactions');
  must(pkg.formCount === 1, 'H: owner still gets a 5472');
  ran++;
}

// ── I. royalty vs rent split ─────────────────────────────────────────────────────
{
  const pkg = await gen.generateFilingPackage(
    base(),
    // Separate canonical codes now: 'royalty' is 13b/27b and 'rent' is 13a/27a.
    // They shared a 'rent_royalty' code split by a nullable is_royalty boolean.
    [tx({ transaction_type: 'royalty', direction: 'received', amount_usd: 700 }),
     tx({ transaction_type: 'rent',    direction: 'received', amount_usd: 250 })],
    2024);
  const t = text(pkg.combined, 'I');
  must(/700/.test(t), 'I: royalty amount present');
  must(/250/.test(t), 'I: rent amount present');
  ran++;
}

console.log(`ran ${ran} scenarios`);
if (fails.length) { console.error('\nFAILED:'); fails.forEach((f) => console.error('  - ' + f)); process.exit(1); }
else console.log('\nALL E2E SCENARIOS PASSED');
