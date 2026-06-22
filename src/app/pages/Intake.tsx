// src/app/pages/Intake.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import {
  BIZ_ACTIVITIES,
  COUNTRIES,
  FILING_DUE_DATES,
  LOAN_TYPES,
  PART_VI_TYPES,
  RP_NAICS,
  ROYALTY_TYPES,
  STEP_LABELS,
  TAX_YEARS,
  TX_TYPES,
  type IntakeStep,
  US_STATES,
} from './intake/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

type Address = {
  line1?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

type RelatedParty = {
  id?: string;
  name: string;
  ref_number: string;
  country: string;           // principal country of business
  country_residence: string;
  country_citizenship: string;
  foreign_tax_id: string;
  address: Address;
  biz_activity: string;
  biz_code: string;
};

type TransactionRow = {
  id?: string;
  related_party_index: number; // 0 = owner, 1+ = additional related parties
  transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: string;
  description: string;
  transaction_date: string;
  is_royalty: boolean;
  related_party_naics?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatEIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function isValidEIN(val: string): boolean {
  return /^\d{2}-\d{7}$/.test(val);
}

function isUSCountry(value?: string | null): boolean {
  return value === 'US';
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

function resolveBizActivityLabel(activity: string): string {
  if (!activity || activity === 'other') return '';
  return activity;
}

function getFilingTimingStatus(
  taxYear: string,
  today: Date,
): { status: 'on_time' | 'within_extension' | 'delayed'; originalPassed: boolean; extendedPassed: boolean } {
  const year = Number(taxYear);
  const dates = FILING_DUE_DATES[year];
  if (!dates) return { status: 'on_time', originalPassed: false, extendedPassed: false };
  const original = new Date(dates.original);
  const extended = new Date(dates.extended);
  const originalPassed = today > original;
  const extendedPassed = today > extended;
  if (!originalPassed) return { status: 'on_time', originalPassed, extendedPassed };
  if (!extendedPassed) return { status: 'within_extension', originalPassed, extendedPassed };
  return { status: 'delayed', originalPassed, extendedPassed };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text-muted, #6b7280)' }}>
        {label}
        {hint && <span style={{ fontWeight: 400, marginLeft: '0.25rem' }}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function AddressFields({
  value,
  onChange,
  forceUS,
}: {
  value: Address;
  onChange: (a: Address) => void;
  forceUS?: boolean;
}) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  const effectiveCountry = forceUS ? 'US' : value.country;
  const isUS = isUSCountry(effectiveCountry);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '0.75rem',
      }}
    >
      <Field label="Street address" style={{ gridColumn: '1 / -1' }}>
        <input
          placeholder="Street address"
          value={value.line1 ?? ''}
          onChange={(e) => set('line1', e.target.value)}
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
        {isUS ? (
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

      {!forceUS && (
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
      )}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const stepHeadingStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 700,
  marginBottom: '1.5rem',
};

const sectionStyle: React.CSSProperties = { marginBottom: '2rem' };

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

const warningBoxStyle: React.CSSProperties = {
  background: '#fffbeb',
  border: '1px solid #fbbf24',
  borderRadius: '0.5rem',
  padding: '0.875rem 1rem',
  fontSize: '0.875rem',
  color: '#92400e',
  marginBottom: '1.25rem',
};

const infoBoxStyle: React.CSSProperties = {
  background: 'var(--tf-offset, #f9fafb)',
  border: '1px solid var(--tf-border, #e5e7eb)',
  borderRadius: '0.375rem',
  padding: '0.625rem 0.875rem',
  fontSize: '0.8125rem',
  color: 'var(--tf-text-muted, #6b7280)',
  marginTop: '0.75rem',
};

// ─── Main component ───────────────────────────────────────────────────────────

export function Intake() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [localFilingId, setLocalFilingId] = useState<string | null>(params.get('filing_id'));
  const filingId = localFilingId ?? params.get('filing_id');

  const [step, setStep] = useState<IntakeStep>(() => {
    const s = Number(params.get('step'));
    return (s >= 1 && s <= 5 ? s : 1) as IntakeStep;
  });

  const [loadingFiling, setLoadingFiling] = useState(!!params.get('filing_id'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [einErr, setEinErr] = useState<string | null>(null);

  // ── Step 1: LLC ────────────────────────────────────────────────────────────
  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [taxYear, setTaxYear] = useState('2024');
  const [totalAssets, setTotalAssets] = useState('');
  const [entityDOI, setEntityDOI] = useState('');
  const [entityPrincipalCountry, setEntityPrincipalCountry] = useState('');
  const [mailing, setMailing] = useState<Address>({ country: 'US' });
  const [entityBizActivity, setEntityBizActivity] = useState('');
  const [entityBizCode, setEntityBizCode] = useState('');

  // ── Step 2: Primary owner ──────────────────────────────────────────────────
  const [ownerName, setOwnerName] = useState('');
  const [ownerCountry, setOwnerCountry] = useState('');         // principal country of business
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCit, setOwnerCountryCit] = useState('');
  const [ownerSSN, setOwnerSSN] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerRefNumber, setOwnerRefNumber] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});
  const [ownerBizActivity, setOwnerBizActivity] = useState('');
  const [ownerBizCode, setOwnerBizCode] = useState('');

  // ── Step 3: Additional related parties ────────────────────────────────────
  const [relatedParties, setRelatedParties] = useState<RelatedParty[]>([]);
  const [rpDraft, setRpDraft] = useState<RelatedParty>({
    name: '',
    ref_number: '',
    country: '',
    country_residence: '',
    country_citizenship: '',
    foreign_tax_id: '',
    address: {},
    biz_activity: '',
    biz_code: '',
  });
  const [showRpForm, setShowRpForm] = useState(false);
  const [editingRpIdx, setEditingRpIdx] = useState<number | null>(null);

  // ── Step 4: Transactions ───────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [txRelatedPartyIdx, setTxRelatedPartyIdx] = useState(0); // 0 = owner
  const [txType, setTxType] = useState('tangible_purchase');
  const [txDir, setTxDir] = useState<'paid' | 'received'>('received');
  const [txAmt, setTxAmt] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState('');
  const [txIsRoyalty, setTxIsRoyalty] = useState(false);
  const [txRpNaics, setTxRpNaics] = useState('');

  // ── Step 5: Extension / delay ──────────────────────────────────────────────
  const [extensionFiled, setExtensionFiled] = useState<boolean | null>(null);
  const [includeReasonableCause, setIncludeReasonableCause] = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────
  const today = new Date();
  const filingTiming = getFilingTimingStatus(taxYear, today);

  // Build the full list of parties for transaction linking:
  // index 0 = primary owner, index 1+ = additional related parties
  const allPartyLabels = [
    ownerName || 'Primary owner',
    ...relatedParties.map((rp, i) => rp.name || `Related party ${i + 1}`),
  ];

  // ── Auto-derive owner ref number ──────────────────────────────────────────
  useEffect(() => {
    const derived = buildOwnerRef(ownerName);
    setOwnerRefNumber(derived);
  }, [ownerName]);

  // ── Sync step to URL ──────────────────────────────────────────────────────
  useEffect(() => {
    const currentStep = Number(params.get('step')) || 1;
    if (currentStep !== step) {
      const newParams = new URLSearchParams(params.toString());
      newParams.set('step', String(step));
      navigate(`?${newParams.toString()}`, { replace: true });
    }
  }, [step, params, navigate]);

  // ── Load existing filing ──────────────────────────────────────────────────
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
      if (err || !f) { setLoadingFiling(false); return; }

      setLlcName(f.llc_name ?? '');
      setEin(f.ein ?? '');
      setStateOfFormation(f.state_of_formation ?? '');
      setTaxYear(String(f.tax_year ?? '2024'));
      setTotalAssets(String((f as any).total_assets ?? ''));
      setEntityDOI((f as any).entity_date_of_incorporation ?? '');
      setEntityPrincipalCountry((f as any).entity_principal_country ?? '');
      setMailing((f.mailing_address as Address) ?? { country: 'US' });
      setEntityBizActivity((f as any).entity_business_activity ?? '');
      setEntityBizCode((f as any).entity_business_code ?? '');

      setOwnerName(f.owner_full_name ?? '');
      setOwnerCountry((f as any).owner_country ?? '');
      setOwnerCountryRes(f.owner_country_residence ?? '');
      setOwnerCountryCit(f.owner_country_citizenship ?? '');
      setOwnerSSN((f as any).owner_ssn ?? '');
      setOwnerForeignTaxId(f.owner_foreign_tax_id ?? '');
      setOwnerRefNumber((f as any).owner_ref_number ?? '');
      setOwnerAddress((f.owner_address as Address) ?? {});
      setOwnerBizActivity(f.owner_business_activity ?? '');
      setOwnerBizCode((f as any).owner_business_code ?? '');

      if ((f as any).related_parties) {
        setRelatedParties((f as any).related_parties as RelatedParty[]);
      }

      const { data: txns } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId)
        .order('created_at', { ascending: true });

      if (txns) {
        setTransactions(
          txns.map((t) => ({
            id: t.id,
            related_party_index: (t as any).related_party_index ?? 0,
            transaction_type: t.transaction_type,
            direction: t.direction,
            amount_usd: String(t.amount_usd ?? ''),
            description: t.description ?? '',
            transaction_date: t.transaction_date ?? '',
            is_royalty: t.is_royalty ?? false,
            related_party_naics: (t as any).related_party_naics ?? '',
          })),
        );
      }

      setLoadingFiling(false);
    })();
  }, [filingId]);

  // ── Patch helpers ─────────────────────────────────────────────────────────
  function patchFromCurrentStep(): Partial<Filing> & Record<string, unknown> {
    if (step === 1)
      return {
        llc_name: llcName.trim() || null,
        ein: ein.trim() || null,
        state_of_formation: stateOfFormation.trim() || null,
        tax_year: taxYear,
        total_assets: totalAssets ? Number(totalAssets) : null,
        entity_date_of_incorporation: entityDOI.trim() || null,
        entity_principal_country: entityPrincipalCountry.trim() || null,
        mailing_address: mailing,
        entity_business_activity: entityBizActivity.trim() || null,
        entity_business_code: entityBizCode.trim() || null,
      };
    if (step === 2)
      return {
        owner_full_name: ownerName.trim() || null,
        owner_country: ownerCountry.trim() || null,
        owner_country_residence: ownerCountryRes.trim() || null,
        owner_country_citizenship: ownerCountryCit.trim() || null,
        owner_ssn: ownerSSN.trim() || null,
        owner_foreign_tax_id: ownerForeignTaxId.trim() || null,
        owner_ref_number: ownerRefNumber.trim() || null,
        owner_address: ownerAddress,
        owner_business_activity: ownerBizActivity.trim() || null,
        owner_business_code: ownerBizCode.trim() || null,
      };
    if (step === 3)
      return {
        related_parties: relatedParties,
      };
    return {};
  }

  // ── EIN blur ──────────────────────────────────────────────────────────────
  const handleEinBlur = () => {
    if (ein && !isValidEIN(ein))
      setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
    else setEinErr(null);
  };

  // ── Save / navigation ─────────────────────────────────────────────────────
  const saveStep = async (): Promise<string | null> => {
  setSaving(true);
  setError(null);

  try {
    const patch = patchFromCurrentStep();
    console.log('saveStep:start', { step, filingId, patch });

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

      if (err) {
        console.error('saveStep:insert error', err, patch);
        throw err;
      }

      const newId = data.id as string;
      console.log('saveStep:insert success', { newId });

      setLocalFilingId(newId);
      navigate(`?filing_id=${newId}&step=${step + 1}`, { replace: true });
      return newId;
    }

    const { error: err } = await supabase
      .from('filings')
      .update(patch)
      .eq('id', filingId);

    if (err) {
      console.error('saveStep:update error', err, patch);
      throw err;
    }

    console.log('saveStep:update success', { filingId, patch });
    return filingId;
  } catch (e: unknown) {
    console.error('saveStep failed', e);
    setError(
      e instanceof Error
        ? e.message
        : typeof e === 'string'
          ? e
          : JSON.stringify(e)
    );
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
          related_party_index: t.related_party_index,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: Number(t.amount_usd),
          description: t.description || null,
          transaction_date: t.transaction_date || null,
          is_royalty: t.is_royalty,
          related_party_naics: t.related_party_naics || null,
        }));

      const toUpsert = validTxns
        .filter((t) => !!t.id)
        .map((t) => ({
          id: t.id!,
          filing_id: filingId,
          related_party_index: t.related_party_index,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: Number(t.amount_usd),
          description: t.description || null,
          transaction_date: t.transaction_date || null,
          is_royalty: t.is_royalty,
          related_party_naics: t.related_party_naics || null,
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
    if (step < 4) {
      const id = await saveStep();
      if (id) {
        const nextStep = (step + 1) as IntakeStep;
        setStep(nextStep);
        const newParams = new URLSearchParams(params.toString());
        newParams.set('step', String(nextStep));
        navigate(`?${newParams.toString()}`, { replace: true });
      }
    } else if (step === 4) {
      const saved = await saveTransactions();
      if (saved) {
        setStep(5);
        const newParams = new URLSearchParams(params.toString());
        newParams.set('step', '5');
        navigate(`?${newParams.toString()}`, { replace: true });
      }
    }
  };

  const handleBack = () => {
    setStep((s) => Math.max(1, s - 1) as IntakeStep);
  };

  const addTransaction = () => {
    if (!txAmt || Number(txAmt) <= 0) return;
    setTransactions((prev) => [
      ...prev,
      {
        related_party_index: txRelatedPartyIdx,
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
        .update({
          status: 'in_progress',
          extension_filed: extensionFiled,
          include_reasonable_cause: includeReasonableCause,
        })
        .eq('id', filingId);
      if (err) throw err;
      navigate(`/filing/${filingId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Related party helpers ─────────────────────────────────────────────────
  const openRpForm = (idx?: number) => {
    if (idx !== undefined) {
      setRpDraft({ ...relatedParties[idx] });
      setEditingRpIdx(idx);
    } else {
      setRpDraft({
        name: '',
        ref_number: '',
        country: '',
        country_residence: '',
        country_citizenship: '',
        foreign_tax_id: '',
        address: {},
        biz_activity: '',
        biz_code: '',
      });
      setEditingRpIdx(null);
    }
    setShowRpForm(true);
  };

  const saveRpDraft = () => {
    const updated = { ...rpDraft, ref_number: buildRelatedPartyRef(rpDraft.name, editingRpIdx ?? relatedParties.length) };
    if (editingRpIdx !== null) {
      setRelatedParties((prev) => prev.map((rp, i) => (i === editingRpIdx ? updated : rp)));
    } else {
      setRelatedParties((prev) => [...prev, updated]);
    }
    setShowRpForm(false);
    setEditingRpIdx(null);
  };

  const removeRp = (i: number) => {
    setRelatedParties((prev) => prev.filter((_, idx) => idx !== i));
    // Remove orphaned transactions for this party; shift indices
    setTransactions((prev) =>
      prev
        .filter((t) => t.related_party_index !== i + 1)
        .map((t) => ({
          ...t,
          related_party_index:
            t.related_party_index > i + 1 ? t.related_party_index - 1 : t.related_party_index,
        })),
    );
  };

  // ── TX type derived state ─────────────────────────────────────────────────
  const txTypeMeta = TX_TYPES.find((t) => t.value === txType);
  const txCategory = txTypeMeta?.category ?? 1;
  const txPart = txTypeMeta?.part ?? 'IV';

  // ─────────────────────────────────────────────────────────────────────────

  if (loadingFiling) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '3rem 1rem', textAlign: 'center', color: 'var(--tf-text-muted, #6b7280)' }}>
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
        .intake-form input::placeholder { color: var(--tf-text-muted, #9ca3af); opacity: 1; }
        .intake-form input[data-invalid="true"] {
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.15);
        }
        .intake-form .field-error { font-size: 0.78rem; color: #dc2626; margin-top: 0.25rem; }
        .intake-form select option { background: var(--tf-surface, #fff); color: var(--tf-text, #111); }
        .intake-form input[readonly] { background: var(--tf-offset, #f3f4f6); color: var(--tf-text-muted, #6b7280); cursor: default; }
        .stepper-track { display: inline-flex; align-items: center; background: #f1f5f9; border-radius: 2rem; padding: 0.25rem; gap: 0; margin-bottom: 2rem; flex-wrap: nowrap; overflow-x: auto; max-width: 100%; }
        .stepper-pill { display: flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.9rem; border-radius: 2rem; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; border: none; background: transparent; transition: background 0.15s, color 0.15s; line-height: 1; }
        .stepper-pill--active { background: #0284c7; color: #fff; font-weight: 700; cursor: default; box-shadow: 0 1px 4px rgba(2,132,199,0.25); }
        .stepper-pill--done { background: #e0f2fe; color: #0369a1; font-weight: 600; cursor: pointer; }
        .stepper-pill--done:hover { background: #bae6fd; }
        .stepper-pill--pending { color: #94a3b8; cursor: default; opacity: 0.6; }
        .stepper-check { display: inline-flex; align-items: center; justify-content: center; width: 1rem; height: 1rem; border-radius: 50%; background: #0369a1; color: #fff; font-size: 0.6rem; font-weight: 800; line-height: 1; flex-shrink: 0; }
        @media (prefers-color-scheme: dark) {
          .stepper-track { background: rgba(255,255,255,0.10); }
          .stepper-pill--done { background: rgba(255,255,255,0.12); color: #7dd3fc; }
          .stepper-pill--done:hover { background: rgba(255,255,255,0.18); }
          .stepper-check { background: #0ea5e9; }
        }
      `}</style>

      <div className="intake-form" style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>

        {/* ── Stepper ──────────────────────────────────────────────────────── */}
        <nav aria-label="Form steps">
          <div className="stepper-track">
            {([1, 2, 3, 4, 5] as IntakeStep[]).map((s) => {
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
                  onClick={() => { if (isDone) setStep(s); }}
                  aria-current={isActive ? 'step' : undefined}
                  tabIndex={isDone ? 0 : -1}
                >
                  {isDone && <span className="stepper-check" aria-hidden="true">✓</span>}
                  {s}. {STEP_LABELS[s]}
                </button>
              );
            })}
          </div>
        </nav>

        {error && (
          <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '0.375rem', padding: '0.75rem 1rem', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            {error}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 1 — LLC Details
        ══════════════════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 1 — LLC Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company information</h3>
              <div style={gridStyle}>
                <Field label="LLC / Corporation name" style={{ gridColumn: '1 / -1' }}>
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

                <Field label="State of formation">
                  <select value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)}>
                    <option value="">— Select state —</option>
                    {US_STATES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Tax year">
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                    {TAX_YEARS.map((y) => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Total assets at year end" hint="USD, as of last day of tax year">
                  <input
                    type="number"
                    min="0"
                    value={totalAssets}
                    onChange={(e) => setTotalAssets(e.target.value)}
                    placeholder="0"
                  />
                </Field>

                <Field label="Date of incorporation">
                  <input
                    type="date"
                    value={entityDOI}
                    onChange={(e) => setEntityDOI(e.target.value)}
                  />
                </Field>

                <Field label="Principal country where business is conducted">
                  <select value={entityPrincipalCountry} onChange={(e) => setEntityPrincipalCountry(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Principal business activity</h3>
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
                      <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>
                    ))}
                    <option value="other">Other — enter manually below</option>
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
              <h3 style={sectionLabelStyle}>LLC mailing address (US)</h3>
              <AddressFields value={mailing} onChange={setMailing} forceUS />
            </section>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 2 — Owner Details
        ══════════════════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 2 — Foreign Owner Details</h2>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Identity</h3>
              <div style={gridStyle}>
                <Field label="Full legal name" hint="As shown on government ID" style={{ gridColumn: '1 / -1' }}>
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="As shown on government ID"
                  />
                </Field>

                <Field label="Principal country of business" hint="Country where owner primarily operates">
                  <select value={ownerCountry} onChange={(e) => setOwnerCountry(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Country of tax residence">
                  <select value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Country of citizenship">
                  <select value={ownerCountryCit} onChange={(e) => setOwnerCountryCit(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="US SSN" hint="If applicable">
                  <input
                    value={ownerSSN}
                    onChange={(e) => setOwnerSSN(e.target.value)}
                    placeholder="XXX-XX-XXXX"
                    inputMode="numeric"
                  />
                </Field>

                <Field label="Foreign tax ID" hint="PAN, TIN, etc. — required">
                  <input
                    value={ownerForeignTaxId}
                    onChange={(e) => setOwnerForeignTaxId(e.target.value)}
                    placeholder="e.g. ABCDE1234F"
                  />
                </Field>

                <Field label="Owner reference number" hint="Auto-derived from name">
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
              <h3 style={sectionLabelStyle}>Owner address</h3>
              <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Principal business activity</h3>
              <div style={gridStyle}>
                <Field label="Activity" hint="Owner's primary business">
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
                      <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>
                    ))}
                    <option value="other">Other — enter manually below</option>
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

        {/* ══════════════════════════════════════════════════════════════════
            STEP 3 — Related Party Details
        ══════════════════════════════════════════════════════════════════ */}
        {step === 3 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 3 — Additional Related Parties</h2>
            <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              Each additional related party that had reportable transactions with the LLC requires a separate Form 5472.
              The primary owner (added in Step 2) is always included. Add any other foreign-related parties here.
            </p>

            {/* Existing related parties list */}
            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Additional related parties ({relatedParties.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {relatedParties.map((rp, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.625rem 0.875rem',
                        background: 'var(--tf-surface, #fff)',
                        border: '1px solid var(--tf-border, #e5e7eb)',
                        borderRadius: '0.5rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600 }}>{rp.name || `Related party ${i + 1}`}</span>
                        {rp.country && (
                          <span style={{ color: 'var(--tf-text-muted, #6b7280)', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                            {COUNTRIES.find((c) => c.value === rp.country)?.label ?? rp.country}
                          </span>
                        )}
                        {rp.ref_number && (
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>
                            {rp.ref_number}
                          </span>
                        )}
                      </div>
                      <button type="button" onClick={() => openRpForm(i)} style={{ ...secondaryBtnStyle, padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>
                        Edit
                      </button>
                      <button type="button" onClick={() => removeRp(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }} aria-label="Remove related party">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Add / edit form */}
            {showRpForm ? (
              <section style={{ ...sectionStyle, background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.625rem', padding: '1.25rem' }}>
                <h3 style={sectionLabelStyle}>{editingRpIdx !== null ? 'Edit related party' : 'Add related party'}</h3>
                <div style={gridStyle}>
                  <Field label="Full legal name" style={{ gridColumn: '1 / -1' }}>
                    <input
                      value={rpDraft.name}
                      onChange={(e) => setRpDraft((p) => ({ ...p, name: e.target.value }))}
                      placeholder="As shown on government ID"
                    />
                  </Field>

                  <Field label="Principal country of business">
                    <select value={rpDraft.country} onChange={(e) => setRpDraft((p) => ({ ...p, country: e.target.value }))}>
                      <option value="">— Select country —</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Country of tax residence">
                    <select value={rpDraft.country_residence} onChange={(e) => setRpDraft((p) => ({ ...p, country_residence: e.target.value }))}>
                      <option value="">— Select country —</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Country of citizenship">
                    <select value={rpDraft.country_citizenship} onChange={(e) => setRpDraft((p) => ({ ...p, country_citizenship: e.target.value }))}>
                      <option value="">— Select country —</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Foreign tax ID" hint="Required">
                    <input
                      value={rpDraft.foreign_tax_id}
                      onChange={(e) => setRpDraft((p) => ({ ...p, foreign_tax_id: e.target.value }))}
                      placeholder="e.g. ABCDE1234F"
                    />
                  </Field>

                  <Field label="Reference number" hint="Auto-derived">
                    <input
                      value={buildRelatedPartyRef(rpDraft.name, editingRpIdx ?? relatedParties.length)}
                      readOnly
                      style={{ background: 'var(--tf-offset, #f3f4f6)', color: 'var(--tf-text-muted, #6b7280)' }}
                    />
                  </Field>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <h4 style={{ ...sectionLabelStyle, marginBottom: '0.625rem' }}>Address</h4>
                  <AddressFields
                    value={rpDraft.address}
                    onChange={(a) => setRpDraft((p) => ({ ...p, address: a }))}
                  />
                </div>

                <div style={{ ...gridStyle, marginTop: '1rem' }}>
                  <Field label="Principal business activity">
                    <select
                      value={rpDraft.biz_activity}
                      onChange={(e) => {
                        const value = e.target.value;
                        const sel = BIZ_ACTIVITIES.find((a) => a.label === value);
                        setRpDraft((p) => ({ ...p, biz_activity: value, biz_code: sel ? sel.code : p.biz_code }));
                      }}
                    >
                      <option value="">— Select activity —</option>
                      {BIZ_ACTIVITIES.map((a) => (
                        <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>
                      ))}
                      <option value="other">Other — enter manually below</option>
                    </select>
                  </Field>

                  <Field label="Activity code">
                    <input
                      value={rpDraft.biz_code}
                      onChange={(e) => setRpDraft((p) => ({ ...p, biz_code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      placeholder="e.g. 541511"
                      inputMode="numeric"
                      maxLength={6}
                    />
                  </Field>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                  <button type="button" onClick={saveRpDraft} style={primaryBtnStyle}>
                    {editingRpIdx !== null ? 'Update party' : 'Add party'}
                  </button>
                  <button type="button" onClick={() => { setShowRpForm(false); setEditingRpIdx(null); }} style={secondaryBtnStyle}>
                    Cancel
                  </button>
                </div>
              </section>
            ) : (
              <button type="button" onClick={() => openRpForm()} style={addBtnStyle}>
                + Add related party
              </button>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 4 — Transactions
        ══════════════════════════════════════════════════════════════════ */}
        {step === 4 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 4 — Reportable Transactions</h2>
            <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              Add every monetary transaction between the LLC and a related party during the tax year.
              For loans, enter the <strong>year-end closing balance</strong>.
            </p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Add a transaction</h3>
              <div style={gridStyle}>

                {/* Related party selector (owner + additional) */}
                <Field label="Related party" style={{ gridColumn: '1 / -1' }}>
                  <select
                    value={txRelatedPartyIdx}
                    onChange={(e) => setTxRelatedPartyIdx(Number(e.target.value))}
                  >
                    {allPartyLabels.map((label, i) => (
                      <option key={i} value={i}>{label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Type">
                  <select
                    value={txType}
                    onChange={(e) => {
                      setTxType(e.target.value);
                      setTxIsRoyalty(false);
                    }}
                  >
                    {/* Group by Part */}
                    {(['IV', 'V', 'VI'] as const).map((part) => (
                      <optgroup key={part} label={`Part ${part}`}>
                        {TX_TYPES.filter((t) => t.part === part).map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                            {t.category === 2 ? ' ★' : t.category === 3 ? ' ★★' : ''}
                          </option>
                        ))}
                      </optgroup>
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

                <Field label={LOAN_TYPES.has(txType) ? 'Closing balance (USD)' : 'Amount (USD)'}>
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

                <Field label="Related-party NAICS" hint="Type of business of the related party" style={{ gridColumn: '1 / -1' }}>
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

                <Field label="Description" hint="Optional" style={{ gridColumn: '1 / -1' }}>
                  <input
                    value={txDesc}
                    onChange={(e) => setTxDesc(e.target.value)}
                    placeholder="Brief description"
                  />
                </Field>
              </div>

              {/* Category warning */}
              {txCategory === 2 && (
                <div style={{ ...infoBoxStyle, borderColor: '#fbbf24', color: '#92400e', background: '#fffbeb', marginTop: '0.875rem' }}>
                  <strong>Heads up:</strong> This transaction type may require the owner to file a US personal tax return. A CPA review is recommended.
                </div>
              )}
              {txCategory === 3 && (
                <div style={{ ...infoBoxStyle, borderColor: '#f87171', color: '#991b1b', background: '#fef2f2', marginTop: '0.875rem' }}>
                  <strong>CPA referral required:</strong> This transaction is too technical for DIY filing. We will flag this case for professional review.
                </div>
              )}
              {PART_VI_TYPES.has(txType) && (
                <p style={infoBoxStyle}>
                  Disclosed in <strong>Part VI statement</strong> — nonmonetary / less-than-FMV. Amount is optional.
                </p>
              )}

              <button type="button" onClick={addTransaction} style={addBtnStyle}>
                Add transaction
              </button>
            </section>

            {/* Transaction list */}
            {transactions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.5rem' }}>
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
                      <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>
                        {allPartyLabels[tx.related_party_index] ?? `Party ${tx.related_party_index}`}
                      </span>
                      {!LOAN_TYPES.has(tx.transaction_type) && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>
                          {tx.direction === 'received' ? 'received' : 'paid'}
                        </span>
                      )}
                      {tx.is_royalty && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>royalty</span>
                      )}
                      {tx.related_party_naics && tx.related_party_naics !== '__manual__' && (
                        <span style={{ fontSize: '0.72rem', color: '#0284c7', background: '#e0f2fe', padding: '0.1rem 0.4rem', borderRadius: '0.25rem', alignSelf: 'center' }}>
                          NAICS {tx.related_party_naics}
                        </span>
                      )}
                      {tx.description && (
                        <span style={{ color: 'var(--tf-text-muted, #6b7280)' }}>{tx.description}</span>
                      )}
                    </div>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7' }}>
                      ${Number(tx.amount_usd).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeTransaction(i)}
                      style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }}
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

        {/* ══════════════════════════════════════════════════════════════════
            STEP 5 — Review & Submit
        ══════════════════════════════════════════════════════════════════ */}
        {step === 5 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 5 — Review &amp; Submit</h2>

            {/* ── Filing timing / extension block ────────────────────────── */}
            {filingTiming.originalPassed && (
              <div style={warningBoxStyle}>
                {filingTiming.extendedPassed ? (
                  <>
                    <strong>Filing appears delayed.</strong> The original due date and the extended deadline for tax year {taxYear} have both passed.
                    This return will be filed late.
                  </>
                ) : (
                  <>
                    <strong>Original due date has passed.</strong> Was Form 7004 (extension) filed for tax year {taxYear}?
                  </>
                )}

                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="extensionFiled"
                      checked={extensionFiled === true}
                      onChange={() => setExtensionFiled(true)}
                    />
                    Yes, Form 7004 was filed
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="extensionFiled"
                      checked={extensionFiled === false}
                      onChange={() => setExtensionFiled(false)}
                    />
                    No extension was filed
                  </label>
                </div>

                {(extensionFiled === false || filingTiming.extendedPassed) && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={includeReasonableCause}
                        onChange={(e) => setIncludeReasonableCause(e.target.checked)}
                      />
                      Include a reasonable cause letter with the filing
                    </label>
                    <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#92400e' }}>
                      A reasonable cause statement may help reduce penalties for late filing. Recommended for all delayed returns.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── LLC ────────────────────────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="LLC name" value={llcName} />
                <SummaryRow label="EIN" value={ein} />
                <SummaryRow label="State of formation" value={US_STATES.find((s) => s.value === stateOfFormation)?.label ?? stateOfFormation} />
                <SummaryRow label="Tax year" value={taxYear} />
                <SummaryRow label="Total assets" value={totalAssets ? `$${Number(totalAssets).toLocaleString()}` : undefined} />
                <SummaryRow label="Date of incorporation" value={entityDOI} />
                <SummaryRow label="Principal country" value={COUNTRIES.find((c) => c.value === entityPrincipalCountry)?.label ?? entityPrincipalCountry} />
                <SummaryRow label="Business activity" value={resolveBizActivityLabel(entityBizActivity)} />
                <SummaryRow label="Activity code" value={entityBizCode} />
                <SummaryRow label="Mailing street" value={mailing.line1} />
                <SummaryRow label="Mailing city" value={mailing.city} />
                <SummaryRow label="Mailing state" value={US_STATES.find((s) => s.value === mailing.region)?.label ?? mailing.region} />
                <SummaryRow label="Mailing postal code" value={mailing.postal_code} />
                <SummaryRow label="Mailing country" value="United States" />
              </div>
            </section>

            {/* ── Primary owner ───────────────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Primary owner</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Full name" value={ownerName} />
                <SummaryRow label="Principal country of business" value={COUNTRIES.find((c) => c.value === ownerCountry)?.label ?? ownerCountry} />
                <SummaryRow label="Country of tax residence" value={COUNTRIES.find((c) => c.value === ownerCountryRes)?.label ?? ownerCountryRes} />
                <SummaryRow label="Citizenship" value={COUNTRIES.find((c) => c.value === ownerCountryCit)?.label ?? ownerCountryCit} />
                <SummaryRow label="US SSN" value={ownerSSN} />
                <SummaryRow label="Foreign tax ID" value={ownerForeignTaxId} />
                <SummaryRow label="Reference number" value={ownerRefNumber} />
                <SummaryRow label="Business activity" value={resolveBizActivityLabel(ownerBizActivity)} />
                <SummaryRow label="Activity code" value={ownerBizCode} />
                <SummaryRow label="Street" value={ownerAddress.line1} />
                <SummaryRow label="City" value={ownerAddress.city} />
                <SummaryRow
                  label="State / Region"
                  value={isUSCountry(ownerAddress.country)
                    ? US_STATES.find((s) => s.value === ownerAddress.region)?.label ?? ownerAddress.region
                    : ownerAddress.region}
                />
                <SummaryRow label="Postal code" value={ownerAddress.postal_code} />
                <SummaryRow label="Country" value={COUNTRIES.find((c) => c.value === ownerAddress.country)?.label ?? ownerAddress.country} />
              </div>
            </section>

            {/* ── Additional related parties ───────────────────────────────── */}
            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Additional related parties ({relatedParties.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {relatedParties.map((rp, i) => (
                    <div key={i} style={reviewGridStyle}>
                      <SummaryRow label="Name" value={rp.name} />
                      <SummaryRow label="Reference" value={rp.ref_number} />
                      <SummaryRow label="Principal country" value={COUNTRIES.find((c) => c.value === rp.country)?.label ?? rp.country} />
                      <SummaryRow label="Country of residence" value={COUNTRIES.find((c) => c.value === rp.country_residence)?.label ?? rp.country_residence} />
                      <SummaryRow label="Citizenship" value={COUNTRIES.find((c) => c.value === rp.country_citizenship)?.label ?? rp.country_citizenship} />
                      <SummaryRow label="Foreign tax ID" value={rp.foreign_tax_id} />
                      <SummaryRow label="Business activity" value={resolveBizActivityLabel(rp.biz_activity)} />
                      <SummaryRow label="Activity code" value={rp.biz_code} />
                      <SummaryRow label="Street" value={rp.address.line1} />
                      <SummaryRow label="City" value={rp.address.city} />
                      <SummaryRow
                        label="State / Region"
                        value={isUSCountry(rp.address.country)
                          ? US_STATES.find((s) => s.value === rp.address.region)?.label ?? rp.address.region
                          : rp.address.region}
                      />
                      <SummaryRow label="Postal code" value={rp.address.postal_code} />
                      <SummaryRow label="Country" value={COUNTRIES.find((c) => c.value === rp.address.country)?.label ?? rp.address.country} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Transactions ─────────────────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
              {transactions.length === 0 ? (
                <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem' }}>No transactions added yet.</p>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div>
                          <span style={{ fontWeight: 700 }}>
                            {TX_TYPES.find((t) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}
                          </span>
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)' }}>
                            → {allPartyLabels[tx.related_party_index] ?? `Party ${tx.related_party_index}`}
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7' }}>
                          ${Number(tx.amount_usd || 0).toLocaleString()}
                        </span>
                      </div>
                      <div style={reviewGridStyle}>
                        {!LOAN_TYPES.has(tx.transaction_type) && (
                          <SummaryRow label="Direction" value={tx.direction === 'received' ? 'LLC received' : 'LLC paid'} />
                        )}
                        <SummaryRow label="Date" value={tx.transaction_date} />
                        <SummaryRow label="Description" value={tx.description} />
                        {ROYALTY_TYPES.has(tx.transaction_type) && (
                          <SummaryRow label="Subtype" value={tx.is_royalty ? 'Royalty' : 'Rent'} />
                        )}
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

        {/* ── Navigation ───────────────────────────────────────────────────── */}
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
            <button type="button" onClick={handleBack} disabled={saving} style={secondaryBtnStyle}>
              Back
            </button>
          )}
          {step < 5 ? (
            <button type="button" onClick={handleNext} disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Saving…' : step === 4 ? 'Save & Review' : 'Save & Continue'}
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Submitting…' : 'Submit Intake'}
            </button>
          )}
        </div>

      </div>
    </>
  );
}

export default Intake;
