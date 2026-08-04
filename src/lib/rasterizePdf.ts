/**
 * rasterizePdf - turn generated PDF bytes into watermarked page images for the
 * pre-payment draft preview.
 *
 * WHY IMAGES AND NOT THE PDF ITSELF
 *
 * The filer has not paid yet. Serving the PDF in an iframe hands over a clean,
 * printable, text-extractable copy of the whole product in two clicks, and it
 * also lets the browser's PDF viewer take over the panel, which is the thing
 * PdfPreviewModal was written to avoid. A raster has no text layer to lift, no
 * clean print, and the DRAFT watermark is burned into the pixels rather than
 * being an overlay a reader can delete.
 *
 * This is deliberately NOT protection in the cryptographic sense. A determined
 * person can retype the numbers off the screen. The point is that what they can
 * take is a picture marked DRAFT, not a filing.
 *
 * The Node equivalent for the marketing thumbnails is scripts/
 * rasterSamplePreview.mjs. Both burn their watermark in at render time; keep
 * the two in step if that treatment changes.
 */

export interface RasterPage {
  /** PNG data URL of the rendered page. */
  src: string;
  width: number;
  height: number;
  /** True when part of this page was obscured because it sits behind the paywall. */
  gated: boolean;
}

export interface RasterizeOptions {
  /**
   * Render scale. Defaults to `defaultScale()`, which accounts for the display.
   *
   * Pass a number only to pin it, for a test or a fixture.
   */
  scale?: number;
  /** Burned-in diagonal watermark. */
  watermark?: string;
  /**
   * Obscure the ARGUMENT of a reasonable cause letter, leaving its structure
   * visible. Used for that letter and nothing else.
   *
   * The band is found by reading the text layer, never by fixed offsets: it
   * runs from the end of the intro to the start of the perjury declaration, so
   * the letterhead, the IRS address block, the RE line, the opening, the
   * section heading, the declaration and the signature all stay legible. What
   * sells the letter was never the argument, it is proof that a properly
   * structured one exists, addressed to the service centre that will read it.
   *
   * Kept in step with scripts/genSampleRcl.mjs, which does the same thing for
   * the marketing sample. Change one and change the other.
   */
  gateArgument?: boolean;
  /** Called after each page renders, for a progress line. */
  onPage?: (done: number, total: number) => void;
}

/**
 * Render scale for this display.
 *
 * The preview is shown at `width: 100%` in a modal, so the pixels the browser
 * needs are CSS width TIMES devicePixelRatio. Rendering at a flat 1.5 gave a
 * 918px-wide page, which a 2x display upscales to fill an 800px column, and
 * upscaled 8pt form text is exactly as soft as it sounds. This is the single
 * most reported complaint about the preview.
 *
 * Capped at 3. Beyond that the gain is invisible and the cost is not: each page
 * is held as a PNG data URL for the life of the modal, and a ten-year catch-up
 * package is a lot of pages on a phone. A 3x Letter page is 1836x2376.
 */
export function defaultScale(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(3, Math.max(1.5, 1.5 * dpr));
}

type PdfjsModule = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * Load pdf.js once, lazily. It is a large dependency and the overwhelming
 * majority of sessions never open the preview, so it must not sit in the main
 * bundle.
 */
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Vite resolves this to a hashed asset URL at build time. Without a
      // worker, pdf.js falls back to a "fake worker" it then refuses to set up.
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** Burn the diagonal watermark across a rendered page. */
function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.font = `bold ${Math.round(w / 5)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Light enough to read the form through, heavy enough that nobody mistakes a
  // screenshot of this for the real thing.
  ctx.fillStyle = 'rgba(180, 30, 30, 0.18)';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * Obscure a horizontal band by PIXELATING it, and label it.
 *
 * Downsample and scale back up, rather than blur. A blur is a convolution and
 * can be partially inverted; downsampling to blocks discards the information
 * outright. The band is then washed back toward the page so it reads as
 * withheld rather than damaged, and labelled so nobody reports it as a
 * rendering fault.
 */
function obscureBand(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  top: number,
  bottom: number,
  label: string,
) {
  const h = Math.ceil(bottom - top);
  if (h <= 0) return;
  // Proportional to the page, NOT a fixed pixel count. A fixed 7 was tuned at
  // one render scale, and raising the scale would have made the blocks finer
  // relative to the text, quietly handing back some of the argument this is
  // here to withhold. 7/918 is that original coarseness, held at any scale.
  const BLOCK = Math.max(7, Math.round(canvas.width / 131));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.ceil(canvas.width / BLOCK));
  small.height = Math.max(1, Math.ceil(h / BLOCK));
  const sctx = small.getContext('2d');
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(canvas, 0, top, canvas.width, h, 0, 0, small.width, small.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, 0, top, canvas.width, h);
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(0, top, canvas.width, h);

  ctx.save();
  ctx.font = `600 ${Math.round(canvas.width / 40)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(30,41,59,0.72)';
  ctx.fillText(label, canvas.width / 2, top + h / 2);
  ctx.restore();
}

interface TextY { s: string; y: number }

/**
 * Where the argument sits on this page of the letter, in viewport pixels.
 *
 * Read off the text layer so a wording change cannot silently expose the
 * argument, and so the perjury declaration and signature are never obscured.
 *
 * When the matchers find nothing, this obscures MORE rather than less: the
 * whole page below its top eighth. genSampleRcl.mjs throws in that case, which
 * is right for a build script an engineer is watching. A filer mid-purchase
 * cannot act on an exception, and the failure that must never happen is
 * showing the argument for free.
 */
function argumentBand(
  items: TextY[],
  pageIndex: number,
  height: number,
  scale: number,
): { top: number; bottom: number } {
  const introIdx = items.findIndex((i) => /facts that establish reasonable cause/i.test(i.s));
  const declY = items.find((i) => /penalties of perjury/i.test(i.s))?.y ?? null;

  // The first section heading sits on the line after the intro. Keeping it
  // costs nothing (it names the topic, not the argument) and shows the letter
  // is organised into sections rather than one undifferentiated block.
  const heading = introIdx >= 0 ? items[introIdx + 1] : null;

  // Same clearances as genSampleRcl.mjs (14pt below the heading, 12pt above
  // the declaration), expressed in render pixels so they hold at any scale.
  const top = heading ? heading.y + 14 * scale : (pageIndex === 0 ? height * 0.34 : height * 0.06);
  const bottom = declY != null ? declY - 12 * scale : height * 0.94;
  if (bottom <= top) return { top: height * 0.12, bottom: height * 0.94 };
  return { top, bottom };
}

/**
 * Render every page of a PDF to a watermarked PNG data URL.
 *
 * Throws if pdf.js cannot parse the bytes. Callers show that as a preview
 * failure and leave the filing untouched: nothing here writes anything.
 */
export async function rasterizePdf(
  bytes: Uint8Array,
  opts: RasterizeOptions = {},
): Promise<RasterPage[]> {
  const { scale = defaultScale(), watermark = 'DRAFT', gateArgument = false, onPage } = opts;
  const pdfjs = await loadPdfjs();

  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given and detaches it, which
    // would empty the caller's package. Hand it a copy.
    data: new Uint8Array(bytes),
    // Where the base-14 font data lives. scripts/copyPdfjsAssets.mjs puts it
    // there; without it the filled values render widely spaced and wrong.
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  });
  const doc = await task.promise;

  const pages: RasterPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser could not render the preview.');

      // IRS forms are drawn without a background of their own.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      if (gateArgument) {
        const content = await page.getTextContent();
        const items: TextY[] = content.items
          .flatMap((i) => ('str' in i && i.str.trim() ? [{ item: i, s: i.str.trim() }] : []))
          .map(({ item, s }) => {
            const [, , , , x, y] = item.transform as number[];
            return { s, y: viewport.convertToViewportPoint(x, y)[1] };
          })
          .sort((a, b) => a.y - b.y);
        const { top, bottom } = argumentBand(items, n - 1, canvas.height, scale);
        obscureBand(canvas, ctx, top, bottom, 'Full reasoning provided with your filing');
      }
      drawWatermark(ctx, canvas.width, canvas.height, watermark);

      pages.push({
        src: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        gated: gateArgument,
      });
      onPage?.(n, doc.numPages);
      page.cleanup();
    }
  } finally {
    // Tears down the worker's copy of the document. Without it a filer who
    // opens the preview on each of four catch-up years keeps four parsed
    // packages alive in the worker for the life of the tab.
    await task.destroy();
  }
  return pages;
}
