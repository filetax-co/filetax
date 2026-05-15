import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router';
import {
  supabase,
  type Filing,
  type FilingTransaction,
  type FilingTransactionCategory,
  type Address,
} from '../../lib/supabase';
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

function downloadPlaceholder(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

  async function recordDownload(formName: string) {
    if (!filing) return;
    const newCount = (filing.download_count ?? 0) + 1;
    const newStatus: Filing['status'] = filing.status === 'paid' ? 'completed' : filing.status;
    await supabase.from('filings').update({ download_count: newCount, status: newStatus }).eq('id', filing.id);
    setFiling((f) => f ? { ...f, download_count: newCount, status: newStatus } as Filing : f);
    const placeholder = [
      'IRS FORM 5472 / PRO FORMA 1120 PLACEHOLDER',
      '----------------------------------------',
      `Document: ${formName}`,
      `LLC name: ${llcName || '(not provided)'}`,
      `EIN: ${ein || '(not provided)'}`,
      `Tax year: ${taxYear || '(not provided)'}`,
      `Owner: ${ownerName || '(not provided)'}`,
      '',
      'NOTE: This is a placeholder file. The real PDF generation',
      'will produce IRS-compliant filled forms ready to mail or fax.',
    ].join('\n');
    downloadPlaceholder(formName.toLowerCase().replace(/\s+/g, '-') + '.txt', placeholder);
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
              <DownloadRow title={`Form 5472 (Tax year ${filing.tax_year ?? 'n/a'})`} subtitle="Ready to mail or fax" onDownload={() => recordDownload('Form 5472')} />
              <DownloadRow title="Pro Forma Form 1120" subtitle="Submit alongside Form 5472" onDownload={() => recordDownload('Pro Forma 1120')} />
              {filing.include_rcl && (
                <DownloadRow title="Reasonable Cause Letter" subtitle="CPA-prepared. For penalty abatement." onDownload={() => recordDownload('Reasonable Cause Letter')} />
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
      </>
    );
  }

  return (
    <>
      <section style={{ background: 'var(--tf-bg)', padding: '3rem 1rem 1.5rem' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <Link to="/dashboard" style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', display: 'inline-block', marginBottom: '1rem' }}>Back to Dashboard</Link>
          <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', marginBottom: '0.25rem', lineHeight: 1.2 }}>{SERVICE_LABEL[filing.service_type]}</h1>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>Step {step} of 4. Your progress is saved automatically when you continue.</p>
          <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.5rem' }}>
            {[1, 2, 3, 4].map((n) => (<div key={n} style={{ flex: 1, height: '4px', borderRadius: '9999px', background: n <= step ? '#0284C7' : 'var(--tf-border)' }} />))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--tf-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            <span>LLC info</span><span>Owner</span><span>Transactions</span><span>Review</span>
          </div>
        </div>
      </section>

      <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 3rem' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>
            {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>}

            {step === 1 && (
              <div>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>LLC information</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>These details come from your LLC formation documents.</p>
                <Field label="LLC legal name"><input value={llcName} onChange={(e) => setLlcName(e.target.value)} style={inputStyle} placeholder="e.g. Acme Holdings LLC" /></Field>
                <Field label="EIN"><input value={ein} onChange={(e) => setEin(e.target.value)} style={inputStyle} placeholder="XX-XXXXXXX" /></Field>
                <Field label="State of formation"><input value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)} style={inputStyle} placeholder="e.g. Delaware" /></Field>
                <Field label="Tax year being filed"><input value={taxYear} onChange={(e) => setTaxYear(e.target.value)} style={inputStyle} placeholder="e.g. 2024" /></Field>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--tf-text)', marginTop: '1.5rem', marginBottom: '0.75rem' }}>Mailing address (U.S.)</p>
                <AddressFields value={mailing} onChange={setMailing} />
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Owner information</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>As the foreign reporting party, the IRS requires the following.</p>
                <Field label="Full legal name"><input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} style={inputStyle} /></Field>
                <Field label="Country of residence"><input value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)} style={inputStyle} placeholder="e.g. India" /></Field>
                <Field label="Country of citizenship"><input value={ownerCountryCit} onChange={(e) => setOwnerCountryCit(e.target.value)} style={inputStyle} /></Field>
                <Field label="Passport number"><input value={ownerPassport} onChange={(e) => setOwnerPassport(e.target.value)} style={inputStyle} /></Field>
                <Field label="Foreign tax ID (optional)"><input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} style={inputStyle} placeholder="e.g. PAN, NIN" /></Field>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--tf-text)', marginTop: '1.5rem', marginBottom: '0.75rem' }}>Foreign address</p>
                <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Reportable transactions</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.25rem' }}>Add each transaction between you (or a related party) and the LLC during the tax year. If there were none, you can leave this empty.</p>
                {transactions.length === 0 ? (
                  <div style={{ background: 'var(--tf-bg)', border: '1px dashed var(--tf-border)', borderRadius: '0.5rem', padding: '1.25rem', textAlign: 'center', marginBottom: '1rem' }}>
                    <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>No transactions yet.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1rem' }}>
                    {transactions.map((t, idx) => (
                      <TxRow key={t.id} index={idx} tx={t} onUpdate={(patch) => updateTx(t.id, patch)} onRemove={() => removeTx(t.id)} />
                    ))}
                  </div>
                )}
                <button onClick={addTransaction} style={{ background: 'transparent', color: '#0284C7', border: '1px solid #0284C7', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '40px' }}>+ Add transaction</button>
                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--tf-border)' }}>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--tf-text)', marginBottom: '0.75rem' }}>Add-ons</p>
                  <label style={checkboxRowStyle(includeFax)}>
                    <input type="checkbox" checked={includeFax} onChange={(e) => setIncludeFax(e.target.checked)} style={{ accentColor: '#0284C7', width: '16px', height: '16px', flexShrink: 0, marginTop: '3px' }} />
                    <div>
                      <p style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--tf-text)' }}>IRS Fax submission (+$30)</p>
                      <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.5 }}>Faster IRS processing with a digital confirmation receipt.</p>
                    </div>
                  </label>
                  <label style={{ ...checkboxRowStyle(includeRcl), marginTop: '0.5rem' }}>
                    <input type="checkbox" checked={includeRcl} onChange={(e) => setIncludeRcl(e.target.checked)} style={{ accentColor: '#0284C7', width: '16px', height: '16px', flexShrink: 0, marginTop: '3px' }} />
                    <div>
                      <p style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--tf-text)' }}>Reasonable Cause Letter (+$200)</p>
                      <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.5 }}>CPA-prepared letter for late filings to support penalty abatement.</p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Review your filing</h2>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>Confirm everything is correct, then pay to download your forms.</p>
                <ReviewSection title="LLC information" onEdit={() => setStep(1)}>
                  <ReviewRow label="LLC name" value={llcName} />
                  <ReviewRow label="EIN" value={ein} />
                  <ReviewRow label="State of formation" value={stateOfFormation} />
                  <ReviewRow label="Tax year" value={taxYear} />
                  <ReviewRow label="Mailing address" value={formatAddress(mailing)} />
                </ReviewSection>
                <ReviewSection title="Owner information" onEdit={() => setStep(2)}>
                  <ReviewRow label="Full legal name" value={ownerName} />
                  <ReviewRow label="Country of residence" value={ownerCountryRes} />
                  <ReviewRow label="Country of citizenship" value={ownerCountryCit} />
                  <ReviewRow label="Passport number" value={ownerPassport} />
                  <ReviewRow label="Foreign tax ID" value={ownerForeignTaxId} />
                  <ReviewRow label="Foreign address" value={formatAddress(ownerAddress)} />
                </ReviewSection>
                <ReviewSection title={`Transactions (${transactions.length})`} onEdit={() => setStep(3)}>
                  {transactions.length === 0 ? (
                    <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>No transactions reported.</p>
                  ) : (
                    transactions.map((t) => (
                      <ReviewRow key={t.id} label={`${TX_CATEGORY_LABEL[t.category]} (${t.direction === 'to_llc' ? 'to LLC' : 'from LLC'})`} value={`${t.currency} ${t.amount.toLocaleString()} ${t.transaction_date ? '/ ' + t.transaction_date : ''} ${t.description ? '/ ' + t.description : ''}`} />
                    ))
                  )}
                </ReviewSection>
                <ReviewSection title="Add-ons" onEdit={() => setStep(3)}>
                  <ReviewRow label="IRS Fax submission" value={includeFax ? 'Yes (+$30)' : 'No'} />
                  <ReviewRow label="Reasonable Cause Letter" value={includeRcl ? 'Yes (+$200)' : 'No'} />
                </ReviewSection>
                <div style={{ borderTop: '2px solid var(--tf-border)', marginTop: '1rem', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text)' }}>Total</span>
                  <span style={{ fontWeight: 700, fontSize: '1.25rem', color: '#0F172A' }}>{formatCents(priceCents)}</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <button onClick={goBack} style={{ background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '44px' }}>
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 4 ? (
              <button onClick={saveAndContinue} disabled={saving} style={primaryFooterBtn(saving)}>
                {saving ? 'Saving...' : 'Save and continue'}
              </button>
            ) : (
              <button onClick={payAndDownload} disabled={paying} style={primaryFooterBtn(paying)}>
                {paying ? 'Processing...' : `Pay and download (${formatCents(priceCents)})`}
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function DownloadRow({ title, subtitle, onDownload }: { title: string; subtitle: string; onDownload: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', marginBottom: '0.625rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', minWidth: 0 }}>
        <div style={{ width: 36, height: 44, background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.25rem', flexShrink: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
          <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#B31D1D' }}>PDF</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--tf-text)', margin: 0 }}>{title}</p>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, margin: 0 }}>{subtitle}</p>
        </div>
      </div>
      <button onClick={onDownload} style={{ background: '#0284C7', color: 'white', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', flexShrink: 0 }}>Download</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.125rem' }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>{label}</label>
      {children}
    </div>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  function set<K extends keyof Address>(key: K, v: string) { onChange({ ...value, [key]: v }); }
  return (
    <>
      <Field label="Address line 1"><input value={value.line1 ?? ''} onChange={(e) => set('line1', e.target.value)} style={inputStyle} /></Field>
      <Field label="Address line 2 (optional)"><input value={value.line2 ?? ''} onChange={(e) => set('line2', e.target.value)} style={inputStyle} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <Field label="City"><input value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} style={inputStyle} /></Field>
        <Field label="State or region"><input value={value.region ?? ''} onChange={(e) => set('region', e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <Field label="Postal code"><input value={value.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} style={inputStyle} /></Field>
        <Field label="Country"><input value={value.country ?? ''} onChange={(e) => set('country', e.target.value)} style={inputStyle} /></Field>
      </div>
    </>
  );
}

function TxRow({ index, tx, onUpdate, onRemove }: { index: number; tx: FilingTransaction; onUpdate: (patch: Partial<FilingTransaction>) => void; onRemove: () => void }) {
  return (
    <div style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '1rem 1.125rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--tf-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transaction {index + 1}</p>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#B31D1D', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }}>Remove</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <Field label="Category">
          <select value={tx.category} onChange={(e) => onUpdate({ category: e.target.value as FilingTransactionCategory })} style={inputStyle}>
            {TX_CATEGORIES.map((c) => <option key={c} value={c}>{TX_CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={tx.direction} onChange={(e) => onUpdate({ direction: e.target.value as 'to_llc' | 'from_llc' })} style={inputStyle}>
            <option value="to_llc">To the LLC</option>
            <option value="from_llc">From the LLC</option>
          </select>
        </Field>
        <Field label="Amount"><input type="number" step="0.01" value={tx.amount} onChange={(e) => onUpdate({ amount: parseFloat(e.target.value) || 0 })} style={inputStyle} /></Field>
        <Field label="Currency"><input value={tx.currency} onChange={(e) => onUpdate({ currency: e.target.value })} style={inputStyle} /></Field>
        <Field label="Date"><input type="date" value={tx.transaction_date ?? ''} onChange={(e) => onUpdate({ transaction_date: e.target.value || null })} style={inputStyle} /></Field>
        <Field label="Description (optional)"><input value={tx.description ?? ''} onChange={(e) => onUpdate({ description: e.target.value || null })} style={inputStyle} /></Field>
      </div>
    </div>
  );
}

function ReviewSection({ title, children, onEdit }: { title: string; children: React.ReactNode; onEdit?: () => void }) {
  return (
    <div style={{ borderTop: '1px solid var(--tf-border)', paddingTop: '1.25rem', paddingBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{title}</h3>
        {onEdit && <button onClick={onEdit} style={{ background: 'none', border: 'none', color: '#0284C7', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>Edit</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '1rem', fontSize: '0.875rem' }}>
      <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ color: 'var(--tf-text)', fontWeight: 500 }}>{value || <span style={{ color: 'var(--tf-muted)' }}>n/a</span>}</span>
    </div>
  );
}

function formatAddress(a: Address): string {
  return [a.line1, a.line2, a.city, a.region, a.postal_code, a.country].filter(Boolean).join(', ');
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.875rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--tf-border)',
  background: 'var(--tf-bg)',
  color: 'var(--tf-text)',
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: '44px',
  fontFamily: 'inherit',
};

function checkboxRowStyle(checked: boolean): React.CSSProperties {
  return { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.875rem 1rem', border: `1px solid ${checked ? '#0284C7' : 'var(--tf-border)'}`, background: checked ? 'rgba(2,132,199,0.06)' : 'var(--tf-bg)', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '44px' };
}

function primaryFooterBtn(busy: boolean): React.CSSProperties {
  return { background: '#0284C7', color: 'white', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.5rem', borderRadius: '0.5rem', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: busy ? 0.7 : 1 };
}
