import React, { useEffect, useState, Fragment } from 'react';
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
  { value: 'loan_to_llc',          label: 'Loan to LLC (closing balance)' },
  { value: 'loan_from_llc',        label: 'Loan from LLC (closing balance)' },
  { value: 'interest',             label: 'Interest' },
  { value: 'insurance',            label: 'Insurance' },
  { value: 'dividend',             label: 'Dividend' },
  { value: 'commission',           label: 'Commission' },
  { value: 'intangible',           label: 'Intangible property' },
  { value: 'capital_contribution', label: 'Capital contribution' },
  { value: 'distribution',         label: 'Distribution' },
  { value: 'formation_costs',      label: 'Formation costs (paid by owner)' },
  { value: 'property_transfer',    label: 'Property transfer (Part VI)' },
  { value: 'nonmonetary_other',    label: 'Other nonmonetary (Part VI)' },
  { value: 'other',                label: 'Other' },
];

const LOAN_TYPES  = new Set(['loan_to_llc', 'loan_from_llc', 'capital_contribution', 'distribution']);
const ROYALTY_TYPES = new Set(['rent_royalty']);
const PART_VI_TYPES = new Set(['property_transfer', 'nonmonetary_other']);

type IntakeStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<IntakeStep, string> = {
  1: 'LLC Details',
  2: 'Owner Details',
  3: 'Transactions',
  4: 'Review',
};

// ─── component ────────────────────────────────────────────────────────────────

export function Intake() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filingId = params.get('filing_id');

  const [step, setStep]     = useState<IntakeStep>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // step 1 — LLC
  const [llcName,          setLlcName]          = useState('');
  const [ein,              setEin]              = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [taxYear,          setTaxYear]          = useState(String(new Date().getFullYear() - 1));
  const [mailing,          setMailing]          = useState<Address>({});

  // step 2 — Owner
  const [ownerName,        setOwnerName]        = useState('');
  const [ownerCountryRes,  setOwnerCountryRes]  = useState('');
  const [ownerCountryCit,  setOwnerCountryCit]  = useState('');
  const [ownerPassport,    setOwnerPassport]    = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerAddress,     setOwnerAddress]     = useState<Address>({});
  const [signerTitle,      setSignerTitle]      = useState('Owner');
  const [ownerBizActivity, setOwnerBizActivity] = useState('');

  // step 3 — Transactions
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [txType,       setTxType]       = useState('sales');
  const [txDir,        setTxDir]        = useState<'paid' | 'received'>('received');
  const [txAmt,        setTxAmt]        = useState('');
  const [txDesc,       setTxDesc]       = useState('');
  const [txDate,       setTxDate]       = useState('');
  const [txIsRoyalty,  setTxIsRoyalty]  = useState(false);

  // ── load existing filing ──────────────────────────────────────────────────
  useEffect(() => {
    if (!filingId) return;
    (async () => {
      const { data: f, error: err } = await supabase
        .from('filings').select('*').eq('id', filingId).single();
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

      const { data: txns } = await supabase
        .from('reportable_transactions').select('*')
        .eq('filing_id', filingId).order('created_at', { ascending: true });
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
    if (step === 1) return {
      llc_name: llcName.trim() || null,
      ein: ein.trim() || null,
      state_of_formation: stateOfFormation.trim() || null,
      tax_year: Number(taxYear),
      mailing_address: mailing,
    };
    if (step === 2) return {
      owner_full_name:          ownerName.trim() || null,
      owner_country_residence:  ownerCountryRes.trim() || null,
      owner_country_citizenship: ownerCountryCit.trim() || null,
      owner_passport_number:    ownerPassport.trim() || null,
      owner_foreign_tax_id:     ownerForeignTaxId.trim() || null,
      owner_address:            ownerAddress,
      signer_title:             signerTitle.trim() || 'Owner',
      owner_business_activity:  ownerBizActivity.trim() || null,
    };
    return {};
  }

  // ── save / navigation ─────────────────────────────────────────────────────

  const saveStep = async (): Promise<string | null> => {
    setSaving(true);
    setError(null);
    try {
      const patch = patchFromCurrentStep();
      if (!filingId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in');
        const { data, error: err } = await supabase
          .from('filings').insert({ ...patch, user_id: user.id }).select('id').single();
        if (err) throw err;
        return data.id as string;
      } else {
        const { error: err } = await supabase
          .from('filings').update(patch).eq('id', filingId);
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
        setStep((s) => (s + 1) as IntakeStep);
      }
    } else if (step === 3) {
      const saved = await saveTransactions();
      if (saved) setStep(4);
    }
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1) as IntakeStep);

  // ── transaction helpers ───────────────────────────────────────────────────

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
      if (rows.length === 0) return true;
      const { error: err } = await supabase
        .from('reportable_transactions').upsert(rows, { onConflict: 'id' });
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
      { transaction_type: txType, direction: txDir, amount_usd: txAmt,
        description: txDesc, transaction_date: txDate, is_royalty: txIsRoyalty },
    ]);
    setTxAmt(''); setTxDesc(''); setTxDate(''); setTxIsRoyalty(false);
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
        .from('filings').update({ status: 'in_progress' }).eq('id', filingId);
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
    <>
      {/* Scoped input styles — fixes dark mode visibility without touching global CSS */}
      <style>{`
        .intake-form input,
        .intake-form select,
        .intake-form textarea {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--tf-border, #d1d5db);
          border-radius: 0.375rem;
          font-size: 0.9375rem;
          font-family: inherit;
          background: var(--tf-input-bg, var(--tf-surface, #fff));
          color: var(--tf-text, #111);
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .intake-form input:focus,
        .intake-form select:focus,
        .intake-form textarea:focus {
          border-color: var(--tf-primary, #2563eb);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--tf-primary, #2563eb) 18%, transparent);
        }
        .intake-form input::placeholder {
          color: var(--tf-text-muted, #9ca3af);
          opacity: 1;
        }
      `}</style>

      <div className="intake-form" style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '2rem 1rem',
        fontFamily: 'inherit',
      }}>

        {/* ── Breadcrumb nav (FilingWizard style) ─────────────────────── */}
        <nav style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {([1, 2, 3, 4] as IntakeStep[]).map((s) => (
            <Fragment key={s}>
              <button
                onClick={() => { if (s < step) setStep(s); }}
                style={{
                  background: step === s ? 'var(--tf-primary, #2563eb)' : 'transparent',
                  color: step === s ? '#fff' : step > s ? 'var(--tf-primary, #2563eb)' : 'var(--tf-text-muted, #6b7280)',
                  border: `1px solid ${
                    step === s  ? 'var(--tf-primary, #2563eb)'
                    : step > s  ? 'var(--tf-primary, #2563eb)'
                    : 'var(--tf-border, #d1d5db)'
                  }`,
                  borderRadius: '2rem',
                  padding: '0.3rem 0.9rem',
                  fontSize: '0.82rem',
                  fontWeight: step === s ? 700 : 400,
                  cursor: s < step ? 'pointer' : 'default',
                  opacity: s > step ? 0.45 : 1,
                }}
              >
                {s}. {STEP_LABELS[s]}
              </button>
              {s < 4 && <span style={{ color: 'var(--tf-text-muted, #9ca3af)', alignSelf: 'center' }}>›</span>}
            </Fragment>
          ))}
        </nav>

        {/* Error banner */}
        {error && (
          <div style={{
            background: '#fef2f2', color: '#991b1b',
            border: '1px solid #fecaca', borderRadius: '0.375rem',
            padding: '0.75rem 1rem', fontSize: '0.875rem', marginBottom: '1.25rem',
          }}>{error}</div>
        )}

        {/* ── Step 1: LLC Details ───────────────────────────────────────── */}
        {step === 1 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 1 — LLC Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company Information</h3>
              <div style={gridStyle}>
                <Field label="LLC name *">
                  <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" />
                </Field>
                <Field label="EIN">
                  <input value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" />
                </Field>
                <Field label="State of formation *">
                  <input value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)} placeholder="e.g. Delaware" />
                </Field>
                <Field label="Tax year *">
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                    {TAX_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC Mailing Address</h3>
              <AddressFields value={mailing} onChange={setMailing} />
            </section>
          </div>
        )}

        {/* ── Step 2: Owner Details ─────────────────────────────────────── */}
        {step === 2 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 2 — Foreign Owner Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Identity</h3>
              <div style={gridStyle}>
                <Field label="Full legal name *" hint="As shown on passport" style={{ gridColumn: '1 / -1' }}>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="As shown on passport" />
                </Field>
                <Field label="Country of residence *">
                  <input value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)} placeholder="e.g. India" />
                </Field>
                <Field label="Country of citizenship">
                  <input value={ownerCountryCit} onChange={(e) => setOwnerCountryCit(e.target.value)} placeholder="e.g. India" />
                </Field>
                <Field label="Passport number">
                  <input value={ownerPassport} onChange={(e) => setOwnerPassport(e.target.value)} placeholder="A12345678" />
                </Field>
                <Field label="Foreign tax ID" hint="Optional">
                  <input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="Optional" />
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner Address</h3>
              <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Signature &amp; Activity</h3>
              <div style={gridStyle}>
                <Field label="Your title" hint="Printed on the form signature line">
                  <input value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} placeholder="Owner" />
                </Field>
                <Field label="Principal business activity" hint="What does the LLC primarily do?">
                  <input value={ownerBizActivity} onChange={(e) => setOwnerBizActivity(e.target.value)} placeholder="Investment holding" />
                </Field>
              </div>
            </section>
          </div>
        )}

        {/* ── Step 3: Transactions ──────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 3 — Reportable Transactions</h2>
            <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              Add every monetary transaction between you and the LLC during the tax year.
              For loans, enter the <strong>year-end closing balance</strong>.
            </p>

            {/* Add transaction form */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Add a transaction</h3>
              <div style={gridStyle}>
                <Field label="Type">
                  <select value={txType} onChange={(e) => { setTxType(e.target.value); setTxIsRoyalty(false); }}>
                    {TX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                {!LOAN_TYPES.has(txType) && (
                  <Field label="Direction">
                    <select value={txDir} onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')}>
                      <option value="received">LLC received</option>
                      <option value="paid">LLC paid</option>
                    </select>
                  </Field>
                )}
                <Field label={LOAN_TYPES.has(txType) ? 'Closing balance (USD) *' : 'Amount (USD) *'}>
                  <input
                    type="number" min="0" value={txAmt}
                    onChange={(e) => setTxAmt(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Date" hint="Optional">
                  <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                </Field>
                {ROYALTY_TYPES.has(txType) && (
                  <Field label="Subtype">
                    <select
                      value={txIsRoyalty ? 'royalty' : 'rent'}
                      onChange={(e) => setTxIsRoyalty(e.target.value === 'royalty')}
                    >
                      <option value="rent">Rent</option>
                      <option value="royalty">Royalty</option>
                    </select>
                  </Field>
                )}
                <Field label="Description" hint="Optional" style={{ gridColumn: '1 / -1' }}>
                  <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Brief description" />
                </Field>
              </div>

              {/* Part VI hint */}
              {PART_VI_TYPES.has(txType) && (
                <p style={{
                  fontSize: '0.8125rem', color: 'var(--tf-text-muted, #6b7280)',
                  marginTop: '0.75rem', padding: '0.625rem 0.875rem',
                  background: 'var(--tf-offset, #f9fafb)',
                  border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.375rem',
                }}>
                  ℹ️ Disclosed in <strong>Part VI statement</strong> (nonmonetary / less-than-FMV). Amount is optional.
                </p>
              )}

              <button onClick={addTransaction} style={addBtnStyle} type="button">
                + Add transaction
              </button>
            </section>

            {/* Transaction list */}
            {transactions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.5rem' }}>
                {transactions.map((tx, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.55rem 0.875rem',
                    background: 'var(--tf-surface, #fff)',
                    border: '1px solid var(--tf-border, #e5e7eb)',
                    borderRadius: '0.5rem', fontSize: '0.875rem',
                  }}>
                    <div style={{ flex: 1, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>
                        {TX_TYPES.find((t) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}
                      </span>
                      {!LOAN_TYPES.has(tx.transaction_type) && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>
                          {tx.direction === 'received' ? '↓ received' : '↑ paid'}
                        </span>
                      )}
                      {tx.is_royalty && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>royalty</span>
                      )}
                      {tx.description && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)' }}> — {tx.description}</span>
                      )}
                    </div>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--tf-primary, #2563eb)' }}>
                      ${Number(tx.amount_usd).toLocaleString()}
                    </span>
                    <button
                      onClick={() => removeTransaction(i)}
                      style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }}
                      type="button" aria-label="Remove transaction"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Review ────────────────────────────────────────────── */}
        {step === 4 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 4 — Review &amp; Submit</h2>

            <div style={{
              background: 'var(--tf-surface, #fff)',
              border: '1px solid var(--tf-border, #e5e7eb)',
              borderRadius: '0.75rem', padding: '1.25rem 1.5rem',
              marginBottom: '1.5rem',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem',
            }}>
              <SummaryRow label="LLC name"          value={llcName} />
              <SummaryRow label="EIN"               value={ein} />
              <SummaryRow label="State"             value={stateOfFormation} />
              <SummaryRow label="Tax year"          value={taxYear} />
              <SummaryRow label="Owner"             value={ownerName} />
              <SummaryRow label="Country of residence" value={ownerCountryRes} />
              <SummaryRow label="Signer title"      value={signerTitle} />
              <SummaryRow label="Business activity" value={ownerBizActivity} />
              <SummaryRow label="Transactions"      value={String(transactions.length)} />
            </div>
          </div>
        )}

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          gap: '0.75rem', paddingTop: '1.5rem',
          borderTop: '1px solid var(--tf-border, #e5e7eb)',
          marginTop: '1.5rem',
        }}>
          {step > 1 && (
            <button onClick={handleBack} disabled={saving} style={secondaryBtnStyle} type="button">
              ← Back
            </button>
          )}
          {step < 4 ? (
            <button onClick={handleNext} disabled={saving} style={primaryBtnStyle} type="button">
              {saving ? 'Saving…' : step === 3 ? 'Save & Review →' : 'Save & Continue →'}
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving} style={primaryBtnStyle} type="button">
              {saving ? 'Submitting…' : 'Submit Intake'}
            </button>
          )}
        </div>

      </div>
    </>
  );
}

export default Intake;

// ─── small components ─────────────────────────────────────────────────────────

function Field({
  label, hint, children, style,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text-muted, #6b7280)' }}>
        {label}
        {hint && <span style={{ fontWeight: 400, marginLeft: '0.25rem' }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function AddressFields({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
      <Field label="Street line 1" style={{ gridColumn: '1 / -1' }}>
        <input placeholder="Street line 1" value={value.line1 ?? ''} onChange={(e) => set('line1', e.target.value)} />
      </Field>
      <Field label="Street line 2" style={{ gridColumn: '1 / -1' }}>
        <input placeholder="Optional" value={value.line2 ?? ''} onChange={(e) => set('line2', e.target.value)} />
      </Field>
      <Field label="City">
        <input placeholder="City" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} />
      </Field>
      <Field label="State / Region">
        <input placeholder="State / Region" value={value.region ?? ''} onChange={(e) => set('region', e.target.value)} />
      </Field>
      <Field label="Postal code">
        <input placeholder="Postal code" value={value.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
      </Field>
      <Field label="Country">
        <input placeholder="Country" value={value.country ?? ''} onChange={(e) => set('country', e.target.value)} />
      </Field>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-text-muted, #6b7280)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 500, color: value ? 'var(--tf-text, #111)' : 'var(--tf-text-muted, #9ca3af)' }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ─── shared styles ────────────────────────────────────────────────────────────

const stepHeadingStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  marginBottom: '1.5rem',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '2rem',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--tf-text-muted, #6b7280)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '0.875rem',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '1rem',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.5rem',
  background: 'var(--tf-primary, #2563eb)',
  color: '#fff',
  border: 'none',
  borderRadius: '0.5rem',
  fontWeight: 700,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  background: 'transparent',
  color: 'var(--tf-text, #111)',
  border: '1px solid var(--tf-border, #d1d5db)',
  borderRadius: '0.5rem',
  fontWeight: 600,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const addBtnStyle: React.CSSProperties = {
  marginTop: '0.75rem',
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
