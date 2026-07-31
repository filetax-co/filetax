import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const root = process.cwd();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/pdf\/([^/?#]+)$/);
  if (m) {
    const p = path.join(root, 'public', 'pdf', m[1]);
    if (!existsSync(p)) return new Response('missing', { status: 404 });
    return new Response(await readFile(p), { status: 200 });
  }
  return realFetch(url, init);
};

const { generateFilingPackage } = await import('../src/lib/pdfGenerator.ts');
const { PDFForm } = await import('pdf-lib');

// Snapshot field values at flatten time, before the appearance is baked in.
const snaps = [];
const orig = PDFForm.prototype.flatten;
PDFForm.prototype.flatten = function (...a) {
  const s = {};
  for (const f of this.getFields()) {
    try { s[f.getName()] = typeof f.getText === 'function' ? (f.getText() ?? '') : (f.isChecked?.() ? 'X' : ''); } catch {}
  }
  snaps.push(s);
  return orig.apply(this, a);
};

const base = {
  id: 't', llc_name: 'Guarantee Test LLC', ein: '11-2223334',
  state_of_formation: 'WY', date_of_incorporation: '2018-01-01',
  entity_principal_country: 'India', total_assets: 50000,
  mailing_address: { line1: '30 N Gould St', city: 'Sheridan', region: 'WY', postal_code: '82801', country: 'US' },
  owner_full_name: 'Test Owner', owner_primary_country: 'India',
  owner_country_residence: 'India', owner_foreign_tax_id: 'ABC123',
  owner_address: { line1: '1 MG Rd', city: 'Bengaluru', region: 'KA', postal_code: '560001', country: 'India' },
  owner_business_activity: 'Software', owner_naics_code: '541511', related_parties: [],
};

console.log('=== FIX 1: loan-guarantee fee on a year whose template lacks lines 20/34 ===');
for (const year of [2019, 2021, 2024]) {
  snaps.length = 0;
  const pkg = await generateFilingPackage({ ...base, tax_year: String(year) }, [
    { related_party_index: 0, transaction_type: 'loan_guarantee', direction: 'paid', amount_usd: 986900 },
  ], year);
  const f = snaps.find((s) => 'CorporationName' in s) ?? {};
  const line34 = f.GuaranteePaid || '(absent)';
  const line35 = f.OtherPayments || '(blank)';
  const line36 = f.TotalPaid || '(blank)';
  const footed = Number(String(line34).replace(/\D/g, '') || 0) + Number(String(line35).replace(/\D/g, '') || 0)
    === Number(String(line36).replace(/\D/g, '') || 0);
  console.log(`  TY${year}: line34=${line34}  line35(other)=${line35}  line36(total)=${line36}  → ${footed ? 'FOOTS' : 'DOES NOT FOOT'}`);
}

console.log('\n=== FIX 2: non-Latin characters no longer abort generation ===');
for (const name of ['Владимир Петров', '山田 太郎', 'محمد بن سلمان', 'राजेश कुमार', 'José Álvarez-Núñez']) {
  try {
    const pkg = await generateFilingPackage(
      { ...base, tax_year: '2025', owner_full_name: name },
      [{ related_party_index: 0, transaction_type: 'service_payment', direction: 'paid', amount_usd: 1000 }],
      2025,
    );
    const flagged = pkg.unsupportedText?.flatMap((u) => u.characters) ?? [];
    console.log(`  ${name.padEnd(22)} → generated ${pkg.combined.length} bytes; ` +
      (flagged.length ? `flagged ${flagged.length} unsupported char(s): ${[...new Set(flagged)].join('')}` : 'fully representable'));
  } catch (e) {
    console.log(`  ${name.padEnd(22)} → STILL THROWS: ${e.message}`);
  }
}
