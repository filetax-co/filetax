/**
 * rasterSamplePreview - turn the sample PDFs from genSamplePreview.mjs into
 * watermarked PNGs for the marketing site's /services page.
 *
 *   node scripts/rasterSamplePreview.mjs
 *
 * PNG rather than the PDF itself for two reasons: it renders inline without
 * the browser's PDF viewer taking over the page, and there is no text layer to
 * lift. A diagonal SAMPLE watermark is burned in so a page saved from the site
 * cannot be mistaken for a filing.
 *
 * Only page 1 of each form is rendered. This is a marketing thumbnail, not the
 * in-product pre-payment preview, which is a separate piece of work.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const samplesDir = path.resolve(here, '../../../FileTax/filetax/public/samples');

// Point at the real worker file on disk. An empty workerSrc makes pdfjs fall
// back to a "fake worker" that it then refuses to set up.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
// Must stay a file:// URL string: on Windows the ESM loader rejects a bare
// absolute path, reading the drive letter as an unknown protocol.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href;

/** Render page 1 at `scale` and burn in a diagonal watermark. */
const render = async (pdfPath, outPath, scale = 2) => {
  const data = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjs.getDocument({
    data,
    disableFontFace: true,
    // Without this the base-14 fonts the filled field values use (Helvetica ->
    // LiberationSans) silently fail to load and pdfjs substitutes a fallback,
    // which makes correct output look wrong: letters render widely spaced and
    // nothing like the printed PDF. Must be a filesystem PATH with a trailing
    // separator, not a file:// URL, or the node font factory cannot read it.
    standardFontDataUrl:
      path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts').replace(/\\/g, '/') + '/',
  }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.font = `bold ${Math.round(canvas.width / 6)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(180, 30, 30, 0.16)';
  ctx.fillText('SAMPLE', 0, 0);
  ctx.restore();

  // WebP, not PNG. These are full-page document rasters: as PNG they came to
  // ~600 KB each, which would have put 1.4 MB of images on /services and undone
  // the image-optimisation pass that took the favicon from 125 KB to 0.8 KB and
  // the logos from 61 KB to 2 KB. WebP at q82 is visually identical on flat
  // black-on-white text and roughly a twentieth of the size.
  await writeFile(outPath, canvas.toBuffer('image/webp', 82));
  console.log('wrote', path.basename(outPath), `${canvas.width}x${canvas.height}`);
};

await render(path.join(samplesDir, 'sample-5472.pdf'), path.join(samplesDir, 'sample-5472.webp'));
await render(path.join(samplesDir, 'sample-1120.pdf'), path.join(samplesDir, 'sample-1120.webp'));
