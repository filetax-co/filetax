/**
 * genSamplePreview - build the Form 5472 and pro forma 1120 shown in the
 * "Sample Output Preview" on the marketing site's /services page.
 *
 * Runs the real generator, unmodified, so the sample cannot drift away from
 * what a customer actually receives. The fetch shim and the filing/transaction
 * row shapes are lifted from genAll100.mjs, which is the reference harness.
 *
 *   node scripts/genSamplePreview.mjs
 *
 * Output (PDF only; rasterising to PNG is a separate step):
 *   ../../FileTax/filetax/public/samples/sample-5472.pdf
 *   ../../FileTax/filetax/public/samples/sample-1120.pdf
 *
 * Deliberately NOT produced: the reasonable cause letter. It is the $199 line
 * item and the one document a filer cannot write themselves, so it is never
 * shown before payment. See handoff item 22.
 *
 * The data below is fictional and deliberately reads that way: "Test LLC" and
 * "Test Owner", not a plausible company and person, so nobody mistakes the
 * sample for a real filer's return. The EIN uses 00 as its prefix, which the
 * IRS does not issue, so it cannot collide with a real employer identification
 * number. Do not replace any of it with anything that could belong to someone.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Serve public/ to the generator's fetch() calls (in the browser it loads the
// blank IRS forms, and the signature script face, over HTTP).
//
// This must cover public/fonts as well as public/pdf. Serving only the PDFs
// leaves signature-script.woff unreachable, and the generator's typed-signature
// path FALLS BACK SILENTLY to Helvetica when the face will not load: the sample
// still builds, still looks plausible, and is simply missing the script
// signature that a real filer gets.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const s = String(url);
  const m = s.match(/\/((?:pdf|fonts)\/[^?#]+)$/);
  if (m) {
    const p = path.join(root, 'public', m[1]);
    if (!existsSync(p)) return new Response('missing', { status: 404 });
    const type = p.endsWith('.woff') ? 'font/woff' : 'application/pdf';
    return new Response(await readFile(p), { status: 200, headers: { 'content-type': type } });
  }
  return realFetch(url, init);
};

const { generateFilingPackage } = await import('../src/lib/pdfGenerator.ts');
const { mapTransactionForPersist } = await import('../src/lib/filingMapping.ts');

const TAX_YEAR = 2025;

const filing = {
  id: 'sample',
  status: 'completed',
  service_type: 'current_year',
  current_step: 5,

  llc_name: 'Test LLC',
  ein: '00-1234567',
  tax_year: TAX_YEAR,
  date_of_incorporation: '2021-03-15',
  state_of_formation: 'DE',
  entity_principal_country: 'US',
  naics_code: '541511',
  naics_description: 'Custom Computer Programming Services',
  total_assets: 48250,

  // Addresses are nested objects, not flat columns. See normalizeAddress in
  // filingMapping.ts.
  llc_us_address: {
    street: '1209 Orange Street, Suite 200',
    city: 'Wilmington',
    state: 'DE',
    zip: '19801',
    country: 'US',
  },

  owner_full_name: 'Test Owner',
  owner_country: 'NG',
  owner_country_residence: 'NG',
  owner_country_citizenship: 'NG',
  owner_us_tin: '',
  owner_foreign_tax_id: 'TIN-4471902',
  owner_address: {
    street: '14 Adeola Odeku Street',
    city: 'Victoria Island, Lagos',
    state: '',
    zip: '101241',
    country: 'NG',
  },
  signature_date: `${TAX_YEAR + 1}-03-12`,

  // No reasonable cause letter in the sample, by design. See the header note.
  include_rcl: false,
  include_reasonable_cause: false,
  reasonable_cause_reasons: [],
  extension_filed: false,
  final_return: false,
  initial_return: false,
  is_fiscal_year: false,

  related_parties: [],
  no_transactions_confirmed: false,
  part_vi_managerial: true,
};

// A realistic but simple year: the owner funds the LLC, takes a distribution,
// and is reimbursed for a service paid on the LLC's behalf. Enough to populate
// Part IV and Part V without turning the preview into an edge case.
const transactions = [
  { transaction_type: 'capital_contribution', direction: 'to_llc', amount_usd: 25000, transaction_date: `${TAX_YEAR}-01-22`, description: 'Owner funding' },
  { transaction_type: 'distribution', direction: 'from_llc', amount_usd: 12000, transaction_date: `${TAX_YEAR}-08-05`, description: 'Owner distribution' },
  { transaction_type: 'services_provided', direction: 'from_llc', amount_usd: 6500, transaction_date: `${TAX_YEAR}-11-18`, description: 'Development services billed to related party' },
].map((t) => ({
  related_party_index: 0,
  ...mapTransactionForPersist({
    transaction_type: t.transaction_type,
    direction: t.direction,
    amount_usd: t.amount_usd,
    loan_begin_usd: null,
    description: t.description,
    transaction_date: t.transaction_date,
  }),
}));

const pkg = await generateFilingPackage(filing, transactions, TAX_YEAR);

const outDir = path.resolve(root, '../../FileTax/filetax/public/samples');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'sample-5472.pdf'), pkg.form5472);
await writeFile(path.join(outDir, 'sample-1120.pdf'), pkg.form1120);

if (pkg.reasonableCauseLetter) {
  throw new Error('Sample produced a reasonable cause letter. It must never be generated here.');
}

console.log('wrote sample-5472.pdf and sample-1120.pdf to', outDir);
