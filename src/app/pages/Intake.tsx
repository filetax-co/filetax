import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router';
import {
  supabase,
  type Filing,
  type Transaction,
  type Address,
} from '../../lib/supabase';

type TxCategory =
  | 'capital_contribution'
  | 'distribution'
  | 'loan_to_llc'
  | 'loan_from_llc'
  | 'service_payment'
  | 'rent_royalty'
  | 'other';
import { assembleFilingPackage } from '../../lib/pdfGenerator';
import { CountrySelect } from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

const TX_CATEGORY_LABEL: Record<TxCategory, string> = {
  capital_contribution: 'Capital contribution',
  distribution: 'Distribution to owner',
  loan_to_llc: 'Loan to the LLC',
  loan_from_llc: 'Loan from the LLC',
  service_payment: 'Service payment',
  rent_royalty: 'Rent or royalty',
  other: 'Other',
};

const TX_CATEGORIES = Object.keys(TX_CATEGORY_LABEL) as TxCategory[];

// On Form 5472, "received" lines (9-22) reflect amounts the LLC received,
// "paid" lines (23-36) reflect amounts the LLC paid out.
// Owner -> LLC means the LLC RECEIVED it. LLC -> Owner means the LLC PAID.
function defaultDirectionFor(cat: TxCategory): 'paid' | 'received' {
  if (cat === 'distribution' || cat === 'loan_from_llc') return 'paid';
  return 'received';
}

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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
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

      // SECURITY: never trust ?status=succeeded from the URL — it is
      // attacker-controllable. Always hand the payment_id to a server-only
      // edge function that verifies the charge with the PSP webhook secret
      // before marking the filing paid.
      if (paymentStatus === 'succeeded' && paymentId && f.status !== 'paid' && f.status !== 'completed') {
        setVerifying(true);
        const { data: verifyData, error: verifyErr } = await supabase.functions.invoke(
          'verify-payment',
          { body: { filing_id: f.id, payment_id: paymentId } },
        );
        setVerifying(false);
        if (!verifyErr && verifyData?.status === 'paid') {
          const { data: refreshed } = await supabase
            .from('filings').select('*').eq('id', f.id).single();
          if (refreshed) f = refreshed as Filing;
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

      const tx = await supabase.from('reportable_transactions').select('*').eq('filing_id', f.id).order('created_at', { ascending: true });
      if (!cancelled && tx.data) setTransactions(tx.data as Transaction[]);

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
    const cat: TxCategory = 'capital_contribution';
    const { data, error } = await supabase
      .from('reportable_transactions')
      .insert({
        filing_id: filing.id,
        transaction_type: cat,
        direction: defaultDirectionFor(cat),
        amount_usd: 0,
      })
      .select('*').single();
    if (error || !data) { setError(error?.message ?? 'Could not add transaction.'); return; }
    setTransactions((arr) => [...arr, data as Transaction]);
  }

  async function updateTx(id: string, patch: Partial<Transaction>) {
    const { data, error } = await supabase
      .from('reportable_transactions')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) { setError(error.message); return; }
    if (data) {
      setTransactions((arr) => arr.map((t) => t.id === id ? (data as Transaction) : t));
    }
  }

  async function removeTx(id: string) {
    const { error } = await supabase.from('reportable_transactions').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    setTransactions((arr) => arr.filter((t) => t.id !== id));
  }

  async function payAndDownload() {
    if (!filing || paying) return;
    setPaying(true);
    setError('');
    // SECURITY: do not write status='paid' from the client. Ask the
    // create-checkout-session edge function for a hosted-checkout URL and
    // redirect there. The PSP webhook (verify-payment) is the only path
    // that may mark the filing paid.
    const { data, error } = await supabase.functions.invoke(
      'create-checkout-session',
      { body: { filing_id: filing.id, amount_cents: calcPriceCents(filing) } },
    );
    setPaying(false);
    if (error || !data?.checkout_url) {
      setError(error?.message ?? 'Could not start checkout. Please try again.');
      return;
    }
    window.location.assign(data.checkout_url as string);
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
      const deliveryMethod = filing.include_irs_fax ? 'fax' : 'mail';
      const packageBytes = await assembleFilingPackage(filing, transactions, deliveryMethod);

      const blob = new Blob([packageBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Form5472_${filing.llc_name?.replace(/\s+/g, '_') ?? 'Filing'}_${filing.tax_year ?? ''}.pdf`;
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
                title={`Complete Filing Package (Tax year ${filing.tax_year ?? 'n/a'})`}
                subtitle={`Single PDF: Cover letter${filing.include_irs_fax ? '' : ', Filing instructions'}, Pro Forma 1120, Form 5472, Statements`}
                generating={generating}
                onDownload={handleDownload}
              />

              <div style={{ background: 'rgba(2,132,199,0.04)', border: '1px solid rgba(2,132,199,0.25)', borderRadius: '0.5rem', padding: '1rem 1.125rem', marginTop: '1.25rem' }}>
                <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--tf-text)', marginBottom: '0.25rem' }}>Next steps</p>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.55 }}>
                  {filing.include_irs_fax
                    ? 'Fax the complete package to the IRS PIN Unit. The fax number and instructions are included in the cover letter.'
                    : 'Print the forms, sign where indicated, and mail the complete package to the IRS PIN Unit at Ogden, UT 84201 (address shown in the cover letter). Keep a digital copy for your records.'}
                </p>
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

          {/* Error banner */}
          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#991B1B', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          {/* ── Step 1: LLC info ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <Field label="LLC legal name" required>
                <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" style={inputStyle} />
              </Field>
              <Field label="EIN (Employer Identification Number)" hint="Format: XX-XXXXXXX">
                <input value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" style={inputStyle} />
              </Field>
              <Field label="State of formation" required>
                <input value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)} placeholder="e.g. Delaware" style={inputStyle} />
              </Field>
              <Field label="Tax year" required hint="The calendar year this filing covers, e.g. 2024">
                <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)} style={inputStyle}>
                  <option value="">Select year…</option>
                  {Array.from({ length: new Date().getFullYear() - 2018 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
              </Field>
              <Field label="LLC mailing address" hint="Where the IRS should mail correspondence">
                <AddressFields value={mailing} onChange={setMailing} />
              </Field>
            </div>
          )}

          {/* ── Step 2: Owner info ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <Field label="Owner full legal name" required>
                <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="As shown on passport" style={inputStyle} />
              </Field>
              <Field label="Country of residence" required hint="Country where you currently reside">
                <CountrySelect value={ownerCountryRes} onChange={setOwnerCountryRes} placeholder="Select country…" />
              </Field>
              <Field label="Country of citizenship" required>
                <CountrySelect value={ownerCountryCit} onChange={setOwnerCountryCit} placeholder="Select country…" />
              </Field>
              <Field label="Passport number" hint="Used to identify you on the form">
                <input value={ownerPassport} onChange={(e) => setOwnerPassport(e.target.value)} placeholder="A12345678" style={inputStyle} />
              </Field>
              <Field label="Foreign tax identification number" hint="TIN, PAN, NIF, BSN, etc. from your home country">
                <input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="Optional" style={inputStyle} />
              </Field>
              <Field label="Owner address" hint="Your personal mailing address">
                <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
              </Field>
            </div>
          )}

          {/* ── Step 3: Transactions ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.25rem' }}>Reportable transactions</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.55 }}>
                  List every transaction between you and the LLC during the tax year. These flow directly onto Form 5472 Parts IV–VI.
                </p>
              </div>

              {transactions.length === 0 && (
                <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '1.5rem', textAlign: 'center', color: 'var(--tf-muted)', fontSize: '0.9375rem' }}>
                  No transactions yet. Add your first one below.
                </div>
              )}

              {transactions.map((tx, idx) => (
                <div key={tx.id} style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--tf-muted)' }}>Transaction {idx + 1}</span>
                    <button
                      onClick={() => removeTx(tx.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '0.375rem' }}
                    >
                      Remove
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <Field label="Type">
                      <select
                        value={tx.transaction_type}
                        onChange={(e) => {
                          const newCat = e.target.value as TxCategory;
                          updateTx(tx.id, { transaction_type: newCat, direction: defaultDirectionFor(newCat) });
                        }}
                        style={inputStyle}
                      >
                        {TX_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>{TX_CATEGORY_LABEL[cat]}</option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Direction" hint="Who initiates / pays">
                      <select
                        value={tx.direction}
                        onChange={(e) => updateTx(tx.id, { direction: e.target.value as 'paid' | 'received' })}
                        style={inputStyle}
                      >
                        <option value="received">LLC received (owner → LLC)</option>
                        <option value="paid">LLC paid (LLC → owner)</option>
                      </select>
                    </Field>
                  </div>

                  <Field label="Amount (USD)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tx.amount_usd ?? ''}
                      onChange={(e) => updateTx(tx.id, { amount_usd: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      style={inputStyle}
                    />
                  </Field>

                  {tx.transaction_type === 'rent_royalty' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--tf-text)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={tx.is_royalty ?? false}
                        onChange={(e) => updateTx(tx.id, { is_royalty: e.target.checked })}
                        style={{ width: '16px', height: '16px', accentColor: '#0284C7' }}
                      />
                      This is a royalty (not rent)
                    </label>
                  )}

                  <Field label="Description" hint="Optional — your own notes, not printed on the form">
                    <input
                      value={tx.description ?? ''}
                      onChange={(e) => updateTx(tx.id, { description: e.target.value || null })}
                      placeholder="Optional"
                      style={inputStyle}
                    />
                  </Field>
                </div>
              ))}

              <button
                onClick={addTransaction}
                style={{ background: 'var(--tf-surface)', color: 'var(--tf-text)', border: '1px dashed var(--tf-border)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                + Add transaction
              </button>

              <Field label="Include IRS fax delivery">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9375rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeFax} onChange={(e) => setIncludeFax(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#0284C7' }} />
                  Fax directly to the IRS PIN Unit (+$30)
                </label>
              </Field>

              <Field label="Include reasonable cause letter">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9375rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeRcl} onChange={(e) => setIncludeRcl(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#0284C7' }} />
                  Add a penalty waiver letter (+$200) — recommended for late or amended filings
                </label>
              </Field>
            </div>
          )}

          {/* ── Step 4: Review & pay ── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.5rem' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>LLC information</h2>
                <ReviewRow label="LLC name" value={filing.llc_name} />
                <ReviewRow label="EIN" value={filing.ein} />
                <ReviewRow label="State of formation" value={filing.state_of_formation} />
                <ReviewRow label="Tax year" value={filing.tax_year} />
              </div>

              <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.5rem' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>Owner information</h2>
                <ReviewRow label="Name" value={filing.owner_full_name} />
                <ReviewRow label="Country of residence" value={filing.owner_country_residence} />
                <ReviewRow label="Country of citizenship" value={filing.owner_country_citizenship} />
                <ReviewRow label="Passport" value={filing.owner_passport_number} />
              </div>

              <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.5rem' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>Transactions ({transactions.length})</h2>
                {transactions.length === 0
                  ? <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem' }}>No transactions — the LLC had no reportable activity this year.</p>
                  : transactions.map((tx) => (
                    <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--tf-border)', fontSize: '0.9375rem' }}>
                      <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>{TX_CATEGORY_LABEL[tx.transaction_type as TxCategory] ?? tx.transaction_type} ({tx.direction})</span>
                      <span style={{ fontWeight: 600 }}>${(tx.amount_usd ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))
                }
              </div>

              <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.5rem' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>Order summary</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9375rem' }}>
                    <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>{SERVICE_LABEL[filing.service_type]}</span>
                    <span style={{ fontWeight: 600 }}>{formatCents(filing.service_type === 'tax_classification' ? 5000 : 15000)}</span>
                  </div>
                  {filing.include_rcl && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9375rem' }}>
                      <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>Reasonable cause letter</span>
                      <span style={{ fontWeight: 600 }}>$200</span>
                    </div>
                  )}
                  {filing.include_irs_fax && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9375rem' }}>
                      <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>IRS fax delivery</span>
                      <span style={{ fontWeight: 600 }}>$30</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700, paddingTop: '0.5rem', borderTop: '1px solid var(--tf-border)' }}>
                    <span>Total</span>
                    <span>{formatCents(priceCents)}</span>
                  </div>
                </div>

                <button
                  onClick={payAndDownload}
                  disabled={paying}
                  style={{
                    width: '100%',
                    background: paying ? '#93C5FD' : '#0284C7',
                    color: 'white',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '1rem',
                    padding: '0.875rem 1rem',
                    borderRadius: '0.5rem',
                    cursor: paying ? 'not-allowed' : 'pointer',
                    minHeight: '48px',
                  }}
                >
                  {paying ? 'Redirecting to checkout…' : `Pay ${formatCents(priceCents)} and get your forms`}
                </button>

                <p style={{ textAlign: 'center', color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, marginTop: '0.75rem', lineHeight: 1.5 }}>
                  Secure payment via Stripe. You will be redirected to a hosted checkout page. After payment you will return here to download your forms.
                </p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', gap: '1rem' }}>
            <button
              onClick={goBack}
              style={{ background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '44px' }}
            >
              {step === 1 ? 'Back to dashboard' : 'Back'}
            </button>
            {step < 4 && (
              <button
                onClick={saveAndContinue}
                disabled={saving}
                style={{ background: saving ? '#93C5FD' : '#0284C7', color: 'white', border: 'none', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.5rem', borderRadius: '0.5rem', cursor: saving ? 'not-allowed' : 'pointer', minHeight: '44px' }}
              >
                {saving ? 'Saving…' : 'Save and continue'}
              </button>
            )}
          </div>
        </div>
      </section>
      <style>{`@keyframes tf-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--tf-bg)',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.375rem',
  padding: '0.5rem 0.75rem',
  fontSize: '0.9375rem',
  color: 'var(--tf-text)',
  outline: 'none',
  minHeight: '40px',
  boxSizing: 'border-box',
};

function Field({ label, hint, required, children }: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--tf-text)' }}>
        {label}{required && <span style={{ color: '#DC2626', marginLeft: '0.25rem' }}>*</span>}
      </label>
      {hint && <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, margin: 0 }}>{hint}</p>}
      {children}
    </div>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v || undefined });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input placeholder="Street line 1" value={value.line1 ?? ''} onChange={(e) => set('line1', e.target.value)} style={inputStyle} />
      <input placeholder="Street line 2 (optional)" value={value.line2 ?? ''} onChange={(e) => set('line2', e.target.value)} style={inputStyle} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <input placeholder="City" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} style={inputStyle} />
        <input placeholder="State / Region" value={value.region ?? ''} onChange={(e) => set('region', e.target.value)} style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <input placeholder="ZIP / Postal code" value={value.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} style={inputStyle} />
        <input placeholder="Country" value={value.country ?? ''} onChange={(e) => set('country', e.target.value)} style={inputStyle} />
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--tf-border)', fontSize: '0.9375rem' }}>
      <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value || '—'}</span>
    </div>
  );
}

function DownloadRow({ title, subtitle, generating, onDownload }: {
  title: string;
  subtitle: string;
  generating: boolean;
  onDownload: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 0', borderBottom: '1px solid var(--tf-border)', gap: '1rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text)', marginBottom: '0.125rem' }}>{title}</p>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400 }}>{subtitle}</p>
      </div>
      <button
        onClick={onDownload}
        disabled={generating}
        style={{
          background: generating ? '#93C5FD' : '#0284C7',
          color: 'white',
          border: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          padding: '0.5rem 1rem',
          borderRadius: '0.375rem',
          cursor: generating ? 'not-allowed' : 'pointer',
          minHeight: '36px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {generating ? 'Generating…' : 'Download PDF'}
      </button>
    </div>
  );
}
