import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import {
  BIZ_ACTIVITIES,
  COUNTRIES,
  RP_NAICS,
  TAX_YEARS,
  type IntakeStep,
  US_STATES,
} from './intake/constants';

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
  related_party_naics?: string;
};

const TX_TYPES: { value: string; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'service_payment', label: 'Service payment' },
  { value: 'rent_royalty', label: 'Rent / Royalty' },
  { value: 'loan_to_llc', label: 'Loan to LLC (closing balance)' },
  { value: 'loan_from_llc', label: 'Loan from LLC (closing balance)' },
  { value: 'interest', label: 'Interest' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'dividend', label: 'Dividend' },
  { value: 'commission', label: 'Commission' },
  { value: 'intangible', label: 'Intangible property' },
  { value: 'capital_contribution', label: 'Capital contribution' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'formation_costs', label: 'Formation costs (paid by owner)' },
  { value: 'property_transfer', label: 'Property transfer (Part VI)' },
  { value: 'nonmonetary_other', label: 'Other nonmonetary (Part VI)' },
  { value: 'other', label: 'Other' },
];

const LOAN_TYPES = new Set(['loan_to_llc', 'loan_from_llc', 'capital_contribution', 'distribution']);
const ROYALTY_TYPES = new Set(['rent_royalty']);
const PART_VI_TYPES = new Set(['property_transfer', 'nonmonetary_other']);

const STEP_LABELS: Record<IntakeStep, string> = {
  1: 'LLC Details',
  2: 'Owner Details',
  3: 'Transactions',
  4: 'Review',
};

function formatEIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function isValidEIN(val: string): boolean {
  return /^\d{2}-\d{7}$/.test(val);
}

function buildOwnerRef(name: string): string {
  const prefix = name.trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  return prefix ? `${prefix}001` : '';
}

function buildRelatedPartyRef(name: string, index: number): string {
  const prefix = name.trim().replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const suffix = String(index + 2).padStart(3, '0');
  return prefix ? `${prefix}${suffix}` : '';
}

function isUSCountry(value?: string | null): boolean {
  return ['US', 'USA', 'United States', 'United States of America'].includes(value ?? '');
}

export function Intake() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [localFilingId, setLocalFilingId] = useState<string | null>(params.get('filing_id'));
  const filingId = localFilingId ?? params.get('filing_id');

  const [step, setStep] = useState<IntakeStep>(() => {
    const s = Number(params.get('step'));
    return (s >= 1 && s <= 4 ? s : 1) as IntakeStep;
  });

  const [loadingFiling, setLoadingFiling] = useState(!!params.get('filing_id'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [einErr, setEinErr] = useState<string | null>(null);

  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [taxYear, setTaxYear] = useState('2024');
  const [mailing, setMailing] = useState<Address>({});
  const [entityBizActivity, setEntityBizActivity] = useState('');
  const [entityBizCode, setEntityBizCode] = useState('');

  const [ownerName, setOwnerName] = useState('');
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCit, setOwnerCountryCit] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerRefNumber, setOwnerRefNumber] = useState('');
  const [ownerDOI, setOwnerDOI] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});
  const [signerTitle, setSignerTitle] = useState('Owner');
  const [ownerBizActivity, setOwnerBizActivity] = useState('');
  const [ownerBizCode, setOwnerBizCode] = useState('');
  const [ownerCountry, setOwnerCountry] = useState('');

  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [txType, setTxType] = useState('sales');
  const [txDir, setTxDir] = useState<'paid' | 'received'>('received');
  const [txAmt, setTxAmt] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState('');
  const [txIsRoyalty, setTxIsRoyalty] = useState(false);
  const [txRpNaics, setTxRpNaics] = useState('');

  useEffect(() => {
    const derived = buildOwnerRef(ownerName);
    setOwnerRefNumber(derived);
  }, [ownerName]);

  useEffect(() => {
    const currentStep = Number(params.get('step')) || 1;
    if (currentStep !== step) {
      const newParams = new URLSearchParams(params.toString());
      newParams.set('step', String(step));
      navigate(`?${newParams.toString()}`, { replace: true });
    }
  }, [step, params, navigate]);

  useEffect(() => {
    if (!filingId) {
      setLoadingFiling(false);
      return;
    }

    setLoadingFiling(true);

    (async () => {
      const { data: f, error: err } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();

      if (err || !f) {
        setLoadingFiling(false);
        return;
      }

      setLlcName(f.llc_name ?? '');
      setEin(f.ein ?? '');
      setStateOfFormation(f.state_of_formation ?? '');
      setTaxYear(String(f.tax_year ?? '2024'));
      setMailing((f.mailing_address as Address) ?? {});
      setEntityBizActivity(((f as Record<string, unknown>).entity_business_activity as string) ?? '');
      setEntityBizCode(((f as Record<string, unknown>).entity_business_code as string) ?? '');

      setOwnerName(f.owner_full_name ?? '');
      setOwnerCountryRes(f.owner_country_residence ?? '');
      setOwnerCountryCit(f.owner_country_citizenship ?? '');
      setOwnerForeignTaxId(f.owner_foreign_tax_id ?? '');
      setOwnerRefNumber(((f as Record<string, unknown>).owner_ref_number as string) ?? '');
      setOwnerDOI(((f as Record<string, unknown>).owner_date_of_incorporation as string) ?? '');
      setOwnerAddress((f.owner_address as Address) ?? {});
      setSignerTitle(f.signer_title ?? 'Owner');
      setOwnerBizActivity(f.owner_business_activity ?? '');
      setOwnerBizCode(((f as Record<string, unknown>).owner_business_code as string) ?? '');
      setOwnerCountry(((f as Record<string, unknown>).owner_country as string) ?? '');

      const { data: txns } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId)
        .order('created_at', { ascending: true });

      if (txns) {
        setTransactions(
          txns.map((t) => ({
            id: t.id,
            transaction_type: t.transaction_type,
            direction: t.direction,
            amount_usd: String(t.amount_usd ?? ''),
            description: t.description ?? '',
            transaction_date: t.transaction_date ?? '',
            is_royalty: t.is_royalty ?? false,
            related_party_naics: '',
          })),
        );
      }

      setLoadingFiling(false);
    })();
  }, [filingId]);

  function patchFromCurrentStep(): Partial<Filing> & Record<string, unknown> {
    if (step === 1) {
      return {
        llc_name: llcName.trim() || null,
        ein: ein.trim() || null,
        state_of_formation: stateOfFormation.trim() || null,
        tax_year: taxYear,
        mailing_address: mailing,
        entity_business_activity: entityBizActivity.trim() || null,
        entity_business_code: entityBizCode.trim() || null,
      };
    }

    if (step === 2) {
      return {
        owner_full_name: ownerName.trim() || null,
        owner_country_residence: ownerCountryRes.trim() || null,
        owner_country_citizenship: ownerCountryCit.trim() || null,
        owner_foreign_tax_id: ownerForeignTaxId.trim() || null,
        owner_ref_number: ownerRefNumber.trim() || null,
        owner_date_of_incorporation: ownerDOI.trim() || null,
        owner_address: ownerAddress,
        signer_title: signerTitle.trim() || 'Owner',
        owner_business_activity: ownerBizActivity.trim() || null,
        owner_business_code: ownerBizCode.trim() || null,
        owner_country: ownerCountry.trim() || null,
      };
    }

    return {};
  }

  const handleEinBlur = () => {
    if (ein && !isValidEIN(ein)) {
      setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
    } else {
      setEinErr(null);
    }
  };

  const saveStep = async (): Promise<string | null> => {
    setSaving(true);
    setError(null);

    try {
      const patch = patchFromCurrentStep();

      if (!filingId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) throw new Error('Not signed in');

        const { data, error: err } = await supabase
          .from('filings')
          .insert({ ...patch, user_id: user.id })
          .select('id')
          .single();

        if (err) throw err;

        const newId = data.id as string;
        setLocalFilingId(newId);
        navigate(`?filing_id=${newId}&step=${step + 1}`, { replace: true });
        return newId;
      }

      const { error: err } = await supabase.from('filings').update(patch).eq('id', filingId);

      if (err) throw err;
      return filingId;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveTransactions = async (): Promise<boolean> => {
    if (!filingId) return false;

    setError(null);

    try {
      const validTxns = transactions.filter((t) => t.amount_usd && Number(t.amount_usd) > 0);
      if (validTxns.length === 0) return true;

      const toInsert = validTxns
        .filter((t) => !t.id)
        .map((t) => ({
          filing_id: filingId,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: Number(t.amount_usd),
          description: t.description || null,
          transaction_date: t.transaction_date || null,
          is_royalty: t.is_royalty,
        }));

      const toUpsert = validTxns
        .filter((t) => !!t.id)
        .map((t) => ({
          id: t.id!,
          filing_id: filingId,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: Number(t.amount_usd),
          description: t.description || null,
          transaction_date: t.transaction_date || null,
          is_royalty: t.is_royalty,
        }));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('reportable_transactions').insert(toInsert);
        if (insErr) throw insErr;
      }

      if (toUpsert.length > 0) {
        const { error: upErr } = await supabase
          .from('reportable_transactions')
          .upsert(toUpsert, { onConflict: 'id' });
        if (upErr) throw upErr;
      }

      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save transactions');
      return false;
    }
  };

  const handleNext = async () => {
    if (step === 1 && ein && !isValidEIN(ein)) {
      setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
      return;
    }

    if (step < 3) {
      const id = await saveStep();
      if (id) {
        const nextStep = (step + 1) as IntakeStep;
        setStep(nextStep);
        const newParams = new URLSearchParams(params.toString());
        newParams.set('step', String(nextStep));
        navigate(`?${newParams.toString()}`, { replace: true });
      }
    } else if (step === 3) {
      const saved = await saveTransactions();
      if (saved) {
        setStep(4);
        const newParams = new URLSearchParams(params.toString());
        newParams.set('step', '4');
        navigate(`?${newParams.toString()}`, { replace: true });
      }
    }
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1) as IntakeStep);

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
        related_party_naics: txRpNaics,
      },
    ]);

    setTxAmt('');
    setTxDesc('');
    setTxDate('');
    setTxIsRoyalty(false);
    setTxRpNaics('');
  };

  const removeTransaction = (i: number) => {
    setTransactions((prev) => prev.filter((_, idx) => idx !== i));
  };

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

  function resolveBizActivityLabel(activity: string): string {
    if (!activity || activity === '__other__') return '';
    return activity;
  }

  if (loadingFiling) {
    return (
      <div
        style={{
          maxWidth: 680,
          margin: '0 auto',
          padding: '3rem 1rem',
          textAlign: 'center',
          color: 'var(--tf-text-muted, #6b7280)',
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <>
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
          border-color: var(--tf-primary, #0284c7);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--tf-primary, #0284c7) 18%, transparent);
        }
        .intake-form input::placeholder {
          color: var(--tf-text-muted, #9ca3af);
          opacity: 1;
        }
        .intake-form input[data-invalid="true"] {
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.15);
        }
        .intake-form .field-error {
          font-size: 0.78rem;
          color: #dc2626;
          margin-top: 0.25rem;
        }
        .intake-form select option {
          background: var(--tf-surface, #fff);
          color: var(--tf-text, #111);
        }
        .intake-form input[readonly] {
          background: var(--tf-offset, #f3f4f6);
          color: var(--tf-text-muted, #6b7280);
          cursor: default;
        }
        .stepper-track {
          display: inline-flex;
          align-items: center;
          background: #f1f5f9;
          border-radius: 2rem;
          padding: 0.25rem;
          gap: 0;
          margin-bottom: 2rem;
          flex-wrap: nowrap;
          overflow-x: auto;
          max-width: 100%;
        }
        .stepper-pill {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.35rem 0.9rem;
          border-radius: 2rem;
          font-size: 0.8125rem;
          font-weight: 500;
          white-space: nowrap;
          border: none;
          background: transparent;
          transition: background 0.15s, color 0.15s;
          line-height: 1;
        }
        .stepper-pill--active {
          background: #0284c7;
          color: #fff;
          font-weight: 700;
          cursor: default;
          box-shadow: 0 1px 4px rgba(2,132,199,0.25);
        }
        .stepper-pill--done {
          background: #e0f2fe;
          color: #0369a1;
          font-weight: 600;
          cursor: pointer;
        }
        .stepper-pill--done:hover {
          background: #bae6fd;
        }
        .stepper-pill--pending {
          color: #94a3b8;
          cursor: default;
          opacity: 0.6;
        }
        .stepper-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1rem;
          height: 1rem;
          border-radius: 50%;
          background: #0369a1;
          color: #fff;
          font-size: 0.6rem;
          font-weight: 800;
          line-height: 1;
          flex-shrink: 0;
        }
        @media (prefers-color-scheme: dark) {
          .stepper-track {
            background: rgba(255, 255, 255, 0.10);
          }
          .stepper-pill--done {
            background: rgba(255, 255, 255, 0.12);
            color: #7dd3fc;
          }
          .stepper-pill--done:hover {
            background: rgba(255, 255, 255, 0.18);
          }
          .stepper-check {
            background: #0ea5e9;
          }
        }
      `}</style>

      <div
        className="intake-form"
        style={{
          maxWidth: 680,
          margin: '0 auto',
          padding: '2rem 1rem',
          fontFamily: 'inherit',
        }}
      >
        <nav aria-label="Form steps">
          <div className="stepper-track">
            {([1, 2, 3, 4] as IntakeStep[]).map((s) => {
              const isDone = s < step;
              const isActive = s === step;
              const isPending = s > step;

              return (
                <button
                  key={s}
                  type="button"
                  className={[
                    'stepper-pill',
                    isActive ? 'stepper-pill--active' : '',
                    isDone ? 'stepper-pill--done' : '',
                    isPending ? 'stepper-pill--pending' : '',
                  ].join(' ')}
                  onClick={() => {
                    if (isDone) setStep(s);
                  }}
                  aria-current={isActive ? 'step' : undefined}
                  tabIndex={isDone ? 0 : -1}
                >
                  {isDone && (
                    <span className="stepper-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  {s}. {STEP_LABELS[s]}
                </button>
              );
            })}
          </div>
        </nav>

        {error && (
          <div
            style={{
              background: '#fef2f2',
              color: '#991b1b',
              border: '1px solid #fecaca',
              borderRadius: '0.375rem',
              padding: '0.75rem 1rem',
              fontSize: '0.875rem',
              marginBottom: '1.25rem',
            }}
          >
            {error}
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 1 — LLC Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company Information</h3>
              <div style={gridStyle}>
                <Field label="LLC / Corporation name *" style={{ gridColumn: '1 / -1' }}>
                  <input
                    value={llcName}
                    onChange={(e) => setLlcName(e.target.value)}
                    placeholder="e.g. Acme Global LLC"
                  />
                </Field>

                <Field label="EIN" hint="Employer Identification Number">
                  <input
                    value={ein}
                    onChange={(e) => setEin(formatEIN(e.target.value))}
                    onBlur={handleEinBlur}
                    placeholder="XX-XXXXXXX"
                    data-invalid={einErr ? 'true' : undefined}
                    inputMode="numeric"
                    maxLength={10}
                  />
                  {einErr && <span className="field-error">{einErr}</span>}
                </Field>

                <Field label="State of formation *">
                  <select
                    value={stateOfFormation}
                    onChange={(e) => setStateOfFormation(e.target.value)}
                  >
                    <option value="">— Select state —</option>
                    {US_STATES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Tax year *">
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                    {TAX_YEARS.map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Principal Business Activity</h3>
              <div style={gridStyle}>
                <Field label="Activity" hint="What does the LLC primarily do?">
                  <select
                    value={entityBizActivity}
                    onChange={(e) => {
                      const value = e.target.value;
                      const sel = BIZ_ACTIVITIES.find((a) => a.label === value);
                      setEntityBizActivity(value);
                      setEntityBizCode(sel ? sel.code : '');
                    }}
                  >
                    <option value="">— Select activity —</option>
                    {BIZ_ACTIVITIES.map((a) => (
                      <option key={`${a.code}-${a.label}`} value={a.label}>
                        {a.label}
                      </option>
                    ))}
                    <option value="__other__">Other (enter manually below)</option>
                  </select>
                </Field>

                <Field label="Business activity code" hint="Auto-filled or enter manually">
                  <input
                    value={entityBizCode}
                    onChange={(e) => setEntityBizCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="e.g. 541511"
                    inputMode="numeric"
                    maxLength={6}
                  />
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC Mailing Address</h3>
              <AddressFields value={mailing} onChange={setMailing} />
            </section>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 2 — Foreign Owner Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Identity</h3>
              <div style={gridStyle}>
                <Field
                  label="Full legal name *"
                  hint="As shown on government ID"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="As shown on government ID"
                  />
                </Field>

                <Field label="Owner country *" hint="Country of the related party">
                  <select value={ownerCountry} onChange={(e) => setOwnerCountry(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Country of residence *">
                  <select
                    value={ownerCountryRes}
                    onChange={(e) => setOwnerCountryRes(e.target.value)}
                  >
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Country of citizenship">
                  <select
                    value={ownerCountryCit}
                    onChange={(e) => setOwnerCountryCit(e.target.value)}
                  >
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Foreign tax ID" hint="Optional — PAN, TIN, etc.">
                  <input
                    value={ownerForeignTaxId}
                    onChange={(e) => setOwnerForeignTaxId(e.target.value)}
                    placeholder="e.g. ABCDE1234F"
                  />
                </Field>

                <Field label="Date of incorporation" hint="Owner entity's incorporation date">
                  <input type="date" value={ownerDOI} onChange={(e) => setOwnerDOI(e.target.value)} />
                </Field>

                <Field
                  label="Owner reference number"
                  hint="Auto-derived: first 3 letters of name + 001"
                >
                  <input
                    value={ownerRefNumber}
                    onChange={(e) => setOwnerRefNumber(e.target.value)}
                    placeholder="e.g. CHI001"
                    readOnly={!!ownerName.trim()}
                  />
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner Address</h3>
              <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Signature &amp; Business Activity</h3>
              <div style={gridStyle}>
                <Field label="Your title" hint="Printed on the form signature line">
                  <input
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                    placeholder="Owner"
                  />
                </Field>

                <Field
                  label="Principal business activity"
                  hint="Related party's primary business"
                >
                  <select
                    value={ownerBizActivity}
                    onChange={(e) => {
                      const value = e.target.value;
                      const sel = BIZ_ACTIVITIES.find((a) => a.label === value);
                      setOwnerBizActivity(value);
                      setOwnerBizCode(sel ? sel.code : '');
                    }}
                  >
                    <option value="">— Select activity —</option>
                    {BIZ_ACTIVITIES.map((a) => (
                      <option key={`${a.code}-${a.label}`} value={a.label}>
                        {a.label}
                      </option>
                    ))}
                    <option value="__other__">Other (enter manually below)</option>
                  </select>
                </Field>

                <Field label="Activity code" hint="Auto-filled or enter manually">
                  <input
                    value={ownerBizCode}
                    onChange={(e) => setOwnerBizCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="e.g. 541511"
                    inputMode="numeric"
                    maxLength={6}
                  />
                </Field>
              </div>
            </section>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 3 — Reportable Transactions</h2>
            <p
              style={{
                color: 'var(--tf-text-muted, #6b7280)',
                fontSize: '0.875rem',
                marginBottom: '1.5rem',
                lineHeight: 1.55,
              }}
            >
              Add every monetary transaction between you and the LLC during the tax year.
              For loans, enter the <strong>year-end closing balance</strong>.
            </p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Add a transaction</h3>
              <div style={gridStyle}>
                <Field label="Type">
                  <select
                    value={txType}
                    onChange={(e) => {
                      setTxType(e.target.value);
                      setTxIsRoyalty(false);
                    }}
                  >
                    {TX_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>

                {!LOAN_TYPES.has(txType) && (
                  <Field label="Direction">
                    <select
                      value={txDir}
                      onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')}
                    >
                      <option value="received">LLC received</option>
                      <option value="paid">LLC paid</option>
                    </select>
                  </Field>
                )}

                <Field label={LOAN_TYPES.has(txType) ? 'Closing balance (USD) *' : 'Amount (USD) *'}>
                  <input
                    type="number"
                    min="0"
                    value={txAmt}
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

                <Field
                  label="Related-party NAICS"
                  hint="Type of business of the related party (display only)"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <select value={txRpNaics} onChange={(e) => setTxRpNaics(e.target.value)}>
                    <option value="">— Select NAICS (optional) —</option>
                    {RP_NAICS.map((n) => (
                      <option key={`${n.code}-${n.label}`} value={n.code}>
                        {n.code} — {n.label} ({n.hint})
                      </option>
                    ))}
                    <option value="__manual__">Other — enter code manually</option>
                  </select>
                </Field>

                <Field
                  label="Description"
                  hint="Optional"
                  style={{ gridColumn: '1 / -1' }}
                >
                  <input
                    value={txDesc}
                    onChange={(e) => setTxDesc(e.target.value)}
                    placeholder="Brief description"
                  />
                </Field>
              </div>

              {PART_VI_TYPES.has(txType) && (
                <p
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--tf-text-muted, #6b7280)',
                    marginTop: '0.75rem',
                    padding: '0.625rem 0.875rem',
                    background: 'var(--tf-offset, #f9fafb)',
                    border: '1px solid var(--tf-border, #e5e7eb)',
                    borderRadius: '0.375rem',
                  }}
                >
                  ℹ️ Disclosed in <strong>Part VI statement</strong> (nonmonetary / less-than-FMV). Amount is optional.
                </p>
              )}

              <button onClick={addTransaction} style={addBtnStyle} type="button">
                + Add transaction
              </button>
            </section>

            {transactions.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.375rem',
                  marginTop: '0.5rem',
                }}
              >
                {transactions.map((tx, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.875rem',
                      background: 'var(--tf-surface, #fff)',
                      border: '1px solid var(--tf-border, #e5e7eb)',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                    }}
                  >
                    <div style={{ flex: 1, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>
                        {TX_TYPES.find((t) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}
                      </span>
                      {!LOAN_TYPES.has(tx.transaction_type) && (
                        <span
                          style={{
                            color: 'var(--tf-text-muted, #6b7280)',
                            fontSize: '0.75rem',
                            alignSelf: 'center',
                          }}
                        >
                          {tx.direction === 'received' ? '↓ received' : '↑ paid'}
                        </span>
                      )}
                      {tx.is_royalty && (
                        <span
                          style={{
                            color: 'var(--tf-text-muted, #6b7280)',
                            fontSize: '0.75rem',
                            alignSelf: 'center',
                          }}
                        >
                          royalty
                        </span>
                      )}
                      {tx.related_party_naics && tx.related_party_naics !== '__manual__' && (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: '#0284c7',
                            background: '#e0f2fe',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '0.25rem',
                            alignSelf: 'center',
                          }}
                        >
                          NAICS {tx.related_party_naics}
                        </span>
                      )}
                      {tx.description && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)' }}>
                          {' '}
                          — {tx.description}
                        </span>
                      )}
                    </div>

                    <span
                      style={{
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: '#0284c7',
                      }}
                    >
                      ${Number(tx.amount_usd).toLocaleString()}
                    </span>

                    <button
                      onClick={() => removeTransaction(i)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#b91c1c',
                        fontSize: '1.125rem',
                        cursor: 'pointer',
                        padding: '0 0.25rem',
                        lineHeight: 1,
                      }}
                      type="button"
                      aria-label="Remove transaction"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 4 — Review &amp; Submit</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="LLC name" value={llcName} />
                <SummaryRow label="EIN" value={ein} />
                <SummaryRow
                  label="State"
                  value={US_STATES.find((s) => s.value === stateOfFormation)?.label ?? stateOfFormation}
                />
                <SummaryRow label="Tax year" value={taxYear} />
                <SummaryRow label="Business activity" value={resolveBizActivityLabel(entityBizActivity)} />
                <SummaryRow label="Activity code" value={entityBizCode} />
                <SummaryRow label="Mailing street 1" value={mailing.line1} />
                <SummaryRow label="Mailing street 2" value={mailing.line2} />
                <SummaryRow label="Mailing city" value={mailing.city} />
                <SummaryRow
                  label="Mailing state / region"
                  value={
                    isUSCountry(mailing.country)
                      ? US_STATES.find((s) => s.value === mailing.region)?.label ?? mailing.region
                      : mailing.region
                  }
                />
                <SummaryRow label="Mailing postal code" value={mailing.postal_code} />
                <SummaryRow
                  label="Mailing country"
                  value={COUNTRIES.find((c) => c.value === mailing.country)?.label ?? mailing.country}
                />
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner / Related Party</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Full name" value={ownerName} />
                <SummaryRow
                  label="Owner country"
                  value={COUNTRIES.find((c) => c.value === ownerCountry)?.label ?? ownerCountry}
                />
                <SummaryRow
                  label="Country of residence"
                  value={COUNTRIES.find((c) => c.value === ownerCountryRes)?.label ?? ownerCountryRes}
                />
                <SummaryRow
                  label="Citizenship"
                  value={COUNTRIES.find((c) => c.value === ownerCountryCit)?.label ?? ownerCountryCit}
                />
                <SummaryRow label="Foreign tax ID" value={ownerForeignTaxId} />
                <SummaryRow label="Date of incorp." value={ownerDOI} />
                <SummaryRow label="Owner ref" value={ownerRefNumber} />
                <SummaryRow label="Signer title" value={signerTitle} />
                <SummaryRow label="Business activity" value={resolveBizActivityLabel(ownerBizActivity)} />
                <SummaryRow label="Activity code" value={ownerBizCode} />
                <SummaryRow label="Owner street 1" value={ownerAddress.line1} />
                <SummaryRow label="Owner street 2" value={ownerAddress.line2} />
                <SummaryRow label="Owner city" value={ownerAddress.city} />
                <SummaryRow
                  label="Owner state / region"
                  value={
                    isUSCountry(ownerAddress.country)
                      ? US_STATES.find((s) => s.value === ownerAddress.region)?.label ?? ownerAddress.region
                      : ownerAddress.region
                  }
                />
                <SummaryRow label="Owner postal code" value={ownerAddress.postal_code} />
                <SummaryRow
                  label="Owner address country"
                  value={COUNTRIES.find((c) => c.value === ownerAddress.country)?.label ?? ownerAddress.country}
                />
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
              {transactions.length === 0 ? (
                <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem' }}>
                  No transactions added yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {transactions.map((tx, i) => (
                    <div
                      key={i}
                      style={{
                        background: 'var(--tf-surface, #fff)',
                        border: '1px solid var(--tf-border, #e5e7eb)',
                        borderRadius: '0.5rem',
                        padding: '0.875rem 1rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          alignItems: 'center',
                          marginBottom: '0.75rem',
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>
                          {TX_TYPES.find((t) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}
                        </span>

                        <span
                          style={{
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            color: '#0284c7',
                          }}
                        >
                          ${Number(tx.amount_usd || 0).toLocaleString()}
                        </span>
                      </div>

                      <div style={reviewGridStyle}>
                        {!LOAN_TYPES.has(tx.transaction_type) && (
                          <SummaryRow
                            label="Direction"
                            value={tx.direction === 'received' ? 'LLC received' : 'LLC paid'}
                          />
                        )}
                        <SummaryRow label="Date" value={tx.transaction_date} />
                        <SummaryRow label="Description" value={tx.description} />
                        <SummaryRow
                          label="Subtype"
                          value={ROYALTY_TYPES.has(tx.transaction_type) ? (tx.is_royalty ? 'Royalty' : 'Rent') : '—'}
                        />
                        <SummaryRow
                          label="Related-party NAICS"
                          value={tx.related_party_naics === '__manual__' ? 'Manual entry' : tx.related_party_naics}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid var(--tf-border, #e5e7eb)',
            marginTop: '1.5rem',
          }}
        >
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
              {saving ? 'Submitting…' : 'Submit Intake →'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default Intake;

function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label
        style={{
          fontSize: '0.8rem',
          fontWeight: 600,
          color: 'var(--tf-text-muted, #6b7280)',
        }}
      >
        {label}
        {hint && <span style={{ fontWeight: 400, marginLeft: '0.25rem' }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function AddressFields({
  value,
  onChange,
}: {
  value: Address;
  onChange: (a: Address) => void;
}) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });

  const isUSAddress = isUSCountry(value.country);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '0.75rem',
      }}
    >
      <Field label="Street line 1" style={{ gridColumn: '1 / -1' }}>
        <input
          placeholder="Street line 1"
          value={value.line1 ?? ''}
          onChange={(e) => set('line1', e.target.value)}
        />
      </Field>

      <Field label="Street line 2" style={{ gridColumn: '1 / -1' }}>
        <input
          placeholder="Optional"
          value={value.line2 ?? ''}
          onChange={(e) => set('line2', e.target.value)}
        />
      </Field>

      <Field label="City">
        <input
          placeholder="City"
          value={value.city ?? ''}
          onChange={(e) => set('city', e.target.value)}
        />
      </Field>

      <Field label="State / Region">
        {isUSAddress ? (
          <select
            value={value.region ?? ''}
            onChange={(e) => set('region', e.target.value)}
          >
            <option value="">— Select state —</option>
            {US_STATES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            placeholder="State / Region"
            value={value.region ?? ''}
            onChange={(e) => set('region', e.target.value)}
          />
        )}
      </Field>

      <Field label="Postal code">
        <input
          placeholder="Postal code"
          value={value.postal_code ?? ''}
          onChange={(e) => set('postal_code', e.target.value)}
        />
      </Field>

      <Field label="Country">
        <select
          value={value.country ?? ''}
          onChange={(e) => {
            const nextCountry = e.target.value;
            const wasUS = isUSCountry(value.country);
            const nextIsUS = isUSCountry(nextCountry);

            onChange({
              ...value,
              country: nextCountry,
              region: wasUS !== nextIsUS ? '' : value.region,
            });
          }}
        >
          <option value="">— Select country —</option>
          {COUNTRIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--tf-text-muted, #6b7280)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '0.95rem',
          fontWeight: 500,
          color: value ? 'var(--tf-text, #111)' : 'var(--tf-text-muted, #9ca3af)',
        }}
      >
        {value || '—'}
      </div>
    </div>
  );
}

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

const reviewGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '0.75rem',
  background: 'var(--tf-surface, #fff)',
  border: '1px solid var(--tf-border, #e5e7eb)',
  borderRadius: '0.625rem',
  padding: '1rem 1.25rem',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.5rem',
  background: '#0284c7',
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
  background: '#0284c7',
  color: '#fff',
  border: 'none',
  borderRadius: '0.375rem',
  fontWeight: 600,
  fontSize: '0.875rem',
  cursor: 'pointer',
};

void buildRelatedPartyRef;
