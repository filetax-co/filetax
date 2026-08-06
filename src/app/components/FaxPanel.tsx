import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import { edgeFunctionError } from '../../lib/edgeErrors';
import { PRICE_FAX } from '../../lib/pricing';
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
  const [working,  setWorking]  = useState<null | 'send' | 'record' | 'check' | 'buy'>(null);
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

  // ── Buy it after the fact ──────────────────────────────────────────────────
  /**
   * A cart of exactly one $9 item against a filing that is already paid. It
   * cannot re-charge for the filing, the letter or a party, because the cart is
   * built server-side from the add-on name rather than re-derived from the
   * filing. On return, `verify-payment` sets `include_irs_fax` and this panel
   * comes back as the send panel.
   */
  const handleBuy = async () => {
    if (working || busy) return;
    setWorking('buy');
    setError(null);
    setNotice(null);
    const { startCheckout } = await import('../../lib/checkout');
    const failure = await startCheckout(filingId, 'fax');
    // A null return means the tab is already navigating to the provider, so
    // clearing the working state here would flash the button back to idle on
    // the way out.
    if (failure) {
      setError(failure);
      setWorking(null);
    }
  };

  // ── Copy of what was transmitted ───────────────────────────────────────────
  /**
   * ONE file, not two downloads.
   *
   * This was "Download confirmation" beside "Download the pages we faxed", and
   * the two describe a single event: the confirmation says what went to the
   * IRS and when, the pages are what went. Two buttons made the filer decide
   * which one they wanted, and the answer is always both, in that order.
   *
   * The confirmation only exists once the transmission is `delivered`, which is
   * deliberate: a receipt for a fax that can still fail would be describing
   * something that has not happened. Before then this produces the pages alone,
   * and the copy under the button says so.
   */
  const handleRecord = async () => {
    if (!transmission || working || busy) return;
    setWorking('record');
    setError(null);
    try {
      const shape = await build({
        sentOn: transmission.submitted_at ? new Date(transmission.submitted_at) : undefined,
      });
      const parts: Uint8Array[] = [];
      if (canConfirm(transmission)) {
        const { buildFaxConfirmation } = await import('../../lib/pdfGenerator');
        parts.push(await buildFaxConfirmation(filing, transmission, {
          formCount: shape.formCount,
          hasRCL: shape.hasRCL,
          has7004: shape.has7004,
          taxYears: shape.taxYears,
        }));
      }
      parts.push(shape.payload);
      const { concatPdfBytes } = await import('../../lib/pdfGenerator');
      download(await concatPdfBytes(parts), `Fax-Record-${slug}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The fax record could not be produced.');
    } finally {
      setWorking(null);
    }
  };

  // ── Not bought yet ─────────────────────────────────────────────────────────
  //
  // The offer, one step back from the panel above. The entitlement is set on the
  // intake screen and frozen at payment, so a filer who did not tick it there
  // had no way to buy it afterwards: the panel simply did not render, and the
  // product silently had no answer for "I want this faxed after all". The most
  // likely person to want it is the one who has just seen the package and
  // realised they have no fax machine.
  //
  // Only offered on a filing that is PAID. Before payment the fax belongs in the
  // main cart, where it is a tick box and not a second checkout.
  if (!filing.include_irs_fax) {
    if (filing.status !== 'paid' && filing.status !== 'completed') return null;
    return (
      <section style={wrap}>
        <h3 style={{ fontSize: '1rem', margin: '0 0 0.25rem' }}>IRS fax delivery</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', lineHeight: 1.55, margin: '0 0 0.9rem' }}>
          Not added. You can mail the package yourself, or we can fax it to the IRS for you and give
          you a transmission confirmation to keep.
        </p>

        {/* The homepage marker treatment, a green tick and a rule per row,
            rather than the fact grid the sent states use. Those grids report a
            transmission that exists; this is the only state on this panel that
            has something to sell, and the site sells in this shape. */}
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
          {[
            `$${PRICE_FAX} once, however many years this filing covers`,
            'We fax the signed package for you, exactly as you generate it',
            'You get a dated transmission confirmation to download and keep',
            'Nothing is sent until you press send, so paying faxes nothing on its own',
          ].map((item) => (
            <li
              key={item}
              style={{
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--tf-border)',
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: 'var(--tf-success)', fontWeight: 700, fontSize: '1rem', flexShrink: 0 }}>
                &#10003;
              </span>
              {item}
            </li>
          ))}
        </ul>

        {error && <div style={errBox}>{error}</div>}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleBuy}
            disabled={!!working || !!busy}
            style={btn(!!working || !!busy, true)}
          >
            {working === 'buy' ? 'Opening checkout…' : `Add fax delivery, $${PRICE_FAX}`}
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
          If the transmission cannot be completed after three attempts, the {`$${PRICE_FAX}`} is
          refundable. See our <a href="/refunds" style={{ color: 'var(--tf-accent)' }}>refund policy</a>.
        </p>
      </section>
    );
  }

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

        {/* One record, one file: the confirmation and the pages it describes.
            Available as soon as a fax has actually been submitted, in flight or
            not. It was once gated on the transmission having settled, which
            withheld the filer's own copy of pages that had ALREADY gone to the
            IRS while we waited on a provider callback. Found on the live
            5 August test row, which is stuck at `submitted` because that fax
            predates the webhook and will never receive one: the copy would have
            been unreachable forever. */}
        {transmission?.submitted_at && (
          <button
            type="button"
            onClick={handleRecord}
            disabled={!!working || !!busy}
            style={btn(!!working || !!busy, true)}
          >
            {working === 'record' ? 'Preparing…' : 'Download fax record'}
          </button>
        )}

        {/* Offered whenever the record is not settled, which is the only time
            it can tell the filer anything they do not already have. */}
        {transmission?.provider_fax_id && transmission.status !== 'delivered' && (
          <button
            type="button"
            onClick={handleCheck}
            disabled={!!working || !!busy}
            style={btn(!!working || !!busy, false)}
          >
            {working === 'check' ? 'Checking…' : 'Update status'}
          </button>
        )}
      </div>

      {transmission?.submitted_at && (
        <p style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
          {canConfirm(transmission)
            ? 'One PDF: your confirmation, followed by the exact pages we transmitted.'
            : 'The exact pages we transmitted. Your confirmation is added to this file once the provider confirms delivery.'}
        </p>
      )}

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
