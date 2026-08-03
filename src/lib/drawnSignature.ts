/**
 * Drawn signature support.
 *
 * A drawn signature is a PNG the filer produces with a finger or a stylus on a
 * canvas. It is passed to `generateFilingPackage` as an option and used for the
 * duration of that call only.
 *
 * WHY AN OPTION AND NOT A COLUMN
 *
 * Putting the image on the filing record would mean a storage bucket, an RLS
 * policy, a retention policy, and a rewrite of the "we never store your
 * documents" privacy claim, all to hold something the filer can redraw in two
 * seconds. Passing it as an option keeps the claim true: the image exists in
 * the tab that drew it, goes into the PDF, and is never sent anywhere. Do not
 * "improve" this by persisting it.
 *
 * WHY IT IS LEGAL
 *
 * IRM 10.10.1.3.1.1 lists, as acceptable electronic signatures, a typed name, a
 * signature captured on a signature pad, and "a handwritten mark input on a
 * display screen with a stylus device". A drawn mark is the third of these. The
 * typed name the product already uses is the first, so neither form is legally
 * superior to the other; this exists because a penalties-of-perjury statement
 * reads as a signed document to a human reviewer, not because typing is
 * insufficient.
 *
 * IRM 10.10.1.3.1 sets five requirements. This module satisfies the first
 * (form). The other four are the caller's responsibility and are documented at
 * the call sites:
 *   - intent to sign: an explicit on-screen notice before the filer draws
 *   - attachment to the specific record: never a reusable asset, redrawn per
 *     filing, which the option-not-column design enforces by construction
 *   - signer identification: the Supabase session
 *   - integrity: if a filing is edited after signing, the signature must be
 *     invalidated and recollected. See SIGNATURE_INVALIDATING_FIELDS below.
 */

import { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';

/**
 * A drawn signature, as a PNG data URL produced by a canvas.
 *
 * PNG specifically, not JPEG: a signature is a few dark strokes on nothing, so
 * it needs the alpha channel to sit over the form's ruled line. A JPEG would
 * paint an opaque white box over whatever it covers.
 */
export type DrawnSignature = string;

/** 2 MB of base64. A canvas signature is a few KB; anything near this is wrong. */
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

const PNG_DATA_URL = /^data:image\/png;base64,/;

export interface SignatureRejection {
  reason: 'not-a-png-data-url' | 'too-large' | 'undecodable' | 'not-an-image';
}

/**
 * Turn a PNG data URL into bytes, or return null with a reason.
 *
 * Returns null rather than throwing on every failure path. A bad signature must
 * degrade to the typed name, which is itself a valid signature, rather than
 * cost the filer their package. The one thing that must NOT happen silently is
 * the fax path transmitting an unsigned jurat, and that is enforced separately
 * by assertSignableByFax().
 */
export const decodeDrawnSignature = (
  value: DrawnSignature | null | undefined,
): { bytes: Uint8Array } | { rejected: SignatureRejection } => {
  if (!value || typeof value !== 'string') return { rejected: { reason: 'not-an-image' } };
  if (!PNG_DATA_URL.test(value)) return { rejected: { reason: 'not-a-png-data-url' } };

  const base64 = value.slice(value.indexOf(',') + 1);
  // Base64 is 4 characters per 3 bytes, so this bounds the decoded size without
  // decoding first.
  if ((base64.length * 3) / 4 > MAX_SIGNATURE_BYTES) return { rejected: { reason: 'too-large' } };

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // PNG magic number. Guards against a mislabelled data URL.
    if (
      bytes.length < 8 ||
      bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
    ) {
      return { rejected: { reason: 'not-an-image' } };
    }
    return { bytes };
  } catch {
    return { rejected: { reason: 'undecodable' } };
  }
};

/**
 * Embed the signature into `doc`, or return null if it cannot be used.
 *
 * Embedding is per-document: a PDFImage belongs to the PDFDocument that
 * embedded it and cannot be drawn onto a page of another one.
 */
export const embedDrawnSignature = async (
  doc: PDFDocument,
  value: DrawnSignature | null | undefined,
): Promise<PDFImage | null> => {
  const decoded = decodeDrawnSignature(value);
  if ('rejected' in decoded) return null;
  try {
    return await doc.embedPng(decoded.bytes);
  } catch {
    return null;
  }
};

/**
 * Draw `image` inside the box (x, y, maxWidth, maxHeight), scaled to fit and
 * anchored bottom-left, preserving aspect ratio.
 *
 * Never upscales. A signature drawn on a small phone canvas blown up to a
 * 200pt box looks like a fax artefact, and on a penalties-of-perjury document
 * that is worth avoiding.
 */
export const drawSignatureInBox = (
  page: PDFPage,
  image: PDFImage,
  box: { x: number; y: number; maxWidth: number; maxHeight: number },
): { width: number; height: number } => {
  const scale = Math.min(box.maxWidth / image.width, box.maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: box.x, y: box.y, width, height });
  return { width, height };
};

/**
 * Fields whose change must invalidate a previously collected signature.
 *
 * This is the integrity requirement of IRM 10.10.1.3.1, and it collides with
 * the post-payment corrections allowed by the paid-filing lock: a filer who
 * signs, then corrects a figure, has signed a document that no longer exists.
 *
 * Consumed by the UI, which must clear the drawn signature and ask for it again
 * whenever one of these changes. Kept here, next to the legal reasoning, rather
 * than in a component, so the list is not quietly edited by someone who does
 * not know why it exists.
 */
export const SIGNATURE_INVALIDATING_FIELDS = [
  'llc_name',
  'ein',
  'tax_year',
  'signer_title',
  'signature_date',
  'final_return',
  'date_of_closure',
  'owner',
  'related_parties',
  'transactions',
] as const;

/**
 * Guard for the fax path.
 *
 * On the mail path a missing signature is recoverable: the filer prints the
 * package and pens it in. On the fax path there is no hand between the PDF and
 * Ogden, so a package with a blank signature line would be transmitted, would
 * report as delivered, and would arrive as a penalties-of-perjury declaration
 * that nobody signed.
 *
 * Returns the reason it is not faxable, or null when it is.
 */
export const faxSignatureBlocker = (args: {
  ownerFullName: string | null | undefined;
  drawnSignature?: DrawnSignature | null;
  includesRCL: boolean;
}): string | null => {
  const typed = (args.ownerFullName ?? '').trim();
  const drawn = args.drawnSignature ? !('rejected' in decodeDrawnSignature(args.drawnSignature)) : false;

  if (!typed && !drawn) {
    return args.includesRCL
      ? 'The reasonable cause statement is signed under penalties of perjury and this package has no signature on it. Add the signer name, or draw a signature, before faxing.'
      : 'This package has no signature on it. Add the signer name, or draw a signature, before faxing.';
  }
  return null;
};
