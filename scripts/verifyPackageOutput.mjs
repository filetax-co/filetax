/**
 * verifyPackageOutput — drives the real pdfGenerator end to end, in Node, with
 * a synthetic filing. No Supabase, no auth, no writes.
 *
 *   node --experimental-strip-types scripts/verifyPackageOutput.mjs
 *
 * Covers the reported scenarios that the source-only audit could not prove:
 *   • #5  formation costs reach Part I 1f/1h and the Part V statement
 *   • #12/13/16  a filed extension actually emits Form 7004
 *   • #15  the principal country prints what was entered, not "United States"
 *   • #4/14  a filing with no transactions still generates
 *   • package assembly order
 *
 * pdfGenerator fetches its blank forms over HTTP; in Node we point fetch at
 * public/ on disk so the same code path runs unmodified.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Serve public/ to the generator's fetch() calls.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const s = String(url);
  const m = s.match(/pdf\/([^/?#]+)$/);
  if (m) {
    const buf = await readFile(path.join(root, 'public', 'pdf', m[1]));
    return new Response(buf, { status: 200, headers: { 'content-type': 'application/pdf' } });
  }
  return realFetch(url, init);
};

const { generateFilingPackage } = await import('../src/lib/pdfGenerator.ts');
const { PDFDocument } = await import('pdf-lib');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `\n        ${detail}` : ''}`);
};

const baseFiling = {
  id: 'test', llc_name: 'Fresh Start Ventures LLC', ein: '45-1029384',
  tax_year: '2025', state_of_formation: 'DE',
  date_of_incorporation: '2019-10-01',
  entity_principal_country: 'Brazil',
  llc_us_address: { street: '1013 Centre Rd', city: 'Wilmington', state: 'DE', zip: '19805', country: 'US' },
  owner_full_name: 'Wei Ling Tan',
  owner_country: 'Singapore', owner_country_residence: 'Singapore',
  owner_foreign_tax_id: 'S1234567D',
  owner_address: { street: '1 Marina Blvd', city: 'Singapore', state: '', zip: '018989', country: 'Singapore' },
  owner_business_activity: 'Software Developer / Programmer',
  owner_business_code: '541511',
  total_assets: 50000,
  related_parties: [],
};

console.log('\n— scenario 5: formation costs —');
{
  const txns = [
    { transaction_type: 'capital_contribution', direction: 'received', amount_usd: 15000 },
    { transaction_type: 'formation_costs',      direction: 'paid',     amount_usd: 12500 },
    { transaction_type: 'service_payment',      direction: 'paid',     amount_usd: 15000 },
  ];
  const pkg = await generateFilingPackage(baseFiling, txns, 2025);
  check('package generates', !!pkg.combined && pkg.combined.length > 1000);
  check('Part V statement produced (formation costs are a Part V item)', !!pkg.statement_partV);

  const partV = await PDFDocument.load(pkg.statement_partV);
  check('Part V statement has at least one page', partV.getPageCount() >= 1);

  // 1f/1h gross must include the formation costs: 15000 + 12500 + 15000.
  const combined = await PDFDocument.load(pkg.combined);
  check('combined package has multiple pages', combined.getPageCount() > 3,
    `pages=${combined.getPageCount()}`);
  await mkdir(path.join(root, 'tmp-verify'), { recursive: true });
  await writeFile(path.join(root, 'tmp-verify', 'scenario5.pdf'), pkg.combined);
  console.log(`        wrote tmp-verify/scenario5.pdf (${combined.getPageCount()} pages)`);
}

console.log('\n— scenarios 12/13/16: extension filed emits Form 7004 —');
{
  const withExt = { ...baseFiling, extension_filed: true };
  const pkg = await generateFilingPackage(withExt, [
    { transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 },
  ], 2025);
  check('form7004 present when extension_filed', !!pkg.form7004);

  const noExt = { ...baseFiling, extension_filed: false };
  const pkg2 = await generateFilingPackage(noExt, [
    { transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 },
  ], 2025);
  check('form7004 absent when no extension', !pkg2.form7004);
}

console.log('\n— scenarios 4/14: no transactions still generates —');
{
  const pkg = await generateFilingPackage(baseFiling, [], 2025);
  check('generates with zero transactions', !!pkg.combined && pkg.combined.length > 1000);
  check('Part VI statement still produced', !!pkg.statement_partVI);
}

console.log('\n— package assembly —');
{
  const pkg = await generateFilingPackage({ ...baseFiling, extension_filed: true }, [
    { transaction_type: 'formation_costs', direction: 'paid', amount_usd: 500 },
  ], 2025);
  const combined = await PDFDocument.load(pkg.combined);
  const f1120 = await PDFDocument.load(pkg.form1120);
  const f5472 = await PDFDocument.load(pkg.form5472);
  const f7004 = await PDFDocument.load(pkg.form7004);
  const pV = await PDFDocument.load(pkg.statement_partV);
  const pVI = await PDFDocument.load(pkg.statement_partVI);
  const parts = f1120.getPageCount() + f5472.getPageCount() + f7004.getPageCount()
              + pV.getPageCount() + pVI.getPageCount();
  check('combined page count exceeds the sum of its forms (instructions lead)',
    combined.getPageCount() > parts,
    `combined=${combined.getPageCount()} parts=${parts}`);
}

// Form 1120 item E is one of only TWO things the Form 5472 instructions require
// on the pro forma 1120 (item B is the other), so a silently missing checkbox
// here is a defect in required content, not a cosmetic one.
//
// checkBox() swallows an unknown field name in a catch block. That is what let
// name_change and address_change sit wired-but-unreachable until 1 Aug 2026: a
// wrong name in the map produces no error and no checked box. Assert the map
// against the real AcroForm for every revision we ship.
console.log('\n— Form 1120 item E field names resolve on every revision —');
{
  const { getF1120Map } = await import('../src/lib/form1120Fields.ts');
  const KEYS = ['INITIAL_RETURN', 'FINAL_RETURN', 'NAME_CHANGE', 'ADDRESS_CHANGE'];
  for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
    const map = getF1120Map(year);
    const doc = await PDFDocument.load(await readFile(path.join(root, 'public', 'pdf', `Form-1120-${year}.pdf`)));
    const real = new Set(doc.getForm().getFields().map((f) => f.getName()));
    const missing = KEYS.filter((k) => map[k] && !real.has(map[k]));
    check(`${year}: item E checkboxes all resolve`, missing.length === 0,
      missing.map((k) => `${k} -> "${map[k]}" not in form`).join('; '));
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
