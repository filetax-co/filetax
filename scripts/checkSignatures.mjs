/**
 * checkSignatures — proves, from the captured bytes, whether each PDF carries a
 * DRAWN signature or fell back to the TYPED name.
 *
 *   node scripts/checkSignatures.mjs [pdfDir] [scenariosFile]
 *
 * A drawn signature is placed as an embedded raster image; the typed fallback
 * is text drawn in a font. So the discriminator is an image XObject on the page
 * that carries the signature, which is a property of the file rather than of
 * anything the generator told us about itself.
 *
 * Reports, per scenario: what the scenario ASKED for (signature_mode) against
 * what the file actually CONTAINS. A drawn scenario whose PDF has no image, or
 * a typed one that somehow has a signature image, is a real defect — the filer
 * would be handing the IRS a return signed differently from how they signed it.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfDir = process.argv[2] ?? path.resolve(here, '../testing/run-2026-08-01/pdfs');
const scenPath = process.argv[3] ?? path.resolve(here, '../testing/__scenarios100.json');

const scenarios = JSON.parse(await readFile(scenPath, 'utf8')).scenarios;
const byId = Object.fromEntries(scenarios.map((s) => [s.scenario_id, s]));

const files = (await readdir(pdfDir)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
if (files.length === 0) {
  console.log('No PDFs captured yet.');
  process.exit(0);
}

const rows = [];
for (const f of files) {
  const buf = await readFile(path.join(pdfDir, f));
  const raw = buf.toString('latin1');

  // Image XObjects. pdf-lib writes /Subtype /Image for an embedded PNG.
  const images = (raw.match(/\/Subtype\s*\/Image/g) ?? []).length;
  // The signature image specifically is a PNG (FlateDecode, DeviceRGB or Gray).
  const pngish = (raw.match(/\/Filter\s*\/FlateDecode[^>]*\/(Width|Height)/g) ?? []).length;

  const id = Number(f.split('__')[0]);
  const s = byId[id];
  const asked = s?.signature_mode ?? '(unknown)';
  const found = images > 0 ? 'drawn (image present)' : 'typed (no image)';
  const agrees = (asked === 'drawn') === (images > 0);

  rows.push({
    id,
    file: f,
    asked,
    images,
    pngish,
    found,
    verdict: asked === '(unknown)' ? 'n/a' : agrees ? 'MATCH' : 'MISMATCH',
    bytes: buf.length,
  });
}

const w = (s, n) => String(s).padEnd(n);
console.log(w('#', 5) + w('asked', 8) + w('images', 8) + w('found', 24) + w('verdict', 10) + 'file');
for (const r of rows) {
  console.log(w(r.id, 5) + w(r.asked, 8) + w(r.images, 8) + w(r.found, 24) + w(r.verdict, 10) + r.file);
}

const bad = rows.filter((r) => r.verdict === 'MISMATCH');
console.log(`\n${rows.length} PDFs, ${rows.filter((r) => r.verdict === 'MATCH').length} match, ${bad.length} mismatch`);
if (bad.length) {
  console.log('\nMISMATCHES — the signature on the file is not the one the scenario asked for:');
  for (const r of bad) console.log(`  #${r.id} asked ${r.asked}, file has ${r.images} image(s): ${r.file}`);
}
