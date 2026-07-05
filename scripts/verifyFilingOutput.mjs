/**
 * End-to-end verification harness (no network, no DB).
 *
 * Bundles the REAL client generator (src/lib/pdfGenerator.ts) with esbuild,
 * stubs fetch() to read the local public/pdf templates, runs it against the
 * sample filing reconstructed from the user's screenshots, then extracts the
 * generated PDF text and asserts input == output.
 *
 * Run: node scripts/verifyFilingOutput.mjs
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Bundle pdfGenerator.ts + filingMapping.ts into a single ESM module ────
// Stub ./supabase (it throws on import without env vars) with a types-only shim.
const supabaseStub = path.join(ROOT, 'scripts', '_supabaseStub.ts');
writeFileSync(supabaseStub, 'export {};\n');

const result = await build({
  entryPoints: [path.join(ROOT, 'src/lib/pdfGenerator.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [
    {
      name: 'stub-supabase',
      setup(b) {
        // pdfGenerator imports types from ./supabase; filingMapping too.
        b.onResolve({ filter: /\/supabase$/ }, () => ({ path: supabaseStub }));
        b.onResolve({ filter: /^\.\.\/lib\/supabase$/ }, () => ({ path: supabaseStub }));
      },
    },
  ],
});

const code = result.outputFiles[0].text;
const modUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const gen = await import(modUrl);

// ── 2. Stub global fetch to serve local public/pdf templates ─────────────────
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\/+/, '');
  const file = path.join(ROOT, 'public', rel);
  const buf = await readFile(file);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

// ── 3. Sample filing reconstructed from the screenshots ──────────────────────
const filing = {
  id: 'sample', user_id: 'u', created_at: '', updated_at: '',
  status: 'paid', current_step: 5, service_type: 'past_year',
  tax_year: '2025',
  llc_name: 'LLC Name',
  ein: '98-7654321',
  state_of_formation: 'AK',
  total_assets: 14000,
  // canonical entity columns (what Intake now writes)
  date_of_incorporation: '2025-11-01',
  naics_code: '541511',
  naics_description: 'Software Development',
  initial_return: true,
  mailing_address: { line1: '123 Main St', city: 'Anchorage', region: 'AK', postal_code: '99501', country: 'US' },
  // owner — literal answers from the screenshots
  owner_full_name: 'Owner Name',
  owner_country: 'United States',         // "country where you do business"
  owner_primary_country: 'United States',
  owner_country_residence: 'Albania',     // "country where you pay taxes"
  owner_country_citizenship: 'India',
  owner_foreign_tax_id: 'FTIN',
  owner_us_tin: '987654321',
  owner_reference_id: 'OWN001',
  owner_ref_number: 'OWN001',
  owner_business_activity: 'Cybersecurity / Data / AI Services',
  owner_naics_code: '541519',
  owner_address: { line1: 'Owner Street', city: 'Owner City', region: 'Owner State', postal_code: '20002', country: 'India' },
  include_irs_fax: false, include_rcl: true,
  parties_count: 3, complex_sections: [], download_count: 0,
  // two additional related parties from the screenshots
  related_parties: [
    { name: 'Vidhi Lathiya', ref_number: 'VID002', country: 'Algeria', country_residence: 'Belarus', foreign_tax_id: 'VID-FTIN', biz_activity: 'Graphic Design', biz_code: '541430', address: { line1: 'A', city: 'B', region: 'C', postal_code: '1', country: 'Algeria' } },
    { name: 'Bhavna Lathiya', ref_number: 'BHA003', country: 'Afghanistan', country_residence: 'Afghanistan', foreign_tax_id: 'BHA-FTIN', biz_activity: 'AI / Machine Learning Services', biz_code: '541511', address: { line1: 'A', city: 'B', region: 'C', postal_code: '1', country: 'Afghanistan' } },
  ],
};

// transactions from the screenshots (related_party_index: 0 = owner)
const transactions = [
  { id: 't1', filing_id: 'sample', related_party_index: 0, transaction_type: 'loan_to_llc',         direction: 'received', amount_usd: 10000,  loan_begin_usd: 0,    description: 'Loan to the LLC' },
  { id: 't2', filing_id: 'sample', related_party_index: 0, transaction_type: 'loan_from_llc',       direction: 'paid',     amount_usd: 100000, loan_begin_usd: 0,    description: 'Loan from the LLC' },
  { id: 't3', filing_id: 'sample', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000,   description: 'Capital contribution by owner' },
  // "Payment for services" with party = Vidhi Lathiya in the screenshot (index 1)
  { id: 't4', filing_id: 'sample', related_party_index: 1, transaction_type: 'service_payment',     direction: 'received', amount_usd: 78,     description: 'Payment for services' },
];

// ── 4. Generate ──────────────────────────────────────────────────────────────
const pkg = await gen.generateFilingPackage(filing, transactions, 2025);

const outPath = path.join(os.tmpdir(), 'verify-filing.pdf');
writeFileSync(outPath, Buffer.from(pkg.combined));
console.log('formCount (Line 1g) =', pkg.formCount);
console.log('combined PDF bytes  =', pkg.combined.length);
console.log('written to          =', outPath);

// ── 5. Extract text via Python pypdf (already available) ──────────────────────
const py = `
import pypdf, sys
r = pypdf.PdfReader(r'${outPath}')
print('PAGES', len(r.pages))
for i,p in enumerate(r.pages):
    print('==== PAGE', i+1, '====')
    print(p.extract_text() or '')
`;
const text = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
console.log(text);

// ── 6. Assertions ─────────────────────────────────────────────────────────────
const fails = [];
const must = (cond, msg) => { if (!cond) fails.push(msg); };

// 1g = 2 forms (owner + Vidhi who has a transaction; Bhavna has none → no form)
must(pkg.formCount === 2, `Line 1g should be 2 (owner + Vidhi), got ${pkg.formCount}`);

// Tax-period dates on the forms use the long human format ("Month D, YYYY").
// (Date of incorporation prints numeric MM/DD/YYYY per the entity-data field.)
must(/November 1, 2025/.test(text), 'Short-year begin "November 1, 2025" not found (initial-return short year)');
must(/December 31, 2025/.test(text), 'Period end "December 31, 2025" not found');

// Owner countries — literal answers, not US/AK fallback
must(/Albania/.test(text), 'Owner tax residence "Albania" not found');
must(/India/.test(text), 'Owner citizenship "India" not found');

// Related party appears
must(/Vidhi Lathiya/.test(text), 'Related party "Vidhi Lathiya" 5472 not found');
must(/OWN001/.test(text), 'Owner reference id OWN001 not found');
must(/VID002/.test(text), 'Related-party reference id VID002 not found');

// Bhavna should NOT have a form (no transactions)
must(!/BHA003/.test(text), 'Bhavna (no transactions) should not have a 5472, but BHA003 appears');

// Capital contribution 1,000 must show on the Part V statement (was dropped before)
must(/1,000/.test(text), 'Capital contribution $1,000 (Part V) not found');

// Amounts print with thousands separators (commas) on the forms.
// Loan balances appear on Part IV lines 17b / 31b as "100,000" / "10,000".
must(/100,000/.test(text), 'Loan balance 100,000 not found on Part IV (with comma)');
must(/10,000/.test(text), 'Loan balance 10,000 not found on Part IV (with comma)');

// Service payment 78 (Vidhi, Part IV line 15) must appear
must(/\b78\b/.test(text), 'Service payment 78 not found');

// EIN present
must(/98-7654321/.test(text), 'EIN not found');

// Gross payments (1f/1h) now INCLUDE the ending loan balances (line 22/36
// totals) and monetary Part V. For the owner's 5472 the entity-wide gross (1h)
// is 10,000 (borrowed) + 100,000 (loaned) + 1,000 (contribution) + 78 (Vidhi
// service) = 111,078.
must(/111,078/.test(text),
  'Line 1f/1h gross should be 111,078 (Part IV + loan ending balances + Part V)');

if (fails.length) {
  console.error('\n❌ FAILED ASSERTIONS:');
  for (const f of fails) console.error('  • ' + f);
  process.exit(1);
} else {
  console.log('\n✅ ALL ASSERTIONS PASSED');
}
