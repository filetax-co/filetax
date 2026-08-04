/**
 * DraftPreviewModal - the pre-payment look at the filer's own forms.
 *
 * The single most common question from people who did not buy was whether they
 * can see the forms before paying. They can now: the real package, built from
 * their real answers, rendered as watermarked images.
 *
 * Three decisions worth keeping:
 *
 *   - THE FORMS ARE SHOWN COMPLETE, every page. An earlier idea was to crop to
 *     the top quarter of each page. The top of Form 5472 is the header and
 *     Part I: the filer's own name, address and EIN, which proves nothing about
 *     our work. What is worth paying for is Part IV and Part V, the numbers we
 *     computed and the line each one landed on. A crop hides exactly that, and
 *     the filer's own data was never ours to withhold.
 *   - THE REASONABLE CAUSE LETTER IS GATED, and it is the only thing that is.
 *     Its structure is visible, its argument is not. That letter is the line
 *     item a filer cannot write themselves.
 *   - IMAGES, NOT THE PDF. See rasterizePdf.ts.
 *
 * Rendering happens here rather than in the caller so the modal can show its
 * own progress: a 12-page package takes a couple of seconds on a phone, and a
 * blank panel in that gap reads as a broken button.
 */

import { useEffect, useRef, useState } from 'react';
import { Lock, X } from 'lucide-react';
import { rasterizePdf, type RasterPage } from '../lib/rasterizePdf';

export interface DraftDoc {
  key: string;
  /** Tab label, e.g. "Form 5472". */
  label: string;
  bytes: Uint8Array;
  /**
   * Obscure the letter's argument, leaving its structure legible. Set only on
   * the reasonable cause letter; every other document is shown in full.
   */
  gateArgument?: boolean;
  /** Shown under a gated document, explaining what is hidden and why. */
  gateNote?: string;
}

export function DraftPreviewModal({
  docs,
  onClose,
  taxYear,
}: {
  docs: DraftDoc[];
  onClose: () => void;
  taxYear?: string;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [activeKey, setActiveKey] = useState(docs[0]?.key ?? '');
  const [pagesByDoc, setPagesByDoc] = useState<Record<string, RasterPage[]>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = docs.find((d) => d.key === activeKey) ?? docs[0];
  const pages = active ? pagesByDoc[active.key] : undefined;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Render the selected document once, on demand. Switching tabs back to one
  // already rendered is instant; nothing re-rasterises.
  useEffect(() => {
    if (!active || pagesByDoc[active.key]) return;
    let cancelled = false;
    setError(null);
    setProgress('Preparing your forms…');
    rasterizePdf(active.bytes, {
      gateArgument: active.gateArgument,
      onPage: (done, total) => {
        if (!cancelled) setProgress(`Rendering page ${done} of ${total}…`);
      },
    })
      .then((rendered) => {
        if (cancelled) return;
        setPagesByDoc((prev) => ({ ...prev, [active.key]: rendered }));
        setProgress(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error(e);
        setProgress(null);
        setError('The preview could not be rendered. Your answers are saved and unaffected, so you can carry on and submit.');
      });
    return () => { cancelled = true; };
  }, [active, pagesByDoc]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Draft preview of your forms"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem 0.75rem',
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 'min(920px, 100%)', height: 'min(90vh, 100%)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--tf-surface, #fff)',
          borderRadius: '0.875rem', overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        }}
      >
        <header
          style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '0.875rem 1rem',
            borderBottom: '1px solid var(--tf-border, #e2e8f0)',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text, #0f172a)' }}>
              Your forms{taxYear ? `, tax year ${taxYear}` : ''}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--tf-muted, #64748b)', lineHeight: 1.45 }}>
              Prepared from your answers. Marked DRAFT until you submit.
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            type="button"
            aria-label="Close preview"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '44px', height: '44px', marginTop: '-0.35rem', marginRight: '-0.5rem',
              borderRadius: '0.5rem', border: 'none',
              background: 'transparent', color: 'var(--tf-muted, #64748b)', cursor: 'pointer',
            }}
          >
            <X size={20} />
          </button>
        </header>

        {docs.length > 1 && (
          // Horizontally scrollable rather than wrapping: three tabs do not fit
          // across a 375px phone, and a wrapped tab row pushes the document
          // itself below the fold on the screen where it is the whole point.
          <div
            role="tablist"
            aria-label="Documents in your package"
            style={{
              display: 'flex', gap: '0.25rem', padding: '0.5rem 0.75rem',
              borderBottom: '1px solid var(--tf-border, #e2e8f0)',
              overflowX: 'auto', flexShrink: 0,
            }}
          >
            {docs.map((d) => {
              const on = d.key === active?.key;
              return (
                <button
                  key={d.key}
                  role="tab"
                  aria-selected={on}
                  type="button"
                  onClick={() => setActiveKey(d.key)}
                  style={{
                    flexShrink: 0, minHeight: '40px', padding: '0 0.85rem',
                    borderRadius: '0.5rem', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: '0.8125rem', fontWeight: 600,
                    border: `1px solid ${on ? 'transparent' : 'var(--tf-border, #e2e8f0)'}`,
                    background: on ? 'var(--tf-accent, #0284c7)' : 'transparent',
                    color: on ? 'var(--tf-on-accent, #fff)' : 'var(--tf-text, #0f172a)',
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--tf-offset, #f1f5f9)', padding: '1rem 0.75rem' }}>
          {error && (
            <div className="cat-banner-red" style={{ margin: '0 auto', maxWidth: '640px' }}>{error}</div>
          )}

          {!error && !pages && (
            <p style={{ textAlign: 'center', color: 'var(--tf-muted, #64748b)', fontSize: '0.875rem', padding: '2rem 0' }}>
              {progress ?? 'Preparing your forms…'}
            </p>
          )}

          {pages?.map((p, i) => (
            <figure key={i} style={{ margin: '0 auto 1rem', maxWidth: '760px' }}>
              <img
                src={p.src}
                alt={`${active?.label}, page ${i + 1} of ${pages.length}, draft preview`}
                style={{
                  display: 'block', width: '100%', height: 'auto',
                  borderRadius: '0.375rem', border: '1px solid var(--tf-border, #e2e8f0)',
                  background: '#fff',
                }}
              />
              <figcaption style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--tf-muted, #64748b)', marginTop: '0.35rem' }}>
                Page {i + 1} of {pages.length}
              </figcaption>
            </figure>
          ))}

          {pages && active?.gateNote && (
            <p
              style={{
                margin: '0 auto', maxWidth: '640px',
                display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
                fontSize: '0.8125rem', lineHeight: 1.55, color: 'var(--tf-muted, #64748b)',
              }}
            >
              <Lock size={15} style={{ flexShrink: 0, marginTop: '0.15rem' }} aria-hidden="true" />
              <span>{active.gateNote}</span>
            </p>
          )}
        </div>

        <footer
          style={{
            flexShrink: 0, padding: '0.75rem 1rem',
            borderTop: '1px solid var(--tf-border, #e2e8f0)',
            display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
          }}
        >
          <p style={{ margin: 0, flex: '1 1 240px', fontSize: '0.78rem', lineHeight: 1.5, color: 'var(--tf-muted, #64748b)' }}>
            This is a draft for checking, not for filing. Nothing has been sent to the IRS.
            You sign and download the clean copies after you submit.
          </p>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: '44px', padding: '0 1.1rem', borderRadius: '0.5rem',
              border: 'none', background: 'var(--tf-accent, #0284c7)',
              color: 'var(--tf-on-accent, #fff)', fontWeight: 600, fontSize: '0.875rem',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Back to my answers
          </button>
        </footer>
      </div>
    </div>
  );
}

export default DraftPreviewModal;
