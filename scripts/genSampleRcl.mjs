/**
 * genSampleRcl — build the reasonable cause letter shown on the marketing
 * site's /services page, and render it PARTIALLY OBSCURED.
 *
 *   node scripts/genSampleRcl.mjs
 *
 * WHY THIS IS TREATED DIFFERENTLY FROM THE FORMS
 *
 * The 5472 and the 1120 are shown complete, because they are mostly the
 * filer's own data and showing them costs nothing. The letter is the opposite:
 * the argument is the product. It is the $199 line item and the one document a
 * filer cannot write themselves.
 *
 * But what sells the letter is not the argument. It is proof that the letter
 * exists, is properly structured, cites real authority, and carries a
 * declaration under penalties of perjury. A reader who has never seen one does
 * not know what it looks like, and that is the worry being answered. So:
 *
 *   VISIBLE   letterhead, the IRS address block, the RE line naming the entity,
 *             EIN and years, the opening paragraph, section headings, the
 *             penalties-of-perjury declaration, and the signature.
 *   OBSCURED  the argument paragraphs, the only part that is reusable.
 *
 * Deliberately NOT a full-page blur (reads as a stock image and proves
 * nothing) and NOT a clean first paragraph alone (the easiest part to write
 * yourself, and it looks like a thin document).
 *
 * Output: ../../FileTax/filetax/public/samples/sample-rcl.webp
 * The PDF is intentionally NOT written to public/, so no clean copy ships.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.resolve(root, '../../FileTax/filetax/public/samples');

// Same shim as genSamplePreview: serve public/pdf and public/fonts.
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

const TAX_YEAR = 2025;

// Same fictional filer as the forms sample. See genSamplePreview.mjs.
const filing = {
  id: 'sample-rcl',
  status: 'completed',
  service_type: 'past_year',
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
  llc_us_address: {
    street: '1209 Orange Street, Suite 200',
    city: 'Wilmington', state: 'DE', zip: '19801', country: 'US',
  },
  owner_full_name: 'Test Owner',
  owner_country: 'NG',
  owner_country_residence: 'NG',
  owner_country_citizenship: 'NG',
  owner_us_tin: '',
  owner_foreign_tax_id: 'TIN-4471902',
  owner_address: {
    street: '14 Adeola Odeku Street',
    city: 'Victoria Island, Lagos', state: '', zip: '101241', country: 'NG',
  },
  signature_date: `${TAX_YEAR + 1}-03-12`,

  include_rcl: true,
  reasonable_cause_reasons: ['first_time_filing', 'no_tax_liability', 'voluntary_filing'],
  extension_filed: false,
  final_return: false,
  initial_return: false,
  is_fiscal_year: false,
  related_parties: [],
  no_transactions_confirmed: true,
  part_vi_managerial: true,
};

const pkg = await generateFilingPackage(filing, [], TAX_YEAR);
if (!pkg.reasonableCauseLetter) throw new Error('No reasonable cause letter was produced.');

// ── render ──────────────────────────────────────────────────────────────────
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc =
  new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;

const SCALE = 2;
const doc = await pdfjs.getDocument({
  data: new Uint8Array(pkg.reasonableCauseLetter),
  disableFontFace: true,
  standardFontDataUrl:
    path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts').replace(/\\/g, '/') + '/',
}).promise;

const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: SCALE });
const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, canvas.width, canvas.height);
await page.render({ canvasContext: ctx, viewport }).promise;

// Find the argument region by reading the text layer rather than hardcoding
// pixel offsets, so a wording change cannot silently expose the argument or
// obscure the signature.
const text = await page.getTextContent();
const items = text.items
  .filter((i) => i.str.trim())
  .map((i) => {
    const [, , , , x, y] = i.transform;
    const p = viewport.convertToViewportPoint(x, y);
    return { s: i.str.trim(), y: p[1] };
  })
  .sort((a, b) => a.y - b.y);

/** First item whose text matches, else null. */
const findY = (re) => items.find((i) => re.test(i.s))?.y ?? null;

// The argument starts after the intro paragraph's last line and ends where the
// perjury declaration begins.
const introIdx = items.findIndex((i) => /facts that establish reasonable cause/i.test(i.s));
const declY = findY(/penalties of perjury/i);

// Keep the first section heading legible. It sits on the line immediately after
// the intro, so it is taken positionally rather than by matching its wording,
// which would break the moment the heading is reworded. Showing it costs
// nothing (it names the topic, not the argument) and it lets a reader see the
// letter is organised into sections rather than being one undifferentiated block.
const heading = introIdx >= 0 ? items[introIdx + 1] : null;
const startAfter = heading ? heading.y : null;
if (heading) console.log('first section heading kept visible:', JSON.stringify(heading.s));

if (startAfter == null || declY == null) {
  throw new Error(
    'Could not locate the argument region in the letter. The intro or the ' +
    'perjury declaration wording changed, or the intro is now the last line on ' +
    'the page; update the matchers before shipping, do NOT fall back to fixed ' +
    'pixel offsets.',
  );
}

const top = startAfter + 14 * SCALE;
const bottom = declY - 12 * SCALE;
if (bottom <= top) throw new Error('Argument region resolved to an empty or inverted band.');

// Obscure by pixelating rather than drawing a box over it: the page still reads
// as a dense body of prose, so the reader sees a real document, but no word is
// recoverable. A blur can sometimes be partially inverted; downsampling to
// blocks and scaling back up discards the information outright.
const bandH = Math.ceil(bottom - top);
const BLOCK = 7;
const small = createCanvas(Math.ceil(canvas.width / BLOCK), Math.ceil(bandH / BLOCK));
const sctx = small.getContext('2d');
sctx.imageSmoothingEnabled = true;
sctx.drawImage(canvas, 0, top, canvas.width, bandH, 0, 0, small.width, small.height);
ctx.imageSmoothingEnabled = false;
ctx.drawImage(small, 0, 0, small.width, small.height, 0, top, canvas.width, bandH);
ctx.imageSmoothingEnabled = true;

// Wash the band back toward the page so it reads as withheld, not damaged.
ctx.fillStyle = 'rgba(255,255,255,0.45)';
ctx.fillRect(0, top, canvas.width, bandH);

// Label it, so nobody mistakes the obscuring for a rendering fault.
ctx.save();
ctx.font = `600 ${Math.round(canvas.width / 42)}px sans-serif`;
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillStyle = 'rgba(30,41,59,0.72)';
ctx.fillText('Full reasoning provided with your filing', canvas.width / 2, top + bandH / 2);
ctx.restore();

// Same diagonal watermark as the forms.
ctx.save();
ctx.translate(canvas.width / 2, canvas.height / 2);
ctx.rotate(-Math.PI / 6);
ctx.font = `bold ${Math.round(canvas.width / 6)}px sans-serif`;
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillStyle = 'rgba(180, 30, 30, 0.16)';
ctx.fillText('SAMPLE', 0, 0);
ctx.restore();

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'sample-rcl.webp'), canvas.toBuffer('image/webp', 82));
console.log(`wrote sample-rcl.webp ${canvas.width}x${canvas.height}, obscured band ${Math.round(top)}-${Math.round(bottom)}`);
