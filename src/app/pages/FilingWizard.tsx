import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase, Filing, FilingTransaction, FilingTransactionCategory, Address } from '../../lib/supabase';
import { assembleFilingPackage } from '../../lib/pdfGenerator';
import { useAuth } from '../context/AuthContext';
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

const CURRENT_TAX_YEAR = String(new Date().getFullYear() - 1);
const TAX_YEARS = Array.from({ length: 5 }, (_, i) => String(Number(CURRENT_TAX_YEAR) - i));

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

const YEARS_INCORP = Array.from({ length: 30 }, (_, i) => String(new Date().getFullYear() - i));

const STEPS = [
  { n: 1, label: 'LLC Details' },
  { n: 2, label: 'Owner Info' },
  { n: 3, label: 'Transactions' },
  { n: 4, label: 'Review' },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function parseIso(iso: string | null | undefined): { m: string; d: string; y: string } {
  if (!iso) return { m: '', d: '', y: '' };
  const parts = iso.split('-');
  return { y: parts[0] ?? '', m: parts[1] ?? '', d: parts[2] ?? '' };
}

function buildIso(m: string, d: string, y: string): string | null {
  if (!m || !d || !y || y.length < 4) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// ── DateParts ────────────────────────────────────────────────────────────────

function DateParts({
  month, day, year,
  onMonth, onDay, onYear,
  label, hint,
}: {
  month: string; day: string; year: string;
  onMonth: (v: string) => void;
  onDay:   (v: string) => void;
  onYear:  (v: string) => void;
  label: string;
  hint?: string;
}) {
  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '0.6rem 0.5rem',
    border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
    background: 'var(--tf-bg)', color: 'var(--tf-text)',
    fontSize: '0.9375rem', boxSizing: 'border-box', minHeight: '42px',
  };
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.35rem', color: 'var(--tf-text)' }}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: 'var(--tf-muted)', marginLeft: '0.35rem' }}>{hint}</span>}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr', gap: '0.5rem' }}>
        <select style={selectStyle} value={month} onChange={e => onMonth(e.target.value)} aria-label="Month">
          <option value="">Month</option>
          {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select style={selectStyle} value={day} onChange={e => onDay(e.target.value)} aria-label="Day">
          <option value="">Day</option>
          {DAYS.map(d => <option key={d} value={d}>{Number(d)}</option>)}
        </select>
        <select style={selectStyle} value={year} onChange={e => onYear(e.target.value)} aria-label="Year">
          <option value="">Year</option>
          {YEARS_INCORP.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

// ── shared field primitives ──────────────────────────────────────────────────

function Field({ label, required, hint, children }: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.35rem', color: 'var(--tf-text)' }}>
        {label}
        {required && <span style={{ color: 'var(--tf-error, #B31D1D)', marginLeft: '0.2rem' }}>*</span>}
        {hint && <span style={{ fontWeight: 400, color: 'var(--tf-muted)', marginLeft: '0.35rem' }}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%', padding: '0.6rem 0.85rem',
        border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
        background: 'var(--tf-bg)', color: 'var(--tf-text)',
        fontSize: '0.9375rem', boxSizing: 'border-box', minHeight: '42px',
        ...props.style,
      }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{
        width: '100%', padding: '0.6rem 0.85rem',
        border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
        background: 'var(--tf-bg)', color: 'var(--tf-text)',
        fontSize: '0.9375rem', boxSizing: 'border-box', minHeight: '42px',
        ...props.style,
      }}
    />
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.07em',
      textTransform: 'uppercase', color: 'var(--tf-muted)',
      marginBottom: '0.75rem', marginTop: '1.5rem',
    }}>
      {children}
    </p>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (v: Address) => void }) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <Field label="Street address">
        <Input value={value.line1 ?? ''} onChange={set('line1')} placeholder="123 Main St" />
      </Field>
      <Field label="Address line 2" hint="(optional)">
        <Input value={value.line2 ?? ''} onChange={set('line2')} placeholder="Suite, unit, etc." />
      </Field>
      <Row>
        <Field label="City">
          <Input value={value.city ?? ''} onChange={set('city')} placeholder="City" />
        </Field>
        <Field label="State / Province">
          <Input value={value.region ?? ''} onChange={set('region')} placeholder="e.g. Maharashtra" />
        </Field>
      </Row>
      <Row>
        <Field label="Postal code">
          <Input value={value.postal_code ?? ''} onChange={set('postal_code')} placeholder="Postal code" />
        </Field>
        <Field label="Country">
          <Input value={value.country ?? ''} onChange={set('country')} placeholder="India" />
        </Field>
      </Row>
    </>
  );
}

// ── step progress bar ────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2.5rem', gap: 0 }}>
      {STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <>
            <div key={s.n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <div style={{
                width: '2rem', height: '2rem', borderRadius: '9999px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.875rem',
                background: done || active ? '#0284C7' : 'var(--tf-bg)',
                color: done || active ? 'white' : 'var(--tf-muted)',
                border: done || active ? 'none' : '1.5px solid var(--tf-border)',
                flexShrink: 0,
              }}>
                {done ? '✓' : s.n}
              </div>
              <span style={{
                fontSize: '0.6875rem', fontWeight: active ? 700 : 500, marginTop: '0.35rem',
                color: active ? '#0284C7' : done ? 'var(--tf-text)' : 'var(--tf-muted)',
                whiteSpace: 'nowrap',
              }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div key={`line-${i}`} style={{
                height: '2px', flex: 1,
                background: s.n < current ? '#0284C7' : 'var(--tf-border)',
                alignSelf: 'flex-start', marginTop: '1rem',
              }} />
            )}
          </>
        );
      })}
    </div>
  );
}

// ── card wrapper ─────────────────────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
      borderRadius: '0.875rem', padding: '2rem 2rem 1.75rem',
    }}>
      <div style={{ marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--tf-border)' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700 }}>{title}</h2>
        {subtitle && <p style={{ color: 'var(--tf-muted)', fontSize: '0.9rem', marginTop: '0.25rem', fontWeight: 400 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid var(--tf-border)' }}>
      {children}
    </div>
  );
}

// ── direction label helper ────────────────────────────────────────────────────

function directionLabel(category: FilingTransactionCategory, direction: 'to_llc' | 'from_llc'): string {
  if (category === 'loan_to_llc' || category === 'loan_from_llc') {
    return direction === 'to_llc' ? 'Owner → LLC' : 'LLC → Owner';
  }
  return direction === 'to_llc' ? 'Owner → LLC (paid to LLC)' : 'LLC → Owner (received by owner)';
}

// ── main component ───────────────────────────────────────────────────────────

export function FilingWizard() {
  usePageMeta({
    title: 'Filing Wizard | FileTax.co',
    description: 'Complete your Form 5472 + Pro Forma 1120 filing in 4 steps.',
  });

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [filing, setFiling] = useState<Filing | null>(null);
  const [transactions, setTransactions] = useState<FilingTransaction[]>([]);
  const [loadingFiling, setLoadingFiling] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Step 1 state ────────────────────────────────────────────
  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [taxYear, setTaxYear] = useState(CURRENT_TAX_YEAR);
  const [mailingAddress, setMailingAddress] = useState<Address>({});
  const [totalAssets, setTotalAssets] = useState('');
  const [naicsCode, setNaicsCode] = useState('');
  const [naicsDescription, setNaicsDescription] = useState('');

  const [incorpMonth, setIncorpMonth] = useState('');
  const [incorpDay,   setIncorpDay]   = useState('');
  const [incorpYear,  setIncorpYear]  = useState('');
  const [dateOfClosure, setDateOfClosure] = useState('');

  // ── Derived: Initial Return flag ────────────────────────────
  const isInitialReturn = useMemo(
    () => Boolean(incorpYear && taxYear && incorpYear === String(Number(taxYear) - 1)),
    [incorpYear, taxYear],
  );

  // ── Step 2 state ────────────────────────────────────────────
  const [ownerFullName, setOwnerFullName] = useState('');
  const [ownerPrimaryCountry, setOwnerPrimaryCountry] = useState('');
  const [ownerCountryResidence, setOwnerCountryResidence] = useState('');
  const [ownerCountryCitizenship, setOwnerCountryCitizenship] = useState('');
  const [ownerPassport, setOwnerPassport] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerUsTin, setOwnerUsTin] = useState('');
  const [ownerReferenceId, setOwnerReferenceId] = useState('');
  const [ownerNaicsCode, setOwnerNaicsCode] = useState('');
  const [ownerNaicsDescription, setOwnerNaicsDescription] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});

  // ── Step 3 state ────────────────────────────────────────────
  const [txCategory, setTxCategory] = useState<FilingTransactionCategory>('capital_contribution');
  const [txDirection, setTxDirection] = useState<'to_llc' | 'from_llc'>('to_llc');
  const [txAmount, setTxAmount] = useState('');
  const [txDate, setTxDate] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txIsRoyalty, setTxIsRoyalty] = useState(false);
  const [addingTx, setAddingTx] = useState(false);

  // ── Step 4: download state ───────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  // Redirect if not logged in once auth resolves
  useEffect(() => {
    if (!authLoading && !user) navigate('/portal?mode=login');
  }, [authLoading, user, navigate]);

  // Load filing — wait until auth is resolved and user is available
  useEffect(() => {
    if (authLoading) return;
    if (!id || !user) return;

    let cancelled = false;

    Promise.all([
      supabase.from('filings').select('*').eq('id', id).eq('user_id', user.id).single(),
      supabase.from('filing_transactions').select('*').eq('filing_id', id).order('created_at'),
    ]).then(([{ data: f }, { data: txs }]) => {
      if (cancelled) return;
      if (!f) { navigate('/dashboard'); return; }
      const fi = f as Filing;
      setFiling(fi);
      setTransactions((txs as FilingTransaction[]) ?? []);
      // Step 1
      setLlcName(fi.llc_name ?? '');
      setEin(fi.ein ?? '');
      setStateOfFormation(fi.state_of_formation ?? '');
      setTaxYear(fi.tax_year ?? CURRENT_TAX_YEAR);
      setMailingAddress(fi.mailing_address ?? {});
      setTotalAssets(fi.total_assets != null ? String(fi.total_assets) : '');
      setNaicsCode(fi.naics_code ?? '');
      setNaicsDescription(fi.naics_description ?? '');
      const incorp = parseIso(fi.date_of_incorporation);
      setIncorpMonth(incorp.m);
      setIncorpDay(incorp.d);
      setIncorpYear(incorp.y);
      setDateOfClosure(fi.date_of_closure ?? '');
      // Step 2
      setOwnerFullName(fi.owner_full_name ?? '');
      setOwnerPrimaryCountry(fi.owner_primary_country ?? '');
      setOwnerCountryResidence(fi.owner_country_residence ?? '');
      setOwnerCountryCitizenship(fi.owner_country_citizenship ?? '');
      setOwnerPassport(fi.owner_passport_number ?? '');
      setOwnerForeignTaxId(fi.owner_foreign_tax_id ?? '');
      setOwnerUsTin(fi.owner_us_tin ?? '');
      setOwnerReferenceId(fi.owner_reference_id ?? '');
      setOwnerNaicsCode(fi.owner_naics_code ?? '');
      setOwnerNaicsDescription(fi.owner_naics_description ?? '');
      setOwnerAddress(fi.owner_address ?? {});
      setLoadingFiling(false);
    });

    return () => { cancelled = true; };
  }, [id, user, authLoading]);

  const currentStep = filing?.current_step ?? 1;

  const saveStep = async (_step: number, patch: Partial<Filing>, nextStep: number) => {
    if (!id) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('filings')
      .update({ ...patch, current_step: nextStep, status: 'in_progress' })
      .eq('id', id);
    if (err) { setError(err.message); setSaving(false); return; }
    setFiling(prev => prev ? { ...prev, ...patch, current_step: nextStep, status: 'in_progress' } : prev);
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
      total_assets: totalAssets ? Number(totalAssets) : null,
      naics_code: naicsCode.trim() || null,
      naics_description: naicsDescription.trim() || null,
      date_of_incorporation: buildIso(incorpMonth, incorpDay, incorpYear),
      date_of_closure: dateOfClosure || null,
      initial_return: isInitialReturn,
    }, 2);
  };

  const handleStep2 = async () => {
    if (!ownerFullName.trim()) { setError('Owner full name is required.'); return; }
    if (!ownerCountryResidence.trim()) { setError('Country of residence is required.'); return; }
    await saveStep(2, {
      owner_full_name: ownerFullName.trim(),
      owner_primary_country: ownerPrimaryCountry.trim() || ownerCountryResidence.trim(),
      owner_country_residence: ownerCountryResidence.trim(),
      owner_country_citizenship: ownerCountryCitizenship.trim(),
      owner_passport_number: ownerPassport.trim(),
      owner_foreign_tax_id: ownerForeignTaxId.trim(),
      owner_us_tin: ownerUsTin.trim() || null,
      owner_reference_id: ownerReferenceId.trim() || null,
      owner_naics_code: ownerNaicsCode.trim() || null,
      owner_naics_description: ownerNaicsDescription.trim() || null,
      owner_address: ownerAddress,
    }, 3);
  };

  const handleAddTransaction = async () => {
    if (!txAmount || isNaN(Number(txAmount)) || Number(txAmount) <= 0) {
      setError('Enter a valid transaction amount.'); return;
    }
    setAddingTx(true); setError('');
    const { data, error: err } = await supabase.from('filing_transactions').insert({
      filing_id: id,
      category: txCategory,
      direction: txDirection,
      amount: Number(txAmount),
      currency: 'USD',
      transaction_date: txDate || null,
      description: txDesc.trim() || null,
      is_royalty: txCategory === 'rent_royalty' ? txIsRoyalty : null,
    }).select().single();
    if (err) { setError(err.message); setAddingTx(false); return; }
    setTransactions(prev => [...prev, data as FilingTransaction]);
    setTxAmount(''); setTxDate(''); setTxDesc('');
    if (txCategory !== 'rent_royalty') setTxIsRoyalty(false);
    setAddingTx(false);
  };

  const handleDeleteTransaction = async (txId: string) => {
    await supabase.from('filing_transactions').delete().eq('id', txId);
    setTransactions(prev => prev.filter(t => t.id !== txId));
  };

  // ── Download single assembled PDF ────────────────────────────
  const handleDownload = async () => {
    if (!filing) return;
    setGenerating(true);
    setDownloadError('');
    try {
      // Bridge FilingTransaction → Transaction (pdfGenerator's canonical type).
      //
      // Key mappings:
      //   category       → transaction_type  (1:1 string, same values)
      //   direction:
      //     'to_llc'   → 'paid'     (owner pays the LLC)
      //     'from_llc' → 'received' (owner receives from the LLC)
      //   amount         → amount_usd
      //   is_royalty     → is_royalty (passed through; only meaningful for rent_royalty)
      const txsForPdf = transactions.map(tx => ({
        id: tx.id,
        filing_id: tx.filing_id,
        created_at: tx.created_at,
        transaction_type: tx.category,
        direction: tx.direction === 'to_llc' ? 'paid' : 'received',
        amount_usd: tx.amount,
        transaction_date: tx.transaction_date,
        description: tx.description,
        is_royalty: tx.is_royalty ?? false,
      }));

      // assembleFilingPackage returns a single merged PDF:
      //   Cover Letter → Filing Instructions → Pro Forma 1120 → Form 5472 → Statements
      const pdfBytes = await assembleFilingPackage(filing, txsForPdf as any, 'mail');

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Form5472_${filing.llc_name?.replace(/\s+/g, '_') ?? 'Filing'}_${filing.tax_year ?? ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Mark filing as completed
      await supabase.from('filings').update({ status: 'completed' }).eq('id', id);
      setFiling(prev => prev ? { ...prev, status: 'completed' } : prev);
    } catch (e: any) {
      console.error('[download]', e);
      setDownloadError(
        e?.message?.includes('Could not load PDF')
          ? 'PDF templates not found. In your Codespace terminal run: bash scripts/download-irs-pdfs.sh'
          : (e?.message ?? 'Failed to generate PDF. Please try again.')
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true); setError('');
    const { error: err } = await supabase
      .from('filings').update({ current_step: 4, status: 'in_progress' }).eq('id', id);
    if (err) { setError(err.message); setSaving(false); return; }
    navigate('/dashboard');
  };

  if (authLoading || loadingFiling) {
    return (
      <section style={{ padding: '6rem 1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem' }}>Loading your filing…</p>
      </section>
    );
  }

  const btnPrimary = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.9375rem',
    padding: '0.6rem 1.4rem', borderRadius: '0.5rem', border: 'none',
    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.65 : 1,
    minHeight: '42px', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
    ...extra,
  });

  const btnGhost = (): React.CSSProperties => ({
    background: 'none', color: 'var(--tf-muted)', fontWeight: 600, fontSize: '0.9375rem',
    padding: '0.6rem 1rem', borderRadius: '0.5rem',
    border: '1px solid var(--tf-border)', cursor: 'pointer', minHeight: '42px',
  });

  return (
    <section style={{ padding: '2.5rem 1rem 6rem', background: 'var(--tf-bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: '660px', margin: '0 auto' }}>

        <a
          href="/dashboard"
          style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginBottom: '2rem' }}
        >
          ← My Filings
        </a>

        <StepBar current={currentStep} />

        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.5rem',
            padding: '0.75rem 1rem', marginBottom: '1.25rem',
            color: '#991B1B', fontSize: '0.9rem', fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        {/* ── Step 1: LLC Details ── */}
        {currentStep === 1 && (
          <Card title="LLC Details" subtitle="Basic information about your US LLC.">
            <Row>
              <Field label="LLC name" required>
                <Input value={llcName} onChange={e => setLlcName(e.target.value)} placeholder="Acme LLC" />
              </Field>
              <Field label="EIN" required>
                <Input value={ein} onChange={e => setEin(e.target.value)} placeholder="XX-XXXXXXX" />
              </Field>
            </Row>
            <Row>
              <Field label="State of formation">
                <Select value={stateOfFormation} onChange={e => setStateOfFormation(e.target.value)}>
                  <option value="">Select state…</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="Tax year">
                <Select value={taxYear} onChange={e => setTaxYear(e.target.value)}>
                  {TAX_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </Select>
              </Field>
            </Row>

            <DateParts
              label="Date of incorporation"
              hint="(optional)"
              month={incorpMonth} day={incorpDay} year={incorpYear}
              onMonth={setIncorpMonth} onDay={setIncorpDay} onYear={setIncorpYear}
            />

            {isInitialReturn && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                background: '#E0F2FE', border: '1px solid #BAE6FD',
                borderRadius: '9999px', padding: '0.3rem 0.85rem',
                fontSize: '0.8125rem', fontWeight: 700, color: '#075985',
                marginBottom: '1.25rem',
              }}>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Initial Return — will be checked on Form 5472 &amp; Pro Forma 1120
              </div>
            )}

            <Field label="Date of dissolution" hint="(if closed)">
              <Input type="date" value={dateOfClosure} onChange={e => setDateOfClosure(e.target.value)} />
            </Field>

            <Row>
              <Field label="Total assets at year-end (USD)" hint="(optional)">
                <Input type="number" min="0" step="0.01" value={totalAssets} onChange={e => setTotalAssets(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="NAICS code" hint="(6-digit, optional)">
                <Input value={naicsCode} onChange={e => setNaicsCode(e.target.value)} placeholder="e.g. 541511" />
              </Field>
            </Row>
            <Field label="Principal business activity" hint="(optional)">
              <Input value={naicsDescription} onChange={e => setNaicsDescription(e.target.value)} placeholder="e.g. Custom Computer Programming Services" />
            </Field>
            <SectionLabel>Mailing address <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <AddressFields value={mailingAddress} onChange={setMailingAddress} />
            <Actions>
              <span />
              <button style={btnPrimary()} onClick={handleStep1} disabled={saving}>
                {saving ? 'Saving…' : 'Save & Continue →'}
              </button>
            </Actions>
          </Card>
        )}

        {/* ── Step 2: Owner Information ── */}
        {currentStep === 2 && (
          <Card title="Owner Information" subtitle="Details of the foreign owner (you).">
            <Field label="Full legal name" required hint="As on passport">
              <Input value={ownerFullName} onChange={e => setOwnerFullName(e.target.value)} placeholder="Full name" />
            </Field>

            <SectionLabel>Country details</SectionLabel>
            <Row>
              <Field label="Primary country of business" hint="(for Form 5472 Line 4c)">
                <Input value={ownerPrimaryCountry} onChange={e => setOwnerPrimaryCountry(e.target.value)} placeholder="India" />
              </Field>
              <Field label="Country of residence" required>
                <Input value={ownerCountryResidence} onChange={e => setOwnerCountryResidence(e.target.value)} placeholder="India" />
              </Field>
            </Row>
            <Field label="Country of citizenship" hint="(leave blank if same as residence)">
              <Input value={ownerCountryCitizenship} onChange={e => setOwnerCountryCitizenship(e.target.value)} placeholder="India" />
            </Field>

            <SectionLabel>Tax identifiers</SectionLabel>
            <Row>
              <Field label="Foreign tax ID" hint="(PAN, etc.)">
                <Input value={ownerForeignTaxId} onChange={e => setOwnerForeignTaxId(e.target.value)} placeholder="e.g. ABCDE1234F" />
              </Field>
              <Field label="US TIN / ITIN" hint="(if any)">
                <Input value={ownerUsTin} onChange={e => setOwnerUsTin(e.target.value)} placeholder="e.g. 9XX-XX-XXXX" />
              </Field>
            </Row>
            <Row>
              <Field label="Passport number">
                <Input value={ownerPassport} onChange={e => setOwnerPassport(e.target.value)} placeholder="Passport number" />
              </Field>
              <Field label="Reference ID" hint="(if assigned by filer)">
                <Input value={ownerReferenceId} onChange={e => setOwnerReferenceId(e.target.value)} placeholder="Optional reference" />
              </Field>
            </Row>

            <SectionLabel>Owner's business activity <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — for Form 5472 Part III)</span></SectionLabel>
            <Row>
              <Field label="NAICS code">
                <Input value={ownerNaicsCode} onChange={e => setOwnerNaicsCode(e.target.value)} placeholder="e.g. 541511" />
              </Field>
              <Field label="Business activity description">
                <Input value={ownerNaicsDescription} onChange={e => setOwnerNaicsDescription(e.target.value)} placeholder="e.g. Software consulting" />
              </Field>
            </Row>

            <SectionLabel>Owner address <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            <Actions>
              <button style={btnGhost()} onClick={() => saveStep(2, {}, 1)} disabled={saving}>← Back</button>
              <button style={btnPrimary()} onClick={handleStep2} disabled={saving}>
                {saving ? 'Saving…' : 'Save & Continue →'}
              </button>
            </Actions>
          </Card>
        )}

        {/* ── Step 3: Transactions ── */}
        {currentStep === 3 && (
          <Card
            title="Reportable Transactions"
            subtitle="Enter every transaction between you and the LLC during the tax year. Leave empty if none."
          >
            {transactions.length > 0 && (
              <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {transactions.map(tx => (
                  <div
                    key={tx.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                      padding: '0.75rem 1rem', borderRadius: '0.5rem',
                      background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', gap: '1rem',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700 }}>${Number(tx.amount).toLocaleString()} {tx.currency}</span>
                      <span style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginLeft: '0.5rem' }}>
                        {TX_CATEGORIES.find(c => c.value === tx.category)?.label}
                        {tx.category === 'rent_royalty' && (
                          <span style={{ marginLeft: '0.3rem', fontStyle: 'italic' }}>
                            ({tx.is_royalty ? 'Royalty' : 'Rent'})
                          </span>
                        )}
                        {' · '}{tx.direction === 'to_llc' ? 'Owner → LLC' : 'LLC → Owner'}
                      </span>
                      {tx.description && (
                        <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>{tx.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteTransaction(tx.id)}
                      aria-label="Remove"
                      style={{ background: 'none', border: 'none', color: '#B31D1D', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 700, flexShrink: 0, padding: '0.2rem 0.4rem' }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem', padding: '1.25rem' }}>
              <p style={{ fontWeight: 700, fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--tf-muted)', marginBottom: '1rem' }}>Add transaction</p>
              <Row>
                <Field label="Category">
                  <Select
                    value={txCategory}
                    onChange={e => {
                      const cat = e.target.value as FilingTransactionCategory;
                      setTxCategory(cat);
                      if (cat !== 'rent_royalty') setTxIsRoyalty(false);
                    }}
                  >
                    {TX_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </Field>
                <Field label="Direction">
                  <Select value={txDirection} onChange={e => setTxDirection(e.target.value as 'to_llc' | 'from_llc')}>
                    <option value="to_llc">Owner → LLC (paid)</option>
                    <option value="from_llc">LLC → Owner (received)</option>
                  </Select>
                </Field>
              </Row>

              {txCategory === 'rent_royalty' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.65rem 0.9rem',
                  background: '#EFF6FF', border: '1px solid #BFDBFE',
                  borderRadius: '0.5rem', marginBottom: '1.25rem',
                }}>
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    cursor: 'pointer', userSelect: 'none',
                    fontSize: '0.9rem', fontWeight: 600, color: '#1E40AF',
                  }}>
                    <input
                      type="checkbox"
                      checked={txIsRoyalty}
                      onChange={e => setTxIsRoyalty(e.target.checked)}
                      style={{ width: '1rem', height: '1rem', cursor: 'pointer', accentColor: '#2563EB' }}
                    />
                    This is a <strong style={{ marginLeft: '0.2rem' }}>royalty</strong> (not rent)
                  </label>
                  <span style={{ color: '#3B82F6', fontSize: '0.8125rem', fontWeight: 400 }}>
                    {txIsRoyalty
                      ? 'Will fill Form 5472 lines 13b / 27b (Royalties)'
                      : 'Will fill Form 5472 lines 13a / 27a (Rents)'}
                  </span>
                </div>
              )}

              <Row>
                <Field label="Amount (USD)" required>
                  <Input type="number" min="0" step="0.01" value={txAmount} onChange={e => setTxAmount(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Date" hint="(optional)">
                  <Input type="date" value={txDate} onChange={e => setTxDate(e.target.value)} />
                </Field>
              </Row>
              <Field label="Description" hint="(optional)">
                <Input value={txDesc} onChange={e => setTxDesc(e.target.value)} placeholder="Brief note" />
              </Field>
              <button
                style={btnPrimary({ fontSize: '0.875rem', padding: '0.5rem 1.1rem' })}
                onClick={handleAddTransaction}
                disabled={addingTx}
              >
                {addingTx ? 'Adding…' : '+ Add'}
              </button>
            </div>
            <Actions>
              <button style={btnGhost()} onClick={() => saveStep(3, {}, 2)} disabled={saving}>← Back</button>
              <button style={btnPrimary()} onClick={() => saveStep(3, {}, 4)} disabled={saving}>
                {saving ? 'Saving…' : 'Continue →'}
              </button>
            </Actions>
          </Card>
        )}

        {/* ── Step 4: Review & Download ── */}
        {currentStep === 4 && filing && (
          <Card title="Review & Download" subtitle="Check everything, then download your completed filing package.">

            <SectionLabel>LLC</SectionLabel>
            <div style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.9375rem', marginBottom: '0.5rem' }}>
              <p><strong>Name:</strong> {filing.llc_name ?? '—'}</p>
              <p><strong>EIN:</strong> {filing.ein ?? '—'}</p>
              <p><strong>State:</strong> {filing.state_of_formation ?? '—'}</p>
              <p><strong>Tax year:</strong> {filing.tax_year ?? '—'}</p>
              {filing.date_of_incorporation && (
                <p><strong>Date of incorporation:</strong> {formatDate(filing.date_of_incorporation)}</p>
              )}
              {filing.date_of_closure && (
                <p><strong>Date of dissolution:</strong> {formatDate(filing.date_of_closure)}</p>
              )}
              {filing.initial_return && (
                <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <strong>Initial Return:</strong>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    background: '#E0F2FE', border: '1px solid #BAE6FD',
                    borderRadius: '9999px', padding: '0.15rem 0.65rem',
                    fontSize: '0.8125rem', fontWeight: 700, color: '#075985',
                  }}>
                    ✓ Yes — box will be checked
                  </span>
                </p>
              )}
              {filing.total_assets != null && <p><strong>Total assets:</strong> ${Number(filing.total_assets).toLocaleString()}</p>}
              {filing.naics_code && <p><strong>NAICS code:</strong> {filing.naics_code} {filing.naics_description ? `— ${filing.naics_description}` : ''}</p>}
            </div>

            <SectionLabel>Owner</SectionLabel>
            <div style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.9375rem', marginBottom: '0.5rem' }}>
              <p><strong>Name:</strong> {filing.owner_full_name ?? '—'}</p>
              <p><strong>Primary country:</strong> {filing.owner_primary_country ?? '—'}</p>
              <p><strong>Residence:</strong> {filing.owner_country_residence ?? '—'}</p>
              <p><strong>Citizenship:</strong> {filing.owner_country_citizenship ?? '—'}</p>
              <p><strong>Passport:</strong> {filing.owner_passport_number ?? '—'}</p>
              <p><strong>Foreign tax ID:</strong> {filing.owner_foreign_tax_id ?? '—'}</p>
              {filing.owner_us_tin && <p><strong>US TIN / ITIN:</strong> {filing.owner_us_tin}</p>}
              {filing.owner_naics_code && <p><strong>Owner NAICS:</strong> {filing.owner_naics_code} {filing.owner_naics_description ? `— ${filing.owner_naics_description}` : ''}</p>}
            </div>

            <SectionLabel>Transactions ({transactions.length})</SectionLabel>
            {transactions.length === 0 ? (
              <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '0.5rem' }}>No transactions recorded.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.5rem' }}>
                {transactions.map(tx => (
                  <div key={tx.id} style={{ background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.7rem 1rem', fontSize: '0.9375rem' }}>
                    <strong>${Number(tx.amount).toLocaleString()}</strong>
                    {' — '}
                    {TX_CATEGORIES.find(c => c.value === tx.category)?.label}
                    {tx.category === 'rent_royalty' && (
                      <span style={{ fontStyle: 'italic', marginLeft: '0.3rem' }}>
                        ({tx.is_royalty ? 'Royalty' : 'Rent'})
                      </span>
                    )}
                    {', '}{tx.direction === 'to_llc' ? 'Owner → LLC' : 'LLC → Owner'}
                    {tx.description && <span style={{ color: 'var(--tf-muted)', marginLeft: '0.4rem' }}>({tx.description})</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Download error */}
            {downloadError && (
              <div style={{
                background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.5rem',
                padding: '0.75rem 1rem', marginTop: '1.25rem',
                color: '#991B1B', fontSize: '0.875rem', lineHeight: 1.5,
              }}>
                {downloadError}
              </div>
            )}

            {/* Download success badge */}
            {filing.status === 'completed' && !downloadError && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                background: '#ECFDF5', border: '1px solid #A7F3D0',
                borderRadius: '9999px', padding: '0.3rem 0.85rem',
                fontSize: '0.8125rem', fontWeight: 700, color: '#065F46',
                marginTop: '1rem',
              }}>
                ✓ Package downloaded — filing marked complete
              </div>
            )}

            <Actions>
              <button style={btnGhost()} onClick={() => saveStep(4, {}, 3)} disabled={saving || generating}>← Edit Transactions</button>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  style={btnPrimary({ background: '#059669', cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.65 : 1 })}
                  onClick={handleDownload}
                  disabled={generating}
                >
                  {generating ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                      Generating…
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download Filing Package
                    </>
                  )}
                </button>
              </div>
            </Actions>

            <style>{`
              @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
          </Card>
        )}

      </div>
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--tf-bg)',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  boxShadow: '0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
};
