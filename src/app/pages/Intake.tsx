import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';

// ─── types ────────────────────────────────────────────────────────────────────

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

type TransactionRow = {
  id?: string;
  transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: string;
  description: string;
  transaction_date: string;
  is_royalty: boolean;
};

// ─── constants ────────────────────────────────────────────────────────────────

const TAX_YEARS = Array.from({ length: new Date().getFullYear() - 2018 }, (_, i) => 2019 + i).reverse();

const TX_TYPES: { value: string; label: string }[] = [
  { value: 'sales',                label: 'Sales' },
  { value: 'service_payment',      label: 'Service payment' },
  { value: 'rent_royalty',         label: 'Rent / Royalty' },
  { value: 'loan_to_llc',         label: 'Loan to LLC (closing balance)' },
  { value: 'loan_from_llc',       label: 'Loan from LLC (closing balance)' },
  { value: 'interest',             label: 'Interest' },
  { value: 'insurance',            label: 'Insurance' },
  { value: 'dividend',             label: 'Dividend' },
  { value: 'commission',           label: 'Commission' },
  { value: 'intangible',           label: 'Intangible property' },
  { value: 'capital_contribution', label: 'Capital contribution' },
  { value: 'distribution',         label: 'Distribution' },
  { value: 'other',                label: 'Other' },
];

const LOAN_TYPES = new Set(['loan_to_llc', 'loan_from_llc', 'capital_contribution', 'distribution']);
const ROYALTY_TYPES = new Set(['rent_royalty']);

const STEP_LABELS = ['LLC details', 'Owner details', 'Transactions', 'Review'];

// ─── component ────────────────────────────────────────────────────────────────

export function Intake() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filingId = params.get('filing_id');

  // step
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // step 1 — LLC
  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear() - 1));
  const [mailing, setMailing] = useState<Address>({});

  // step 2 — Owner
  const [ownerName, setOwnerName] = useState('');
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCit, setOwnerCountryCit] = useState('');
  const [ownerPassport, setOwnerPassport] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});
  const [signerTitle, setSignerTitle] = useState('Owner');
  const [ownerBizActivity, setOwnerBizActivity] = useState('');

  // step 3 — Transactions
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [txType, setTxType] = useState('sales');
  const [txDir, setTxDir] = useState<'paid' | 'received'>('received');
  const [txAmt, setTxAmt] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState('');
  const [txIsRoyalty, setTxIsRoyalty] = useState(false);

  // ── load existing filing ──────────────────────────────────────────────────
  useEffect(() => {
    if (!filingId) return;
    (async () => {
      const { data: f, error: err } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();
      if (err || !f) return;

      setLlcName(f.llc_name ?? '');
      setEin(f.ein ?? '');
      setStateOfFormation(f.state_of_formation ?? '');
      setTaxYear(String(f.tax_year ?? new Date().getFullYear() - 1));
      setMailing(f.mailing_address ?? {});

      setOwnerName(f.owner_full_name ?? '');
      setOwnerCountryRes(f.owner_country_residence ?? '');
      setOwnerCountryCit(f.owner_country_citizenship ?? '');
      setOwnerPassport(f.owner_passport_number ?? '');
      setOwnerForeignTaxId(f.owner_foreign_tax_id ?? '');
      setOwnerAddress(f.owner_address ?? {});
      setSignerTitle(f.signer_title ?? 'Owner');
      setOwnerBizActivity(f.owner_business_activity ?? '');

      // load transactions
      const { data: txns } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId)
        .order('created_at', { ascending: true });
      if (txns) {
        setTransactions(txns.map((t) => ({
          id: t.id,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: String(t.amount_usd ?? ''),
          description: t.description ?? '',
          transaction_date: t.transaction_date ?? '',
          is_royalty: t.is_royalty ?? false,
        })));
      }
    })();
  }, [filingId]);

  // ── patch helpers ─────────────────────────────────────────────────────────

  function patchFromCurrentStep(): Partial<Filing> {
    if (step === 1) return { llc_name: llcName.trim() || null, ein: ein.trim() || null, state_of_formation: stateOfFormation.trim() || null, tax_year: Number(taxYear), mailing_address: mailing };
    if (step === 2) return { owner_full_name: ownerName.trim() || null, owner_country_residence: ownerCountryRes.trim() || null, owner_country_citizenship: ownerCountryCit.trim() || null, owner_passport_number: ownerPassport.trim() || null, owner_foreign_tax_id: ownerForeignTaxId.trim() || null, owner_address: ownerAddress, signer_title: signerTitle.trim() || 'Owner', owner_business_activity: ownerBizActivity.trim() || null };
    return {};
  }

  // ── save / navigation ─────────────────────────────────────────────────────

  const saveStep = async (): Promise<string | null> => {
    setSaving(true);
    setError(null);
    try {
      const patch = patchFromCurrentStep();

      if (!filingId) {
        // create new filing
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in');
        const { data, error: err } = await supabase
          .from('filings')
          .insert({ ...patch, user_id: user.id })
          .select('id')
          .single();
        if (err) throw err;
        return data.id as string;
      } else {
        const { error: err } = await supabase
          .from('filings')
          .update(patch)
          .eq('id', filingId);
        if (err) throw err;
        return filingId;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (step < 3) {
      const id = await saveStep();
      if (id) {
        if (!filingId) navigate(`?filing_id=${id}`, { replace: true });
        setStep((s) => s + 1);
      }
    } else if (step === 3) {
      // FIX (point 6): only advance to review if transactions saved without error
      const saved = await saveTransactions();
      if (saved) setStep(4);
    }
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1));

  // ── transaction helpers ───────────────────────────────────────────────────

  // FIX (point 4): upsert instead of delete-then-reinsert to avoid race
  // conditions and to preserve DB-generated IDs for rows that already exist.
  const saveTransactions = async (): Promise<boolean> => {
    if (!filingId) return false;
    setError(null);
    try {
      const rows = transactions
        .filter((t) => t.amount_usd && Number(t.amount_usd) > 0)
        .map((t) => ({
          ...(t.id ? { id: t.id } : {}),
          filing_id: filingId,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: Number(t.amount_usd),
          description: t.description || null,
          transaction_date: t.transaction_date || null,
          is_royalty: t.is_royalty,
        }));

      if (rows.length === 0) return true; // nothing to save is not an error

      const { error: err } = await supabase
        .from('reportable_transactions')
        .upsert(rows, { onConflict: 'id' });
      if (err) throw err;
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save transactions');
      return false;
    }
  };

  const addTransaction = () => {
    if (!txAmt || Number(txAmt) <= 0) return;
    setTransactions((prev) => [
      ...prev,
      {
        transaction_type: txType,
        direction: txDir,
        amount_usd: txAmt,
        description: txDesc,
        transaction_date: txDate,
        is_royalty: txIsRoyalty,
      },
    ]);
    setTxAmt('');
    setTxDesc('');
    setTxDate('');
    setTxIsRoyalty(false);
  };

  const removeTransaction = (i: number) =>
    setTransactions((prev) => prev.filter((_, idx) => idx !== i));

  // ── submit (step 4) ───────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!filingId) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('filings')
        .update({ status: 'in_progress' })
        .eq('id', filingId);
      if (err) throw err;
      navigate(`/filing/${filingId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>

        {/* Step bar */}
        <div style={stepBarStyle}>
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <React.Fragment key={n}>
                <div style={stepItemStyle}>
                  <div style={stepCircleStyle(active, done)}>{done ? '✓' : n}</div>
                  <span style={stepLabelStyle(active)}>{label}</span>
                </div>
                {i < STEP_LABELS.length - 1 && <div style={stepLineStyle(done)} />}
              </React.Fragment>
            );
          })}
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        {/* ── Step 1: LLC details ── */}
        {step === 1 && (
          <div style={fieldsStyle}>
            <h2 style={headingStyle}>LLC details</h2>
            <Field label="LLC name" required>
              <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" style={inputStyle} />
            </Field>
            <Field label="EIN" hint="Employer Identification Number">
              <input value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" style={inputStyle} />
            </Field>
            <Field label="State of formation" required>
              <input value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)} placeholder="e.g. Delaware" style={inputStyle} />
            </Field>
            <Field label="Tax year" required>
              <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)} style={inputStyle}>
                {TAX_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="LLC mailing address">
              <AddressFields value={mailing} onChange={setMailing} />
            </Field>
          </div>
        )}

        {/* ── Step 2: Owner details ── */}
        {step === 2 && (
          <div style={fieldsStyle}>
            <h2 style={headingStyle}>Foreign owner details</h2>
            <Field label="Full legal name" required hint="As shown on passport">
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="As shown on passport" style={inputStyle} />
            </Field>
            <FieldRow>
              <Field label="Country of residence" required>
                <input value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)} placeholder="e.g. India" style={inputStyle} />
              </Field>
              <Field label="Country of citizenship">
                <input value={ownerCountryCit} onChange={(e) => setOwnerCountryCit(e.target.value)} placeholder="e.g. India" style={inputStyle} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Passport number">
                <input value={ownerPassport} onChange={(e) => setOwnerPassport(e.target.value)} placeholder="A12345678" style={inputStyle} />
              </Field>
              <Field label="Foreign tax ID" hint="Optional">
                <input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="Optional" style={inputStyle} />
              </Field>
            </FieldRow>
            <Field label="Owner address" hint="Your personal mailing address">
              <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            </Field>
            <Field label="Your title" hint="Printed on the form signature line (e.g. Owner, Director, Manager)">
              <input value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} placeholder="Owner" style={inputStyle} />
            </Field>
            <Field label="Principal business activity" hint="What does the LLC primarily do? (e.g. Investment holding, E-commerce)">
              <input value={ownerBizActivity} onChange={(e) => setOwnerBizActivity(e.target.value)} placeholder="Investment holding" style={inputStyle} />
            </Field>
          </div>
        )}

        {/* ── Step 3: Transactions ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.25rem' }}>Reportable transactions</h2>
              <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.55 }}>
                Add every monetary transaction between you and the LLC during the tax year.
                For loans, enter the <strong>year-end closing balance</strong> (not individual draws/repayments).
              </p>
            </div>

            {/* Add transaction form */}
            <div style={txFormStyle}>
              <FieldRow>
                <Field label="Type">
                  <select value={txType} onChange={(e) => { setTxType(e.target.value); setTxIsRoyalty(false); }} style={inputStyle}>
                    {TX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                {!LOAN_TYPES.has(txType) && (
                  <Field label="Direction">
                    <select value={txDir} onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')} style={inputStyle}>
                      <option value="received">LLC received</option>
                      <option value="paid">LLC paid</option>
                    </select>
                  </Field>
                )}
              </FieldRow>
              <FieldRow>
                <Field label={LOAN_TYPES.has(txType) ? 'Closing balance (USD)' : 'Amount (USD)'} required>
                  <input
                    type="number"
                    min="0"
                    value={txAmt}
                    onChange={(e) => setTxAmt(e.target.value)}
                    placeholder="0"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Date" hint="Optional">
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </FieldRow>
              {ROYALTY_TYPES.has(txType) && (
                <label style={checkLabelStyle}>
                  <input type="checkbox" checked={txIsRoyalty} onChange={(e) => setTxIsRoyalty(e.target.checked)} />
                  &nbsp;This is a royalty (not rent)
                </label>
              )}
              <Field label="Description" hint="Optional">
                <input
                  value={txDesc}
                  onChange={(e) => setTxDesc(e.target.value)}
                  placeholder="Brief description"
                  style={inputStyle}
                />
              </Field>
              <button onClick={addTransaction} style={addBtnStyle} type="button">
                + Add transaction
              </button>
            </div>

            {/* Transaction list */}
            {transactions.length > 0 && (
              <div style={txListStyle}>
                {transactions.map((tx, i) => (
                  <div key={i} style={txRowStyle}>
                    <div style={{ flex: 1 }}>
                      <span style={txTypeStyle}>{TX_TYPES.find((t) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}</span>
                      {!LOAN_TYPES.has(tx.transaction_type) && (
                        <span style={txDirStyle}>{tx.direction === 'received' ? '↓ received' : '↑ paid'}</span>
                      )}
                      {tx.is_royalty && <span style={txDirStyle}>royalty</span>}
                      {tx.description && <span style={txDescStyle}> — {tx.description}</span>}
                    </div>
                    <span style={txAmtStyle}>${Number(tx.amount_usd).toLocaleString()}</span>
                    <button onClick={() => removeTransaction(i)} style={removeBtnStyle} type="button" aria-label="Remove">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Review ── */}
        {step === 4 && (
          <div style={fieldsStyle}>
            <h2 style={headingStyle}>Review &amp; submit</h2>
            <ReviewRow label="LLC name" value={llcName} />
            <ReviewRow label="EIN" value={ein} />
            <ReviewRow label="State" value={stateOfFormation} />
            <ReviewRow label="Tax year" value={taxYear} />
            <ReviewRow label="Owner" value={ownerName} />
            <ReviewRow label="Country of residence" value={ownerCountryRes} />
            <ReviewRow label="Signer title" value={signerTitle} />
            <ReviewRow label="Business activity" value={ownerBizActivity} />
            <ReviewRow label="Transactions" value={String(transactions.length)} />
          </div>
        )}

        {/* Navigation */}
        <div style={navStyle}>
          {step > 1 && (
            <button onClick={handleBack} style={secondaryBtnStyle} type="button" disabled={saving}>
              Back
            </button>
          )}
          {step < 4 ? (
            <button onClick={handleNext} style={primaryBtnStyle} type="button" disabled={saving}>
              {saving ? 'Saving…' : step === 3 ? 'Save & review' : 'Save & continue'}
            </button>
          ) : (
            <button onClick={handleSubmit} style={primaryBtnStyle} type="button" disabled={saving}>
              {saving ? 'Submitting…' : 'Submit intake'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Intake;

// ─── small components ─────────────────────────────────────────────────────────

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={labelStyle}>
        {label}{required && <span style={{ color: 'var(--tf-error, #c0392b)' }}> *</span>}
        {hint && <span style={hintStyle}> — {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>{children}</div>;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--tf-border, #e5e7eb)' }}>
      <span style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{value || '—'}</span>
    </div>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <input placeholder="Street line 1" value={value.line1 ?? ''} onChange={(e) => set('line1', e.target.value)} style={inputStyle} />
      <input placeholder="Street line 2 (optional)" value={value.line2 ?? ''} onChange={(e) => set('line2', e.target.value)} style={inputStyle} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <input placeholder="City" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} style={inputStyle} />
        <input placeholder="State / Region" value={value.region ?? ''} onChange={(e) => set('region', e.target.value)} style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <input placeholder="Postal code" value={value.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} style={inputStyle} />
        <input placeholder="Country" value={value.country ?? ''} onChange={(e) => set('country', e.target.value)} style={inputStyle} />
      </div>
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--tf-border, #d1d5db)',
  borderRadius: '0.375rem',
  fontSize: '0.9375rem',
  background: 'var(--tf-input-bg, #fff)',
  color: 'var(--tf-text, #111)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: 'var(--tf-text, #111)',
};

const hintStyle: React.CSSProperties = {
  fontWeight: 400,
  color: 'var(--tf-muted, #6b7280)',
};

const headingStyle: React.CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 700,
  marginBottom: '0.25rem',
};

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--tf-bg, #f9fafb)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '2rem 1rem',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '640px',
  background: 'var(--tf-surface, #fff)',
  borderRadius: '0.75rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  padding: '2rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem',
};

const fieldsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
};

const stepBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0',
  marginBottom: '0.5rem',
};

const stepItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.25rem',
  minWidth: '60px',
};

const stepCircleStyle = (active: boolean, done: boolean): React.CSSProperties => ({
  width: '28px',
  height: '28px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.8125rem',
  fontWeight: 700,
  background: done ? 'var(--tf-primary, #2563eb)' : active ? 'var(--tf-primary, #2563eb)' : 'var(--tf-border, #d1d5db)',
  color: done || active ? '#fff' : 'var(--tf-muted, #6b7280)',
  transition: 'background 0.2s',
});

const stepLabelStyle = (active: boolean): React.CSSProperties => ({
  fontSize: '0.6875rem',
  fontWeight: active ? 700 : 400,
  color: active ? 'var(--tf-primary, #2563eb)' : 'var(--tf-muted, #6b7280)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
});

const stepLineStyle = (done: boolean): React.CSSProperties => ({
  flex: 1,
  height: '2px',
  background: done ? 'var(--tf-primary, #2563eb)' : 'var(--tf-border, #d1d5db)',
  marginBottom: '1rem',
  transition: 'background 0.2s',
});

const navStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.75rem',
  paddingTop: '0.5rem',
  borderTop: '1px solid var(--tf-border, #e5e7eb)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.5625rem 1.25rem',
  background: 'var(--tf-primary, #2563eb)',
  color: '#fff',
  border: 'none',
  borderRadius: '0.375rem',
  fontWeight: 600,
  fontSize: '0.9375rem',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.5625rem 1.25rem',
  background: 'transparent',
  color: 'var(--tf-text, #111)',
  border: '1px solid var(--tf-border, #d1d5db)',
  borderRadius: '0.375rem',
  fontWeight: 600,
  fontSize: '0.9375rem',
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: '0.375rem',
  padding: '0.75rem 1rem',
  fontSize: '0.875rem',
};

const txFormStyle: React.CSSProperties = {
  background: 'var(--tf-offset, #f9fafb)',
  border: '1px solid var(--tf-border, #e5e7eb)',
  borderRadius: '0.5rem',
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const addBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '0.4375rem 1rem',
  background: 'var(--tf-primary, #2563eb)',
  color: '#fff',
  border: 'none',
  borderRadius: '0.375rem',
  fontWeight: 600,
  fontSize: '0.875rem',
  cursor: 'pointer',
};

const txListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
};

const txRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.5rem 0.75rem',
  background: 'var(--tf-surface, #fff)',
  border: '1px solid var(--tf-border, #e5e7eb)',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
};

const txTypeStyle: React.CSSProperties = {
  fontWeight: 600,
};

const txDirStyle: React.CSSProperties = {
  marginLeft: '0.375rem',
  fontSize: '0.75rem',
  color: 'var(--tf-muted, #6b7280)',
};

const txDescStyle: React.CSSProperties = {
  color: 'var(--tf-muted, #6b7280)',
};

const txAmtStyle: React.CSSProperties = {
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  marginLeft: 'auto',
};

const removeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--tf-muted, #6b7280)',
  fontSize: '1.125rem',
  cursor: 'pointer',
  lineHeight: 1,
  padding: '0 0.25rem',
};

const checkLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: '0.875rem',
  color: 'var(--tf-text, #111)',
  cursor: 'pointer',
};
