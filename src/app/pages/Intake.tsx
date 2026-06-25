// src/app/pages/Intake.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import {
  BIZ_ACTIVITIES,
  COUNTRIES,
  DIRECTION_TYPES,
  FILING_DUE_DATES,
  LOAN_TYPES,
  PART_V_TYPES,
  PART_VI_TYPES,
  REASONABLE_CAUSE_REASONS,
  RP_NAICS,
  STEP_LABELS,
  TAX_YEARS,
  TX_CATEGORIES,
  TX_TYPES,
  type IntakeStep,
  US_STATES,
} from './intake/constants';

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
  country: string;
  country_residence: string;
  country_citizenship: string;
  foreign_tax_id: string;
  address: Address;
  biz_activity: string;
  biz_code: string;
};

type TransactionRow = {
  id?: string;
  related_party_index: number;
  transaction_type: string;
  direction: 'paid' | 'received';
  amount_usd: string;
  description: string;
  transaction_date: string;
  related_party_naics?: string;
};

function formatEIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function isValidEIN(val: string): boolean {
  return /^\d{2}-\d{7}$/.test(val);
}

function isUSCountry(value?: string | null): boolean {
  return value === 'US' || value === 'United States';
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

function isAddressComplete(address: Address, forceUS?: boolean): boolean {
  if (!address.line1?.trim()) return false;
  if (!address.city?.trim()) return false;
  if (!address.region?.trim()) return false;
  if (!address.postal_code?.trim()) return false;
  if (!forceUS && !address.country?.trim()) return false;
  return true;
}

function buildTxSentence(sentence: string, partyName: string, amount: string): string {
  const partyLabel = partyName || 'the related party';
  const amtLabel = amount && Number(amount) > 0 ? `USD ${Number(amount).toLocaleString()}` : '';
  return sentence.replace('{party}', partyLabel).replace('{amount}', amtLabel);
}

function getStepOrder(show1b: boolean): IntakeStep[] {
  if (show1b) return [1, '1b', 2, 3, 4, 5];
  return [1, 2, 3, 4, 5];
}

function Field({
  label,
  hint,
  children,
  style,
  required,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  required?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text-muted, #6b7280)' }}>
        {label}
        {required && <span style={{ color: '#b91c1c', marginLeft: '0.2rem' }}>*</span>}
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
      <Field label="Street address" style={{ gridColumn: '1 / -1' }} required>
        <input placeholder="Street address" value={value.line1 ?? ''} onChange={(e) => set('line1', e.target.value)} />
      </Field>
      <Field label="City" required>
        <input placeholder="City" value={value.city ?? ''} onChange={(e) => set('city', e.target.value)} />
      </Field>
      <Field label="State / Region" required>
        {isUS ? (
          <select value={value.region ?? ''} onChange={(e) => set('region', e.target.value)}>
            <option value="">— Select state —</option>
            {US_STATES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        ) : (
          <input placeholder="State / Region" value={value.region ?? ''} onChange={(e) => set('region', e.target.value)} />
        )}
      </Field>
      <Field label="Postal code" required>
        <input placeholder="Postal code" value={value.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
      </Field>
      {!forceUS && (
        <Field label="Country" required>
          <select
            value={value.country ?? ''}
            onChange={(e) => {
              const nextCountry = e.target.value;
              const wasUS = isUSCountry(value.country);
              const nextIsUS = isUSCountry(nextCountry);
              onChange({ ...value, country: nextCountry, region: wasUS !== nextIsUS ? '' : value.region });
            }}
          >
            <option value="">— Select country —</option>
            {COUNTRIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
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
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-text-muted, #6b7280)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 500, color: value ? 'var(--tf-text, #111)' : 'var(--tf-text-muted, #9ca3af)' }}>
        {value || '—'}
      </div>
    </div>
  );
}

const stepHeadingStyle: React.CSSProperties = { fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' };
const stepSubheadStyle: React.CSSProperties = { fontSize: '0.9rem', color: 'var(--tf-text-muted, #6b7280)', marginBottom: '1.75rem', lineHeight: 1.55 };
const sectionStyle: React.CSSProperties = { marginBottom: '2rem' };
const sectionLabelStyle: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 700, color: 'var(--tf-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.875rem' };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' };
const reviewGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.625rem', padding: '1rem 1.25rem' };
const primaryBtnStyle: React.CSSProperties = { padding: '0.6rem 1.5rem', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '0.5rem', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' };
const secondaryBtnStyle: React.CSSProperties = { padding: '0.6rem 1.25rem', background: 'transparent', color: 'var(--tf-text, #111)', border: '1px solid var(--tf-border, #d1d5db)', borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer' };
const addBtnStyle: React.CSSProperties = { marginTop: '0.75rem', alignSelf: 'flex-start', padding: '0.4375rem 1rem', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' };
const infoBoxStyle: React.CSSProperties = { background: 'var(--tf-offset, #f9fafb)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.375rem', padding: '0.625rem 0.875rem', fontSize: '0.8125rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.75rem' };
const errorSummaryStyle: React.CSSProperties = { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '0.875rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' };
const groupedCardStyle: React.CSSProperties = { border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.625rem', background: 'var(--tf-surface, #fff)', overflow: 'hidden' };

export function Intake() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [localFilingId, setLocalFilingId] = useState<string | null>(params.get('filing_id'));
  const filingId = localFilingId ?? params.get('filing_id');

  const [taxYear, setTaxYear] = useState('2024');
  const today = new Date();
  const filingTiming = getFilingTimingStatus(taxYear, today);
  const show1b = filingTiming.originalPassed;
  const stepOrder = getStepOrder(show1b);

  const [step, setStep] = useState<IntakeStep>(() => {
    const raw = params.get('step');
    if (raw === '1b') return '1b';
    const s = Number(raw);
    return (s >= 1 && s <= 5 ? s : 1) as IntakeStep;
  });

  const [loadingFiling, setLoadingFiling] = useState(!!params.get('filing_id'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [einErr, setEinErr] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [rpErrors, setRpErrors] = useState<string[]>([]);
  const [txErrors, setTxErrors] = useState<string[]>([]);

  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [totalAssets, setTotalAssets] = useState('');
  const [entityDOI, setEntityDOI] = useState('');
  const [entityPrincipalCountry, setEntityPrincipalCountry] = useState('');
  const [mailing, setMailing] = useState<Address>({ country: 'US' });
  const [entityBizActivity, setEntityBizActivity] = useState('');
  const [entityBizCode, setEntityBizCode] = useState('');

  const [extensionFiled, setExtensionFiled] = useState<boolean | null>(null);
  const [includeReasonableCause, setIncludeReasonableCause] = useState(false);
  const [reasonableCauseReasons, setReasonableCauseReasons] = useState<string[]>([]);

  const [ownerName, setOwnerName] = useState('');
  const [ownerCountry, setOwnerCountry] = useState('');
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCit, setOwnerCountryCit] = useState('');
  const [ownerSSN, setOwnerSSN] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerRefNumber, setOwnerRefNumber] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});
  const [ownerBizActivity, setOwnerBizActivity] = useState('');
  const [ownerBizCode, setOwnerBizCode] = useState('');

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

  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [noTransactionsConfirmed, setNoTransactionsConfirmed] = useState(false);

  const [txRelatedPartyIdx, setTxRelatedPartyIdx] = useState(0);
  const [txType, setTxType] = useState('');
  const [txDir, setTxDir] = useState<'paid' | 'received'>('received');
  const [txAmt, setTxAmt] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState('');
  const [txRpNaics, setTxRpNaics] = useState('');

  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const allPartyLabels = [
    ownerName || 'Primary owner',
    ...relatedParties.map((rp, i) => rp.name || `Related party ${i + 1}`),
  ];

  const selectedTxMeta = TX_TYPES.find((t) => t.value === txType);
  const currentStepIdx = stepOrder.indexOf(step);

  const goToStepByIndex = (idx: number, nextFilingId?: string) => {
    const target = stepOrder[idx];
    if (target === undefined) return;

    setStep(target);

    const resolvedFilingId = nextFilingId ?? localFilingId ?? params.get('filing_id');
    const newParams = new URLSearchParams(params.toString());
    newParams.set('step', String(target));

    if (resolvedFilingId) {
      newParams.set('filing_id', resolvedFilingId);
    }

    navigate(`?${newParams.toString()}`, { replace: true });
  };

  useEffect(() => {
    if (step === '1b' && !show1b) {
      setStep(1);
    }
  }, [show1b, step]);

  useEffect(() => {
    const newParams = new URLSearchParams(params.toString());
    newParams.set('step', String(step));
    if (filingId) {
      newParams.set('filing_id', filingId);
    }
    navigate(`?${newParams.toString()}`, { replace: true });
  }, [step, filingId, navigate, params]);

  useEffect(() => {
    if (!filingId) {
      setLoadingFiling(false);
      return;
    }

    setLoadingFiling(true);

    (async () => {
      const { data: f, error: err } = await supabase.from('filings').select('*').eq('id', filingId).single();
      if (err || !f) {
        setLoadingFiling(false);
        return;
      }

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

      setExtensionFiled((f as any).extension_filed ?? null);
      setIncludeReasonableCause((f as any).include_reasonable_cause ?? false);
      setReasonableCauseReasons((f as any).reasonable_cause_reasons ?? []);

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

      setNoTransactionsConfirmed((f as any).no_transactions_confirmed ?? false);

      const { data: txns } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId)
        .order('created_at', { ascending: true });

      if (txns) {
        setTransactions(
          txns.map((t: any) => ({
            id: t.id,
            related_party_index: t.related_party_index ?? 0,
            transaction_type: t.transaction_type,
            direction: t.direction,
            amount_usd: String(t.amount_usd ?? ''),
            description: t.description ?? '',
            transaction_date: t.transaction_date ?? '',
            related_party_naics: t.related_party_naics ?? '',
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
        total_assets: totalAssets ? Number(totalAssets) : null,
        entity_date_of_incorporation: entityDOI.trim() || null,
        entity_principal_country: entityPrincipalCountry.trim() || null,
        mailing_address: mailing,
        entity_business_activity: entityBizActivity.trim() || null,
        entity_business_code: entityBizCode.trim() || null,
      };
    }

    if (step === '1b') {
      return {
        extension_filed: extensionFiled,
        include_reasonable_cause: includeReasonableCause,
        reasonable_cause_reasons: reasonableCauseReasons,
      };
    }

    if (step === 2) {
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
    }

    if (step === 3) {
      return {
        related_parties: relatedParties,
      };
    }

    if (step === 4) {
      return {
        no_transactions_confirmed: noTransactionsConfirmed,
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

  function validateStep1(): string[] {
    const errs: string[] = [];
    if (!llcName.trim()) errs.push('Enter the LLC / Corporation name.');
    if (!ein.trim()) errs.push('Enter the EIN.');
    if (ein.trim() && !isValidEIN(ein)) errs.push('Enter a valid EIN in XX-XXXXXXX format.');
    if (!stateOfFormation) errs.push('Select the state of formation.');
    if (!taxYear) errs.push('Select the tax year.');
    if (!entityDOI) errs.push('Enter the date of incorporation.');
    if (!entityPrincipalCountry) errs.push('Select the principal country where business is conducted.');
    if (!entityBizActivity) errs.push('Select the LLC principal business activity.');
    if (!entityBizCode.trim()) errs.push('Enter the LLC business activity code.');
    if (!isAddressComplete(mailing, true)) errs.push('Complete the LLC mailing address.');
    return errs;
  }

  function validateStep1b(): string[] {
    const errs: string[] = [];
    if (extensionFiled === null) errs.push('Please confirm whether Form 7004 (extension) was filed.');
    if (includeReasonableCause && reasonableCauseReasons.length === 0) {
      errs.push('Select at least one reason for the reasonable cause letter.');
    }
    return errs;
  }

  function validateStep2(): string[] {
    const errs: string[] = [];
    if (!ownerName.trim()) errs.push('Enter the owner full legal name.');
    if (!ownerCountry) errs.push('Select the owner principal country of business.');
    if (!ownerCountryRes) errs.push('Select the owner country of tax residence.');
    if (!ownerCountryCit) errs.push('Select the owner country of citizenship.');
    if (!ownerForeignTaxId.trim()) errs.push('Enter the owner foreign tax ID.');
    if (!ownerRefNumber.trim()) errs.push('Enter the owner reference number.');
    if (!ownerBizActivity) errs.push('Select the owner principal business activity.');
    if (!ownerBizCode.trim()) errs.push('Enter the owner activity code.');
    if (!isAddressComplete(ownerAddress, false)) errs.push('Complete the owner address.');
    return errs;
  }

  function validateRelatedPartyDraft(draft: RelatedParty): string[] {
    const errs: string[] = [];
    if (!draft.name.trim()) errs.push('Enter the related party full legal name.');
    if (!draft.country) errs.push('Select the related party principal country of business.');
    if (!draft.country_residence) errs.push('Select the related party country of tax residence.');
    if (!draft.country_citizenship) errs.push('Select the related party country of citizenship.');
    if (!draft.foreign_tax_id.trim()) errs.push('Enter the related party foreign tax ID.');
    if (!draft.ref_number.trim()) errs.push('Enter the related party reference number.');
    if (!draft.biz_activity) errs.push('Select the related party principal business activity.');
    if (!draft.biz_code.trim()) errs.push('Enter the related party activity code.');
    if (!isAddressComplete(draft.address, false)) errs.push('Complete the related party address.');
    return errs;
  }

  function validateTransactionDraft(): string[] {
    const errs: string[] = [];
    if (!txType) errs.push('Select a transaction type.');
    const meta = TX_TYPES.find((t) => t.value === txType);
    const isOptionalAmt = meta?.amountOptional || PART_V_TYPES.has(txType) || PART_VI_TYPES.has(txType);
    if (!isOptionalAmt) {
      if (!txAmt || Number(txAmt) <= 0) errs.push('Enter a valid amount in USD.');
    } else if (txAmt && Number(txAmt) < 0) {
      errs.push('Amount cannot be negative.');
    }
    if (LOAN_TYPES.has(txType) && !txAmt) errs.push('Enter the year-end closing balance for the loan.');
    return errs;
  }

  function validateCurrentStep(): string[] {
    if (step === 1) return validateStep1();
    if (step === '1b') return validateStep1b();
    if (step === 2) return validateStep2();
    if (step === 3) {
      if (showRpForm) return ['Finish or cancel the related party form before continuing.'];
      return [];
    }
    if (step === 4) {
      if (showRpForm) return ['Finish or cancel the related party form before continuing.'];
      if (transactions.length === 0 && !noTransactionsConfirmed) {
        return ['Confirm that the LLC had no reportable transactions this year, or add at least one.'];
      }
      return [];
    }
    return [];
  }

  const saveStep = async (): Promise<string | null> => {
    setSaving(true);
    setError(null);

    try {
      const patch = patchFromCurrentStep();

      if (!filingId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in');

        const { data, error: err } = await supabase
          .from('filings')
          .insert({ ...patch, user_id: user.id })
          .select('id')
          .single();

        if (err) throw err;

        const newId = data.id as string;
        setLocalFilingId(newId);
        return newId;
      }

      const { error: err } = await supabase.from('filings').update(patch).eq('id', filingId);
      if (err) throw err;

      return filingId;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveTransactions = async (idOverride?: string): Promise<boolean> => {
    const activeFilingId = idOverride ?? filingId;
    if (!activeFilingId) return false;

    setError(null);

    try {
      const validTxns = transactions.filter(
        (t) =>
          PART_V_TYPES.has(t.transaction_type) ||
          PART_VI_TYPES.has(t.transaction_type) ||
          (t.amount_usd && Number(t.amount_usd) > 0),
      );

      if (validTxns.length === 0) return true;

      const toInsert = validTxns
        .filter((t) => !t.id)
        .map((t) => ({
          filing_id: activeFilingId,
          related_party_index: t.related_party_index,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: t.amount_usd ? Number(t.amount_usd) : null,
          description: t.description || null,
          transaction_date: t.transaction_date || null,
          related_party_naics: t.related_party_naics || null,
        }));

      const toUpsert = validTxns
        .filter((t) => !!t.id)
        .map((t) => ({
          id: t.id!,
          filing_id: activeFilingId,
          related_party_index: t.related_party_index,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: t.amount_usd ? Number(t.amount_usd) : null,
          description: t.description || null,
          transaction_date: t.transaction_date || null,
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
    const errs = validateCurrentStep();
    setStepErrors(errs);

    if (step === 1 && ein && !isValidEIN(ein)) {
      setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
    }

    if (errs.length > 0) return;

    const nextIdx = currentStepIdx + 1;
    if (nextIdx >= stepOrder.length) return;

    if (step !== 4) {
      const id = await saveStep();
      if (!id) return;

      if (!filingId) {
        setLocalFilingId(id);
      }

      goToStepByIndex(nextIdx, id);
      return;
    }

    const ensuredId = filingId ?? (await saveStep());
    if (!ensuredId) return;

    if (!filingId) {
      setLocalFilingId(ensuredId);
    }

    const saved = await saveTransactions(ensuredId);
    if (!saved) return;

    goToStepByIndex(nextIdx, ensuredId);
  };

  const handleBack = () => {
    setStepErrors([]);
    const prevIdx = currentStepIdx - 1;
    if (prevIdx >= 0) goToStepByIndex(prevIdx);
  };

  const handleSubmit = async () => {
    const errs = validateCurrentStep();
    setStepErrors(errs);

    if (errs.length > 0) return;

    if (!filingId) {
      setError('Missing filing ID. Please go back one step and save again.');
      return;
    }

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

  const openRpForm = (idx?: number) => {
    setRpErrors([]);
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
    const errs = validateRelatedPartyDraft(rpDraft);
    setRpErrors(errs);
    if (errs.length > 0) return;

    const updated = { ...rpDraft };
    if (editingRpIdx !== null) {
      setRelatedParties((prev) => prev.map((rp, i) => (i === editingRpIdx ? updated : rp)));
    } else {
      setRelatedParties((prev) => [...prev, updated]);
    }

    setShowRpForm(false);
    setEditingRpIdx(null);
    setRpErrors([]);
  };

  const removeRp = (i: number) => {
    setRelatedParties((prev) => prev.filter((_, idx) => idx !== i));
    setTransactions((prev) =>
      prev
        .filter((t) => t.related_party_index !== i + 1)
        .map((t) => ({
          ...t,
          related_party_index: t.related_party_index > i + 1 ? t.related_party_index - 1 : t.related_party_index,
        })),
    );
  };

  const addTransaction = () => {
    const errs = validateTransactionDraft();
    setTxErrors(errs);
    if (errs.length > 0) return;

    setTransactions((prev) => [
      ...prev,
      {
        related_party_index: txRelatedPartyIdx,
        transaction_type: txType,
        direction: txDir,
        amount_usd: txAmt,
        description: txDesc,
        transaction_date: txDate,
        related_party_naics: txRpNaics,
      },
    ]);

    setTxAmt('');
    setTxDesc('');
    setTxDate('');
    setTxRpNaics('');
    setTxType('');
    setOpenCategory(null);
    setTxErrors([]);
    setStepErrors([]);
    setNoTransactionsConfirmed(false);
  };

  const removeTransaction = (i: number) => {
    setTransactions((prev) => prev.filter((_, idx) => idx !== i));
  };

  if (loadingFiling) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '3rem 1rem', textAlign: 'center', color: 'var(--tf-text-muted, #6b7280)' }}>
        Loading…
      </div>
    );
  }

  const visibleSteps = stepOrder;

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
        .intake-form input[data-invalid="true"],
        .intake-form select[data-invalid="true"] {
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.15);
        }
        .intake-form .field-error { font-size: 0.78rem; color: #dc2626; margin-top: 0.25rem; }
        .intake-form select option { background: var(--tf-surface, #fff); color: var(--tf-text, #111); }
        .stepper-track {
          display: inline-flex; align-items: center;
          background: #f1f5f9; border-radius: 2rem;
          padding: 0.25rem; gap: 0; margin-bottom: 2rem;
          flex-wrap: nowrap; overflow-x: auto; max-width: 100%;
        }
        .stepper-pill {
          display: flex; align-items: center; gap: 0.35rem;
          padding: 0.35rem 0.9rem; border-radius: 2rem;
          font-size: 0.8125rem; font-weight: 500;
          white-space: nowrap; border: none; background: transparent;
          transition: background 0.15s, color 0.15s; line-height: 1;
        }
        .stepper-pill--active { background: #0284c7; color: #fff; font-weight: 700; cursor: default; box-shadow: 0 1px 4px rgba(2,132,199,0.25); }
        .stepper-pill--done { background: #e0f2fe; color: #0369a1; font-weight: 600; cursor: pointer; }
        .stepper-pill--done:hover { background: #bae6fd; }
        .stepper-pill--pending { color: #94a3b8; cursor: default; opacity: 0.6; }
        .stepper-check { display: inline-flex; align-items: center; justify-content: center; width: 1rem; height: 1rem; border-radius: 50%; background: #0369a1; color: #fff; font-size: 0.6rem; font-weight: 800; line-height: 1; flex-shrink: 0; }
        .tx-cat-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.875rem 1rem; cursor: pointer; user-select: none;
          background: var(--tf-surface, #fff);
          transition: background 0.12s;
        }
        .tx-cat-header:hover { background: #f8fafc; }
        .tx-cat-header.is-open { background: #f0f9ff; }
        .tx-cat-chevron {
          width: 1.25rem; height: 1.25rem; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: var(--tf-text-muted, #6b7280);
          transition: transform 0.2s;
        }
        .tx-cat-chevron.is-open { transform: rotate(180deg); }
        .tx-cat-body {
          border-top: 1px solid var(--tf-border, #e5e7eb);
          padding: 0.875rem; background: #fafbfc;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.5rem;
        }
        .tx-type-card {
          text-align: left; border: 1px solid var(--tf-border, #d1d5db);
          border-radius: 0.5rem; padding: 0.75rem 0.875rem;
          background: var(--tf-surface, #fff); cursor: pointer; width: 100%;
          transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
        }
        .tx-type-card:hover { border-color: #93c5fd; background: #f8fafc; }
        .tx-type-card.is-selected {
          border-color: #0284c7;
          box-shadow: 0 0 0 3px rgba(2,132,199,0.12);
          background: #eff6ff;
        }
        .tx-type-label { font-weight: 600; font-size: 0.9rem; color: var(--tf-text, #111); }
        .tx-type-sentence { display: block; margin-top: 0.25rem; font-size: 0.8125rem; color: var(--tf-text-muted, #6b7280); line-height: 1.45; }
        .rc-reason {
          display: flex; gap: 0.75rem; align-items: flex-start;
          padding: 0.75rem 1rem;
          border: 1px solid var(--tf-border, #e5e7eb);
          border-radius: 0.5rem; cursor: pointer;
          background: var(--tf-surface, #fff);
          transition: border-color 0.12s, background 0.12s;
        }
        .rc-reason:hover { border-color: #93c5fd; background: #f8fafc; }
        .rc-reason.is-checked { border-color: #0284c7; background: #eff6ff; }
        .rc-reason input[type="checkbox"] {
          width: 1.1rem !important; height: 1.1rem !important;
          flex-shrink: 0; margin-top: 0.15rem;
          accent-color: #0284c7;
          padding: 0 !important; border: none !important;
          box-shadow: none !important;
        }
        .rc-reason-label { font-weight: 600; font-size: 0.9rem; color: var(--tf-text, #111); }
        .rc-reason-hint { font-size: 0.8rem; color: var(--tf-text-muted, #6b7280); margin-top: 0.15rem; line-height: 1.4; }
        .confirm-check-row {
          display: flex; gap: 0.75rem; align-items: flex-start;
          padding: 1rem 1.25rem;
          background: #fffbeb; border: 1px solid #fbbf24; border-radius: 0.5rem;
          margin-top: 1.25rem;
        }
        .confirm-check-row input[type="checkbox"] {
          width: 1.1rem !important; height: 1.1rem !important;
          flex-shrink: 0; margin-top: 0.15rem;
          accent-color: #d97706;
          padding: 0 !important; border: none !important;
          box-shadow: none !important;
        }
        @media (prefers-color-scheme: dark) {
          .stepper-track { background: rgba(255,255,255,0.10); }
          .stepper-pill--done { background: rgba(255,255,255,0.12); color: #7dd3fc; }
          .stepper-pill--done:hover { background: rgba(255,255,255,0.18); }
          .stepper-check { background: #0ea5e9; }
          .tx-cat-header.is-open { background: rgba(2,132,199,0.12); }
          .tx-type-card.is-selected { background: rgba(2,132,199,0.12); }
          .rc-reason.is-checked { background: rgba(2,132,199,0.12); }
        }
      `}</style>

      <div className="intake-form" style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>
        <nav aria-label="Form steps">
          <div className="stepper-track">
            {visibleSteps.map((s, idx) => {
              const isDone = idx < currentStepIdx;
              const isActive = s === step;
              const isPending = idx > currentStepIdx;
              const label = STEP_LABELS[String(s)];
              const shortLabel = s === '1b' ? 'Filing Status' : label;
              return (
                <button
                  key={String(s)}
                  type="button"
                  className={[
                    'stepper-pill',
                    isActive ? 'stepper-pill--active' : '',
                    isDone ? 'stepper-pill--done' : '',
                    isPending ? 'stepper-pill--pending' : '',
                  ].join(' ')}
                  onClick={() => {
                    if (isDone) goToStepByIndex(idx);
                  }}
                  aria-current={isActive ? 'step' : undefined}
                  tabIndex={isDone ? 0 : -1}
                >
                  {isDone && <span className="stepper-check" aria-hidden="true">✓</span>}
                  {typeof s === 'number' ? `${s}. ` : ''}
                  {shortLabel}
                </button>
              );
            })}
          </div>
        </nav>

        {error && <div style={errorSummaryStyle}>{error}</div>}

        {stepErrors.length > 0 && (
          <div style={errorSummaryStyle}>
            <div style={{ fontWeight: 700, marginBottom: '0.45rem' }}>Please complete the following before continuing:</div>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {stepErrors.map((msg, i) => (
                <li key={i} style={{ marginBottom: '0.25rem' }}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={stepHeadingStyle}>Your LLC details</h2>
            <p style={stepSubheadStyle}>Basic information about the US company. This goes on the pro forma 1120 and all Form 5472 filings.</p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company information</h3>
              <div style={gridStyle}>
                <Field label="LLC / Corporation name" style={{ gridColumn: '1 / -1' }} required>
                  <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" />
                </Field>
                <Field label="EIN" hint="Employer Identification Number" required>
                  <input
                    value={ein}
                    onChange={(e) => {
                      setEin(formatEIN(e.target.value));
                      setEinErr(null);
                    }}
                    onBlur={handleEinBlur}
                    placeholder="XX-XXXXXXX"
                    data-invalid={einErr ? 'true' : undefined}
                    inputMode="numeric"
                    maxLength={10}
                  />
                  {einErr && <span className="field-error">{einErr}</span>}
                </Field>
                <Field label="State of formation" required>
                  <select value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)}>
                    <option value="">— Select state —</option>
                    {US_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Tax year" required>
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
                    {TAX_YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </Field>
                <Field label="Total assets at year-end" hint="USD">
                  <input type="number" min="0" value={totalAssets} onChange={(e) => setTotalAssets(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Date of incorporation" required>
                  <input type="date" value={entityDOI} onChange={(e) => setEntityDOI(e.target.value)} />
                </Field>
                <Field label="Country where business is primarily conducted" required>
                  <select value={entityPrincipalCountry} onChange={(e) => setEntityPrincipalCountry(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>What does the LLC do?</h3>
              <div style={gridStyle}>
                <Field label="Primary business activity" required>
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
                    {BIZ_ACTIVITIES.map((a) => <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>)}
                    <option value="other">Other — enter manually below</option>
                  </select>
                </Field>
                <Field label="Business activity code" hint="Auto-filled or enter 6-digit code" required>
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

        {step === '1b' && (
          <div>
            <h2 style={stepHeadingStyle}>Filing status &amp; late penalties</h2>
            <p style={stepSubheadStyle}>
              The original due date for the {taxYear} tax year has passed.
              {filingTiming.extendedPassed
                ? ' Both the original and extended deadlines have now passed — this return will be filed late.'
                : ' Answer a few quick questions so we can handle this correctly.'}
            </p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Was an extension filed?</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--tf-text-muted, #6b7280)', marginBottom: '0.875rem', lineHeight: 1.5 }}>
                Form 7004 is an extension request that gives the LLC an extra 6 months to file.
                If one was filed on time, the extended deadline applies.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {[
                  {
                    val: true,
                    label: 'Yes — Form 7004 was filed on time',
                    sub: filingTiming.extendedPassed ? 'The extended deadline has also passed.' : 'The extended deadline applies.',
                  },
                  {
                    val: false,
                    label: 'No — no extension was filed',
                    sub: 'The original deadline applied. This return is late.',
                  },
                ].map(({ val, label, sub }) => (
                  <label
                    key={String(val)}
                    style={{
                      display: 'flex',
                      gap: '0.75rem',
                      alignItems: 'flex-start',
                      padding: '0.875rem 1rem',
                      border: `1px solid ${extensionFiled === val ? '#0284c7' : 'var(--tf-border, #e5e7eb)'}`,
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      background: extensionFiled === val ? '#eff6ff' : 'var(--tf-surface, #fff)',
                      transition: 'border-color 0.12s, background 0.12s',
                    }}
                  >
                    <input
                      type="radio"
                      name="extensionFiled"
                      checked={extensionFiled === val}
                      onChange={() => setExtensionFiled(val)}
                      style={{ marginTop: '0.15rem', accentColor: '#0284c7', width: '1.1rem', height: '1.1rem', flexShrink: 0, padding: 0, border: 'none', boxShadow: 'none' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{label}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.15rem' }}>{sub}</div>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            {(extensionFiled === false || filingTiming.extendedPassed) && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Penalty relief — reasonable cause letter</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--tf-text-muted, #6b7280)', marginBottom: '1rem', lineHeight: 1.55 }}>
                  The IRS charges a <strong>$25,000 penalty per year</strong> for late Form 5472 filings. A reasonable cause letter explains why the filing was late and asks the IRS to reduce or waive the penalty. It does not guarantee relief, but is strongly recommended for late returns.
                </p>

                <label
                  style={{
                    display: 'flex',
                    gap: '0.75rem',
                    alignItems: 'flex-start',
                    padding: '0.875rem 1rem',
                    marginBottom: '1.25rem',
                    border: `1px solid ${includeReasonableCause ? '#0284c7' : 'var(--tf-border, #e5e7eb)'}`,
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    background: includeReasonableCause ? '#eff6ff' : 'var(--tf-surface, #fff)',
                    transition: 'border-color 0.12s, background 0.12s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeReasonableCause}
                    onChange={(e) => {
                      setIncludeReasonableCause(e.target.checked);
                      if (!e.target.checked) setReasonableCauseReasons([]);
                    }}
                    style={{ marginTop: '0.15rem', accentColor: '#0284c7', width: '1.1rem', height: '1.1rem', flexShrink: 0, padding: 0, border: 'none', boxShadow: 'none' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Include a reasonable cause letter (+$200)</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.15rem' }}>Drafted by a CPA and submitted with your filing. Recommended for all late returns.</div>
                  </div>
                </label>

                {includeReasonableCause && (
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--tf-text, #111)' }}>
                      Which of these apply to your situation? <span style={{ fontWeight: 400, color: 'var(--tf-text-muted, #6b7280)' }}>Select all that are true.</span>
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {REASONABLE_CAUSE_REASONS.map((reason) => {
                        const isChecked = reasonableCauseReasons.includes(reason.value);
                        return (
                          <label
                            key={reason.value}
                            className={`rc-reason${isChecked ? ' is-checked' : ''}`}
                            onClick={() => {
                              setReasonableCauseReasons((prev) =>
                                isChecked ? prev.filter((r) => r !== reason.value) : [...prev, reason.value],
                              );
                            }}
                          >
                            <input type="checkbox" checked={isChecked} onChange={() => {}} />
                            <div>
                              <div className="rc-reason-label">{reason.label}</div>
                              <div className="rc-reason-hint">{reason.hint}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={stepHeadingStyle}>Foreign owner details</h2>
            <p style={stepSubheadStyle}>The individual or entity that owns 25% or more of this LLC. This information goes on Form 5472, Part II.</p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Identity</h3>
              <div style={gridStyle}>
                <Field label="Full legal name" hint="As shown on government ID" style={{ gridColumn: '1 / -1' }} required>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="As shown on government ID" />
                </Field>
                <Field label="Country where owner primarily does business" required>
                  <select value={ownerCountry} onChange={(e) => setOwnerCountry(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Country of tax residence" required>
                  <select value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Country of citizenship" required>
                  <select value={ownerCountryCit} onChange={(e) => setOwnerCountryCit(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="US SSN or ITIN" hint="If you have one">
                  <input value={ownerSSN} onChange={(e) => setOwnerSSN(e.target.value)} placeholder="XXX-XX-XXXX" inputMode="numeric" />
                </Field>
                <Field label="Foreign tax ID" hint="e.g. PAN, TIN, passport number" required>
                  <input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="e.g. ABCDE1234F" />
                </Field>
                <Field label="Reference number" hint="Used internally on Form 5472" required>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input value={ownerRefNumber} onChange={(e) => setOwnerRefNumber(e.target.value)} placeholder="e.g. CHI001" />
                    <button type="button" style={{ ...secondaryBtnStyle, padding: '0.5rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => setOwnerRefNumber(buildOwnerRef(ownerName))}>Auto-fill</button>
                  </div>
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner&apos;s address</h3>
              <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner&apos;s primary business activity</h3>
              <div style={gridStyle}>
                <Field label="Activity" required>
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
                    {BIZ_ACTIVITIES.map((a) => <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>)}
                    <option value="other">Other — enter manually below</option>
                  </select>
                </Field>
                <Field label="Activity code" hint="Auto-filled or enter manually" required>
                  <input value={ownerBizCode} onChange={(e) => setOwnerBizCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="e.g. 541511" inputMode="numeric" maxLength={6} />
                </Field>
              </div>
            </section>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={stepHeadingStyle}>Additional related parties</h2>
            <p style={stepSubheadStyle}>
              If the LLC had transactions with other related foreign entities or individuals (besides the primary owner), add them here. Each one requires a separate Form 5472. Most single-owner LLCs can skip this step.
            </p>

            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Added so far ({relatedParties.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {relatedParties.map((rp, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0.875rem', background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600 }}>{rp.name || `Related party ${i + 1}`}</span>
                        {rp.country && <span style={{ color: 'var(--tf-text-muted, #6b7280)', marginLeft: '0.5rem', fontSize: '0.8rem' }}>{COUNTRIES.find((c) => c.value === rp.country)?.label ?? rp.country}</span>}
                        {rp.ref_number && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>{rp.ref_number}</span>}
                      </div>
                      <button type="button" onClick={() => openRpForm(i)} style={{ ...secondaryBtnStyle, padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>Edit</button>
                      <button type="button" onClick={() => removeRp(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }} aria-label="Remove">×</button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {showRpForm ? (
              <section style={{ ...sectionStyle, background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.625rem', padding: '1.25rem' }}>
                <h3 style={sectionLabelStyle}>{editingRpIdx !== null ? 'Edit related party' : 'Add related party'}</h3>

                {rpErrors.length > 0 && (
                  <div style={errorSummaryStyle}>
                    <div style={{ fontWeight: 700, marginBottom: '0.45rem' }}>Please complete the following:</div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {rpErrors.map((msg, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{msg}</li>)}
                    </ul>
                  </div>
                )}

                <div style={gridStyle}>
                  <Field label="Full legal name" style={{ gridColumn: '1 / -1' }} required>
                    <input value={rpDraft.name} onChange={(e) => setRpDraft((p) => ({ ...p, name: e.target.value }))} placeholder="As shown on government ID" />
                  </Field>
                  <Field label="Country of business" required>
                    <select value={rpDraft.country} onChange={(e) => setRpDraft((p) => ({ ...p, country: e.target.value }))}>
                      <option value="">— Select country —</option>
                      {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Country of tax residence" required>
                    <select value={rpDraft.country_residence} onChange={(e) => setRpDraft((p) => ({ ...p, country_residence: e.target.value }))}>
                      <option value="">— Select country —</option>
                      {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Country of citizenship" required>
                    <select value={rpDraft.country_citizenship} onChange={(e) => setRpDraft((p) => ({ ...p, country_citizenship: e.target.value }))}>
                      <option value="">— Select country —</option>
                      {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Foreign tax ID" required>
                    <input value={rpDraft.foreign_tax_id} onChange={(e) => setRpDraft((p) => ({ ...p, foreign_tax_id: e.target.value }))} placeholder="e.g. ABCDE1234F" />
                  </Field>
                  <Field label="Reference number" required>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input value={rpDraft.ref_number} onChange={(e) => setRpDraft((p) => ({ ...p, ref_number: e.target.value }))} placeholder="e.g. REL002" />
                      <button type="button" style={{ ...secondaryBtnStyle, padding: '0.5rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => setRpDraft((p) => ({ ...p, ref_number: buildRelatedPartyRef(p.name, editingRpIdx ?? relatedParties.length) }))}>Auto-fill</button>
                    </div>
                  </Field>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <h4 style={{ ...sectionLabelStyle, marginBottom: '0.625rem' }}>Address</h4>
                  <AddressFields value={rpDraft.address} onChange={(a) => setRpDraft((p) => ({ ...p, address: a }))} />
                </div>

                <div style={{ ...gridStyle, marginTop: '1rem' }}>
                  <Field label="Primary business activity" required>
                    <select
                      value={rpDraft.biz_activity}
                      onChange={(e) => {
                        const value = e.target.value;
                        const sel = BIZ_ACTIVITIES.find((a) => a.label === value);
                        setRpDraft((p) => ({ ...p, biz_activity: value, biz_code: sel ? sel.code : p.biz_code }));
                      }}
                    >
                      <option value="">— Select activity —</option>
                      {BIZ_ACTIVITIES.map((a) => <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>)}
                      <option value="other">Other — enter manually below</option>
                    </select>
                  </Field>
                  <Field label="Activity code" required>
                    <input value={rpDraft.biz_code} onChange={(e) => setRpDraft((p) => ({ ...p, biz_code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="e.g. 541511" inputMode="numeric" maxLength={6} />
                  </Field>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                  <button type="button" onClick={saveRpDraft} style={primaryBtnStyle}>{editingRpIdx !== null ? 'Update' : 'Add party'}</button>
                  <button type="button" onClick={() => { setShowRpForm(false); setEditingRpIdx(null); setRpErrors([]); }} style={secondaryBtnStyle}>Cancel</button>
                </div>
              </section>
            ) : (
              <button type="button" onClick={() => openRpForm()} style={addBtnStyle}>+ Add related party</button>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 style={stepHeadingStyle}>Reportable transactions</h2>
            <p style={stepSubheadStyle}>
              List every money flow between the LLC and its related parties during {taxYear}. Pick a category, then choose the specific type.
            </p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Who was this transaction with?</h3>
              <Field label="Related party" required>
                <select value={txRelatedPartyIdx} onChange={(e) => setTxRelatedPartyIdx(Number(e.target.value))}>
                  {allPartyLabels.map((label, i) => <option key={i} value={i}>{label}</option>)}
                </select>
              </Field>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>What kind of transaction was it?</h3>
              {txErrors.some((e) => e.includes('transaction type')) && (
                <div style={{ ...errorSummaryStyle, marginBottom: '0.75rem' }}>Select a transaction type below.</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {TX_CATEGORIES.map((cat) => {
                  const isOpen = openCategory === cat.key;
                  const typesInCat = TX_TYPES.filter((t) => cat.values.includes(t.value));
                  const hasSelection = typesInCat.some((t) => t.value === txType);

                  return (
                    <div key={cat.key} style={{ ...groupedCardStyle, borderColor: hasSelection ? '#0284c7' : 'var(--tf-border, #e5e7eb)' }}>
                      <div
                        className={`tx-cat-header${isOpen ? ' is-open' : ''}`}
                        onClick={() => setOpenCategory(isOpen ? null : cat.key)}
                        role="button"
                        aria-expanded={isOpen}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text, #111)' }}>{cat.label}</span>
                            {hasSelection && (
                              <span style={{ fontSize: '0.72rem', background: '#0284c7', color: '#fff', padding: '0.1rem 0.45rem', borderRadius: '1rem', fontWeight: 700 }}>Selected</span>
                            )}
                            {(cat.key === 'structural' || cat.key === 'nonmonetary' || cat.key === 'complex') && (
                              <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#92400e', padding: '0.1rem 0.45rem', borderRadius: '1rem', fontWeight: 600 }}>CPA review recommended</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.2rem' }}>{cat.description}</div>
                        </div>
                        <svg className={`tx-cat-chevron${isOpen ? ' is-open' : ''}`} viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </div>

                      {isOpen && (
                        <div className="tx-cat-body">
                          {typesInCat.map((item) => {
                            const partyName = allPartyLabels[txRelatedPartyIdx] || 'the related party';
                            const previewSentence = item.sentence
                              .replace('{party}', partyName)
                              .replace('{amount}', txAmt ? `USD ${Number(txAmt).toLocaleString()}` : '…');

                            return (
                              <button
                                key={item.value}
                                type="button"
                                className={`tx-type-card${txType === item.value ? ' is-selected' : ''}`}
                                onClick={() => {
                                  setTxType(item.value);
                                  setTxErrors([]);
                                  if (!DIRECTION_TYPES.has(item.value)) setTxDir('received');
                                }}
                              >
                                <span className="tx-type-label">{item.label}</span>
                                <span className="tx-type-sentence">{previewSentence}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {txType && (
              <section style={{ ...sectionStyle, background: '#f8fafc', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.625rem', padding: '1.25rem' }}>
                <h3 style={{ ...sectionLabelStyle, marginBottom: '0.75rem' }}>Transaction details</h3>

                {txErrors.length > 0 && (
                  <div style={{ ...errorSummaryStyle, marginBottom: '0.875rem' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Fix the following:</div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {txErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                    </ul>
                  </div>
                )}

                {selectedTxMeta && (
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.9rem', color: '#1e40af', lineHeight: 1.55 }}>
                    <strong>Summary:</strong> {buildTxSentence(selectedTxMeta.sentence, allPartyLabels[txRelatedPartyIdx] || '', txAmt)}
                    {txAmt && Number(txAmt) > 0 && ` — USD ${Number(txAmt).toLocaleString()}`}
                    {selectedTxMeta.showDirection && txAmt && ` (${txDir === 'received' ? 'received by LLC' : 'paid by LLC'})`}
                  </div>
                )}

                <div style={gridStyle}>
                  {selectedTxMeta?.showDirection && (
                    <Field label="Who paid?" required>
                      <select value={txDir} onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')}>
                        <option value="received">LLC received the money</option>
                        <option value="paid">LLC paid the money</option>
                      </select>
                    </Field>
                  )}

                  <Field
                    label={selectedTxMeta?.amountLabel ?? 'Amount (USD)'}
                    hint={selectedTxMeta?.amountOptional ? 'Optional' : selectedTxMeta?.amountHint}
                    required={!selectedTxMeta?.amountOptional && !PART_V_TYPES.has(txType) && !PART_VI_TYPES.has(txType)}
                  >
                    <input type="number" min="0" value={txAmt} onChange={(e) => setTxAmt(e.target.value)} placeholder="0" />
                    {selectedTxMeta?.amountHint && <span style={{ fontSize: '0.78rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.2rem' }}>{selectedTxMeta.amountHint}</span>}
                  </Field>

                  <Field label="Date" hint="Optional">
                    <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                  </Field>

                  {!PART_V_TYPES.has(txType) && (
                    <Field label="What type of business is the related party?" hint="Optional" style={{ gridColumn: '1 / -1' }}>
                      <select value={txRpNaics} onChange={(e) => setTxRpNaics(e.target.value)}>
                        <option value="">— Select (optional) —</option>
                        {RP_NAICS.map((n) => <option key={`${n.code}-${n.label}`} value={n.code}>{n.label} — {n.hint}</option>)}
                        <option value="__manual__">Other</option>
                      </select>
                    </Field>
                  )}

                  <Field label="Notes" hint="Optional" style={{ gridColumn: '1 / -1' }}>
                    <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Brief description or reference" />
                  </Field>
                </div>

                {PART_VI_TYPES.has(txType) && (
                  <div style={{ ...infoBoxStyle, marginTop: '0.75rem', background: '#fefce8', borderColor: '#fde68a', color: '#92400e' }}>
                    This is a <strong>Part VI</strong> disclosure — a non-cash or below-market-value transaction. The amount is optional.
                  </div>
                )}

                <button type="button" onClick={addTransaction} style={{ ...addBtnStyle, marginTop: '1.25rem' }}>
                  Add this transaction
                </button>
              </section>
            )}

            {transactions.length > 0 && (
              <section style={{ marginTop: '1.5rem' }}>
                <h3 style={sectionLabelStyle}>Transactions added ({transactions.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {transactions.map((tx, i) => {
                    const meta = TX_TYPES.find((t) => t.value === tx.transaction_type);
                    const partyName = allPartyLabels[tx.related_party_index] ?? `Party ${tx.related_party_index}`;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0.875rem', background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.5rem', fontSize: '0.875rem' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600 }}>{meta?.label ?? tx.transaction_type}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.1rem' }}>
                            {meta ? buildTxSentence(meta.sentence, partyName, tx.amount_usd) : partyName}
                            {tx.description ? ` · ${tx.description}` : ''}
                          </div>
                        </div>
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7', flexShrink: 0 }}>
                          {tx.amount_usd ? `$${Number(tx.amount_usd).toLocaleString()}` : '—'}
                        </span>
                        <button type="button" onClick={() => removeTransaction(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }} aria-label="Remove">×</button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {transactions.length === 0 && (
              <label className="confirm-check-row">
                <input type="checkbox" checked={noTransactionsConfirmed} onChange={(e) => setNoTransactionsConfirmed(e.target.checked)} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#92400e' }}>
                    The LLC had no reportable transactions with any related party in {taxYear}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#a16207', marginTop: '0.2rem', lineHeight: 1.45 }}>
                    This typically applies to dormant LLCs. Form 5472 is still required even with no transactions — only the header information is filed.
                  </div>
                </div>
              </label>
            )}
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 style={stepHeadingStyle}>Review &amp; submit</h2>
            <p style={stepSubheadStyle}>Check everything below before submitting. You can go back to any step using the navigation above.</p>

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
              </div>
            </section>

            {show1b && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Filing status</h3>
                <div style={reviewGridStyle}>
                  <SummaryRow label="Form 7004 filed?" value={extensionFiled === true ? 'Yes' : extensionFiled === false ? 'No' : '—'} />
                  <SummaryRow label="Reasonable cause letter?" value={includeReasonableCause ? `Yes — ${reasonableCauseReasons.length} reason(s) selected` : 'No'} />
                </div>
              </section>
            )}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Primary owner</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Full name" value={ownerName} />
                <SummaryRow label="Country of business" value={COUNTRIES.find((c) => c.value === ownerCountry)?.label ?? ownerCountry} />
                <SummaryRow label="Country of tax residence" value={COUNTRIES.find((c) => c.value === ownerCountryRes)?.label ?? ownerCountryRes} />
                <SummaryRow label="Citizenship" value={COUNTRIES.find((c) => c.value === ownerCountryCit)?.label ?? ownerCountryCit} />
                <SummaryRow label="US SSN / ITIN" value={ownerSSN} />
                <SummaryRow label="Foreign tax ID" value={ownerForeignTaxId} />
                <SummaryRow label="Reference number" value={ownerRefNumber} />
                <SummaryRow label="Business activity" value={resolveBizActivityLabel(ownerBizActivity)} />
                <SummaryRow label="Activity code" value={ownerBizCode} />
                <SummaryRow label="Street" value={ownerAddress.line1} />
                <SummaryRow label="City" value={ownerAddress.city} />
                <SummaryRow label="State / Region" value={isUSCountry(ownerAddress.country) ? US_STATES.find((s) => s.value === ownerAddress.region)?.label ?? ownerAddress.region : ownerAddress.region} />
                <SummaryRow label="Postal code" value={ownerAddress.postal_code} />
                <SummaryRow label="Country" value={COUNTRIES.find((c) => c.value === ownerAddress.country)?.label ?? ownerAddress.country} />
              </div>
            </section>

            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Additional related parties ({relatedParties.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {relatedParties.map((rp, i) => (
                    <div key={i} style={reviewGridStyle}>
                      <SummaryRow label="Name" value={rp.name} />
                      <SummaryRow label="Reference" value={rp.ref_number} />
                      <SummaryRow label="Country" value={COUNTRIES.find((c) => c.value === rp.country)?.label ?? rp.country} />
                      <SummaryRow label="Tax residence" value={COUNTRIES.find((c) => c.value === rp.country_residence)?.label ?? rp.country_residence} />
                      <SummaryRow label="Citizenship" value={COUNTRIES.find((c) => c.value === rp.country_citizenship)?.label ?? rp.country_citizenship} />
                      <SummaryRow label="Foreign tax ID" value={rp.foreign_tax_id} />
                      <SummaryRow label="Business activity" value={resolveBizActivityLabel(rp.biz_activity)} />
                      <SummaryRow label="Activity code" value={rp.biz_code} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
              {transactions.length === 0 ? (
                <div style={{ ...infoBoxStyle, background: '#fffbeb', borderColor: '#fbbf24', color: '#92400e' }}>
                  No reportable transactions — confirmed by you. The filing will include only header information.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {transactions.map((tx, i) => {
                    const meta = TX_TYPES.find((t) => t.value === tx.transaction_type);
                    const partyName = allPartyLabels[tx.related_party_index] ?? `Party ${tx.related_party_index}`;
                    return (
                      <div key={i} style={{ background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.5rem', padding: '0.875rem 1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{meta?.label ?? tx.transaction_type}</div>
                            <div style={{ fontSize: '0.825rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.2rem' }}>
                              {meta ? buildTxSentence(meta.sentence, partyName, tx.amount_usd) : ''}
                            </div>
                          </div>
                          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7', flexShrink: 0 }}>
                            {tx.amount_usd ? `$${Number(tx.amount_usd || 0).toLocaleString()}` : '—'}
                          </span>
                        </div>
                        <div style={reviewGridStyle}>
                          {meta?.showDirection && <SummaryRow label="Direction" value={tx.direction === 'received' ? 'LLC received' : 'LLC paid'} />}
                          <SummaryRow label="Date" value={tx.transaction_date} />
                          <SummaryRow label="Notes" value={tx.description} />
                          {tx.related_party_naics && tx.related_party_naics !== '__manual__' && (
                            <SummaryRow label="Related party NAICS" value={tx.related_party_naics} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1.5rem', borderTop: '1px solid var(--tf-border, #e5e7eb)', marginTop: '1.5rem' }}>
          {currentStepIdx > 0 && (
            <button type="button" onClick={handleBack} disabled={saving} style={secondaryBtnStyle}>Back</button>
          )}
          {step !== 5 ? (
            <button type="button" onClick={handleNext} disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Saving…' : step === 4 ? 'Save & Review' : 'Save & Continue'}
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={saving} style={primaryBtnStyle}>
              {saving ? 'Submitting…' : 'Submit intake'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default Intake;
