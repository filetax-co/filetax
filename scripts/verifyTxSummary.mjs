// Verifies summarizeTransactions buckets + formGross follow the IRS Part-IV rule
// (Part IV monetary flows only; loans + Part V excluded), and that buckets sum
// to the total entered. Run: node scripts/verifyTxSummary.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(ROOT, 'scripts', '_sbStub3.ts');
writeFileSync(stub, 'export {};\n');

const result = await build({
  entryPoints: [path.join(ROOT, 'src/lib/filingMapping.ts')],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{
    name: 'stub-supabase',
    setup(b) { b.onResolve({ filter: /supabase/ }, () => ({ path: stub })); },
  }],
});
const mapping = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));

const fails = [];
const must = (c, m) => { if (!c) fails.push(m); };

const uiRows = [
  { transaction_type: 'capital_contribution', amount_usd: 1000 },  // Part V, money in
  { transaction_type: 'loan_to_llc',          amount_usd: 10000 }, // loan, money in
  { transaction_type: 'service_payment',      amount_usd: 78 },    // Part IV flow, other
  { transaction_type: 'distribution',         amount_usd: 500 },   // Part V, money out
];
const s = mapping.summarizeTransactions(uiRows);
console.log('summary:', JSON.stringify(s));

must(s.totalEntered === 11578, `totalEntered should be 11578, got ${s.totalEntered}`);
must(s.formGross === 78, `formGross should be 78 (Part IV flows only), got ${s.formGross}`);
must(s.bucketIn.total === 11000 && s.bucketIn.count === 2, `Money in should be 11000/2, got ${s.bucketIn.total}/${s.bucketIn.count}`);
must(s.bucketOut.total === 500 && s.bucketOut.count === 1, `Money out should be 500/1, got ${s.bucketOut.total}/${s.bucketOut.count}`);
must(s.bucketOther.total === 78 && s.bucketOther.count === 1, `Other should be 78/1, got ${s.bucketOther.total}/${s.bucketOther.count}`);
must(s.bucketIn.total + s.bucketOut.total + s.bucketOther.total === s.totalEntered, 'buckets do not sum to totalEntered');

const s2 = mapping.summarizeTransactions([{ transaction_type: 'royalty', amount_usd: 200 }]);
must(s2.formGross === 200 && s2.bucketOther.total === 200, `royalty is a Part IV flow: gross ${s2.formGross}, other ${s2.bucketOther.total}`);

const s3 = mapping.summarizeTransactions([{ transaction_type: 'loan_from_llc', amount_usd: 5000 }]);
must(s3.formGross === 0 && s3.bucketOut.total === 5000, `loan_from_llc: not gross, money out; got gross ${s3.formGross}, out ${s3.bucketOut.total}`);

if (fails.length) { console.error('\nFAILED:'); fails.forEach((f) => console.error('  - ' + f)); process.exit(1); }
else console.log('\nTX SUMMARY RECONCILES (Part IV gross + buckets correct)');
