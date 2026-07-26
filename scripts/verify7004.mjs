// Verifies Form 7004 generation fills the expected fields. Run: node scripts/verify7004.mjs
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';
import { PDFDocument, PDFTextField, PDFCheckBox } from 'pdf-lib';
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

/**
 * Read back the filled field values. This used to shell out to python3/pypdf,
 * which is not installed on every machine that needs to run the check — pd
 * f-lib is already a dependency and reads the same values.
 */
const dump = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const lines = [];
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      const v = field.getText();
      if (v) lines.push(`'${name}' = '${v}'`);
    } else if (field instanceof PDFCheckBox && field.isChecked()) {
      lines.push(`'${name}' = checked`);
    }
  }
  return lines.join('\n') + '\n';
};

/**
 * Text drawn straight onto the page rather than into a field — the ending date
 * on the period line is drawn, because both date slots share one field name.
 */
const pageText = (bytes) => {
  const buf = Buffer.from(bytes);
  let text = '';
  const start = Buffer.from('stream');
  const end = Buffer.from('endstream');
  for (let i = 0; (i = buf.indexOf(start, i)) !== -1; ) {
    let s = i + start.length;
    if (buf[s] === 0x0d) s++;
    if (buf[s] === 0x0a) s++;
    const e = buf.indexOf(end, s);
    if (e === -1) break;
    const chunk = buf.subarray(s, e);
    try { text += zlib.inflateSync(chunk).toString('latin1') + '\n'; }
    catch { text += chunk.toString('latin1') + '\n'; }
    i = e + end.length;
  }
  // pdf-lib writes drawn strings as hex — <446563656D626572...> Tj — so decode
  // those runs, otherwise a search for the visible words finds nothing.
  return text.replace(/<([0-9A-Fa-f]{4,})>/g, (whole, hex) => {
    if (hex.length % 2) return whole;
    try { return Buffer.from(hex, 'hex').toString('latin1'); }
    catch { return whole; }
  });
};

const fails = [];
const must = (c, m) => { if (!c) fails.push(m); };

// 1. Standalone 7004 (initial return — formed 2025, filing 2025 => short year)
const f7004 = await gen.generateForm7004(baseFiling(), 2025);
const t = await dump(f7004);
console.log('=== 7004 (initial/short year) fields ===\n' + t);
must(/Northwind Trading LLC/.test(t), 'LLC name missing');
must(/88-7766554/.test(t), 'EIN missing');
must(/Wilmington/.test(t), 'city missing');
must(/Initial_Return/.test(t) || /Yes|On|1/.test(t), 'initial-return checkbox not set');

// The period line preprints the century: "beginning ____, 20 __, and ending
// ____, 20 __". A four-digit year printed "20 2025".
must(/'LLC_Beginning_Year' = '25'/.test(t), "beginning year must be 2 digits ('25'), the form preprints '20'");
must(/'LLC_Ending_Year' = '25'/.test(t), "ending year must be 2 digits ('25')");
must(!/= '2025'/.test(t), 'no year field may carry a 4-digit year');

// Both date slots on that line share the field name LLC_Beginning_Date, so the
// ending date is drawn onto the page instead. Beginning is the formation date
// (short year); ending is 31 December.
// The blank takes the month and day only — the year that follows it is the
// "20 __" box, so a full date printed the year twice.
const shortYearPage = pageText(f7004);
must(/'LLC_Beginning_Date' = 'February 10'/.test(t), "beginning slot should read 'February 10' — the year goes in the 20 __ box");
must(!/February 10, 2025/.test(t), 'beginning slot must not repeat the year');
must(/December 31/.test(shortYearPage), 'ending date must be printed in the ending slot, not a repeat of the beginning date');
must(!/December 31, 2025/.test(shortYearPage), 'ending slot must not repeat the year');

// 2. Calendar-year filer (formed earlier) => LLC_Calendar_Year filled
const f7004cal = await gen.generateForm7004(baseFiling({ date_of_incorporation: '2020-01-01' }), 2025);
const tcal = await dump(f7004cal);
console.log('=== 7004 (calendar year) fields ===\n' + tcal);
must(/'LLC_Calendar_Year' = '25'/.test(tcal), "calendar year must print as '25' — the form already shows '20'");
must(!/2025/.test(tcal), "calendar year must not print '2025' (it would read '20 2025')");

// 3. Package includes form7004 when extension_filed=true; absent when false
const pkgWith = await gen.generateFilingPackage(baseFiling({ extension_filed: true }),
  [{ id: 'c', filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 }], 2025);
must(!!pkgWith.form7004, 'package should include form7004 when extension_filed=true');

const pkgWithout = await gen.generateFilingPackage(baseFiling({ extension_filed: false, include_7004: false }),
  [{ id: 'c', filing_id: 's', related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 }], 2025);
must(!pkgWithout.form7004, 'package should NOT include form7004 when neither flag set');

if (fails.length) { console.error('\nFAILED:'); fails.forEach((x) => console.error('  - ' + x)); process.exit(1); }
else console.log('\n7004 GENERATION OK');
