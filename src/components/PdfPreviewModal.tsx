/**
 * PdfPreviewModal
 *
 * A contained preview of a generated PDF: a centred panel over a blurred page,
 * NOT a full-window document viewer. Embedding the PDF inline at full height
 * handed the whole screen to the browser's built-in viewer — toolbar, zoom
 * controls, thumbnail rail and all — so it read as though the app had been
 * replaced by Adobe. Here the document sits inside a panel with our own header,
 * and the filing page stays visible (blurred) behind it.
 *
 * Shared by the filing wizard and the download button so there is exactly one
 * preview treatment in the product.
 */

import { useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';

export interface PreviewTarget {
  /** Blob (or other) URL of the PDF to show. */
  url: string;
  /** Filename shown in the header and used for the download. */
  filename: string;
}

export function PdfPreviewModal({
  target,
  onClose,
  onDownload,
  title = 'Preview your complete filing',
  footnote,
}: {
  target: PreviewTarget;
  onClose: () => void;
  onDownload: () => void;
  title?: string;
  footnote?: string;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Return focus to whatever opened the modal, and stop the page behind it
    // from scrolling while it is up.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Only a click that starts AND ends on the backdrop closes it, so a drag
      // that began inside the document does not dismiss the panel.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem 1rem',
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 'min(920px, 100%)', height: 'min(88vh, 100%)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--tf-surface, #fff)',
          borderRadius: '0.875rem', overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        }}
      >
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.875rem 1rem',
            borderBottom: '1px solid var(--tf-border, #e2e8f0)',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text, #0f172a)' }}>
              {title}
            </div>
            <div
              style={{
                fontSize: '0.78rem', color: 'var(--tf-muted, #64748b)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {target.filename}
            </div>
          </div>
          <button
            onClick={onDownload}
            type="button"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.45rem 0.9rem', borderRadius: '0.5rem', border: 'none',
              background: 'var(--tf-accent, #0284c7)', color: 'var(--tf-on-accent, #fff)',
              fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Download size={15} />
            <span>Download PDF</span>
          </button>
          <button
            ref={closeRef}
            onClick={onClose}
            type="button"
            aria-label="Close preview"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0.35rem', borderRadius: '0.5rem', border: 'none',
              background: 'transparent', color: 'var(--tf-muted, #64748b)', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </header>

        <iframe
          title={title}
          // #view=FitH fits the page to the panel width instead of opening at
          // the viewer's own default zoom; toolbar/navpanes are hidden where
          // the browser honours them.
          src={`${target.url}#view=FitH&toolbar=0&navpanes=0`}
          style={{ flex: 1, width: '100%', border: 'none', background: 'var(--tf-offset, #f1f5f9)' }}
        />

        {footnote && (
          <p
            style={{
              margin: 0, padding: '0.75rem 1rem', flexShrink: 0,
              borderTop: '1px solid var(--tf-border, #e2e8f0)',
              fontSize: '0.8125rem', color: 'var(--tf-muted, #64748b)', lineHeight: 1.5,
            }}
          >
            {footnote}
          </p>
        )}
      </div>
    </div>
  );
}
