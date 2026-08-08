import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { supabase, Filing, Transaction } from '../../lib/supabase';
import { startCheckout } from '../../lib/checkout';
import { edgeFunctionError } from '../../lib/edgeErrors';
import { PART_V_TX_TYPES } from '../../lib/filingMapping';
import { TX_TYPES } from './intake/constants';
import { formatAmount } from '../../lib/money';
import { billablePartyCount, checkoutLines, PRICE_ADDITIONAL_PARTY } from '../../lib/pricing';
import { usePageMeta } from '../hooks/usePageMeta';
import { SignaturePad } from '../components/SignaturePad';
import FaxPanel, { type FaxBuild } from '../components/FaxPanel';
import { loadFaxTransmission } from '../../lib/faxTransmissions';
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
  const [faxLocked,    setFaxLocked]    = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [genErr,       setGenErr]       = useState<string | null>(null);
  const [loadErr,      setLoadErr]      = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  // Drawn signature, held in memory for this tab only. Deliberately NOT written
  // to the filing record or to storage: see the header of lib/drawnSignature.ts
  // for why that is what keeps the "we never store your documents" claim true.
  const [drawnSignature, setDrawnSignature] = useState<DrawnSignature | null>(null);
  // BILLABLE parties, not stored ones. A related party with no transactions in
  // this year produces no Form 5472 in the download, so it is not charged for,
  // and counting it here would have gated the download behind a $25 payment for
  // a form that was never going to be in the package.
  const relatedPartyCount = billablePartyCount(
    Array.isArray(filing?.related_parties) ? filing.related_parties.length : 0,
    transactions.map((t) => t.related_party_index),
  );
  const hasUnpaidRelatedParties =
    relatedPartyCount > Number(filing?.paid_related_party_count ?? 0);
  // `submitted` is a paid state, the strongest one: it is what a filing becomes
  // once its fax is confirmed delivered to Ogden. Omitting it here would have
  // shown the pay-first view to a filer whose return is already with the IRS.
  const isPaid =
    (filing?.status === 'paid' || filing?.status === 'completed' || filing?.status === 'submitted') &&
    !hasUnpaidRelatedParties;
  // A TOP-UP is a filing that has already been paid for once and has since
  // gained a related party. `hasUnpaidRelatedParties` alone does not mean that:
  // on a filing that has never been paid, paid_related_party_count is 0, so
  // every related party is "unpaid" and the checkout section announced
  // "1 additional related party requires payment" to someone whose whole $391
  // payment had just been declined. The button charged the full cart correctly;
  // only the words were wrong, which is the worse failure of the two after a
  // decline.
  const isRelatedPartyTopUp = filing?.paid_at != null && hasUnpaidRelatedParties;

  /**
   * Billable additional parties for every year of a catch-up, or null on a
   * single filing, where the count already in `relatedPartyCount` is the whole
   * answer. One checkout buys the whole job, so the figure this page shows has
   * to be the job's; pricing it from the anchor year alone understates any
   * catch-up whose other years carry parties of their own.
   */
  const [jobPartiesByYear, setJobPartiesByYear] = useState<number[] | null>(null);
  useEffect(() => {
    const jid = filing?.job_id;
    if (!jid || isPaid) { setJobPartiesByYear(null); return; }
    let cancelled = false;
    (async () => {
      const { data: sibs } = await supabase
        .from('filings').select('id, related_parties').eq('job_id', jid);
      const rows = sibs ?? [];
      const ids = rows.map((s: any) => s.id as string);
      const { data: txns } = ids.length
        ? await supabase
            .from('reportable_transactions')
            .select('filing_id, related_party_index')
            .in('filing_id', ids)
        : { data: [] as any[] };
      const byFiling = new Map<string, (number | null)[]>();
      for (const t of (txns ?? []) as any[]) {
        const k = t.filing_id as string;
        if (!byFiling.has(k)) byFiling.set(k, []);
        byFiling.get(k)!.push(t.related_party_index ?? null);
      }
      if (cancelled) return;
      setJobPartiesByYear(rows.map((s: any) => billablePartyCount(
        Array.isArray(s.related_parties) ? s.related_parties.length : 0,
        byFiling.get(s.id as string) ?? [],
      )));
    })();
    return () => { cancelled = true; };
  }, [filing?.job_id, isPaid]);

  /**
   * The cart this page's button leads to. A top-up is deliberately NOT the
   * whole cart: `create-checkout-session` sells exactly the unpaid party delta
   * in that case, so showing the filing and the letter again would quote a
   * filer who has already paid for both.
   */
  const paymentCart = isRelatedPartyTopUp
    ? {
        lines: [{
          label: `Additional related ${
            relatedPartyCount - Number(filing?.paid_related_party_count ?? 0) === 1 ? 'party' : 'parties'
          }, ${relatedPartyCount - Number(filing?.paid_related_party_count ?? 0)} at $${PRICE_ADDITIONAL_PARTY}`,
          amount: (relatedPartyCount - Number(filing?.paid_related_party_count ?? 0)) * PRICE_ADDITIONAL_PARTY,
        }],
        total: (relatedPartyCount - Number(filing?.paid_related_party_count ?? 0)) * PRICE_ADDITIONAL_PARTY,
      }
    : checkoutLines({
        billablePartiesByYear: jobPartiesByYear ?? [relatedPartyCount],
        includeRCL: filing?.include_rcl === true,
        includeFax: filing?.include_irs_fax === true,
      });

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
      // Whether this filing's pages are already at the IRS. FaxPanel loads the
      // same row, but it renders below the edit links and cannot reach back up
      // to hide them, so this page reads it too rather than routing state
      // through a callback whose timing would decide what the filer sees.
      // Anything but a failed transmission counts: a fax still in flight must
      // not be edited out from under itself either.
      if (fi) {
        const tx = await loadFaxTransmission({ id: fi.id as string, job_id: (fi as any).job_id ?? null });
        setFaxLocked(!!tx && tx.status !== 'failed');
      }
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
            // `error.message` on a non-2xx is the generic "Edge Function
            // returned a non-2xx status code", which is what a filer saw here
            // after paying. edgeFunctionError digs out verify-payment's own
            // sentence instead. See lib/edgeErrors.ts.
            : await edgeFunctionError(
                data, error,
                'We could not confirm the payment. Please contact support@filetax.co and we will sort it out.',
              ),
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
      setPaymentNotice(
        data.added === 'fax'
          ? 'Fax delivery added. Send your package to the IRS from the fax section below.'
          : 'Payment confirmed. You can now sign and download your filing package.',
      );
      setCheckoutBusy(false);
      window.history.replaceState({}, '', `/filing/${id}`);
    })();
  }, [id]);

  // The tab title, which nothing set here. Cloudflare answers a hard load of
  // /filing/:id out of 404.html (see public/_redirects), so the title it
  // carried, "Page not found", survived into a perfectly working page. The
  // redirect rule fixes the status; this fixes the title even if a future build
  // reaches this route through the not-found shell again. noindex because this
  // is a signed-in surface.
  usePageMeta({
    title: 'Your filing package | FileTax.co',
    description: 'Generate, sign and download your Form 5472 filing package.',
    noindex: true,
  });

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
      // No `fax: true` here. This path produces the filer's own copy, and
      // building the transmission payload alongside it would run
      // faxSignatureBlocker, which refuses an unsigned package: correct before
      // a fax, wrong before a download the filer intends to print and sign.
      const pkg = await generateFilingPackage(fi, txns ?? [], undefined, {
        drawnSignature,
      });

      // The IRS forms are rendered with WinAnsi-encoded fonts. Anything outside
      // that set (Cyrillic, Arabic, CJK, Devanagari, …) cannot be drawn and is
      // dropped, which would file a return with a name or address missing
      // characters. Refuse to deliver such a package and say exactly which
      // characters are the problem, so the filer can enter the romanized legal
      // name the IRS expects on these forms.
      const refusal = refuseUnsupportedText(pkg.unsupportedText);
      if (refusal) throw new Error(refusal);

      // Straight to the file. The filer saw the forms in the draft preview
      // before paying, so a second overlay after payment only stands between
      // them and the download they came for.
      const filename = `Form-5472-${fi.llc_name ?? 'filing'}-${fi.tax_year ?? 'draft'}.pdf`;
      triggerDownload(pkg.combined, filename);
      await markDownloaded([fi]);

      // Generating no longer faxes. It used to: one button produced the filer's
      // PDF and transmitted a return to the IRS in the same click, so a filer
      // who regenerated to redraw a signature dispatched a second time, and
      // nobody could download their own forms without sending. A transmission
      // cannot be recalled, so it gets its own deliberate click in FaxPanel.
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

  /**
   * Record that the filer has the forms.
   *
   * Nothing wrote `status = 'completed'` or `download_count`, so a paid filing
   * stayed in the dashboard's "Ready to download" bucket forever, the
   * "Filed & downloaded" bucket was permanently empty, and the card kept its
   * red "Past due, file ASAP" chip after the filer had the return in hand.
   * Every piece of UI for the finished state already existed; the state was
   * simply unreachable.
   *
   * Safe from the client: `filings_block_payment_writes` permits `completed`
   * when the row is already `paid`, `download_count` is not one of its guarded
   * columns, and `filings_freeze_when_paid` only defends the identity columns
   * and related-party removal, so this costs nothing from the correction
   * budget. `forms_generated_at` IS guarded and is deliberately left to the
   * server.
   *
   * Best-effort by design. The bytes are already on the filer's disk by the
   * time this runs, so a failure here must not surface as a download error; it
   * is a bookkeeping write, and the next one will correct it.
   */
  const markDownloaded = async (rows: { id: string; download_count?: number | null }[]) => {
    // Never write `completed` over `submitted`. A faxed filing is further along
    // than a downloaded one, and walking it back would demote the dashboard
    // card from "Faxed to the IRS" to "Downloaded" because the filer saved a
    // second copy of the same PDF. The trigger would refuse the write anyway
    // (it permits `completed` only from `paid` / `completed`), so attempting it
    // would fail the whole update and lose the download count with it.
    const submitted = filing?.status === 'submitted';
    await Promise.all(rows.map(async (row) => {
      const { error } = await supabase
        .from('filings')
        .update({
          ...(submitted ? {} : { status: 'completed' }),
          download_count: Number(row.download_count ?? 0) + 1,
        })
        .eq('id', row.id);
      if (error) console.error('[markDownloaded]', row.id, error.message);
    }));
    setFiling((prev) => (prev
      ? { ...prev, status: submitted ? prev.status : 'completed', download_count: Number(prev.download_count ?? 0) + 1 }
      : prev));
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

  /**
   * Everything a catch-up job needs to be rebuilt: the job row, every year's
   * filing, and every year's transactions.
   *
   * Extracted because the fax path needs exactly the same load as the download
   * path, and two copies of a query that decides which years go to the IRS is
   * one copy too many.
   */
  const loadJobYears = async (jobId: string) => {
    const { data: job } = await supabase
      .from('filing_jobs').select('include_rcl, rcl_narrative, reasonable_cause_reasons').eq('id', jobId).single();

    const { data: yearFilings, error: yfErr } = await supabase
      .from('filings').select('*').eq('job_id', jobId);
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
    return { job, yearFilings: yearFilings as Filing[], years };
  };

  const handleGenerateJob = async (mode: 'bundle' | 'per-year') => {
    if (!filing?.job_id || !isPaid) return;
    setGenerating(true);
    setGenErr(null);
    try {
      const { job, yearFilings, years } = await loadJobYears(filing.job_id);

      const { generateMultiYearPackage, narrativeFromReasonCodes, refuseUnsupportedText } =
        await import('../../lib/pdfGenerator');
      // One letter covers all years: free-text narrative wins, else build it
      // from the reasons collected once at job setup.
      const jobNarrative =
        (job?.rcl_narrative?.trim() || null) ||
        narrativeFromReasonCodes((job as any)?.reasonable_cause_reasons, years.length);

      // No `fax: true`: see handleGenerate. This is the filer's copy.
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

      // Every year in the catch-up was just delivered, in either mode, so every
      // year is marked. Marking only the anchor filing would leave the rest of
      // the job sitting in "Ready to download" with the forms already on disk.
      await markDownloaded(yearFilings as Filing[]);
      // As on the single-year path, the fax is its own click now. See
      // handleGenerate.
    } catch (err) {
      setGenErr(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Build the transmission-ready package, for FaxPanel.
   *
   * The same function serves three callers, deliberately: sending the fax,
   * rebuilding the filer's copy of what was sent, and telling the confirmation
   * what the package contained. One builder means the receipt cannot describe a
   * different set of documents from the one that went to Ogden.
   *
   * `sentOn` dates the cover page. Omitted when sending; passed as the recorded
   * submit time when reproducing a fax already sent, so the filer's copy is the
   * document the IRS holds and not a fresh one wearing today's date.
   */
  const buildFax = async (opts?: { sentOn?: Date }): Promise<FaxBuild> => {
    if (!filing) throw new Error('This filing is still loading.');

    const { refuseUnsupportedText } = await import('../../lib/pdfGenerator');

    if (filing.job_id) {
      const { job, yearFilings, years } = await loadJobYears(filing.job_id);
      const { generateMultiYearPackage, narrativeFromReasonCodes } =
        await import('../../lib/pdfGenerator');
      const jobNarrative =
        (job?.rcl_narrative?.trim() || null) ||
        narrativeFromReasonCodes((job as any)?.reasonable_cause_reasons, years.length);

      const pkg = await generateMultiYearPackage(years, {
        includeRCL: !!job?.include_rcl,
        rclNarrative: jobNarrative,
        fax: true,
        sentOn: opts?.sentOn,
        drawnSignature,
      });
      const refusal = refuseUnsupportedText(pkg.unsupportedText);
      if (refusal) throw new Error(refusal);
      if (!pkg.faxPayload) throw new Error('The IRS fax package could not be assembled.');

      return {
        payload: pkg.faxPayload,
        formCount: pkg.perYear.reduce((sum, y) => sum + y.formCount, 0),
        hasRCL: !!pkg.reasonableCauseLetter,
        // Mirrors wants7004() in pdfGenerator, which is what actually decides
        // whether a 7004 is in the package. Any year carrying one puts one in
        // the transmission, because the transmission is the whole job.
        has7004: yearFilings.some((f) => f.include_7004 === true || f.extension_filed === true),
        taxYears: pkg.taxYears,
      };
    }

    // Single year. Re-read rather than using the loaded copy: a correcting edit
    // in another tab must not be faxed away.
    const { data: fi, error: fiErr } = await supabase
      .from('filings').select('*').eq('id', filing.id).single();
    if (fiErr || !fi) throw new Error(fiErr?.message ?? 'This filing could not be loaded.');
    const { data: txns, error: txErr } = await supabase
      .from('reportable_transactions').select('*').eq('filing_id', filing.id);
    if (txErr) throw txErr;

    const { generateFilingPackage } = await import('../../lib/pdfGenerator');
    const pkg = await generateFilingPackage(fi, txns ?? [], undefined, {
      drawnSignature,
      fax: true,
      sentOn: opts?.sentOn,
    });
    const refusal = refuseUnsupportedText(pkg.unsupportedText);
    if (refusal) throw new Error(refusal);
    if (!pkg.faxPayload) throw new Error('The IRS fax package could not be assembled.');

    return {
      payload: pkg.faxPayload,
      formCount: pkg.formCount,
      hasRCL: !!pkg.reasonableCauseLetter,
      has7004: !!pkg.form7004,
      taxYears: [Number(fi.tax_year)],
    };
  };

  // ── render ────────────────────────────────────────────────────────────────

  // Which parts the package will actually contain.
  //
  // The Part V set is imported rather than restated. It used to be a literal
  // array here and a second literal in pdfGenerator.ts, which is two places to
  // change and one screen that would have gone on promising a statement the
  // package no longer produced. filingMapping owns it now; pdfGenerator cannot
  // be imported here without pulling pdf-lib into the main bundle.
  const hasPartV = transactions.some((t) => PART_V_TX_TYPES.has(t.transaction_type));
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
                  <IncludedItem icon="" label="Pro Forma 1120" desc="US corporation income tax return" />
                  <IncludedItem icon="" label="Form 5472" desc="Information return for 25%-foreign-owned US corporations" />
                  {hasPartV && (
                    <IncludedItem icon="" label="Part V Statement" desc="Monetary transactions: distributions, dividends, capital contributions, formation costs" />
                  )}
                  <IncludedItem icon="" label="Part VI Statement" desc="Nonmonetary / less-than-FMV transactions" />
                  {has7004 && (
                    <IncludedItem icon="" label="Form 7004" desc="6-month extension to file, included with your package" />
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
                    />
                  )}
                  {/* Same rule as the letter above, and the same defect avoided:
                      the filer is charged for this, so it is named on the screen
                      where they pay. It is a service rather than a document, so
                      it sits last, after the things that end up in the PDF. */}
                  {filing?.include_irs_fax && (
                    <IncludedItem
                      icon=""
                      label="IRS Fax Transmission"
                      desc="We fax the completed package to the IRS and send you the confirmation, charged once however many years it covers"
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
                        {/* The canonical label, not the raw code run through
                            CSS `capitalize`, which produced "Loan To Llc" on
                            the page a filer reads after paying. Falls back to
                            the code only for a type this build does not know. */}
                        <span style={{ fontWeight: 600 }}>
                          {TX_TYPES.find((t) => t.value === tx.transaction_type)?.label
                            ?? tx.transaction_type.replace(/_/g, ' ')}
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
                          ${formatAmount(tx.amount_usd)}
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
                {/* Not on a faxed filing: the intake refuses the write, so this
                    only ever led somewhere that would turn the filer away. */}
                {!faxLocked && (
                  <button
                    onClick={() => id && navigate(`/intake?filing_id=${id}`)}
                    style={{ ...secondaryBtnStyle, marginTop: '1rem', display: 'inline-block' }}
                  >
                    ← Back to intake to add transactions
                  </button>
                )}
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
                    {isRelatedPartyTopUp
                      ? `${relatedPartyCount - Number(filing?.paid_related_party_count ?? 0)} additional related ${relatedPartyCount - Number(filing?.paid_related_party_count ?? 0) === 1 ? 'party requires' : 'parties require'} payment. After payment, you can generate and download the updated filing package.`
                      : 'Your checkout is calculated from the tax years and optional services in this filing. After payment, you can generate and download the filing package.'}
                  </p>
                  {/* The figure, before the button, not after the redirect.
                      This page asked for a card without ever naming a price:
                      the first number in the flow was on Dodo's checkout. */}
                  {paymentCart.total > 0 && (
                    <div style={{
                      padding: '1rem 1.125rem',
                      border: '1px solid var(--tf-border)',
                      borderRadius: '0.625rem',
                      background: 'var(--tf-offset)',
                      marginBottom: '1rem',
                    }}>
                      {paymentCart.lines.map((line) => (
                        <div
                          key={line.label}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '1.5rem',
                            fontSize: '0.95rem',
                            color: 'var(--tf-text)',
                            marginBottom: '0.625rem',
                          }}
                        >
                          <span>{line.label}</span>
                          <span style={{ whiteSpace: 'nowrap' }}>${formatAmount(line.amount)}</span>
                        </div>
                      ))}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '1.5rem',
                        paddingTop: '0.875rem',
                        marginTop: '0.25rem',
                        borderTop: '1px solid var(--tf-border)',
                        fontWeight: 700,
                        color: 'var(--tf-text)',
                        fontSize: '1.0625rem',
                      }}>
                        <span>{(jobPartiesByYear?.length ?? 0) > 1 ? 'Total for every year' : 'Total'}</span>
                        <span style={{ whiteSpace: 'nowrap' }}>${formatAmount(paymentCart.total)}</span>
                      </div>
                    </div>
                  )}
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
                      : isRelatedPartyTopUp
                        ? 'Pay for the additional related party'
                        : 'Continue to secure checkout'}
                  </button>
                  {/* Our prices exclude tax, and until this line the first a
                      filer heard of it was the processor turning a $332 cart
                      into $391.76. Saying it here costs one muted sentence;
                      putting the real figure on this page would mean asking
                      Dodo for a tax quote before checkout, which is a large
                      change for a number they see thirty seconds later.
                      The sentence naming billing country and currency was cut
                      on the owner's instruction, 8 August 2026: the itemised
                      total above already tells the filer what they are paying,
                      and the qualifications were longer than the fact. */}
                  <p style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', lineHeight: 1.5, marginTop: '0.75rem', marginBottom: 0 }}>
                    Prices exclude tax.
                  </p>
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
              {/* A faxed filing is read-only, NOT unreachable. Hiding this
                  button took away the filer's own record of what they told the
                  IRS, which is exactly what they need in front of them when
                  they file next year. The intake freezes every field for a
                  faxed filing (AccordionSection's `frozen`), so this opens the
                  answers to be read, not edited. */}
              <button
                onClick={() => id && navigate(`/intake?filing_id=${id}`)}
                style={secondaryBtnStyle}
                type="button"
              >
                {faxLocked ? '← View your answers' : '← Edit Filing'}
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
                    {generating ? 'Generating…' : 'Generate & download'}
                  </button>
                )}
              </div>}
            </div>

            {/* The "Your filing package is ready" card that used to sit here is
                gone. It named the file just downloaded and offered a second
                Download PDF button, which put two buttons on screen doing the
                same thing: the primary one below the signature pad, and the
                card's. One action, one button. Generating downloads the file,
                and generating again downloads it again, deterministically from
                the same saved row.

                Earlier shapes, for anyone tempted to bring it back: an inline
                75vh PDF, which handed the page to the browser's own viewer and
                read as if the app had been replaced by Adobe, then a preview
                overlay, which went because the filer already reviewed these
                forms before paying. */}

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

            {/* ── IRS fax ──────────────────────────────────────────────────
                Last on the page, and that is the ladder: pay, generate and
                download your own copy, then send it, then take the
                confirmation away. Each rung is its own click and each one is
                only reachable once the rung below it is done.

                The entitlement is deliberately NOT tested here. It was, and
                that made the offer state unreachable: the panel decided it had
                something to sell and this line had already decided there was
                nothing to render. One fact, two places, which is the failure
                this codebase keeps repeating. The panel owns it now, and it
                returns null for an unpaid filing. */}
            {isPaid && filing && (
              <FaxPanel filing={filing} build={buildFax} busy={generating} />
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

// Every row in this list is a document the package will contain. There is no
// "if applicable" badge: a row that might not apply is a row that should not be
// rendered, and each caller is already gated on the condition that decides it.
function IncludedItem({
  icon, label, desc,
}: {
  icon: string;
  label: string;
  desc: string;
}) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
      <span style={{ fontSize: '1rem', lineHeight: 1.4, flexShrink: 0 }}>{icon}</span>
      <div>
        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
          {label}
        </span>
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

// faxNoticeFor() lived here and told the filer what a dispatch had just done.
// It is gone with the transient banner it fed: the dispatch result is no longer
// the only thing the page knows about the fax. FaxPanel reads the transmission
// row itself and says what the transmission IS, which survives a refresh.

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
