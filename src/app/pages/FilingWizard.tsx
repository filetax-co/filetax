import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase, Filing, FilingTransaction, FilingTransactionCategory, Address } from '../../lib/supabase';
import { useAuth } from '../../lib/useAuth';
import { usePageMeta } from '../hooks/usePageMeta';

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
  'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
  'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
  'Wisconsin','Wyoming',
];

const TX_CATEGORIES: { value: FilingTransactionCategory; label: string }[] = [
  { value: 'capital_contribution', label: 'Capital Contribution' },
  { value: 'distribution',         label: 'Distribution' },
  { value: 'loan_to_llc',          label: 'Loan to LLC' },
  { value: 'loan_from_llc',        label: 'Loan from LLC' },
  { value: 'service_payment',      label: 'Service Payment' },
  { value: 'rent_royalty',         label: 'Rent / Royalty / License' },
  { value: 'other',                label: 'Other' },
];

const TAX_YEARS = ['2024', '2023', '2022', '2021', '2020'];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.625rem 0.875rem', borderRadius: '0.5rem',
  border: '1px solid var(--tf-border)', background: 'var(--tf-bg)',
  color: 'var(--tf-text)', fontSize: '0.9375rem', boxSizing: 'border-box', minHeight: '44px',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.875rem',
  marginBottom: '0.375rem', color: 'var(--tf-text)',
};
const fieldStyle: React.CSSProperties = { marginBottom: '1.125rem' };
const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem',
};

function AddressFields({ prefix, value, onChange }: {
  prefix: string;
  value: Address;
  onChange: (v: Address) => void;
}) {
  const f = (field: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [field]: e.target.value });
  return (
    <>
      <div style={fieldStyle}>
        <label style={labelStyle}>Street address</label>
        <input style={inputStyle} value={value.line1 ?? ''} onChange={f('line1')} placeholder="123 Main St" />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Address line 2 <span style={{ fontWeight: 400, color: 'var(--tf-muted)' }}>(optional)</span></label>
        <input style={inputStyle} value={value.line2 ?? ''} onChange={f('line2')} placeholder="Suite, unit, etc." />
      </div>
      <div style={{ ...gridStyle, marginBottom: '1.125rem' }}>
        <div>
          <label style={labelStyle}>City</label>
          <input style={inputStyle} value={value.city ?? ''} onChange={f('city')} placeholder="City" />
        </div>
        <div>
          <label style={labelStyle}>State / Province</label>
          <input style={inputStyle} value={value.region ?? ''} onChange={f('region')} placeholder="State or province" />
        </div>
      </div>
      <div style={gridStyle}>
        <div>
          <label style={labelStyle}>Postal code</label>
          <input style={inputStyle} value={value.postal_code ?? ''} onChange={f('postal_code')} placeholder="Postal code" />
        </div>
        <div>
          <label style={labelStyle}>Country</label>
          <input style={inputStyle} value={value.country ?? ''} onChange={f('country')} placeholder="India" />
        </div>
      </div>
    </>
  );
}

export function FilingWizard() {
  usePageMeta({
    title: 'Filing Wizard | FileTax.co',
    description: 'Complete your Form 5472 + Pro Forma 1120 filing in 4 simple steps.',
  });

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [filing, setFiling] = useState<Filing | null>(null);
  const [transactions, setTransactions] = useState<FilingTransaction[]>([]);
  const [loadingFiling, setLoadingFiling] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 fields
  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [taxYear, setTaxYear] = useState('2024');
  const [mailingAddress, setMailingAddress] = useState<Address>({});

  // Step 2 fields
  const [ownerFullName, setOwnerFullName] = useState('');
  const [ownerCountryResidence, setOwnerCountryResidence] = useState('');
  const [ownerCountryCitizenship, setOwnerCountryCitizenship] = useState('');
  const [ownerPassport, setOwnerPassport] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});

  // Step 3 — transactions
  const [txCategory, setTxCategory] = useState<FilingTransactionCategory>('capital_contribution');
  const [txDirection, setTxDirection] = useState<'to_llc' | 'from_llc'>('to_llc');
  const [txAmount, setTxAmount] = useState('');
  const [txDate, setTxDate] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [addingTx, setAddingTx] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/portal?mode=login');
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!id || !user) return;
    Promise.all([
      supabase.from('filings').select('*').eq('id', id).eq('user_id', user.id).single(),
      supabase.from('filing_transactions').select('*').eq('filing_id', id).order('created_at'),
    ]).then(([{ data: f }, { data: txs }]) => {
      if (!f) { navigate('/dashboard'); return; }
      const fi = f as Filing;
      setFiling(fi);
      setTransactions((txs as FilingTransaction[]) ?? []);
      // Hydrate step fields
      setLlcName(fi.llc_name ?? '');
      setEin(fi.ein ?? '');
      setStateOfFormation(fi.state_of_formation ?? '');
      setTaxYear(fi.tax_year ?? '2024');
      setMailingAddress(fi.mailing_address ?? {});
      setOwnerFullName(fi.owner_full_name ?? '');
      setOwnerCountryResidence(fi.owner_country_residence ?? '');
      setOwnerCountryCitizenship(fi.owner_country_citizenship ?? '');
      setOwnerPassport(fi.owner_passport_number ?? '');
      setOwnerForeignTaxId(fi.owner_foreign_tax_id ?? '');
      setOwnerAddress(fi.owner_address ?? {});
      setLoadingFiling(false);
    });
  }, [id, user]);

  const currentStep = filing?.current_step ?? 1;

  const saveStep = async (step: number, patch: Partial<Filing>, nextStep: number) => {
    if (!id) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('filings')
      .update({ ...patch, current_step: nextStep, status: 'in_progress' })
      .eq('id', id);
    if (err) { setError(err.message); setSaving(false); return; }
    setFiling((prev) => prev ? { ...prev, ...patch, current_step: nextStep, status: 'in_progress' } : prev);
    setSaving(false);
  };

  const handleStep1 = async () => {
    if (!llcName.trim()) { setError('LLC name is required.'); return; }
    if (!ein.trim()) { setError('EIN is required.'); return; }
    await saveStep(1, {
      llc_name: llcName.trim(),
      ein: ein.trim(),
      state_of_formation: stateOfFormation,
      tax_year: taxYear,
      mailing_address: mailingAddress,
    }, 2);
  };

  const handleStep2 = async () => {
    if (!ownerFullName.trim()) { setError('Owner full name is required.'); return; }
    if (!ownerCountryResidence.trim()) { setError('Country of residence is required.'); return; }
    await saveStep(2, {
      owner_full_name: ownerFullName.trim(),
      owner_country_residence: ownerCountryResidence.trim(),
      owner_country_citizenship: ownerCountryCitizenship.trim(),
      owner_passport_number: ownerPassport.trim(),
      owner_foreign_tax_id: ownerForeignTaxId.trim(),
      owner_address: ownerAddress,
    }, 3);
  };

  const handleAddTransaction = async () => {
    if (!txAmount || isNaN(Number(txAmount)) || Number(txAmount) <= 0) {
      setError('Enter a valid transaction amount.'); return;
    }
    setAddingTx(true);
    setError('');
    const { data, error: err } = await supabase.from('filing_transactions').insert({
      filing_id: id,
      category: txCategory,
      direction: txDirection,
      amount: Number(txAmount),
      currency: 'USD',
      transaction_date: txDate || null,
      description: txDesc.trim() || null,
    }).select().single();
    if (err) { setError(err.message); setAddingTx(false); return; }
    setTransactions((prev) => [...prev, data as FilingTransaction]);
    setTxAmount(''); setTxDate(''); setTxDesc('');
    setAddingTx(false);
  };

  const handleDeleteTransaction = async (txId: string) => {
    await supabase.from('filing_transactions').delete().eq('id', txId);
    setTransactions((prev) => prev.filter((t) => t.id !== txId));
  };

  const handleStep3 = async () => {
    await saveStep(3, {}, 4);
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('filings')
      .update({ current_step: 4, status: 'in_progress' })
      .eq('id', id);
    if (err) { setError(err.message); setSaving(false); return; }
    navigate('/dashboard');
  };

  if (authLoading || loadingFiling) {
    return (
      <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--tf-muted)' }}>Loading your filing…</p>
      </section>
    );
  }

  const stepTitles = [
    'LLC Details',
    'Owner Information',
    'Transactions',
    'Review & Submit',
  ];

  const btnPrimary: React.CSSProperties = {
    background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.9375rem',
    padding: '0.625rem 1.5rem', borderRadius: '0.5rem', border: 'none',
    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
    minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
  };
  const btnSecondary: React.CSSProperties = {
    background: 'none', color: 'var(--tf-muted)', fontWeight: 600, fontSize: '0.9375rem',
    padding: '0.625rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--tf-border)',
    cursor: 'pointer', minHeight: '44px',
  };

  return (
    <section style={{ padding: '2.5rem 1rem 5rem' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>

        {/* Back */}
        <a href="/dashboard" style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.375rem', marginBottom: '1.75rem' }}>
          ← My Filings
        </a>

        {/* Progress steps */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '2.5rem', background: 'var(--tf-surface)', borderRadius: '0.75rem', border: '1px solid var(--tf-border)', overflow: 'hidden' }}>
          {stepTitles.map((title, i) => {
            const step = i + 1;
            const isActive = step === currentStep;
            const isDone = step < currentStep;
            return (
              <div
                key={step}
                style={{
                  flex: 1, padding: '0.875rem 0.5rem', textAlign: 'center',
                  background: isActive ? '#0284C7' : isDone ? 'rgba(2,132,199,0.08)' : 'transparent',
                  borderRight: i < 3 ? '1px solid var(--tf-border)' : 'none',
                }}
              >
                <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: isActive ? 'white' : isDone ? '#0284C7' : 'var(--tf-muted)', marginBottom: '0.125rem' }}>
                  Step {step}
                </div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: isActive ? 'white' : isDone ? '#0284C7' : 'var(--tf-muted)' }}>
                  {isDone ? '\u2713 ' : ''}{title}
                </div>
              </div>
            );
          })}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.25rem', color: '#991B1B', fontSize: '0.9375rem', fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* ── STEP 1: LLC Details ── */}
        {currentStep === 1 && (
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>LLC Details</h2>
            <div style={fieldStyle}>
              <label style={labelStyle}>LLC name <span style={{ color: '#DC2626' }}>*</span></label>
              <input style={inputStyle} value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="Acme LLC" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>EIN <span style={{ color: '#DC2626' }}>*</span></label>
              <input style={inputStyle} value={ein} onChange={(e) => setEin(e.target.value)} placeholder="XX-XXXXXXX" />
            </div>
            <div style={{ ...gridStyle, marginBottom: '1.125rem' }}>
              <div>
                <label style={labelStyle}>State of formation</label>
                <select style={inputStyle} value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)}>
                  <option value="">Select state…</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Tax year</label>
                <select style={inputStyle} value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                  {TAX_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--tf-text)' }}>LLC mailing address <span style={{ fontWeight: 400, color: 'var(--tf-muted)' }}>(optional)</span></p>
            <AddressFields prefix="llc" value={mailingAddress} onChange={setMailingAddress} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button style={btnPrimary} onClick={handleStep1} disabled={saving}>
                {saving ? 'Saving…' : 'Save & Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Owner Info ── */}
        {currentStep === 2 && (
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Owner Information</h2>
            <div style={fieldStyle}>
              <label style={labelStyle}>Full legal name <span style={{ color: '#DC2626' }}>*</span></label>
              <input style={inputStyle} value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} placeholder="As on passport" />
            </div>
            <div style={{ ...gridStyle, marginBottom: '1.125rem' }}>
              <div>
                <label style={labelStyle}>Country of residence <span style={{ color: '#DC2626' }}>*</span></label>
                <input style={inputStyle} value={ownerCountryResidence} onChange={(e) => setOwnerCountryResidence(e.target.value)} placeholder="India" />
              </div>
              <div>
                <label style={labelStyle}>Country of citizenship</label>
                <input style={inputStyle} value={ownerCountryCitizenship} onChange={(e) => setOwnerCountryCitizenship(e.target.value)} placeholder="India" />
              </div>
            </div>
            <div style={{ ...gridStyle, marginBottom: '1.125rem' }}>
              <div>
                <label style={labelStyle}>Passport number</label>
                <input style={inputStyle} value={ownerPassport} onChange={(e) => setOwnerPassport(e.target.value)} placeholder="Passport number" />
              </div>
              <div>
                <label style={labelStyle}>Foreign tax ID <span style={{ fontWeight: 400, color: 'var(--tf-muted)' }}>(PAN etc.)</span></label>
                <input style={inputStyle} value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="e.g. PAN" />
              </div>
            </div>
            <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--tf-text)' }}>Owner address <span style={{ fontWeight: 400, color: 'var(--tf-muted)' }}>(optional)</span></p>
            <AddressFields prefix="owner" value={ownerAddress} onChange={setOwnerAddress} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
              <button style={btnSecondary} onClick={() => saveStep(2, {}, 1)} disabled={saving}>← Back</button>
              <button style={btnPrimary} onClick={handleStep2} disabled={saving}>
                {saving ? 'Saving…' : 'Save & Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Transactions ── */}
        {currentStep === 3 && (
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Reportable Transactions</h2>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '1.5rem' }}>
              Enter all transactions between you and the LLC during the tax year.
              If there were none, click Continue without adding any.
            </p>

            {/* Existing transactions */}
            {transactions.length > 0 && (
              <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {transactions.map((tx) => (
                  <div key={tx.id} style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                        ${Number(tx.amount).toLocaleString()} {tx.currency}
                      </span>
                      <span style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginLeft: '0.5rem' }}>
                        {TX_CATEGORIES.find(c => c.value === tx.category)?.label} &mdash; {tx.direction === 'to_llc' ? 'to LLC' : 'from LLC'}
                      </span>
                      {tx.description && <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', marginTop: '0.125rem' }}>{tx.description}</p>}
                    </div>
                    <button
                      onClick={() => handleDeleteTransaction(tx.id)}
                      style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 700, padding: '0.25rem 0.5rem', flexShrink: 0 }}
                      aria-label="Remove transaction"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add transaction form */}
            <div style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '1rem' }}>Add a transaction</p>
              <div style={{ ...gridStyle, marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select style={inputStyle} value={txCategory} onChange={(e) => setTxCategory(e.target.value as FilingTransactionCategory)}>
                    {TX_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Direction</label>
                  <select style={inputStyle} value={txDirection} onChange={(e) => setTxDirection(e.target.value as 'to_llc' | 'from_llc')}>
                    <option value="to_llc">Owner → LLC (to LLC)</option>
                    <option value="from_llc">LLC → Owner (from LLC)</option>
                  </select>
                </div>
              </div>
              <div style={{ ...gridStyle, marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>Amount (USD) <span style={{ color: '#DC2626' }}>*</span></label>
                  <input style={inputStyle} type="number" min="0" step="0.01" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label style={labelStyle}>Date <span style={{ fontWeight: 400, color: 'var(--tf-muted)' }}>(optional)</span></label>
                  <input style={inputStyle} type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                </div>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Description <span style={{ fontWeight: 400, color: 'var(--tf-muted)' }}>(optional)</span></label>
                <input style={inputStyle} value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Brief description" />
              </div>
              <button style={{ ...btnPrimary, fontSize: '0.875rem', padding: '0.5rem 1.25rem' }} onClick={handleAddTransaction} disabled={addingTx}>
                {addingTx ? 'Adding…' : '+ Add transaction'}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <button style={btnSecondary} onClick={() => saveStep(3, {}, 2)} disabled={saving}>← Back</button>
              <button style={btnPrimary} onClick={handleStep3} disabled={saving}>
                {saving ? 'Saving…' : 'Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Review & Submit ── */}
        {currentStep === 4 && filing && (
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Review & Submit</h2>

            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontWeight: 700, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--tf-muted)', marginBottom: '0.75rem' }}>LLC Details</p>
              <div style={{ background: 'var(--tf-bg)', borderRadius: '0.5rem', padding: '1rem', border: '1px solid var(--tf-border)', fontSize: '0.9375rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <p><strong>Name:</strong> {filing.llc_name ?? '—'}</p>
                <p><strong>EIN:</strong> {filing.ein ?? '—'}</p>
                <p><strong>State:</strong> {filing.state_of_formation ?? '—'}</p>
                <p><strong>Tax year:</strong> {filing.tax_year ?? '—'}</p>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontWeight: 700, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--tf-muted)', marginBottom: '0.75rem' }}>Owner Details</p>
              <div style={{ background: 'var(--tf-bg)', borderRadius: '0.5rem', padding: '1rem', border: '1px solid var(--tf-border)', fontSize: '0.9375rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <p><strong>Name:</strong> {filing.owner_full_name ?? '—'}</p>
                <p><strong>Country of residence:</strong> {filing.owner_country_residence ?? '—'}</p>
                <p><strong>Country of citizenship:</strong> {filing.owner_country_citizenship ?? '—'}</p>
                <p><strong>Passport:</strong> {filing.owner_passport_number ?? '—'}</p>
                <p><strong>Foreign tax ID:</strong> {filing.owner_foreign_tax_id ?? '—'}</p>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontWeight: 700, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--tf-muted)', marginBottom: '0.75rem' }}>Transactions ({transactions.length})</p>
              {transactions.length === 0 ? (
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem' }}>No transactions recorded.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {transactions.map((tx) => (
                    <div key={tx.id} style={{ background: 'var(--tf-bg)', borderRadius: '0.5rem', padding: '0.75rem 1rem', border: '1px solid var(--tf-border)', fontSize: '0.9375rem' }}>
                      <strong>${Number(tx.amount).toLocaleString()}</strong> — {TX_CATEGORIES.find(c => c.value === tx.category)?.label}, {tx.direction === 'to_llc' ? 'to LLC' : 'from LLC'}
                      {tx.description && <span style={{ color: 'var(--tf-muted)', marginLeft: '0.5rem' }}>({tx.description})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: 'rgba(2,132,199,0.05)', border: '1px solid #BAE6FD', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1.75rem', fontSize: '0.9375rem', color: 'var(--tf-text)' }}>
              <strong>What happens next:</strong> After submitting, our CPA team will review your information and prepare your Form 5472 + Pro Forma 1120. You will receive an email with payment instructions to download your completed forms.
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button style={btnSecondary} onClick={() => saveStep(4, {}, 3)} disabled={saving}>← Edit Transactions</button>
              <button style={{ ...btnPrimary, background: '#059669' }} onClick={handleSubmit} disabled={saving}>
                {saving ? 'Submitting…' : '\u2713 Submit Filing'}
              </button>
            </div>
          </div>
        )}

      </div>
    </section>
  );
}
