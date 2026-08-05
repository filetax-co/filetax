import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import { edgeFunctionError } from '../../lib/edgeErrors';
import {
  loadFaxTransmission,
  pollFaxTransmission,
  canConfirm,
  canDispatch,
  faxStatusLine,
  isStale,
  type FaxTransmission,
} from '../../lib/faxTransmissions';

/**
 * Everything the filer sees about their $9 fax, in one place.
 *
 * Three things were missing and all three are here, because they are the same
 * record read three ways:
 *
 *   1. THE FAX IS ITS OWN CLICK. It used to ride along with "Generate &
 *      download": one button both produced the filer's PDF and transmitted a
 *      return to the IRS. A transmission cannot be recalled, so it should not be
 *      a side effect of downloading a file, and a filer who wanted to regenerate
 *      with a redrawn signature had no way to do that without dispatching again.
 *      Generate now only generates.
 *   2. THE CONFIRMATION IS DURABLE. A delivered transmission renders to a PDF
 *      the filer keeps. Before this the only evidence was a line of React state
 *      that vanished on refresh.
 *   3. THE FILER GETS THE PAGES THAT WERE SENT. Not the mail-ready package, the
 *      actual transmitted document: cover page first, no filing-instructions
 *      page. Rebuilt with the cover dated from `submitted_at`, so the copy and
 *      the pages Ogden holds are the same document.
 *
 * The panel owns the transmission row and nothing else owns it, so the button
 * states, the status line and the receipt cannot disagree.
 */

export interface FaxBuild {
  /** The transmission-ready bytes: cover page, then the package, no instructions page. */
  payload: Uint8Array;
  formCount: number;
  hasRCL: boolean;
  has7004: boolean;
  /** Every year the transmission covers. One fax covers a whole catch-up. */
  taxYears: number[];
}

interface Props {
  filing: Filing;
  /**
   * Build the transmission payload. Owned by the page because only it knows
   * whether this is a single year or a catch-up job, and holds the drawn
   * signature.
   *
   * `sentOn` dates the cover. Omitted when sending (today is correct), passed
   * as `submitted_at` when rebuilding the copy of a fax already sent.
   */
  build: (opts?: { sentOn?: Date }) => Promise<FaxBuild>;
  /** The page is busy generating; do not let a second job start. */
  busy?: boolean;
}

export default function FaxPanel({ filing, build, busy }: Props) {
  const [transmission, setTransmission] = useState<FaxTransmission | null>(null);
  const [loaded,   setLoaded]   = useState(false);
  const [working,  setWorking]  = useState<null | 'send' | 'confirm' | 'copy' | 'check'>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const filingId = filing.id;
  const jobId = filing.job_id ?? null;

  // Load once on mount. This is the read that never existed: a filer returning
  // to the page a day later now sees the state of their transmission instead of
  // a blank screen and a button that would have sent it twice.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const row = await loadFaxTransmission({ id: filingId, job_id: jobId });
      if (cancelled) return;
      setTransmission(row);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [filingId, jobId]);

  // Follow an in-flight transmission to its conclusion. Sinch's callback lands
  // seconds to minutes after submission and the filer should not have to guess
  // when to refresh. Cancelled on unmount by the returned function.
  useEffect(() => {
    if (!transmission) return;
    if (transmission.status !== 'dispatching' && transmission.status !== 'submitted') return;
    // Nothing is coming for a stale submission, so polling it is noise.
    if (isStale(transmission)) return;
    return pollFaxTransmission({ id: filingId, job_id: jobId }, setTransmission);
  }, [filingId, jobId, transmission?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = useCallback((bytes: Uint8Array, filename: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);

  const slug = (filing.llc_name ?? 'filing').replace(/[^a-zA-Z0-9]/g, '_');

  // ── Send ───────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (working || busy) return;
    setWorking('send');
    setError(null);
    setNotice(null);
    try {
      const { payload } = await build();
      const { dispatchIrsFax } = await import('../../lib/faxDispatch');
      const result = await dispatchIrsFax(filingId, payload);
      // Read the row back rather than trusting the response shape. The response
      // says what this request did; the row says what the transmission IS,
      // including an attempt some earlier request left behind.
      const row = await loadFaxTransmission({ id: filingId, job_id: jobId });
      setTransmission(row);
      if (result.duplicate) {
        setNotice(
          result.status === 'dispatching'
            ? 'A fax for this filing is already being submitted, so we did not send a second one.'
            : 'This filing has already been faxed to the IRS. We did not send it twice.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The fax could not be submitted.');
      // A failed dispatch writes the row too, and that row is what says whether
      // a retry is still available.
      setTransmission(await loadFaxTransmission({ id: filingId, job_id: jobId }));
    } finally {
      setWorking(null);
    }
  };

  // ── Ask the provider directly ──────────────────────────────────────────────
  /**
   * The delivery record, pulled rather than waited for.
   *
   * Sinch's callback is the fast path and it is not a reliable one: on 5 August
   * a fax the receiving end actually got never reached `delivered`, because the
   * callback could not connect at all. A filer should not have to email support
   * to find out what a provider already knows, so this asks.
   */
  const handleCheck = async () => {
    if (!transmission || working || busy) return;
    setWorking('check');
    setError(null);
    setNotice(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('reconcile-fax-status', {
        body: { filing_id: filingId },
      });
      if (fnErr || !data) {
        throw new Error(await edgeFunctionError(data, fnErr, 'We could not reach the fax provider.'));
      }
      const row = await loadFaxTransmission({ id: filingId, job_id: jobId });
      setTransmission(row);
      if (data.pending) {
        setNotice('The provider still has this fax in progress. Check again in a few minutes.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not reach the fax provider.');
    } finally {
      setWorking(null);
    }
  };

  // ── Confirmation ───────────────────────────────────────────────────────────
  const handleConfirmation = async () => {
    if (!canConfirm(transmission) || working || busy) return;
    setWorking('confirm');
    setError(null);
    try {
      // Built from the filing and the row, so it needs the package's shape but
      // not its bytes. `build` is the only thing that knows the form count, and
      // it is cheap enough next to a transmission the filer already waited for.
      const shape = await build({
        sentOn: transmission.submitted_at ? new Date(transmission.submitted_at) : undefined,
      });
      const { buildFaxConfirmation } = await import('../../lib/pdfGenerator');
      const pdf = await buildFaxConfirmation(filing, transmission, {
        formCount: shape.formCount,
        hasRCL: shape.hasRCL,
        has7004: shape.has7004,
        taxYears: shape.taxYears,
      });
      download(pdf, `Fax-Confirmation-${slug}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The confirmation could not be produced.');
    } finally {
      setWorking(null);
    }
  };

  // ── Copy of what was transmitted ───────────────────────────────────────────
  const handleCopy = async () => {
    if (!transmission || working || busy) return;
    setWorking('copy');
    setError(null);
    try {
      const { payload } = await build({
        sentOn: transmission.submitted_at ? new Date(transmission.submitted_at) : undefined,
      });
      download(payload, `Faxed-Package-${slug}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The transmitted copy could not be rebuilt.');
    } finally {
      setWorking(null);
    }
  };

  if (!filing.include_irs_fax) return null;
  if (!loaded) return null;

  const sendable = canDispatch(transmission);
  const inFlight = !!transmission
    && (transmission.status === 'dispatching' || transmission.status === 'submitted')
    && !isStale(transmission);

  return (
    <section style={wrap}>
      <h3 style={{ fontSize: '1rem', margin: '0 0 0.25rem' }}>IRS fax delivery</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', lineHeight: 1.55, margin: '0 0 0.9rem' }}>
        {faxStatusLine(transmission)}
      </p>

      {transmission && (
        <dl style={facts}>
          <Fact label="Status" value={transmission.status} />
          {transmission.page_count != null && (
            <Fact label="Pages transmitted" value={String(transmission.page_count)} />
          )}
          {transmission.pages_sent != null && (
            <Fact label="Pages received" value={String(transmission.pages_sent)} />
          )}
          {transmission.attempts > 1 && (
            <Fact label="Attempts" value={String(transmission.attempts)} />
          )}
        </dl>
      )}

      {error && <div style={errBox}>{error}</div>}
      {notice && <div style={noticeBox}>{notice}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {sendable && (
          <button
            type="button"
            onClick={handleSend}
            disabled={!!working || !!busy}
            style={btn(!!working || !!busy, true)}
          >
            {working === 'send'
              ? 'Submitting…'
              : transmission ? 'Try the fax again' : 'Send to the IRS by fax'}
          </button>
        )}

        {/* The confirmation is the reason the $9 was charged, so it leads once
            it exists. Deliberately unavailable before `delivered`: a receipt
            for a fax that has not completed would be describing something that
            can still fail. */}
        {canConfirm(transmission) && (
          <button
            type="button"
            onClick={handleConfirmation}
            disabled={!!working || !!busy}
            style={btn(!!working || !!busy, true)}
          >
            {working === 'confirm' ? 'Preparing…' : 'Download confirmation'}
          </button>
        )}

        {/* Available as soon as a fax has actually been submitted, in flight or
            not. It was gated on the transmission having settled, which withheld
            the filer's own copy of pages that had ALREADY gone to the IRS while
            we waited on a provider callback. Found on the live 5 August test
            row, which is stuck at `submitted` because that fax predates the
            webhook and will never receive one: the copy would have been
            unreachable forever. */}
        {/* Offered whenever the record is not settled, which is the only time
            it can tell the filer anything they do not already have. */}
        {transmission?.provider_fax_id && transmission.status !== 'delivered' && (
          <button
            type="button"
            onClick={handleCheck}
            disabled={!!working || !!busy}
            style={btn(!!working || !!busy, !canConfirm(transmission))}
          >
            {working === 'check' ? 'Checking…' : 'Check with the provider'}
          </button>
        )}

        {transmission?.submitted_at && (
          <button
            type="button"
            onClick={handleCopy}
            disabled={!!working || !!busy}
            style={btn(!!working || !!busy, false)}
          >
            {working === 'copy' ? 'Rebuilding…' : 'Download the pages we faxed'}
          </button>
        )}
      </div>

      {inFlight && (
        <p style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', margin: '0.75rem 0 0' }}>
          This page updates itself. You can leave and come back, the transmission continues either way.
        </p>
      )}

      {/* Said before the click, not after. The one thing a filer cannot undo in
          this product is a fax to the IRS. */}
      {sendable && !transmission && (
        <p style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
          We fax the signed package exactly as you generated it. A transmission cannot be recalled,
          so make any corrections before you send.
        </p>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{
        fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: 'var(--tf-muted)',
      }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontSize: '0.9rem', textTransform: 'capitalize' }}>{value}</dd>
    </div>
  );
}

const wrap: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '1.25rem',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.625rem',
  background: 'var(--tf-surface)',
};

const facts: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: '0.75rem',
  margin: '0 0 1rem',
};

const errBox: React.CSSProperties = {
  background: 'var(--tf-error-bg)',
  color: 'var(--tf-error-text)',
  border: '1px solid var(--tf-error-border)',
  borderRadius: '0.5rem',
  padding: '0.7rem 0.9rem',
  fontSize: '0.85rem',
  marginBottom: '0.9rem',
};

const noticeBox: React.CSSProperties = {
  background: 'var(--tf-offset)',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.5rem',
  padding: '0.7rem 0.9rem',
  fontSize: '0.85rem',
  marginBottom: '0.9rem',
};

const btn = (disabled: boolean, primary: boolean): React.CSSProperties => ({
  padding: '0.55rem 1.15rem',
  background: primary ? 'var(--tf-accent)' : 'transparent',
  color: primary ? 'var(--tf-on-accent)' : 'var(--tf-text)',
  border: primary ? 'none' : '1px solid var(--tf-border)',
  borderRadius: '0.5rem',
  fontWeight: primary ? 700 : 600,
  fontSize: '0.9rem',
  opacity: disabled ? 0.55 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
