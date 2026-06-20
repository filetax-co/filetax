import { useEffect, useState, useMemo, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase, Filing, Transaction, Address } from '../../lib/supabase';

// Categories supported by this wizard (subset of Transaction['transaction_type']).
type WizardTxCategory =
  | 'capital_contribution'
  | 'distribution'
  | 'dividend'
  | 'loan_to_llc'
  | 'loan_from_llc'
  | 'service_payment'
  | 'rent_royalty'
  | 'other';
import { assembleFilingPackage, EARLIEST_SUPPORTED_TAX_YEAR } from '../../lib/pdfGenerator';
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

const TX_CATEGORIES: { value: WizardTxCategory; label: string }[] = [
  { value: 'capital_contribution', label: 'Capital Contribution' },
  { value: 'distribution',         label: 'Distribution' },
  { value: 'dividend',             label: 'Dividend' },
  { value: 'loan_to_llc',          label: 'Loan to LLC (owner lent to LLC)' },
  { value: 'loan_from_llc',        label: 'Loan from LLC (owner borrowed from LLC)' },
  { value: 'service_payment',      label: 'Service Payment' },
  { value: 'rent_royalty',         label: 'Rent / Royalty / License' },
  { value: 'other',                label: 'Other' },
];

// Returns the current year in US Eastern Time (IRS jurisdiction).
function getEasternYear(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
    }).format(new Date())
  );
}
const ET_YEAR = getEasternYear();
const CURRENT_TAX_YEAR = String(ET_YEAR - 1);
const TAX_YEARS = (() => {
  const newest = Number(CURRENT_TAX_YEAR);
  const out: string[] = [];
  for (let y = newest; y >= EARLIEST_SUPPORTED_TAX_YEAR; y--) out.push(String(y));
  return out;
})();

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

const YEARS_INCORP = Array.from({ length: 30 }, (_, i) => String(ET_YEAR - i));

const STEPS = [
  { n: 1, label: 'LLC Details' },
  { n: 2, label: 'Owner Info' },
  { n: 3, label: 'Transactions' },
  { n: 4, label: 'Review & File' },
];

// ── Inline sub-components ──────────────────────────────────────────────────

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
      {children}
    </div>
  );
}

function Field({
  label, hint, lineRef, children,
}: {
  label: string; hint?: string; lineRef?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--tf-text)' }}>
        {lineRef && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 700, color: 'var(--tf-primary)',
            background: 'rgba(2,132,199,0.08)', borderRadius: '0.25rem',
            padding: '0.1rem 0.35rem', marginRight: '0.4rem', letterSpacing: '0.02em',
          }}>{lineRef}</span>
        )}
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: '0.72rem', color: 'var(--tf-muted)' }}>{hint}</span>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        border: '1px solid var(--tf-border)',
        borderRadius: '0.4rem',
        padding: '0.5rem 0.65rem',
        fontSize: '0.875rem',
        background: 'var(--tf-surface)',
        color: 'var(--tf-text)',
        width: '100%',
        outline: 'none',
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
        border: '1px solid var(--tf-border)',
        borderRadius: '0.4rem',
        padding: '0.5rem 0.65rem',
        fontSize: '0.875rem',
        background: 'var(--tf-surface)',
        color: 'var(--tf-text)',
        width: '100%',
        outline: 'none',
        ...props.style,
      }}
    />
  );
}

function AddressBlock({
  value, onChange, prefix,
}: {
  value: Address | null;
  onChange: (a: Address) => void;
  prefix: string;
}) {
  const a = value ?? {};
  const upd = (k: keyof Address, v: string) => onChange({ ...a, [k]: v } as Address);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Input placeholder="Street" value={a.street ?? ''} onChange={e => upd('street', e.target.value)} id={`${prefix}_street`} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr', gap: '0.5rem' }}>
        <Input placeholder="City" value={a.city ?? ''} onChange={e => upd('city', e.target.value)} />
        <Input placeholder="State/Region" value={a.region ?? ''} onChange={e => upd('region', e.target.value)} />
        <Input placeholder="Postal code" value={a.postal_code ?? ''} onChange={e => upd('postal_code', e.target.value)} />
      </div>
      <Input placeholder="Country" value={a.country ?? ''} onChange={e => upd('country', e.target.value)} />
    </div>
  );
}

function fmtDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function FilingWizard() {
  usePageMeta('Filing Wizard', 'Complete your Form 5472 filing step by step.');
  const { filingId } = useParams<{ filingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep]         = useState(1);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [filing, setFiling]     = useState<Filing | null>(null);
  const [generating, setGenerating] = useState(false);

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [llcName, setLlcName]           = useState('');
  const [ein, setEin]                   = useState('');
  const [taxYear, setTaxYear]           = useState(CURRENT_TAX_YEAR);
  const [incorpMonth, setIncorpMonth]   = useState('');
  const [incorpDay, setIncorpDay]       = useState('');
  const [incorpYear, setIncorpYear]     = useState('');
  const [closureDate, setClosureDate]   = useState('');
  const [naicsCode, setNaicsCode]       = useState('');
  const [naicsDesc, setNaicsDesc]       = useState('');
  const [mailingAddr, setMailingAddr]   = useState<Address | null>(null);
  const [totalAssets, setTotalAssets]   = useState('');
  const [initialReturn, setInitialReturn] = useState(false);
  const [nameChange, setNameChange]     = useState(false);
  const [addressChange, setAddressChange] = useState(false);

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [ownerName, setOwnerName]             = useState('');
  const [ownerUsTin, setOwnerUsTin]           = useState('');
  const [ownerForeignTin, setOwnerForeignTin] = useState('');
  const [ownerRefId, setOwnerRefId]           = useState('');
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCit, setOwnerCountryCit] = useState('');
  const [ownerResCountry, setOwnerResCountry] = useState('');
  const [ownerBizActivity, setOwnerBizActivity] = useState('');
  const [ownerAddr, setOwnerAddr]             = useState<Address | null>(null);
  const [signerTitle, setSignerTitle]         = useState('Owner');

  // ── Step 3 state ──────────────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading]       = useState(false);

  // ── Tx form state ─────────────────────────────────────────────────────────
  const [txCategory, setTxCategory]   = useState<WizardTxCategory>('capital_contribution');
  const [txAmount, setTxAmount]       = useState('');
  const [txDesc, setTxDesc]           = useState('');
  const [txDirection, setTxDirection] = useState<'received' | 'paid'>('received');
  const [txIsRoyalty, setTxIsRoyalty] = useState(false);
  const [txSaving, setTxSaving]       = useState(false);

  const isInitialAutoDetected = useMemo(
    () => Boolean(incorpYear && taxYear && incorpYear === taxYear),
    [incorpYear, taxYear],
  );

  // ── Load existing filing on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!filingId) return;
    (async () => {
      const { data: fi } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();
      if (!fi) return;
      setFiling(fi);

      // Step 1
      setLlcName(fi.llc_name ?? '');
      setEin(fi.ein ?? '');
      setTaxYear(fi.tax_year ?? CURRENT_TAX_YEAR);
      if (fi.date_of_incorporation) {
        const d = new Date(`${fi.date_of_incorporation}T12:00:00`);
        if (!isNaN(d.getTime())) {
          setIncorpMonth(String(d.getMonth() + 1).padStart(2, '0'));
          setIncorpDay(String(d.getDate()).padStart(2, '0'));
          setIncorpYear(String(d.getFullYear()));
        }
      }
      setClosureDate(fmtDateInput(fi.date_of_closure));
      setNaicsCode(fi.naics_code ? String(fi.naics_code) : '');
      setNaicsDesc(fi.naics_description ?? '');
      setMailingAddr(fi.mailing_address ?? null);
      setTotalAssets(fi.total_assets != null ? String(fi.total_assets) : '');
      setInitialReturn(fi.initial_return ?? false);
      setNameChange(fi.name_change ?? false);
      setAddressChange(fi.address_change ?? false);

      // Step 2
      setOwnerName(fi.owner_full_name ?? '');
      setOwnerUsTin(fi.owner_us_tin ?? '');
      setOwnerForeignTin(fi.owner_foreign_tax_id ?? '');
      setOwnerRefId(fi.owner_reference_id ?? '');
      setOwnerCountryRes(fi.owner_country_residence ?? '');
      setOwnerCountryCit(fi.owner_country_citizenship ?? '');
      setOwnerResCountry(fi.owner_resident_country ?? '');
      setOwnerBizActivity(fi.owner_business_activity ?? '');
      setOwnerAddr(fi.owner_address ?? null);
      setSignerTitle(fi.signer_title ?? 'Owner');
    })();
  }, [filingId]);

  // FIX (point 5): load transactions any time step 3 becomes active —
  // including when the user navigates Back from step 4 — so the list is
  // always fresh and never shows a stale empty state.
  useEffect(() => {
    if (step !== 3 || !filingId) return;
    (async () => {
      setTxLoading(true);
      const { data } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId)
        .order('created_at', { ascending: true });
      setTransactions(data ?? []);
      setTxLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, filingId]);

  // FIX (point 9): refresh the filing record from DB every time the user
  // reaches Step 4 so the review screen always shows the latest saved values
  // (Steps 1 and 2 save to DB but only update local state — filing object
  // would otherwise remain stale after those saves).
  useEffect(() => {
    if (step !== 4 || !filingId) return;
    (async () => {
      const { data: fi } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();
      if (fi) setFiling(fi);
    })();
  }, [step, filingId]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function buildIncorpDate(): string | null {
    if (!incorpYear || !incorpMonth || !incorpDay) return null;
    return `${incorpYear}-${incorpMonth}-${incorpDay}`;
  }

  async function saveStep(stepNum: number, payload: Partial<Filing>, nextStep: number) {
    setSaving(true);
    setError(null);
    try {
      if (!filingId) throw new Error('No filing ID');
      const { error: err } = await supabase
        .from('filings')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', filingId);
      if (err) throw err;
      setStep(nextStep);
      window.scrollTo(0, 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Step handlers ─────────────────────────────────────────────────────────

  async function handleStep1() {
    const incorpDate = buildIncorpDate();
    await saveStep(1, {
      llc_name:             llcName.trim(),
      ein:                  ein.trim(),
      tax_year:             taxYear,
      date_of_incorporation: incorpDate,
      date_of_closure:      closureDate || null,
      naics_code:           naicsCode ? Number(naicsCode) : null,
      naics_description:    naicsDesc.trim() || null,
      mailing_address:      mailingAddr,
      total_assets:         totalAssets ? Number(totalAssets) : null,
      initial_return:       isInitialAutoDetected || initialReturn,
      name_change:          nameChange,
      address_change:       addressChange,
    }, 2);
  }

  async function handleStep2() {
    await saveStep(2, {
      owner_full_name:          ownerName.trim(),
      owner_us_tin:             ownerUsTin.trim() || null,
      owner_foreign_tax_id:     ownerForeignTin.trim() || null,
      owner_reference_id:       ownerRefId.trim() || null,
      owner_country_residence:  ownerCountryRes.trim() || null,
      owner_country_citizenship: ownerCountryCit.trim() || null,
      owner_resident_country:   ownerResCountry.trim() || null,
      owner_business_activity:  ownerBizActivity.trim() || null,
      owner_address:            ownerAddr,
      signer_title:             signerTitle.trim() || 'Owner',
    }, 3);
  }

  async function handleAddTransaction() {
    if (!txAmount || !filingId) return;
    setTxSaving(true);
    setError(null);
    try {
      const amt = Number(txAmount);

      // Derive the canonical direction for categories where it is implicit.
      // loan_to_llc   = owner lent TO the LLC   → LLC *received* the funds
      // loan_from_llc = owner borrowed FROM LLC  → LLC *paid* out the funds
      // capital_contribution = owner puts money in → LLC received
      // distribution         = LLC returns money  → LLC paid
      // dividend             = LLC distributes earnings → LLC paid
      // All other categories: use the user-selected txDirection.
      let direction: 'received' | 'paid' = txDirection;
      if (txCategory === 'loan_to_llc' || txCategory === 'capital_contribution') {
        direction = 'received';
      } else if (
        txCategory === 'loan_from_llc' ||
        txCategory === 'distribution' ||
        txCategory === 'dividend'
      ) {
        direction = 'paid';
      }

      const { data, error: err } = await supabase
        .from('reportable_transactions')
        .insert({
          filing_id:        filingId,
          transaction_type: txCategory,
          amount_usd:       amt,
          description:      txDesc.trim() || null,
          direction,
          is_royalty:       txIsRoyalty,
        })
        .select()
        .single();
      if (err) throw err;
      setTransactions(prev => [...prev, data]);
      setTxAmount('');
      setTxDesc('');
      setTxIsRoyalty(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add transaction');
    } finally {
      setTxSaving(false);
    }
  }

  async function handleDeleteTransaction(txId: string) {
    const { error: err } = await supabase.from('reportable_transactions').delete().eq('id', txId);
    if (!err) setTransactions(prev => prev.filter(t => t.id !== txId));
  }

  async function handleGenerate() {
    if (!filingId) return;
    setGenerating(true);
    setError(null);
    try {
      const { data: fi } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();
      if (!fi) throw new Error('Filing not found');

      const { data: txns } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId);

      // FIX (point 10): generate the PDF first — only mark as completed if
      // the full PDF assembly and download succeeds. Previously the status
      // update ran even when assembleFilingPackage threw, leaving filings
      // stuck as 'completed' with no actual PDF produced.
      const pdfBytes = await assembleFilingPackage(fi, txns ?? []);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Form5472_${fi.llc_name?.replace(/\s+/g, '_') ?? 'Filing'}_${fi.tax_year ?? ''}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      // Only reaches here if PDF was generated without throwing.
      await supabase
        .from('filings')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', filingId);

      navigate('/dashboard');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const stepStyle: React.CSSProperties = {
    background: 'var(--tf-card)',
    borderRadius: '0.75rem',
    padding: '1.75rem',
    boxShadow: '0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)',
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Progress */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        {STEPS.map(s => (
          <div
            key={s.n}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '0.5rem',
              borderRadius: '0.5rem',
              fontSize: '0.8rem',
              fontWeight: step === s.n ? 700 : 400,
              background: step === s.n
                ? 'var(--tf-primary)'
                : step > s.n ? 'rgba(2,132,199,0.15)' : 'var(--tf-surface)',
              color: step === s.n ? '#fff' : step > s.n ? 'var(--tf-primary)' : 'var(--tf-muted)',
              border: '1px solid',
              borderColor: step >= s.n ? 'var(--tf-primary)' : 'var(--tf-border)',
              cursor: step > s.n ? 'pointer' : 'default',
            }}
            onClick={() => step > s.n && setStep(s.n)}
          >
            {s.n}. {s.label}
          </div>
        ))}
      </div>

      {error && (
        <div style={{
          background: 'rgba(161,44,123,0.08)', border: '1px solid rgba(161,44,123,0.25)',
          borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem',
          color: '#a12c7b', fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div style={stepStyle}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--tf-text)' }}>
            Step 1 — LLC & Tax Year Details
          </h2>

          <FieldRow>
            <Field label="LLC legal name" lineRef="1a">
              <Input value={llcName} onChange={e => setLlcName(e.target.value)} placeholder="Acme LLC" />
            </Field>
            <Field label="EIN" lineRef="1b" hint="XX-XXXXXXX">
              <Input value={ein} onChange={e => setEin(e.target.value)} placeholder="12-3456789" />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Tax year" lineRef="tax year">
              <Select value={taxYear} onChange={e => setTaxYear(e.target.value)}>
                {TAX_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </Select>
            </Field>
            <Field label="Date of incorporation" lineRef="1c" hint="Month / Day / Year">
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.25fr', gap: '0.5rem' }}>
                <Select value={incorpMonth} onChange={e => setIncorpMonth(e.target.value)}>
                  <option value="">Month</option>
                  {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
                <Select value={incorpDay} onChange={e => setIncorpDay(e.target.value)}>
                  <option value="">Day</option>
                  {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </Select>
                <Select value={incorpYear} onChange={e => setIncorpYear(e.target.value)}>
                  <option value="">Year</option>
                  {YEARS_INCORP.map(y => <option key={y} value={y}>{y}</option>)}
                </Select>
              </div>
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Date of closure" lineRef="1c" hint="Leave blank if still active">
              <Input type="date" value={closureDate} onChange={e => setClosureDate(e.target.value)} />
            </Field>
            <Field label="NAICS code" lineRef="1d" hint="6-digit — optional">
              <Input value={naicsCode} onChange={e => setNaicsCode(e.target.value)} placeholder="523110" maxLength={6} />
            </Field>
          </FieldRow>

          <Field label="Principal business activity" lineRef="1d" hint="Description — optional">
            <Input value={naicsDesc} onChange={e => setNaicsDesc(e.target.value)} placeholder="Investment holding" />
          </Field>

          <div style={{ margin: '1rem 0' }}>
            <Field
              label="Total assets at year-end (USD)"
              lineRef="1e"
              hint="End-of-year balance — feeds Pro Forma 1120 line 1e (total assets). The ending balances from Part IV lines 17b and 31b separately feed Form 5472 line 22 / 36 and are reflected in lines 1f and 1h."
            >
              <Input
                type="number"
                value={totalAssets}
                onChange={e => setTotalAssets(e.target.value)}
                placeholder="0"
                min="0"
              />
            </Field>
          </div>

          <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--tf-text)', marginBottom: '0.5rem' }}>
              Return type checkboxes
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--tf-text)' }}>
                <input
                  type="checkbox"
                  checked={isInitialAutoDetected || initialReturn}
                  onChange={e => setInitialReturn(e.target.checked)}
                  disabled={isInitialAutoDetected}
                />
                Initial return
                {isInitialAutoDetected && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--tf-primary)' }}>(auto-detected — incorp year matches tax year)</span>
                )}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--tf-text)' }}>
                <input type="checkbox" checked={nameChange} onChange={e => setNameChange(e.target.checked)} />
                Name change
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--tf-text)' }}>
                <input type="checkbox" checked={addressChange} onChange={e => setAddressChange(e.target.checked)} />
                Address change
              </label>
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text)', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, color: 'var(--tf-primary)',
                background: 'rgba(2,132,199,0.08)', borderRadius: '0.25rem',
                padding: '0.1rem 0.35rem', marginRight: '0.4rem',
              }}>1h – 1k</span>
              US Mailing Address
            </p>
            <AddressBlock value={mailingAddr} onChange={setMailingAddr} prefix="mailing" />
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleStep1}
              disabled={saving || !llcName || !ein || !taxYear}
              style={{
                background: 'var(--tf-primary)', color: '#fff',
                border: 'none', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600,
                fontSize: '0.9rem', cursor: saving ? 'wait' : 'pointer',
                opacity: saving || !llcName || !ein ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Next →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div style={stepStyle}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--tf-text)' }}>
            Step 2 — Foreign Owner (25% Shareholder)
          </h2>

          {/* Auto-selected relationship badge */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
            padding: '0.65rem 0.9rem',
            background: 'rgba(2,132,199,0.05)', border: '1px solid rgba(2,132,199,0.18)',
            borderRadius: '0.5rem', marginBottom: '1.25rem',
            fontSize: '0.8125rem', color: 'var(--tf-muted)',
          }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="#0284C7" style={{ marginTop: 1, flexShrink: 0 }}>
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
            </svg>
            <span>
              <strong style={{ color: 'var(--tf-text)' }}>Part II · Box 3 will be auto-checked</strong>
              {' — '}The 100% LLC member is always the 25% foreign shareholder. Part III line 8e boxes 2 &amp; 3 will be ticked; box 1 (related to reporting corporation) is never used for an SMLLC.
            </span>
          </div>

          <FieldRow>
            <Field label="Owner full name" lineRef="Part II">
              <Input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Jane Smith" />
            </Field>
            <Field label="Signer title" lineRef="1120 sig" hint="Default: Owner">
              <Input value={signerTitle} onChange={e => setSignerTitle(e.target.value)} placeholder="Owner" />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="US TIN (if any)" lineRef="Part II" hint="SSN or ITIN — optional">
              <Input value={ownerUsTin} onChange={e => setOwnerUsTin(e.target.value)} placeholder="XXX-XX-XXXX" />
            </Field>
            <Field label="Foreign TIN" lineRef="Part II" hint="Optional">
              <Input value={ownerForeignTin} onChange={e => setOwnerForeignTin(e.target.value)} />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Reference ID" lineRef="Part II" hint="If no US TIN — optional">
              <Input value={ownerRefId} onChange={e => setOwnerRefId(e.target.value)} />
            </Field>
            <Field label="Country of residence" lineRef="Part II">
              <Input value={ownerCountryRes} onChange={e => setOwnerCountryRes(e.target.value)} placeholder="IN" />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Country of citizenship" lineRef="Part II">
              <Input value={ownerCountryCit} onChange={e => setOwnerCountryCit(e.target.value)} placeholder="IN" />
            </Field>
            <Field label="Resident country" lineRef="Part II">
              <Input value={ownerResCountry} onChange={e => setOwnerResCountry(e.target.value)} placeholder="IN" />
            </Field>
          </FieldRow>

          <Field label="Business activity description" lineRef="Part III">
            <Input value={ownerBizActivity} onChange={e => setOwnerBizActivity(e.target.value)} placeholder="Investment holding" />
          </Field>

          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text)', marginBottom: '0.5rem' }}>
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, color: 'var(--tf-primary)',
                background: 'rgba(2,132,199,0.08)', borderRadius: '0.25rem',
                padding: '0.1rem 0.35rem', marginRight: '0.4rem',
              }}>Part II</span>
              Owner address
            </p>
            <AddressBlock value={ownerAddr} onChange={setOwnerAddr} prefix="owner" />
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={() => setStep(1)}
              style={{
                background: 'var(--tf-surface)', color: 'var(--tf-text)',
                border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
                padding: '0.6rem 1.2rem', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleStep2}
              disabled={saving || !ownerName}
              style={{
                background: 'var(--tf-primary)', color: '#fff',
                border: 'none', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600,
                fontSize: '0.9rem', cursor: saving ? 'wait' : 'pointer',
                opacity: saving || !ownerName ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Next →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div style={stepStyle}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--tf-text)' }}>
            Step 3 — Transactions (Part IV)
          </h2>

          {/* Add transaction form */}
          <div style={{
            background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
            borderRadius: '0.5rem', padding: '1rem', marginBottom: '1.25rem',
          }}>
            <p style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--tf-text)' }}>
              Add a transaction
            </p>

            <FieldRow>
              <Field label="Category">
                <Select value={txCategory} onChange={e => setTxCategory(e.target.value as WizardTxCategory)}>
                  {TX_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="Amount (USD)">
                <Input
                  type="number"
                  min="0"
                  value={txAmount}
                  onChange={e => setTxAmount(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </FieldRow>

            {/* Direction — only shown for categories where it is ambiguous */}
            {txCategory !== 'loan_to_llc' &&
             txCategory !== 'loan_from_llc' &&
             txCategory !== 'capital_contribution' &&
             txCategory !== 'distribution' &&
             txCategory !== 'dividend' && (
              <Field label="Direction" hint="Received = LLC received from owner; Paid = LLC paid to owner">
                <Select value={txDirection} onChange={e => setTxDirection(e.target.value as 'received' | 'paid')}>
                  <option value="received">Received (by LLC)</option>
                  <option value="paid">Paid (by LLC)</option>
                </Select>
              </Field>
            )}

            {/* Royalty toggle for rent_royalty */}
            {txCategory === 'rent_royalty' && (
              <div style={{ margin: '0.5rem 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--tf-text)' }}>
                  <input type="checkbox" checked={txIsRoyalty} onChange={e => setTxIsRoyalty(e.target.checked)} />
                  This is a royalty / license (not rent)
                </label>
              </div>
            )}

            <Field label="Description (optional)">
              <Input value={txDesc} onChange={e => setTxDesc(e.target.value)} placeholder="e.g. Capital contribution for operations" />
            </Field>

            <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleAddTransaction}
                disabled={txSaving || !txAmount}
                style={{
                  background: 'var(--tf-primary)', color: '#fff',
                  border: 'none', borderRadius: '0.5rem',
                  padding: '0.5rem 1.2rem', fontWeight: 600,
                  fontSize: '0.875rem', cursor: txSaving ? 'wait' : 'pointer',
                  opacity: txSaving || !txAmount ? 0.6 : 1,
                }}
              >
                {txSaving ? 'Adding…' : '+ Add'}
              </button>
            </div>
          </div>

          {/* Transaction list */}
          {txLoading ? (
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>Loading transactions…</p>
          ) : transactions.length === 0 ? (
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No transactions yet. Add at least one above.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {transactions.map(tx => (
                <div key={tx.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
                  borderRadius: '0.4rem', padding: '0.6rem 0.75rem', fontSize: '0.875rem',
                }}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--tf-text)' }}>
                      {TX_CATEGORIES.find(c => c.value === tx.transaction_type)?.label ?? tx.transaction_type}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--tf-primary)', marginLeft: '0.4rem' }}>
                      {tx.direction}
                    </span>
                    {tx.description && (
                      <span style={{ color: 'var(--tf-muted)', marginLeft: '0.5rem' }}>— {tx.description}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 700, color: 'var(--tf-text)' }}>
                      ${Number(tx.amount_usd).toLocaleString()}
                    </span>
                    <button
                      onClick={() => handleDeleteTransaction(tx.id)}
                      style={{ color: '#a12c7b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={() => setStep(2)}
              style={{
                background: 'var(--tf-surface)', color: 'var(--tf-text)',
                border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
                padding: '0.6rem 1.2rem', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={transactions.length === 0}
              style={{
                background: 'var(--tf-primary)', color: '#fff',
                border: 'none', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600,
                fontSize: '0.9rem', cursor: 'pointer',
                opacity: transactions.length === 0 ? 0.5 : 1,
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4 ── */}
      {step === 4 && filing && (
        <div style={stepStyle}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--tf-text)' }}>
            Step 4 — Review &amp; Generate
          </h2>

          <div style={{
            background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
            borderRadius: '0.5rem', padding: '1rem', marginBottom: '1.25rem',
            fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--tf-text)',
          }}>
            <p><strong>LLC name:</strong> {filing.llc_name ?? '—'}</p>
            <p><strong>EIN:</strong> {filing.ein ?? '—'}</p>
            <p><strong>Tax year:</strong> {filing.tax_year ?? '—'}</p>
            <p><strong>Owner:</strong> {filing.owner_full_name ?? '—'}</p>
            <p><strong>Owner country:</strong> {filing.owner_country_residence ?? '—'}</p>
            {filing.total_assets != null && <p><strong>Total assets:</strong> ${Number(filing.total_assets).toLocaleString()}</p>}
            <p><strong>Transactions:</strong> {transactions.length}</p>
          </div>

          <div style={{
            background: 'rgba(2,132,199,0.05)', border: '1px solid rgba(2,132,199,0.18)',
            borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.25rem',
            fontSize: '0.8rem', color: 'var(--tf-muted)',
          }}>
            Clicking <strong>Generate &amp; Download</strong> will create a combined PDF package (Form 5472 + Pro Forma 1120) and mark this filing as complete.
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={() => setStep(3)}
              style={{
                background: 'var(--tf-surface)', color: 'var(--tf-text)',
                border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
                padding: '0.6rem 1.2rem', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                background: generating ? 'var(--tf-muted)' : 'var(--tf-primary)',
                color: '#fff', border: 'none', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 700,
                fontSize: '0.9rem', cursor: generating ? 'wait' : 'pointer',
              }}
            >
              {generating ? 'Generating…' : '⬇ Generate & Download'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
