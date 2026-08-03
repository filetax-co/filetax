/**
 * verifyTypedSignature - proves, from the produced PDF bytes, that the typed
 * name is rendered in the script face, that a name the face cannot render falls
 * back to the plain typed name instead of printing blanks, and that a drawn
 * mark still wins over both.
 *
 *   node scripts/verifyTypedSignature.mjs
 *
 * Exercises src/lib/typedSignature.ts itself rather than a copy: the module is
 * bundled with esbuild (already present as a Vite dependency) to CommonJS with
 * pdf-lib left external, because this repo's Node cannot import pdf-lib's named
 * exports through plain ESM. fetch is pointed at public/ on disk so the real
 * font-loading path runs unmodified.
 */

import { readFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// Serve public/ to the module's fetch() calls.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const m = String(url).match(/(fonts|pdf)\/([^/?#]+)$/);
  if (m) {
    const buf = await readFile(path.join(root, 'public', m[1], m[2]));
    return new Response(buf, { status: 200 });
  }
  return realFetch(url, init);
};

const esbuild = require('esbuild');
// Inside the repo, not the system temp directory, so the bundle's external
// 'pdf-lib' require still resolves against node_modules.
const outDir = path.join(root, 'node_modules', '.cache', 'verifyTypedSignature');
const outFile = path.join(outDir, 'typedSignature.cjs');
await mkdir(outDir, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'src/lib/typedSignature.ts')],
  outfile: outFile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['pdf-lib'],
  logLevel: 'error',
});

const {
  embedSignatureFont,
  signatureFaceCovers,
  canRenderTypedSignature,
  drawTypedSignatureInBox,
  drawTypedSignatureOverField,
} = require(outFile);
const { PDFDocument, PDFTextField } = require('pdf-lib');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `\n        ${detail}` : ''}`);
};

/**
 * Whether the saved file carries the script face.
 *
 * Saved WITHOUT object streams: pdf-lib compresses object dictionaries into
 * object streams by default, which hides /BaseFont from a byte scan and would
 * make every one of these checks report a false negative.
 */
const hasScript = async (doc) => {
  const text = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
  return [...text.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_]+)/g)]
    .some((m) => /DancingScript/i.test(m[1]));
};

// ── 1. the face embeds and reports its coverage honestly ─────────────────────
{
  check('renders a Latin name', await signatureFaceCovers('Jean-Luc Picard'));
  check('renders an accented Latin name', await signatureFaceCovers('José Álvarez'));
  check('refuses a Cyrillic name', !(await signatureFaceCovers('Ольга Иванова')));
  check('refuses a CJK name', !(await signatureFaceCovers('山田太郎')));
  check('refuses an empty name', !(await signatureFaceCovers('   ')));

  const doc = await PDFDocument.create();
  const font = await embedSignatureFont(doc, 'Jean-Luc Picard');
  check('script face embeds from the woff', !!font);
  check('and its embedded form agrees on coverage',
    font && canRenderTypedSignature(font, 'Jean-Luc Picard'));
  // The costly half of the coverage guard: an unrenderable name must not leave
  // an unused font object behind in a document that never draws from it.
  const declined = await PDFDocument.create();
  check('an unrenderable name is refused before the face is embedded',
    (await embedSignatureFont(declined, 'Ольга Иванова')) === null);
  check('and leaves no font in that document', !(await hasScript(declined)));
}

// ── 2. drawing into a free box ───────────────────────────────────────────────
{
  const doc = await PDFDocument.create();
  const font = await embedSignatureFont(doc, 'Ana Ruiz');
  const page = doc.addPage();
  const box = { x: 72, y: 200, maxWidth: 200, maxHeight: 34 };

  const short = drawTypedSignatureInBox(page, font, 'Ana Ruiz', box);
  check('draws a short name', !!short);
  check('short name is capped, not blown up to fill the box', short && short.size <= 28,
    short && `size ${short.size}`);
  check('short name fits the box', short && short.width <= box.maxWidth,
    short && `width ${short.width?.toFixed(1)} > ${box.maxWidth}`);

  const long = drawTypedSignatureInBox(page, font, 'Bartholomew Featherstonehaugh-Wickersham', box);
  check('long name fits the box', long && long.width <= box.maxWidth + 0.5,
    long && `width ${long.width?.toFixed(1)} > ${box.maxWidth}`);
  check('long name stays legible', long && long.size >= 7, long && `size ${long.size?.toFixed(1)}`);

  check('a Cyrillic name draws nothing rather than blanks',
    drawTypedSignatureInBox(page, font, 'Ольга Иванова', box) === null);

  check('the script face reaches the saved file', await hasScript(doc));
}

// ── 3. drawing over the real Form 1120 signature field ───────────────────────
// Form-1120-2025.pdf uses the canonical page-1 schema (getF1120Map(2025) ->
// F1120_FALLBACK), whose signature field is plainly named 'Signature'.
const OFFICER_FIELD = 'Signature';
const template = await readFile(path.join(root, 'public/pdf/Form-1120-2025.pdf')).catch(() => null);

if (!template) {
  console.log('SKIP  Form-1120-2025.pdf not in public/pdf, field test not run');
} else {
  const fieldValue = async (doc) => {
    const f = doc.getForm().getField(OFFICER_FIELD);
    return f instanceof PDFTextField ? f.getText() ?? '' : null;
  };

  // A renderable name: the field is cleared and the script face carries it.
  {
    const doc = await PDFDocument.load(template);
    doc.getForm().getField(OFFICER_FIELD).setText('Jean-Luc Picard');
    const ok = await drawTypedSignatureOverField(doc, OFFICER_FIELD, 'Jean-Luc Picard');
    check('1120: script signature is drawn over the field', ok === true);
    check('1120: the typed field is cleared so the box carries one mark', (await fieldValue(doc)) === '');
    check('1120: the script face reaches the saved file', await hasScript(doc));
  }

  // A name the face cannot render: whatever setText() put on the signature line
  // must survive untouched. The field is seeded with what production actually
  // holds for such a filer, the WinAnsi-stripped value toFormText() produces,
  // because seeding it with the raw Cyrillic would instead exercise pdf-lib's
  // WinAnsi encoder, which is a different guard living in pdfGenerator.ts.
  {
    const doc = await PDFDocument.load(template);
    doc.getForm().getField(OFFICER_FIELD).setText('Olga Ivanova (transliterated)');
    const ok = await drawTypedSignatureOverField(doc, OFFICER_FIELD, 'Ольга Иванова');
    check('1120: an unrenderable name is declined', ok === false);
    check('1120: and the typed signature line is left untouched',
      (await fieldValue(doc)) === 'Olga Ivanova (transliterated)');
    check('1120: with no script face embedded', !(await hasScript(doc)));
  }

  // A field that does not exist must not throw.
  {
    const doc = await PDFDocument.load(template);
    check('1120: a missing field is declined, not thrown on',
      (await drawTypedSignatureOverField(doc, 'NoSuchField', 'Jean-Luc Picard')) === false);
  }
}

await rm(outDir, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
