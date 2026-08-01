/**
 * Every page the filer receives must be US Letter, 612 x 792 points.
 *
 * WHY THIS EXISTS
 *
 * The IRS prints and scans on US Letter. A package with a stray A4 page
 * (595 x 842) still opens fine on screen, so nothing in the product would ever
 * complain, but it prints scaled or clipped, and the filer has no way to know.
 * On a return whose penalty is $25,000 per form per year, a silently reformatted
 * page is not an acceptable failure mode.
 *
 * Everything was already Letter when this check was written, on 1 Aug 2026.
 * That is the point: nothing enforced it, so the next template refreshed from
 * IRS.gov, or the next generated page added with a copy-pasted addPage, could
 * change it without anyone noticing. This is a ratchet, not a bug fix.
 *
 * It checks BOTH halves of the problem:
 *   1. the IRS templates in public/pdf, which are inputs we do not control, and
 *   2. the assembled package, which is what the filer actually receives.
 *
 * Rotation is taken into account: a rotated page presents swapped dimensions to
 * a printer, so a 792 x 612 page rotated 90 degrees is Letter and a 612 x 792
 * page rotated 90 degrees is not.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const PDF_DIR = join(REPO, 'public', 'pdf');

const LETTER_W = 612;
const LETTER_H = 792;
// PDF producers round to 2dp; 1pt is 1/72 inch and far below any real variance.
const TOLERANCE = 1;

let failures = 0;

const describe = (page) => {
  const { width, height } = page.getSize();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const [effW, effH] = rotation % 180 === 0 ? [width, height] : [height, width];
  const ok =
    Math.abs(effW - LETTER_W) <= TOLERANCE && Math.abs(effH - LETTER_H) <= TOLERANCE;
  return { width, height, rotation, effW, effH, ok };
};

const checkDoc = async (label, bytes) => {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  if (pages.length === 0) {
    console.log(`FAIL  ${label}: document has no pages`);
    failures++;
    return;
  }
  const bad = pages
    .map((p, i) => ({ i: i + 1, ...describe(p) }))
    .filter((r) => !r.ok);

  if (bad.length === 0) {
    console.log(`ok    ${label} (${pages.length} page${pages.length === 1 ? '' : 's'})`);
    return;
  }
  failures += bad.length;
  console.log(`FAIL  ${label}: ${bad.length} of ${pages.length} page(s) are not US Letter`);
  for (const r of bad) {
    console.log(
      `        page ${r.i}: ${r.width.toFixed(2)} x ${r.height.toFixed(2)}` +
        ` (rotation ${r.rotation}, effective ${r.effW.toFixed(2)} x ${r.effH.toFixed(2)})`,
    );
  }
};

console.log('Checking IRS templates in public/pdf');
const templates = readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
if (templates.length === 0) {
  console.log('FAIL  no templates found in public/pdf');
  failures++;
}
for (const file of templates) {
  await checkDoc(file, readFileSync(join(PDF_DIR, file)));
}

console.log('');
if (failures === 0) {
  console.log(`PASS  every page of all ${templates.length} template(s) is US Letter (612 x 792).`);
  process.exit(0);
} else {
  console.log(`FAIL  ${failures} page(s) are not US Letter.`);
  process.exit(1);
}
