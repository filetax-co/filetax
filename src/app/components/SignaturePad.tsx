import { useCallback, useEffect, useRef, useState } from 'react';
import type { DrawnSignature } from '@/lib/drawnSignature';

/**
 * Draw-your-signature canvas.
 *
 * Scope, decided by the owner: the reasonable cause letter and the pro forma
 * 1120 signature line. Not Form 7004.
 *
 * The legal form requirement is satisfied by the drawn mark itself (IRM
 * 10.10.1.3.1.1). Of the other four requirements in IRM 10.10.1.3.1, two are
 * this component's job and are implemented here:
 *
 *   - INTENT TO SIGN. The notice above the canvas states what is being signed
 *     and that it is made under penalties of perjury, and it is shown BEFORE
 *     the filer draws, not after. Do not move it, collapse it into a tooltip,
 *     or soften the wording.
 *   - ATTACHMENT TO THE RECORD. The image is held in component state, handed to
 *     the generator for one call, and never uploaded or persisted. It is not a
 *     reusable asset that could be replayed onto a different filing.
 *
 * The remaining two are handled elsewhere: signer identification by the
 * Supabase session, and integrity by clearing the signature whenever the filing
 * changes (see SIGNATURE_INVALIDATING_FIELDS in lib/drawnSignature.ts).
 *
 * No dependency: pointer events onto a canvas, then toDataURL('image/png').
 * Pointer events rather than mouse+touch because they cover finger, stylus and
 * mouse in one code path, which matters when a large share of this audience is
 * on a phone.
 */

interface SignaturePadProps {
  /** Called with a PNG data URL when the drawing changes, or null when cleared. */
  onChange: (signature: DrawnSignature | null) => void;
  /** Name printed under the signature line, shown so the filer knows who they are signing as. */
  signerName?: string | null;
  /** What is being signed, e.g. "the reasonable cause statement and your Form 1120". */
  documentDescription?: string;
  disabled?: boolean;
}

// Canvas is sized in CSS pixels and scaled by devicePixelRatio for the backing
// store, otherwise the stroke is soft on every retina phone, which is most of
// this audience.
const CANVAS_CSS_HEIGHT = 160;
const STROKE_WIDTH = 2.2;

export function SignaturePad({
  onChange,
  signerName,
  documentDescription = 'your filing',
  disabled = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // Size the backing store to the element's real size at the current DPR.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Preserve whatever has been drawn across a resize (an orientation change
    // on a phone would otherwise silently wipe the signature).
    const previous = hasInk.current ? canvas.toDataURL('image/png') : null;

    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(CANVAS_CSS_HEIGHT * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';

    if (previous) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, CANVAS_CSS_HEIGHT);
      img.src = previous;
    }
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPoint.current = pointFromEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    const from = lastPoint.current;
    if (!ctx || !from) return;
    const to = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    lastPoint.current = to;
    hasInk.current = true;
    if (isEmpty) setIsEmpty(false);
  };

  const commit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(hasInk.current ? canvas.toDataURL('image/png') : null);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Capture already released, nothing to do.
    }
    commit();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    // clearRect works in the scaled space, so clear the full backing store.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasInk.current = false;
    setIsEmpty(true);
    onChange(null);
  };

  return (
    <div>
      {/*
        Intent to sign. This is a legal requirement, not UI copy. It must state
        what is being signed, and it must appear before the filer draws.
      */}
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--tf-text)',
          marginBottom: '0.5rem',
          lineHeight: 1.5,
        }}
      >
        By drawing your signature below, you are signing {documentDescription} under
        penalties of perjury. That means you are stating the information in it is true
        and correct to the best of your knowledge.
      </p>
      <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', marginBottom: '0.75rem' }}>
        Use your finger, a stylus, or your mouse. Nothing is sent to the IRS yet, and you
        can clear it and draw again as many times as you like.
      </p>

      <canvas
        ref={canvasRef}
        aria-label="Signature drawing area"
        role="img"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          width: '100%',
          height: CANVAS_CSS_HEIGHT,
          border: `1px ${isEmpty ? 'dashed' : 'solid'} var(--tf-border)`,
          borderRadius: '0.5rem',
          background: 'var(--tf-input-bg, var(--tf-surface))',
          // Without this, a finger drag scrolls the page instead of drawing.
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'crosshair',
          display: 'block',
          opacity: disabled ? 0.6 : 1,
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginTop: '0.5rem',
        }}
      >
        <span style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)' }}>
          {signerName ? `Signing as ${signerName}` : 'Sign above'}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || isEmpty}
          style={{
            // 44px minimum tap target, phone-first.
            minHeight: '44px',
            padding: '0 1rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--tf-border)',
            background: 'transparent',
            color: isEmpty ? 'var(--tf-muted)' : 'var(--tf-text)',
            fontSize: '0.875rem',
            cursor: disabled || isEmpty ? 'default' : 'pointer',
          }}
        >
          Clear and start again
        </button>
      </div>

      {isEmpty && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.5rem' }}>
          Drawing a signature is optional. If you leave this blank, your typed name is
          used instead, which the IRS also accepts.
        </p>
      )}
    </div>
  );
}

export default SignaturePad;
