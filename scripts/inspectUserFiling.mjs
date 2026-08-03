// Reproduce a corrected version of the user's filing (calendar-year 2022,
// incorporated 2021, RCL on) and verify the 4 fixes in the combined PDF:
//   - 1120 begin/end date blanks are EMPTY for a calendar-year filer
//   - RCL page is present in the package
//   - instructions no longer tell the user to write the DE banner
//   - 1120 still shows the year + incorporation date
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(ROOT, 'scripts', '_sbI.ts'); writeFileSync(stub, 'export {};\n');
const r = await build({ entryPoints: [path.join(ROOT, 'src/lib/pdfGenerator.ts')], bundle: true, format: 'esm', platform: 'node', write: false,
  define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 's', setup(b) { b.onResolve({ filter: /\/supabase$/ }, () => ({ path: stub })); } }] });
const gen = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
globalThis.fetch = async (u) => { const b = await readFile(path.join(ROOT, 'public', String(u).replace(/^\/+/, ''))); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };

const filing = {
  id: 's', user_id: 'u', created_at: '', updated_at: '', status: 'in_progress', current_step: 5,
  service_type: 'past_year', tax_year: '2022',
  llc_name: 'Owner Name', ein: '12-3456789', state_of_formation: 'AL', total_assets: 123434,
  date_of_incorporation: '2021-09-10', naics_code: '518210', naics_description: 'Cloud / Hosting / DevOps',
  mailing_address: { line1: 'Street Address', city: 'City', region: 'AL', postal_code: '10001', country: 'US' },
  owner_full_name: 'ABC Owner', owner_country: 'Madagascar', owner_primary_country: 'Madagascar',
  owner_country_residence: 'Afghanistan', owner_country_citizenship: 'Albania',
  owner_foreign_tax_id: 'dshfiuhsdikf', owner_us_tin: '12345678765432', owner_reference_id: 'ABC001',
  owner_business_activity: 'Cloud / DevOps / Infrastructure', owner_naics_code: '518210',
  owner_address: { line1: 'Owner Address', city: 'Owner City', region: 'Owner State', postal_code: '109233', country: 'Cabo Verde' },
  include_irs_fax: false, include_rcl: true,
  reasonable_cause_reasons: ['first_time_filing', 'not_informed', 'voluntary_filing'],
  parties_count: 2, complex_sections: [], download_count: 0, part_vi_managerial: true,
  related_parties: [
    { name: 'Related Party', ref_number: 'REL002', country: 'Algeria', country_residence: 'Angola',
      foreign_tax_id: '123456789', us_tin: '98765432', biz_activity: 'IT Consultant', biz_code: '541512',
      address: { line1: 'Related Address', city: 'Related City', region: 'Related State', postal_code: '991010', country: 'Algeria' } },
  ],
};
const tx = (o) => ({ id: Math.random().toString(36).slice(2), filing_id: 's', ...o });
const transactions = [
  tx({ related_party_index: 1, transaction_type: 'other', direction: 'received', amount_usd: 123445 }),
  tx({ related_party_index: 0, transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1253564 }),
];

const pkg = await gen.generateFilingPackage(filing, transactions, 2022);

const f = path.join(os.tmpdir(), 'corrected.pdf'); writeFileSync(f, Buffer.from(pkg.combined));
const py = `import pypdf\nr=pypdf.PdfReader(r'${f}')\nprint('PAGES',len(r.pages))\nfor i,p in enumerate(r.pages):\n print('==== PAGE',i+1,'====')\n print((p.extract_text() or '')[:900])`;
const text = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
console.log(text);

const fails = [];
const must = (c, m) => { if (!c) fails.push(m); };
must(!!pkg.reasonableCauseLetter, 'RCL not returned standalone');
must(/REASONABLE CAUSE STATEMENT/.test(text), 'RCL page not in combined package');
must(/this is the owner.s first time filing|first time filing/i.test(text), 'RCL narrative from reasons missing');
must(!/Write "Foreign-owned U\.S\. DE"/.test(text), 'instructions still tell user to WRITE the DE banner');
must(/already printed across the top/.test(text), 'instructions do not confirm the banner is pre-printed');
// Calendar-year 1120: the 1120 page (page 3 here: RCL, instructions, then 1120)
// should NOT contain a "January 1, 2022" begin-date blank. It should show the
// year 2022 and the incorporation date Sept 10, 2021.
// (The instructions page legitimately mentions "January 1, 2022 through ..." as
// prose, so we check only the 1120 page itself.)
// The 1120 page is uniquely identified by its signature block ("Managing
// Member") — the instructions page also mentions "Foreign-owned U.S. DE".
const pages = text.split(/==== PAGE \d+ ====/);
const form1120Page = pages.find((p) => /Foreign-owned U\.S\. DE/.test(p) && /Managing Member/.test(p)) || '';
must(/September 10, 2021/.test(form1120Page), 'incorporation date not on the 1120');
must(!/January 1, 2022/.test(form1120Page), '1120 still has full "January 1, 2022" begin-date (should be blank for calendar year)');
must(/\b2022\b/.test(form1120Page), '1120 year box not filled');

console.log(fails.length ? '\nFAILED:\n  ' + fails.join('\n  ') : '\nALL 4 FIXES VERIFIED');
process.exit(fails.length ? 1 : 0);
