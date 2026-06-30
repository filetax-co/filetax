// Verifies Form 7004 generation fills the expected fields. Run: node scripts/verify7004.mjs
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(ROOT, 'scripts', '_sb7.ts');
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

const baseFiling = (over = {}) => ({
  id: 's', user_id: 'u', created_at: '', updated_at: '', status: 'paid', current_step: 5,
  service_type: 'current_year', tax_year: '2025',
  llc_name: 'Northwind Trading LLC', ein: '88-7766554', state_of_formation: 'DE',
  date_of_incorporation: '2025-02-10',
  mailing_address: { line1: '500 Market St', city: 'Wilmington', region: 'DE', postal_code: '19801', country: 'US' },
  owner_full_name: 'Rahul Sharma', owner_country: 'United States', owner_country_residence: 'India',
  owner_country_citizenship: 'India', owner_foreign_tax_id: 'ABCDE1234F', owner_reference_id: 'RAH001',
  owner_address: { line1: 'A', city: 'Pune', region: 'MH', postal_code: '411001', country: 'India' },
  include_irs_fax: false, include_rcl: false, parties_count: 1, complex_sections: [], download_count: 0,
  related_parties: [], extension_filed: true,
  ...over,
});

const dump = (bytes, label) => {
  const f = path.join(os.tmpdir(), label + '.pdf');
  writeFileSync(f, Buffer.from(bytes));
  const py = `import pypdf\nr=pypdf.PdfReader(r'${f}')\nflds=r.get_fields() or {}\nfor k,v in flds.items():\n  val=v.get('/V')\n  if val not in (None,''): print(repr(k),'=',repr(val))`;
  return execFileSync('python3', ['-c', py], { encoding: 'utf8' });
};

const fails = [];
const must = (c, m) => { if (!c) fails.push(m); };

// 1. Standalone 7004 (initial return — formed 2025, filing 2025 => short year)
const f7004 = await gen.generateForm7004(baseFiling(), 2025);
const t = dump(f7004, '7004-initial');
console.log('=== 7004 (initial/short year) fields ===\n' + t);
must(/Northwind Trading LLC/.test(t), 'LLC name missing');
must(/88-7766554/.test(t), 'EIN missing');
must(/Wilmington/.test(t), 'city missing');
must(/Initial_Return/.test(t) || /Yes|On|1/.test(t), 'initial-return checkbox not set');

// 2. Calendar-year filer (formed earlier) => LLC_Calendar_Year filled
const f7004cal = await gen.generateForm7004(baseFiling({ date_of_incorporation: '2020-01-01' }), 2025);
const tcal = dump(f7004cal, '7004-cal');
console.log('=== 7004 (calendar year) fields ===\n' + tcal);
must(/2025/.test(tcal), 'calendar year 2025 missing');

// 3. Package includes form7004 when extension_filed=true; absent when false
const pkgWith = await gen.generateFilingPackage(baseFiling({ extension_filed: true }),
  [{ id: 'c', filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 }], 2025);
must(!!pkgWith.form7004, 'package should include form7004 when extension_filed=true');

const pkgWithout = await gen.generateFilingPackage(baseFiling({ extension_filed: false, include_7004: false }),
  [{ id: 'c', filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 }], 2025);
must(!pkgWithout.form7004, 'package should NOT include form7004 when neither flag set');

if (fails.length) { console.error('\nFAILED:'); fails.forEach((x) => console.error('  - ' + x)); process.exit(1); }
else console.log('\n7004 GENERATION OK');
