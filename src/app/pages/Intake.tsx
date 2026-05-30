import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router';
import JSZip from 'jszip';
import {
  supabase,
  type Filing,
  type FilingTransaction,
  type FilingTransactionCategory,
  type Address,
} from '../../lib/supabase';
import { generateFilingPackage } from '../../lib/pdfGenerator';
import { CountrySelect } from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

const TX_CATEGORY_LABEL: Record<FilingTransactionCategory, string> = {
  capital_contribution: 'Capital contribution',
  distribution: 'Distribution to owner',
  loan_to_llc: 'Loan to the LLC',
  loan_from_llc: 'Loan from the LLC',
  service_payment: 'Service payment',
  rent_royalty: 'Rent or royalty',
  other: 'Other',
};

const TX_CATEGORIES = Object.keys(TX_CATEGORY_LABEL) as FilingTransactionCategory[];

const SERVICE_LABEL = {
  current_year: 'Form 5472 + Pro Forma 1120',
  past_year: 'Past Year Filing + Reasonable Cause Letter',
  tax_classification: 'LLC Tax Classification Change',
};

function calcPriceCents(filing: Filing): number {
  let cents = 0;
  if (filing.service_type === 'current_year') cents += 15000;
  else if (filing.service_type === 'past_year') cents += 15000;
  else if (filing.service_type === 'tax_classification') cents += 5000;
  if (filing.include_rcl) cents += 20000;
  if (filing.include_irs_fax) cents += 3000;
  return cents;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

export function Intake() {
  usePageMeta({ title: 'Filing intake | FileTax.co', description: 'Complete your filing.' });

  const { filingId } = useParams<{ filingId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [filing, setFiling] = useState<Filing | null>(null);
  const [transactions, setTransactions] = useState<FilingTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<number>(1);

  // Download state
  const [generating, setGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [taxYear, setTaxYear] = useState('');
  const [mailing, setMailing] = useState<Address>({});

  const [ownerName, setOwnerName] = useState('');
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCit, setOwnerCountryCit] = useState('');
  const [ownerPassport, setOwnerPassport] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});

  const [includeFax, setIncludeFax] = useState(false);
  const [includeRcl, setIncludeRcl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user || !filingId) return;
      setLoading(true);

      const { data, error } = await supabase.from('filings').select('*').eq('id', filingId).single();

      if (cancelled) return;

      if (error || !data) {
        setError('Could not load this filing. It may not exist or belong to another account.');
        setLoading(false);
        return;
      }

      let f = data as Filing;

      const paymentStatus = searchParams.get('status');
      const paymentId = searchParams.get('payment_id');

      if (paymentStatus === 'succeeded' && paymentId && f.status !== 'paid' && f.status !== 'completed') {
        setVerifying(true);
        const cents = calcPriceCents(f);
        const now = new Date().toISOString();
        const { error: updateErr } = await supabase
          .from('filings')
          .update({ status: 'paid', paid_at: now, payment_id: paymentId, payment_amount_cents: cents, forms_generated_at: now })
          .eq('id', f.id);
        setVerifying(false);
        if (!updateErr) {
          f = { ...f, status: 'paid', paid_at: now, payment_id: paymentId, payment_amount_cents: cents, forms_generated_at: now };
        }
        searchParams.delete('status');
        searchParams.delete('payment_id');
        setSearchParams(searchParams, { replace: true });
      } else if ((paymentStatus === 'failed' || paymentStatus === 'cancelled') && f.status !== 'paid' && f.status !== 'completed') {
        await supabase.from('filings').update({ status: 'payment_failed' }).eq('id', f.id);
        f = { ...f, status: 'payment_failed' };
        searchParams.delete('status');
        searchParams.delete('payment_id');
        setSearchParams(searchParams, { replace: true });
      }

      setFiling(f);
      setStep(f.current_step);
      setLlcName(f.llc_name ?? '');
      setEin(f.ein ?? '');
      setStateOfFormation(f.state_of_formation ?? '');
      setTaxYear(f.tax_year ?? '');
      setMailing(f.mailing_address ?? {});

      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const metaName = typeof meta.full_name === 'string' ? meta.full_name : '';
      setOwnerName(f.owner_full_name ?? metaName ?? '');
      setOwnerCountryRes(f.owner_country_residence ?? '');
      setOwnerCountryCit(f.owner_country_citizenship ?? '');
      setOwnerPassport(f.owner_passport_number ?? '');
      setOwnerForeignTaxId(f.owner_foreign_tax_id ?? '');
      setOwnerAddress(f.owner_address ?? {});
      setIncludeFax(f.include_irs_fax);
      setIncludeRcl(f.include_rcl);

      const tx = await supabase.from('filing_transactions').select('*').eq('filing_id', f.id).order('created_at', { ascending: true });
      if (!cancelled && tx.data) setTransactions(tx.data as FilingTransaction[]);

      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filingId]);

  function patchFromCurrentStep() {
    if (step === 1) return { llc_name: llcName.trim() || null, ein: ein.trim() || null, state_of_formation: stateOfFormation.trim() || null, tax_year: taxYear.trim() || null, mailing_address: mailing };
    if (step === 2) return { owner_full_name: ownerName.trim() || null, owner_country_residence: ownerCountryRes.trim() || null, owner_country_citizenship: ownerCountryCit.trim() || null, owner_passport_number: ownerPassport.trim() || null, owner_foreign_tax_id: ownerForeignTaxId.trim() || null, owner_address: ownerAddress };
    if (step === 3) return { include_irs_fax: includeFax, include_rcl: includeRcl };
    return {};
  }

  async function saveAndContinue() {
    if (!filing || saving) return;
    setSaving(true);
    setError('');
    const patch = patchFromCurrentStep();
    const nextStep = Math.min(step + 1, 4);
    const { error } = await supabase.from('filings').update({ ...patch, current_step: nextStep, status: 'in_progress' }).eq('id', filing.id);
    setSaving(false);
    if (error) { setError(error.message); return; }
    setFiling((f) => f ? { ...f, ...patch, current_step: nextStep, status: 'in_progress' } as Filing : f);
    setStep(nextStep);
    window.scrollTo({ top: 0 });
  }

  async function goBack() {
    if (step <= 1) { navigate('/dashboard'); return; }
    setStep(step - 1);
    window.scrollTo({ top: 0 });
  }

  async function addTransaction() {
    if (!filing) return;
    const { data, error } = await supabase
      .from('filing_transactions')
      .insert({ filing_id: filing.id, category: 'capital_contribution', direction: 'to_llc', amount: 0, currency: 'USD' })
      .select('*').single();
    if (error || !data) { setError(error?.message ?? 'Could not add transaction.'); return; }
    setTransactions((arr) => [...arr, data as FilingTransaction]);
  }

  async function updateTx(id: string, patch: Partial<FilingTransaction>) {
    setTransactions((arr) => arr.map((t) => t.id === id ? { ...t, ...patch } : t));
    const { error } = await supabase.from('filing_transactions').update(patch).eq('id', id);
    if (error) setError(error.message);
  }

  async function removeTx(id: string) {
    setTransactions((arr) => arr.filter((t) => t.id !== id));
    const { error } = await supabase.from('filing_transactions').delete().eq('id', id);
    if (error) setError(error.message);
  }

  async function payAndDownload() {
    if (!filing || paying) return;
    setPaying(true);
    setError('');
    const cents = calcPriceCents(filing);
    const now = new Date().toISOString();
    const mockPaymentId = 'mock_' + Math.random().toString(36).slice(2, 10);
    const { error } = await supabase
      .from('filings')
      .update({ status: 'paid', paid_at: now, payment_amount_cents: cents, payment_id: mockPaymentId, forms_generated_at: now })
      .eq('id', filing.id);
    setPaying(false);
    if (error) { setError(error.message); return; }
    setFiling((f) => f ? { ...f, status: 'paid', paid_at: now, payment_id: mockPaymentId, payment_amount_cents: cents, forms_generated_at: now } as Filing : f);
    window.scrollTo({ top: 0 });
  }

  async function retryPayment() {
    if (!filing) return;
    setError('');
    await supabase.from('filings').update({ status: 'in_progress' }).eq('id', filing.id);
    setFiling((f) => f ? { ...f, status: 'in_progress' } as Filing : f);
    setStep(4);
    window.scrollTo({ top: 0 });
  }

  async function handleDownload() {
    if (!filing) return;
    setGenerating(true);
    setDownloadError('');
    try {
      const txsForPdf = transactions.map((tx) => ({
        ...tx,
        amount_usd: tx.amount,
        transaction_type: tx.category,
      })) as any;

      const pkg = await generateFilingPackage(filing, txsForPdf);

      const zip = new JSZip();
      const folderName = `Form5472_${filing.llc_name?.replace(/\s+/g, '_') ?? 'Filing'}_${filing.tax_year ?? ''}`;
      const folder = zip.folder(folderName)!;

      folder.file('Form_5472.pdf', pkg.form5472Bytes);
      folder.file('ProForma_1120.pdf', pkg.proForma1120Bytes);
      if (pkg.hasPartV) {
        folder.file('PartV_Statement.txt', pkg.partVStatement);
      }
      // Part VI statement PDF — always included
      folder.file('PartVI_Statement.pdf', pkg.partVIStatementBytes);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      // Update download count and mark completed
      const newCount = (filing.download_count ?? 0) + 1;
      await supabase
        .from('filings')
        .update({ download_count: newCount, status: 'completed' })
        .eq('id', filing.id);
      setFiling((f) => f ? { ...f, download_count: newCount, status: 'completed' } as Filing : f);
    } catch (e: any) {
      console.error('[download]', e);
      setDownloadError(
        e?.message?.includes('Could not load PDF')
          ? 'PDF templates not found. In your Codespace terminal run: bash scripts/download-irs-pdfs.sh'
          : (e?.message ?? 'Failed to generate PDF. Please try again.'),
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 500 }}>Loading...</p>
      </section>
    );
  }

  if (!filing) {
    return (
      <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem' }}>Filing not found</h1>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '1rem' }}>{error}</p>
        <Link to="/dashboard" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>Back to Dashboard</Link>
      </section>
    );
  }

  const isPaid = filing.status === 'paid' || filing.status === 'completed';
  const isFailed = filing.status === 'payment_failed';
  const priceCents = calcPriceCents(filing);

  if (verifying) {
    return (
      <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', width: '36px', height: '36px', border: '3px solid var(--tf-border)', borderTopColor: '#0284C7', borderRadius: '50%', animation: 'tf-spin 0.8s linear infinite', marginBottom: '1rem' }} />
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.25rem' }}>Verifying your payment</h2>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 400 }}>This usually takes a few seconds. Please do not close this window.</p>
        <style>{`@keyframes tf-spin { to { transform: rotate(360deg); } }`}</style>
      </section>
    );
  }

  if (isFailed) {
    return (
      <>
        <section style={{ background: 'var(--tf-bg)', padding: '3rem 1rem 1.5rem' }}>
          <div style={{ maxWidth: '760px', margin: '0 auto' }}>
            <Link to="/dashboard" style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' }}>Back to Dashboard</Link>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', marginBottom: '0.25rem', lineHeight: 1.2 }}>{SERVICE_LABEL[filing.service_type]}</h1>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>Your data is safe. Try the payment again.</p>
          </div>
        </section>
        <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 3rem' }}>
          <div style={{ maxWidth: '760px', margin: '0 auto' }}>
            <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>
              <div style={{ textAlign: 'center', paddingBottom: '1.25rem', borderBottom: '1px solid var(--tf-border)', marginBottom: '1.25rem' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', borderRadius: '9999px', background: 'rgba(179,29,29,0.1)', marginBottom: '0.75rem' }}>
                  <span style={{ color: '#B31D1D', fontSize: '1.5rem', fontWeight: 700 }}>!</span>
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>Payment did not go through</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, lineHeight: 1.5 }}>No charge was made. Your filing details are saved, so you can try again whenever you are ready.</p>
              </div>
              <div style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.875rem 1.125rem', marginBottom: '1rem' }}>
                <p style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--tf-text)', marginBottom: '0.5rem' }}>Common reasons</p>
                <ul style={{ margin: 0, paddingLeft: '1.125rem', color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.7 }}>
                  <li>Card was declined by the issuer</li>
                  <li>Insufficient funds or daily limit reached</li>
                  <li>The browser tab was closed before payment finished</li>
                </ul>
              </div>
              <button onClick={retryPayment} style={{ width: '100%', background: '#0284C7', color: 'white', border: 'none', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '44px', marginBottom: '0.5rem' }}>Try payment again</button>
              <Link to="/dashboard" style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', background: 'var(--tf-bg)', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '44px' }}>Save and finish later</Link>
            </div>
            <p style={{ textAlign: 'center', color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, marginTop: '1rem' }}>
              Stuck? Email <a href="mailto:hello@filetax.co" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>hello@filetax.co</a>
              {filing.payment_id ? <> with reference <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{filing.payment_id}</span></> : null}
            </p>
          </div>
        </section>
      </>
    );
  }

  if (isPaid) {
    return (
      <>
        <section style={{ background: 'var(--tf-bg)', padding: '3rem 1rem 1.5rem' }}>
          <div style={{ maxWidth: '760px', margin: '0 auto' }}>
            <Link to="/dashboard" style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' }}>Back to Dashboard</Link>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', marginBottom: '0.25rem', lineHeight: 1.2 }}>{SERVICE_LABEL[filing.service_type]}</h1>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>Your forms are ready to download.</p>
            <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.5rem' }}>
              {[1, 2, 3, 4].map((n) => (<div key={n} style={{ flex: 1, height: '4px', borderRadius: '9999px', background: '#059669' }} />))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--tf-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              <span>LLC info</span><span>Owner</span><span>Transactions</span><span style={{ color: '#059669' }}>Complete</span>
            </div>
          </div>
        </section>

        {filing.paid_at && (
          <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 1rem' }}>
            <div style={{ maxWidth: '760px', margin: '0 auto' }}>
              <div style={{ background: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.3)', borderRadius: '0.75rem', padding: '0.875rem 1.125rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '9999px', background: '#059669', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: '0.875rem' }}>✓</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text)', marginBottom: '0.25rem' }}>Payment received</p>
                  <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.6 }}>
                    {formatCents(filing.payment_amount_cents ?? priceCents)} on {new Date(filing.paid_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    {filing.payment_id ? <> (Ref: <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{filing.payment_id}</span>)</> : null}
                  </p>
                  {user?.email && (
                    <p style={{ color: 'var(--tf-muted)', fontSize: '0.75rem', fontWeight: 400, marginTop: '0.25rem' }}>A receipt was emailed to {user.email}.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 3rem' }}>
          <div style={{ maxWidth: '760px', margin: '0 auto' }}>
            <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>
              <div style={{ textAlign: 'center', paddingBottom: '1.25rem', borderBottom: '1px solid var(--tf-border)', marginBottom: '1.25rem' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', borderRadius: '9999px', background: 'rgba(5,150,105,0.1)', marginBottom: '0.75rem' }}>
                  <span style={{ color: '#059669', fontSize: '1.5rem', fontWeight: 700 }}>✓</span>
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>Your forms are ready</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>Print-ready PDFs, structured exactly as the IRS requires.</p>
              </div>

              {/* Download error */}
              {downloadError && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#991B1B', fontSize: '0.875rem', lineHeight: 1.5 }}>
                  {downloadError}
                </div>
              )}

              {/* Completed badge */}
              {filing.status === 'completed' && !downloadError && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '9999px', padding: '0.3rem 0.85rem', fontSize: '0.8125rem', fontWeight: 700, color: '#065F46', marginBottom: '1rem' }}>
                  ✓ Forms downloaded — filing marked complete
                </div>
              )}

              <DownloadRow
                title={`Form 5472 (Tax year ${filing.tax_year ?? 'n/a'})`}
                subtitle="Ready to mail or fax"
                generating={generating}
                onDownload={handleDownload}
              />
              <DownloadRow
                title="Pro Forma Form 1120"
                subtitle="Submit alongside Form 5472"
                generating={generating}
                onDownload={handleDownload}
              />
              <DownloadRow
                title="Part VI Statement"
                subtitle="Disclosure of uncompensated management services — Treas. Reg. § 1.6038A-2(b)(7)(ix)"
                generating={generating}
                onDownload={handleDownload}
              />
              {filing.include_rcl && (
                <DownloadRow
                  title="Reasonable Cause Letter"
                  subtitle="CPA-prepared. For penalty abatement."
                  generating={generating}
                  onDownload={handleDownload}
                />
              )}
              <div style={{ background: 'rgba(2,132,199,0.04)', border: '1px solid rgba(2,132,199,0.25)', borderRadius: '0.5rem', padding: '1rem 1.125rem', marginTop: '1.25rem' }}>
                <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--tf-text)', marginBottom: '0.25rem' }}>Next steps</p>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.55 }}>Print the forms, sign where indicated, and mail to the IRS at the address shown on Form 5472. Most filers also keep a digital copy in their records.</p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <Link to="/dashboard" style={{ background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>Done</Link>
            </div>
          </div>
        </section>
        <style>{`@keyframes tf-spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  // ── Step renderer ────────────────────────────────────────────────────────────

  const stepLabels = ['LLC info', 'Owner', 'Transactions', 'Review & pay'];

  return (
    <>
      {/* Progress header */}
      <section style={{ background: 'var(--tf-bg)', padding: '3rem 1rem 1.5rem' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <Link to="/dashboard" style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' }}>Back to Dashboard</Link>
          <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', marginBottom: '0.25rem', lineHeight: 1.2 }}>{SERVICE_LABEL[filing.service_type]}</h1>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>Step {step} of 4</p>
          <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.5rem' }}>
            {[1, 2, 3, 4].map((n) => (
              <div key={n} style={{ flex: 1, height: '4px', borderRadius: '9999px', background: n <= step ? '#0284C7' : 'var(--tf-border)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--tf-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {stepLabels.map((label, i) => (
              <span key={label} style={{ color: i + 1 === step ? '#0284C7' : 'var(--tf-muted)' }}>{label}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Step body */}
      <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 3rem' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#991B1B', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>

            {/* ── Step 1: LLC Info ── */}
            {step === 1 && (
              <>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem' }}>LLC information</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <FieldRow label="Legal LLC name" id="llc-name">
                    <input id="llc-name" type="text" value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Ventures LLC" style={inputStyle} />
                  </FieldRow>
                  <FieldRow label="EIN" id="ein">
                    <input id="ein" type="text" value={ein} onChange={(e) => setEin(e.target.value)} placeholder="XX-XXXXXXX" style={inputStyle} />
                  </FieldRow>
                  <FieldRow label="State of formation" id="state">
                    <input id="state" type="text" value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)} placeholder="e.g. Wyoming" style={inputStyle} />
                  </FieldRow>
                  <FieldRow label="Tax year" id="tax-year">
                    <input id="tax-year" type="text" value={taxYear} onChange={(e) => setTaxYear(e.target.value)} placeholder="e.g. 2024" style={inputStyle} />
                  </FieldRow>
                  <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                    <legend style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--tf-text)', marginBottom: '0.75rem' }}>Mailing address</legend>
                    <AddressFields value={mailing} onChange={setMailing} />
                  </fieldset>
                </div>
              </>
            )}

            {/* ── Step 2: Owner Info ── */}
            {step === 2 && (
              <>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem' }}>Foreign owner information</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <FieldRow label="Full legal name" id="owner-name">
                    <input id="owner-name" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="As shown on passport" style={inputStyle} />
                  </FieldRow>
                  <CountrySelect
                    id="owner-country-res"
                    label="Country of residence"
                    value={ownerCountryRes}
                    onChange={setOwnerCountryRes}
                  />
                  <CountrySelect
                    id="owner-country-cit"
                    label="Country of citizenship"
                    value={ownerCountryCit}
                    onChange={setOwnerCountryCit}
                  />
                  <FieldRow label="Passport number" id="owner-passport">
                    <input id="owner-passport" type="text" value={ownerPassport} onChange={(e) => setOwnerPassport(e.target.value)} placeholder="Optional" style={inputStyle} />
                  </FieldRow>
                  <FieldRow label="Foreign tax ID" id="owner-ftid">
                    <input id="owner-ftid" type="text" value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="Optional" style={inputStyle} />
                  </FieldRow>
                  <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                    <legend style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--tf-text)', marginBottom: '0.75rem' }}>Owner address</legend>
                    <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
                  </fieldset>
                </div>
              </>
            )}

            {/* ── Step 3: Transactions ── */}
            {step === 3 && (
              <>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>Transactions</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                  Add every transaction between the LLC and its foreign owner during the tax year.
                  Leave this section empty if there were no reportable transactions.
                </p>
                {transactions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                    {transactions.map((tx) => (
                      <div key={tx.id} style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.875rem 1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--tf-muted)' }}>Type</label>
                            <select
                              value={tx.category}
                              onChange={(e) => updateTx(tx.id, { category: e.target.value as FilingTransactionCategory })}
                              style={{ ...inputStyle, fontSize: '0.875rem' }}
                            >
                              {TX_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>{TX_CATEGORY_LABEL[cat]}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--tf-muted)' }}>Amount (USD)</label>
                            <input
                              type="number"
                              min={0}
                              value={tx.amount ?? 0}
                              onChange={(e) => updateTx(tx.id, { amount: parseFloat(e.target.value) || 0 })}
                              style={{ ...inputStyle, fontSize: '0.875rem' }}
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => removeTx(tx.id)}
                          style={{ fontSize: '0.8125rem', color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={addTransaction}
                  style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0284C7', background: 'none', border: '1px dashed #93C5FD', borderRadius: '0.5rem', padding: '0.625rem 1rem', cursor: 'pointer', width: '100%', minHeight: '44px' }}
                >
                  + Add transaction
                </button>
              </>
            )}

            {/* ── Step 4: Review & Pay ── */}
            {step === 4 && (
              <>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.5rem' }}>Review &amp; pay</h2>
                <ReviewRow label="LLC name" value={filing.llc_name ?? '—'} />
                <ReviewRow label="EIN" value={filing.ein ?? '—'} />
                <ReviewRow label="Tax year" value={filing.tax_year ?? '—'} />
                <ReviewRow label="Foreign owner" value={filing.owner_full_name ?? '—'} />
                <ReviewRow label="Country of residence" value={filing.owner_country_residence ?? '—'} />
                <ReviewRow label="Country of citizenship" value={filing.owner_country_citizenship ?? '—'} />
                <ReviewRow label="Transactions" value={`${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`} />
                <div style={{ borderTop: '1px solid var(--tf-border)', marginTop: '1rem', paddingTop: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', fontSize: '0.9375rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={includeFax} onChange={(e) => setIncludeFax(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      <span>IRS fax delivery <span style={{ color: 'var(--tf-muted)', fontWeight: 400 }}>(+$30)</span></span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', fontSize: '0.9375rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={includeRcl} onChange={(e) => setIncludeRcl(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                      <span>Reasonable cause letter <span style={{ color: 'var(--tf-muted)', fontWeight: 400 }}>(+$200)</span></span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.125rem', fontWeight: 700, marginBottom: '1.25rem' }}>
                    <span>Total</span>
                    <span>{formatCents(priceCents)}</span>
                  </div>
                  <button
                    onClick={payAndDownload}
                    disabled={paying}
                    style={{ width: '100%', background: '#0284C7', color: 'white', border: 'none', fontWeight: 700, fontSize: '1rem', padding: '0.875rem 1rem', borderRadius: '0.5rem', cursor: paying ? 'not-allowed' : 'pointer', minHeight: '48px', opacity: paying ? 0.7 : 1 }}
                  >
                    {paying ? 'Processing…' : `Pay ${formatCents(priceCents)} and generate forms`}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', gap: '0.75rem' }}>
            <button
              onClick={goBack}
              style={{ background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '44px' }}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 4 && (
              <button
                onClick={saveAndContinue}
                disabled={saving}
                style={{ background: '#0284C7', color: 'white', border: 'none', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.5rem', borderRadius: '0.5rem', cursor: saving ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : 'Save and continue'}
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5625rem 0.75rem',
  fontSize: '0.9375rem',
  color: 'var(--tf-text)',
  background: 'var(--tf-bg)',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.5rem',
  minHeight: '44px',
  boxSizing: 'border-box',
};

function FieldRow({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label htmlFor={id} style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--tf-text)', letterSpacing: '0.01em' }}>{label}</label>
      {children}
    </div>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  const upd = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input placeholder="Street line 1" value={value.line1 ?? ''} onChange={upd('line1')} style={inputStyle} />
      <input placeholder="Street line 2 (optional)" value={value.line2 ?? ''} onChange={upd('line2')} style={inputStyle} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <input placeholder="City" value={value.city ?? ''} onChange={upd('city')} style={inputStyle} />
        <input placeholder="State / Region" value={value.region ?? ''} onChange={upd('region')} style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <input placeholder="Postal code" value={value.postal_code ?? ''} onChange={upd('postal_code')} style={inputStyle} />
        <CountrySelect
          id="address-country"
          label=""
          value={value.country ?? ''}
          onChange={(v) => onChange({ ...value, country: v })}
          style={{ gap: 0 }}
        />
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--tf-border)', fontSize: '0.9375rem' }}>
      <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function DownloadRow({ title, subtitle, generating, onDownload }: { title: string; subtitle: string; generating: boolean; onDownload: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid var(--tf-border)', gap: '1rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.125rem' }}>{title}</p>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem' }}>{subtitle}</p>
      </div>
      <button
        onClick={onDownload}
        disabled={generating}
        style={{ background: generating ? 'var(--tf-border)' : '#0284C7', color: generating ? 'var(--tf-muted)' : 'white', border: 'none', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: generating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', minHeight: '44px', flexShrink: 0 }}
      >
        {generating ? 'Generating…' : 'Download ZIP'}
      </button>
    </div>
  );
}
