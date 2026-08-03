/**
 * Typed signature support.
 *
 * A typed signature is the filer's name, rendered in a script face on the
 * signature line, the way a PDF editor renders a typed signature by default.
 * It is what the package uses when the filer leaves the signature pad blank.
 *
 * WHY THIS EXISTS
 *
 * The typed name has always been on the package; before this module it was
 * drawn in the same Helvetica as every other value, so it read as a filled
 * field rather than as a signature. Rendering it in a script face changes
 * nothing legally and everything visually: a human reviewer at Ogden sees a
 * document that looks signed.
 *
 * WHY IT IS THE FALLBACK AND NOT THE DEFAULT
 *
 * IRM 10.10.1.3.1.1 lists a typed name and a handwritten mark drawn on screen
 * as equally acceptable electronic signatures, so neither is legally superior.
 * The difference is evidential: a drawn mark is something the filer personally
 * made, while this is something the software drew, and anyone holding the same
 * name can produce byte-identical output. On a penalties-of-perjury document
 * carrying a $25,000 penalty that difference is worth preserving, so the pad
 * stays the default and this catches the filer who cannot draw one. Do not
 * "simplify" this by dropping the pad.
 *
 * WHY A WOFF AND NOT A TTF
 *
 * @fontsource ships woff/woff2 only. pdf-lib cannot read woff2, but fontkit
 * decompresses plain woff, so the woff is embedded directly and no TTF is
 * vendored. The face is Dancing Script, under the SIL Open Font License, which
 * permits embedding; the licence travels with the file in
 * public/fonts/signature-script-LICENSE.txt and must stay next to it.
 *
 * public/fonts/signature-script.woff is a byte-for-byte copy of
 * node_modules/@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff.
 * @fontsource/dancing-script is therefore a devDependency: it pins the source
 * of that copy and is how the file is refreshed, but nothing imports it and no
 * part of it reaches the bundle.
 *
 * WHAT THIS DOES NOT SOLVE
 *
 * Dancing Script covers Latin and Latin-1 only. It has no Cyrillic, Greek, CJK
 * or Indic glyphs, and fontkit does NOT throw on a missing glyph, it silently
 * maps to .notdef, which would print a signature line of empty boxes. Every
 * entry point below therefore checks coverage first and returns false when the
 * name will not render, leaving the caller's plain typed name in place. This is
 * the same population that toFormText() already reports as unsupported in
 * pdfGenerator.ts, and embedding a Unicode face for them is a separate job.
 */

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, PDFTextField, rgb } from 'pdf-lib';

/** Ink colour. Near-black rather than black, so it reads as ink and not as print. */
const SIGNATURE_INK = rgb(0.09, 0.12, 0.33);

/**
 * Resolved lazily and defensively. `import.meta.env` exists under Vite but not
 * under plain Node, where the verify scripts import this module directly, and
 * reading a property off the missing object would throw at module load and take
 * the whole generator with it.
 */
const fontUrl = (): string => {
  let base = '/';
  try {
    base = import.meta.env?.BASE_URL ?? '/';
  } catch {
    /* not running under Vite */
  }
  return `${base}fonts/signature-script.woff`;
};

/**
 * The font file, fetched once per tab.
 *
 * Cached as the in-flight promise, not the bytes, so a package with several
 * years in it issues one request rather than one per document. A failed fetch
 * clears the cache so the next package retries instead of inheriting the
 * failure for the life of the tab.
 */
let fontBytesPromise: Promise<ArrayBuffer> | null = null;

const loadFontBytes = async (): Promise<ArrayBuffer> => {
  if (!fontBytesPromise) {
    fontBytesPromise = (async () => {
      const url = fontUrl();
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch signature font: ${url} (${resp.status})`);
      return resp.arrayBuffer();
    })().catch((err) => {
      fontBytesPromise = null;
      throw err;
    });
  }
  return fontBytesPromise;
};

/**
 * The face parsed standalone, for coverage questions.
 *
 * Kept separate from any PDFDocument so "can this name be rendered?" can be
 * answered BEFORE embedding. Asking a PDFFont instead would mean embedding the
 * face into every package first, including the ones that then decline to use
 * it, leaving an unused font object in a document that never draws a glyph
 * from it.
 */
interface CoverageFont { hasGlyphForCodePoint?: (cp: number) => boolean }
let coverageFontPromise: Promise<CoverageFont | null> | null = null;

const loadCoverageFont = async (): Promise<CoverageFont | null> => {
  if (!coverageFontPromise) {
    coverageFontPromise = (async () => {
      try {
        const bytes = await loadFontBytes();
        return (fontkit as unknown as { create: (b: Uint8Array) => CoverageFont })
          .create(new Uint8Array(bytes));
      } catch {
        return null;
      }
    })();
  }
  return coverageFontPromise;
};

/**
 * Whether the script face has a glyph for every character in `name`.
 *
 * The guard that keeps a Cyrillic or CJK name off the signature line as a row
 * of blank boxes: fontkit does not throw on a missing glyph, it maps silently
 * to .notdef. Answers false whenever the font or the coverage API is
 * unavailable, so an unexpected shape leaves the plain typed name standing,
 * which is the safe direction to fail in.
 */
export const signatureFaceCovers = async (name: string | null | undefined): Promise<boolean> => {
  const value = (name ?? '').trim();
  if (!value) return false;
  const font = await loadCoverageFont();
  if (typeof font?.hasGlyphForCodePoint !== 'function') return false;
  for (const ch of value.normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || !font.hasGlyphForCodePoint(cp)) return false;
  }
  return true;
};

/**
 * Embed the script face into `doc` for `name`, or return null if it cannot be
 * used for that name.
 *
 * Per-document, like embedDrawnSignature: a PDFFont belongs to the document
 * that embedded it. Subset, so only the glyphs of the name that was actually
 * signed travel in the package (a few hundred bytes, not 29 KB).
 *
 * Takes the name so coverage decides whether to embed at all. Returns null
 * rather than throwing on every failure path: a missing font must degrade to
 * the plain typed name, which is itself a valid signature, rather than cost
 * the filer their package.
 */
export const embedSignatureFont = async (
  doc: PDFDocument,
  name: string | null | undefined,
): Promise<PDFFont | null> => {
  if (!(await signatureFaceCovers(name))) return null;
  try {
    const bytes = await loadFontBytes();
    doc.registerFontkit(fontkit);
    return await doc.embedFont(bytes, { subset: true });
  } catch {
    return null;
  }
};

/**
 * The synchronous twin of signatureFaceCovers(), asked of an already-embedded
 * font so the drawing path below can guard without being async.
 *
 * Belt and braces: embedSignatureFont() has already refused to embed for a
 * name it cannot render, so this should never be the thing that says no. It
 * exists so a caller that reuses one embedded font across several names, which
 * nothing does today, cannot print blanks. Reaches through PDFFont to the
 * underlying fontkit font because pdf-lib exposes no coverage API of its own;
 * an unexpected shape returns false and the plain typed name stands.
 */
export const canRenderTypedSignature = (font: PDFFont, text: string): boolean => {
  const value = (text ?? '').trim();
  if (!value) return false;
  const inner = (font as unknown as {
    embedder?: { font?: { hasGlyphForCodePoint?: (cp: number) => boolean } };
  }).embedder?.font;
  if (typeof inner?.hasGlyphForCodePoint !== 'function') return false;
  for (const ch of value.normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || !inner.hasGlyphForCodePoint(cp)) return false;
  }
  return true;
};

/**
 * Draw `text` as a signature inside the box (x, y, maxWidth, maxHeight),
 * anchored bottom-left, and return the size it was drawn at, or null if it
 * could not be drawn.
 *
 * Sized to fill the box and then shrunk to fit the width, so a long name stays
 * inside the ruled line instead of running off it. Never larger than
 * `maxSize`: a two-letter name scaled to a 34pt box would print as a monogram.
 * Never smaller than MIN_SIZE, because a name squeezed below legibility is
 * worse than one that slightly overhangs its box.
 */
const MIN_SIZE = 7;

export const drawTypedSignatureInBox = (
  page: PDFPage,
  font: PDFFont,
  text: string,
  box: { x: number; y: number; maxWidth: number; maxHeight: number; maxSize?: number },
): { size: number; width: number } | null => {
  const value = (text ?? '').trim().normalize('NFC');
  if (!value || !canRenderTypedSignature(font, value)) return null;

  try {
    // Dancing Script's ascenders and descenders are tall relative to its
    // x-height, so heightAtSize (which spans both) is what has to fit the box,
    // not the cap height.
    const cap = box.maxSize ?? 28;
    let size = Math.min(cap, (box.maxHeight * cap) / Math.max(font.heightAtSize(cap), 1));
    const width = font.widthOfTextAtSize(value, size);
    if (width > box.maxWidth) size = Math.max(MIN_SIZE, (size * box.maxWidth) / width);

    // Sit the baseline above the bottom of the box by the descender depth, so
    // the tail of a "g" or "y" lands inside the box rather than under it.
    const descent = font.heightAtSize(size) - font.heightAtSize(size, { descender: false });
    page.drawText(value, {
      x: box.x,
      y: box.y + descent,
      size,
      font,
      color: SIGNATURE_INK,
    });
    return { size, width: font.widthOfTextAtSize(value, size) };
  } catch {
    return null;
  }
};

/**
 * Render `text` as a signature over the AcroForm field `fieldName`.
 *
 * Mirrors drawSignatureOverField() in pdfGenerator.ts, including finding the
 * page that actually carries the widget rather than assuming page 1, and
 * clearing the field so the box carries one mark and not two. Returns false
 * when anything is missing, in which case the caller's setText() value stands.
 */
export const drawTypedSignatureOverField = async (
  doc: PDFDocument,
  fieldName: string,
  text: string,
  font?: PDFFont | null,
): Promise<boolean> => {
  const value = (text ?? '').trim();
  if (!fieldName || !value) return false;

  try {
    const scriptFont = font ?? (await embedSignatureFont(doc, value));
    if (!scriptFont || !canRenderTypedSignature(scriptFont, value)) return false;

    const field = doc.getForm().getField(fieldName);
    if (!(field instanceof PDFTextField)) return false;

    const widget = field.acroField.getWidgets()[0];
    if (!widget) return false;
    const rect = widget.getRectangle();

    const pages = doc.getPages();
    const page =
      pages.find((p) => {
        const annots = p.node.Annots();
        if (!annots) return false;
        for (let i = 0; i < annots.size(); i++) {
          if (annots.get(i) === widget.dict || annots.lookup(i) === widget.dict) return true;
        }
        return false;
      }) ?? pages[0];
    if (!page) return false;

    const pad = 1;
    const drawn = drawTypedSignatureInBox(page, scriptFont, value, {
      x: rect.x + pad,
      y: rect.y + pad,
      maxWidth: Math.max(rect.width - pad * 2, 1),
      maxHeight: Math.max(rect.height - pad * 2, 1),
      // The 1120 signature box is short and wide. Capping at the box height
      // keeps the script from overprinting the ruled line above it.
      maxSize: 16,
    });
    if (!drawn) return false;

    // Clear the typed name only once the script rendering has succeeded, so a
    // failure can never leave the signature line blank.
    field.setText('');
    return true;
  } catch {
    return false;
  }
};
