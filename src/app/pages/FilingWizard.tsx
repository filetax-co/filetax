import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { supabase, Filing, Transaction } from '../../lib/supabase';
import { PdfPreviewModal } from '../../components/PdfPreviewModal';
import { startCheckout } from '../../lib/checkout';
import { SignaturePad } from '../components/SignaturePad';
import type { DrawnSignature } from '../../lib/drawnSignature';

// ─── helpers ──────────────────────────────────────────────────────────────────

const getEasternYear = (): number => {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return eastern.getFullYear();
};

const currentYear = getEasternYear();

const TAX_YEARS = Array.from(
  { length: currentYear - 2018 },
  (_, i) => 2019 + i,
).reverse();

// ─── component ───────────────────────────────────────────────────────────────
//
// FilingWizard is the GENERATE step only.
// It is reached via /filing/:id, which the Dashboard routes to for
// paid / completed filings. Data entry (steps 1-3) lives in Intake (/intake/:id).
//
// Combined PDF order is owned by generateFilingPackage() in pdfGenerator.ts, // Instructions → reasonable-cause letter (if any) → Pro Forma 1120 → Form 7004
// (if any) → owner's Form 5472 with its Part V / Part VI statements → a Form
// 5472 per remaining related party. Do not restate it here; the previous copy
// of this comment had drifted and described a sequence no longer produced.
//
// statement_partVI is always included (hardcoded true in pdfGenerator.ts).
// statement_partV is included only when distributions, contributions, dividends,
// or formation-cost payments are present (hasPartV === true).
// property_transfer and nonmonetary_other are disclosed in statement_partVI only, // they do NOT trigger hasPartV.

export default function FilingWizard() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  // ── state ─────────────────────────────────────────────────────────────────

  const [filing,       setFiling]       = useState<Filing | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [genErr,       setGenErr]       = useState<string | null>(null);
  const [loadErr,      setLoadErr]      = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  // Generated single-year package: kept as a blob URL so the filer can preview
  // it in the overlay and download the same bytes without regenerating.
  const [preview, setPreview] = useState<{ url: string; filename: string } | null>(null);
  // Whether the preview overlay is showing. Kept separate from `preview` so the
  // generated package can persist on the page after the overlay is dismissed.
  const [previewOpen, setPreviewOpen] = useState(false);
  // Drawn signature, held in memory for this tab only. Deliberately NOT written
  // to the filing record or to storage: see the header of lib/drawnSignature.ts
  // for why that is what keeps the "we never store your documents" claim true.
  const [drawnSignature, setDrawnSignature] = useState<DrawnSignature | null>(null);
  const relatedPartyCount = Array.isArray(filing?.related_parties) ? filing.related_parties.length : 0;
  const hasUnpaidRelatedParties =
    relatedPartyCount > Number(filing?.paid_related_party_count ?? 0);
  const isPaid =
    (filing?.status === 'paid' || filing?.status === 'completed') &&
    !hasUnpaidRelatedParties;

  // Integrity, IRM 10.10.1.3.1. A signature is a statement about a specific
  // document. If the filing changes after it was drawn, what the filer signed no
  // longer exists, so the mark is discarded and has to be drawn again. This
  // matters because 20260702_lock_paid_filings deliberately allows two
  // post-payment corrections, so a signed filing CAN still change.
  const filingFingerprint = filing
    ? JSON.stringify([
        filing.llc_name, filing.ein, filing.tax_year, filing.signer_title,
        filing.signature_date, filing.final_return, filing.date_of_closure,
        transactions.map((t) => [t.id, t.amount_usd, t.transaction_type, t.related_party_index]),
      ])
    : null;

  useEffect(() => {
    setDrawnSignature(null);
  }, [filingFingerprint]);

  // Revoke the preview blob URL when it changes or the component unmounts.
  useEffect(() => {
    return () => { if (preview?.url) URL.revokeObjectURL(preview.url); };
  }, [preview]);

  // ── load filing + transactions ────────────────────────────────────────────

  useEffect(() => {
    if (!id) { setLoadErr('No filing ID in URL.'); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const [{ data: fi, error: fiErr }, { data: txData, error: txErr }] = await Promise.all([
        supabase.from('filings').select('*').eq('id', id).single(),
        supabase.from('reportable_transactions').select('*').eq('filing_id', id).order('created_at', { ascending: true }),
      ]);
      setLoading(false);
      if (fiErr)  { setLoadErr(fiErr.message);  return; }
      if (txErr)  { setLoadErr(txErr.message);  return; }
      if (fi)     setFiling(fi);
      if (txData) setTransactions(txData);
    })();
  }, [id]);

  // Dodo appends payment_id and status to the return URL. The values are only
  // hints: verify-payment fetches the payment directly from Dodo and validates
  // its metadata and complete product cart before marking the filing paid.
  useEffect(() => {
    if (!id) return;
    const params = new URLSearchParams(window.location.search);
    const paymentResult = params.get('payment');
    const paymentId = params.get('payment_id');

    if (paymentResult === 'cancelled') {
      setPaymentNotice('Checkout was cancelled. Your filing is saved and no payment was taken.');
      window.history.replaceState({}, '', `/filing/${id}`);
      return;
    }
    if (!paymentId) return;

    setCheckoutBusy(true);
    setPaymentNotice('Confirming your payment...');
    (async () => {
      const { data, error } = await supabase.functions.invoke('verify-payment', {
        body: { filing_id: id, payment_id: paymentId },
      });
      if (error || data?.status !== 'paid') {
        setPaymentNotice(
          data?.status === 'processing'
            ? 'Your payment is still processing. Refresh this page in a moment.'
            : data?.error || error?.message || 'We could not confirm the payment. Please contact support.',
        );
        setCheckoutBusy(false);
        return;
      }

      const { data: refreshed } = await supabase
        .from('filings')
        .select('*')
        .eq('id', id)
        .single();
      if (refreshed) setFiling(refreshed);
      setPaymentNotice('Payment confirmed. You can now sign and download your filing package.');
      setCheckoutBusy(false);
      window.history.replaceState({}, '', `/filing/${id}`);
    })();
  }, [id]);

  const handleCheckout = async () => {
    if (!id || checkoutBusy) return;
    setCheckoutBusy(true);
    setPaymentNotice(null);
    // Shared with the end of intake, which is where most filers now reach
    // checkout from. See lib/checkout.ts.
    const failure = await startCheckout(id);
    if (failure) {
      setPaymentNotice(failure);
      setCheckoutBusy(false);
    }
  };

  // ── generate PDF ──────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!id || !filing || !isPaid) return;
    setGenerating(true);
    setGenErr(null);
    try {
      const { data: fi, error: fiErr } = await supabase
        .from('filings').select('*').eq('id', id).single();
      if (fiErr) throw fiErr;

      const { data: txns, error: txErr2 } = await supabase
        .from('reportable_transactions').select('*').eq('filing_id', id);
      if (txErr2) throw txErr2;

      // A filing with no reportable transactions is still valid and worth
      // generating: the foreign owner's managerial services are always
      // disclosed in Part VI, and filing on time avoids the $25,000 penalty
      // even when no Part IV/V transaction occurred.
      const { generateFilingPackage, refuseUnsupportedText } = await import('../../lib/pdfGenerator');
      const pkg = await generateFilingPackage(fi, txns ?? [], undefined, { drawnSignature });

      // The IRS forms are rendered with WinAnsi-encoded fonts. Anything outside
      // that set (Cyrillic, Arabic, CJK, Devanagari, …) cannot be drawn and is
      // dropped, which would file a return with a name or address missing
      // characters. Refuse to deliver such a package and say exactly which
      // characters are the problem, so the filer can enter the romanized legal
      // name the IRS expects on these forms.
      const refusal = refuseUnsupportedText(pkg.unsupportedText);
      if (refusal) throw new Error(refusal);

      // The button says "Generate & preview", so open the overlay straight away;
      // the package card stays on the page once it is dismissed.
      const blob = new Blob([pkg.combined], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const filename = `Form-5472-${fi.llc_name ?? 'filing'}-${fi.tax_year ?? 'draft'}.pdf`;
      setPreview({ url, filename });
      setPreviewOpen(true);
    } catch (err) {
      setGenErr(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ── multi-year job download ─────────────────────────────────────────────────
  // When this filing belongs to a catch-up job, build the whole job: one
  // reasonable-cause letter + one print-ready PDF per year + an optional
  // single bundled PDF. `mode` selects which artifact to download.

  // Download the already-generated single-year preview without regenerating.
  const downloadPreview = () => {
    if (!preview || !isPaid) return;
    const a = document.createElement('a');
    a.href = preview.url;
    a.download = preview.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const triggerDownload = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleGenerateJob = async (mode: 'bundle' | 'per-year') => {
    if (!filing?.job_id || !isPaid) return;
    setGenerating(true);
    setGenErr(null);
    try {
      const { data: job } = await supabase
        .from('filing_jobs').select('include_rcl, rcl_narrative, reasonable_cause_reasons').eq('id', filing.job_id).single();

      const { data: yearFilings, error: yfErr } = await supabase
        .from('filings').select('*').eq('job_id', filing.job_id);
      if (yfErr || !yearFilings || yearFilings.length === 0) {
        throw new Error(yfErr?.message ?? 'No filings found for this catch-up job.');
      }

      // Load every year's transactions in parallel.
      const years = await Promise.all(
        yearFilings.map(async (f) => {
          const { data: txns } = await supabase
            .from('reportable_transactions').select('*').eq('filing_id', f.id);
          return {
            taxYear: Number(f.tax_year),
            filing: f as Filing,
            transactions: (txns ?? []) as Transaction[],
          };
        }),
      );

      const { generateMultiYearPackage, narrativeFromReasonCodes, refuseUnsupportedText } =
        await import('../../lib/pdfGenerator');
      // One letter covers all years: free-text narrative wins, else build it
      // from the reasons collected once at job setup.
      const jobNarrative =
        (job?.rcl_narrative?.trim() || null) ||
        narrativeFromReasonCodes((job as any)?.reasonable_cause_reasons, years.length);
      const pkg = await generateMultiYearPackage(years, {
        includeRCL: !!job?.include_rcl,
        rclNarrative: jobNarrative,
        // One drawing signs the whole catch-up: the single reasonable cause
        // letter and every year's pro forma 1120.
        drawnSignature,
      });

      // Same refusal as the single-year path above, which this had no equivalent
      // of: a catch-up for an owner whose legal name is not Latin downloaded
      // happily with the name stripped out of every year's return. Both paths
      // now go through the one function, so the check cannot be present in one
      // and missing from the other again.
      const refusal = refuseUnsupportedText(pkg.unsupportedText);
      if (refusal) throw new Error(refusal);

      const slug = (filing.llc_name ?? 'LLC').replace(/[^a-zA-Z0-9]/g, '_');

      if (mode === 'bundle') {
        triggerDownload(pkg.bundled, `FilingPackage_${slug}_${pkg.taxYears[0]}-${pkg.taxYears[pkg.taxYears.length - 1]}.pdf`);
      } else {
        // One file per year, plus the single RCL.
        if (pkg.reasonableCauseLetter) {
          triggerDownload(pkg.reasonableCauseLetter, `ReasonableCauseLetter_${slug}.pdf`);
        }
        for (const y of pkg.perYear) {
          triggerDownload(y.pdf, `Form-5472-${slug}-${y.taxYear}.pdf`);
        }
      }
    } catch (err) {
      setGenErr(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  // Determine which parts will be generated (mirrors pdfGenerator.ts logic)
  const hasPartV = transactions.some(t =>
    ['distribution', 'dividend', 'capital_contribution', 'formation_costs'].includes(t.transaction_type)
  );
  // Part VI is always generated, hardcoded true in pdfGenerator.ts
  // Form 7004 belongs in the package whenever the filing opted into an extension
  // (include_7004) OR the owner reported one was already filed (extension_filed),
  // including when someone else filed it for them: they still need a copy of what
  // was filed on their behalf. This must stay in step with wants7004() in
  // pdfGenerator.ts, which decides what the package actually contains. Narrowing
  // this to include_7004 alone silently hid a 7004 that was already merged into
  // the combined PDF, because nothing in the app ever writes include_7004.
  const has7004 = filing?.include_7004 === true || filing?.extension_filed === true;

  return (
    <>
      {/* Scoped input styles, matches Intake.tsx, fixes dark mode visibility */}
      <style>{`
        .filing-wizard input,
        .filing-wizard select,
        .filing-wizard textarea {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--tf-border);
          border-radius: 0.375rem;
          font-size: 0.9375rem;
          font-family: inherit;
          background: var(--tf-input-bg, var(--tf-surface));
          color: var(--tf-text);
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .filing-wizard input:focus,
        .filing-wizard select:focus,
        .filing-wizard textarea:focus {
          border-color: var(--tf-accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--tf-accent) 18%, transparent);
        }
        .filing-wizard input::placeholder {
          color: var(--tf-muted);
          opacity: 1;
        }
      `}</style>

      <div className="filing-wizard" style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '2rem 1rem',
        fontFamily: 'inherit',
      }}>

        {/* ── Back link ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '1.75rem' }}>
          <Link
            to="/dashboard"
            style={{
              fontSize: '0.875rem',
              color: 'var(--tf-muted)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            ← Dashboard
          </Link>
        </div>

        {/* ── Page heading ──────────────────────────────────────────────── */}
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' }}>
          {isPaid ? 'Generate Filing Package' : 'Review and Payment'}
        </h2>
        {filing && (
          <p style={{ fontSize: '0.875rem', color: 'var(--tf-muted)', marginBottom: '1.75rem' }}>
            {filing.llc_name ?? 'Not provided'} · Tax year {filing.tax_year ?? 'Not provided'}
          </p>
        )}

        {/* ── Loading ───────────────────────────────────────────────────── */}
        {loading && (
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9rem' }}>Loading filing…</p>
        )}

        {/* ── Load error ────────────────────────────────────────────────── */}
        {loadErr && (
          <div style={errorBannerStyle}>{loadErr}</div>
        )}

        {/* ── Main content ──────────────────────────────────────────────── */}
        {!loading && !loadErr && filing && (
          <>
            {/* ── Filing summary card ──────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Filing Details</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '0.75rem',
                background: 'var(--tf-surface)',
                border: '1px solid var(--tf-border)',
                borderRadius: '0.625rem',
                padding: '1.125rem 1.25rem',
              }}>
                <SummaryRow label="LLC / Corp"      value={filing.llc_name} />
                <SummaryRow label="EIN"             value={filing.ein} />
                <SummaryRow label="Tax year"        value={String(filing.tax_year ?? 'Not provided')} />
                <SummaryRow label="State"           value={filing.state_of_formation} />
                <SummaryRow label="Owner"           value={filing.owner_full_name} />
                <SummaryRow label="Country"         value={filing.owner_country_residence} />
                <SummaryRow label="Transactions"    value={String(transactions.length)} />
              </div>
            </section>

            {/* ── What's included card ─────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>What's Included</h3>
              <div style={{
                background: 'var(--tf-surface)',
                border: '1px solid var(--tf-border)',
                borderRadius: '0.625rem',
                padding: '1.125rem 1.25rem',
              }}>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <IncludedItem icon="" label="Pro Forma 1120" desc="US corporation income tax return" always />
                  <IncludedItem icon="" label="Form 5472" desc="Information return for 25%-foreign-owned US corporations" always />
                  {hasPartV && (
                    <IncludedItem icon="" label="Part V Statement" desc="Monetary transactions: distributions, dividends, capital contributions, formation costs" always={false} />
                  )}
                  <IncludedItem icon="" label="Part VI Statement" desc="Nonmonetary / less-than-FMV transactions, always included" always />
                  {has7004 && (
                    <IncludedItem icon="" label="Form 7004" desc="6-month extension to file, included with your package" always />
                  )}
                  {/* The reasonable cause letter was missing from this list until
                      3 Aug 2026, on the one screen where the customer pays. It is
                      the $199 line item, the most expensive thing in the package,
                      and it was the only document generated but never named here.
                      The signature copy below already said "your reasonable cause
                      statement", so the screen contradicted itself. Driven by the
                      same `filing.include_rcl` the copy uses, so the two cannot
                      disagree again. */}
                  {filing?.include_rcl && (
                    <IncludedItem
                      icon=""
                      label="Reasonable Cause Letter"
                      desc="CPA-authored statement asking the IRS to abate the late-filing penalty, one letter covering every late year"
                      // Not "if applicable". This row renders only when the letter
                      // IS in the package, so hedging next to the $199 line item
                      // would read as doubt about the thing they are paying most
                      // for. (Part V above has the same shape and still carries
                      // the badge; left alone rather than widened into a refactor.)
                      always
                    />
                  )}
                </ul>
                <p style={{
                  marginTop: '1rem',
                  fontSize: '0.8125rem',
                  color: 'var(--tf-muted)',
                  lineHeight: 1.55,
                }}>
                  All documents are combined into a single PDF ready to submit with your tax return.
                </p>
              </div>
            </section>

            {/* ── Transactions summary (if any) ─────────────────────────── */}
            {transactions.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {transactions.map(tx => (
                    <div key={tx.id} style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.55rem 0.875rem',
                      background: 'var(--tf-surface)',
                      border: '1px solid var(--tf-border)',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                    }}>
                      <div style={{ flex: 1, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                          {tx.transaction_type.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', textTransform: 'capitalize' }}>
                          {tx.direction}
                        </span>
                        {tx.description && (
                          <span style={{ color: 'var(--tf-muted)' }}>{tx.description}</span>
                        )}
                      </div>
                      {tx.amount_usd != null && (
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--tf-accent)' }}>
                          ${tx.amount_usd.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* No transactions, informational, not a blocker. A return with no
                reportable transactions is still valid and worth filing. */}
            {transactions.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '2rem 1rem',
                color: 'var(--tf-muted)',
                border: '2px dashed var(--tf-border)',
                borderRadius: '0.75rem',
                marginBottom: '1.5rem',
                fontSize: '0.9rem',
              }}>
                <p style={{ marginBottom: '0.5rem', fontWeight: 600 }}>No reportable transactions this year.</p>
                <p style={{ fontSize: '0.8125rem' }}>
                  That is fine, you can still generate and file. Your Form 5472 discloses the
                  managerial services you provide as the owner, and filing on time protects you
                  from the $25,000 penalty even in a year with no transactions.
                </p>
                <button
                  onClick={() => id && navigate(`/intake?filing_id=${id}`)}
                  style={{ ...secondaryBtnStyle, marginTop: '1rem', display: 'inline-block' }}
                >
                  ← Back to intake to add transactions
                </button>
              </div>
            )}

            {/* ── Generate error ───────────────────────────────────────── */}
            {genErr && (
              <div style={{ ...errorBannerStyle, marginBottom: '1rem' }}>{genErr}</div>
            )}
            {paymentNotice && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.875rem 1rem',
                  borderLeft: `4px solid ${isPaid ? 'var(--tf-banner-green-border)' : 'var(--tf-banner-amber-border)'}`,
                  borderRadius: '0.375rem',
                  background: isPaid ? 'var(--tf-banner-green-bg)' : 'var(--tf-banner-amber-bg)',
                  color: isPaid ? 'var(--tf-banner-green-text)' : 'var(--tf-banner-amber-text)',
                  fontSize: '0.875rem',
                  lineHeight: 1.5,
                }}
              >
                {paymentNotice}
              </div>
            )}

            {!isPaid && (
              <section style={{ ...sectionStyle, marginBottom: '1.5rem' }}>
                <div style={{
                  padding: '1.25rem',
                  border: '1px solid var(--tf-border)',
                  borderRadius: '0.625rem',
                  background: 'var(--tf-surface)',
                }}>
                  <h3 style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>
                    Complete payment before generating your package
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', lineHeight: 1.55, marginBottom: '1rem' }}>
                    {hasUnpaidRelatedParties
                      ? `${relatedPartyCount - Number(filing?.paid_related_party_count ?? 0)} additional related ${relatedPartyCount - Number(filing?.paid_related_party_count ?? 0) === 1 ? 'party requires' : 'parties require'} payment. After payment, you can generate and download the updated filing package.`
                      : 'Your checkout is calculated from the tax years and optional services in this filing. After payment, you can generate and download the filing package.'}
                  </p>
                  <button
                    onClick={handleCheckout}
                    disabled={checkoutBusy}
                    style={{
                      ...primaryBtnStyle,
                      opacity: checkoutBusy ? 0.55 : 1,
                      cursor: checkoutBusy ? 'not-allowed' : 'pointer',
                    }}
                    type="button"
                  >
                    {checkoutBusy
                      ? 'Opening secure checkout...'
                      : hasUnpaidRelatedParties
                        ? 'Pay for additional related party'
                        : 'Continue to secure checkout'}
                  </button>
                </div>
              </section>
            )}

            {/* ── Sign ─────────────────────────────────────────────────────
                Placed immediately before the generate action, so the signature
                is drawn against the filing as it is about to be rendered
                rather than at some earlier step the filer may have edited
                since. Optional: leaving it blank falls back to the typed name,
                which IRM 10.10.1.3.1.1 accepts just as readily.
            */}
            {isPaid && <div style={{
              paddingTop: '1.5rem',
              marginBottom: '1.5rem',
              borderTop: '1px solid var(--tf-border)',
            }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
                Sign this download (optional)
              </h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                A PDF you already downloaded cannot be changed. Clear or redraw below, then generate
                again to create a new package with the new signature. Your locked signer identity
                remains unchanged.
              </p>
              <SignaturePad
                onChange={setDrawnSignature}
                signerName={filing?.owner_full_name ?? null}
                documentDescription={
                  filing?.include_rcl
                    ? 'your reasonable cause statement and your Form 1120'
                    : 'your Form 1120'
                }
                disabled={generating}
              />
            </div>}

            {/* ── Action buttons ───────────────────────────────────────── */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--tf-border)',
              flexWrap: 'wrap',
            }}>
              <button
                onClick={() => id && navigate(`/intake?filing_id=${id}`)}
                style={secondaryBtnStyle}
                type="button"
              >
                ← Edit Filing
              </button>

              {isPaid && <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {!filing?.job_id && (
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    style={{
                      ...primaryBtnStyle,
                      opacity: generating ? 0.55 : 1,
                      cursor: generating ? 'not-allowed' : 'pointer',
                    }}
                    type="button"
                  >
                    {generating ? 'Generating…' : preview ? 'Regenerate' : 'Generate & preview'}
                  </button>
                )}
              </div>}
            </div>

            {/* ── Generated package: open in the preview overlay ──────────────
                The PDF used to sit inline at 75vh, which handed the page to the
                browser's own viewer (toolbar, zoom, thumbnail rail) and read as
                if the app had been replaced by Adobe. It now opens in the shared
                overlay, so the filing page stays put behind it. */}
            {preview && (
              <div style={{ marginTop: '1.5rem' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '0.75rem', flexWrap: 'wrap',
                  padding: '1rem 1.25rem',
                  border: '1px solid var(--tf-border)', borderRadius: '0.625rem',
                  background: 'var(--tf-surface)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0, color: 'var(--tf-text)' }}>
                      Your filing package is ready
                    </p>
                    <p style={{
                      fontSize: '0.8125rem', color: 'var(--tf-muted)', margin: '0.15rem 0 0',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {preview.filename}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button onClick={() => setPreviewOpen(true)} style={secondaryBtnStyle} type="button">
                      Preview
                    </button>
                    <button onClick={downloadPreview} style={primaryBtnStyle} type="button">
                      Download PDF
                    </button>
                  </div>
                </div>
              </div>
            )}

            {previewOpen && preview && (
              <PdfPreviewModal
                target={preview}
                onClose={() => setPreviewOpen(false)}
                onDownload={downloadPreview}
                footnote="Review every page. When it looks right, download the PDF, then print and mail (or fax) it to the IRS using the instructions on the first page."
              />
            )}

            {/* ── Multi-year catch-up: whole-job download ─────────────────── */}
            {filing?.job_id && isPaid && (
              <div style={{
                marginTop: '1.5rem', padding: '1.25rem',
                border: '1px solid var(--tf-border)', borderRadius: '0.625rem',
                background: 'var(--tf-offset)',
              }}>
                <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem', color: 'var(--tf-text)' }}>
                  This is a multi-year catch-up filing
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
                  We prepare one reasonable-cause letter covering every year, plus a separate print-ready
                  PDF per year (each starts with its own filing instructions). Download the years separately,
                  or as one combined PDF.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleGenerateJob('per-year')}
                    disabled={generating}
                    style={{ ...primaryBtnStyle, opacity: generating ? 0.55 : 1, cursor: generating ? 'not-allowed' : 'pointer' }}
                    type="button"
                  >
                    {generating ? 'Generating…' : 'Download each year + RCL'}
                  </button>
                  <button
                    onClick={() => handleGenerateJob('bundle')}
                    disabled={generating}
                    style={{ ...secondaryBtnStyle, opacity: generating ? 0.55 : 1, cursor: generating ? 'not-allowed' : 'pointer' }}
                    type="button"
                  >
                    Download all-in-one PDF
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── small components ─────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{
        fontSize: '0.75rem',
        color: 'var(--tf-muted)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.95rem',
        fontWeight: 500,
        color: value ? 'var(--tf-text)' : 'var(--tf-muted)',
      }}>
        {value || 'Not provided'}
      </div>
    </div>
  );
}

function IncludedItem({
  icon, label, desc, always,
}: {
  icon: string;
  label: string;
  desc: string;
  always: boolean;
}) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
      <span style={{ fontSize: '1rem', lineHeight: 1.4, flexShrink: 0 }}>{icon}</span>
      <div>
        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
          {label}
        </span>
        {!always && (
          <span style={{
            marginLeft: '0.4rem',
            fontSize: '0.72rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--tf-accent)',
            background: 'color-mix(in srgb, var(--tf-accent) 12%, transparent)',
            padding: '0.1rem 0.4rem',
            borderRadius: '0.25rem',
          }}>
            if applicable
          </span>
        )}
        <p style={{
          margin: '0.15rem 0 0',
          fontSize: '0.8125rem',
          color: 'var(--tf-muted)',
          lineHeight: 1.5,
        }}>
          {desc}
        </p>
      </div>
    </li>
  );
}

// ─── shared styles ────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  marginBottom: '1.75rem',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--tf-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '0.75rem',
};

const errorBannerStyle: React.CSSProperties = {
  background: 'var(--tf-error-bg)',
  color: 'var(--tf-error-text)',
  border: '1px solid var(--tf-error-border)',
  borderRadius: '0.5rem',
  padding: '0.75rem 1rem',
  fontSize: '0.875rem',
  marginBottom: '1.25rem',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.5rem',
  background: 'var(--tf-accent)',
  color: 'var(--tf-on-accent)',
  border: 'none',
  borderRadius: '0.5rem',
  fontWeight: 700,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  background: 'transparent',
  color: 'var(--tf-text)',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.5rem',
  fontWeight: 600,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

// TAX_YEARS is kept in scope for potential future use (e.g. year picker override).
void TAX_YEARS;
