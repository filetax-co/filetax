// src/app/pages/Intake.tsx
import React, { useEffect, useMemo, useState } from 'react';
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
  STEP_LABELS,
  TAX_YEARS,
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

type TxUiGroup = {
  label: string;
  items: Array<{
    value: string;
    label: string;
    category: number;
    part?: string;
  }>;
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

function isAddressComplete(address: Address, forceUS?: boolean): boolean {
  if (!address.line1?.trim()) return false;
  if (!address.city?.trim()) return false;
  if (!address.region?.trim()) return false;
  if (!address.postal_code?.trim()) return false;
  if (!forceUS && !address.country?.trim()) return false;
  return true;
}

function classifyTxLabel(label: string): number {
  const text = label.toLowerCase();
  if (
    text.includes('cost sharing') ||
    text.includes('platform contribution') ||
    text.includes('intangible') ||
    text.includes('insurance') ||
    text.includes('reinsurance') ||
    text.includes('guarantee') ||
    text.includes('other amounts') ||
    text.includes('other amount')
  ) {
    return 3;
  }
  if (
    text.includes('service') ||
    text.includes('technical') ||
    text.includes('managerial') ||
    text.includes('engineering') ||
    text.includes('scientific') ||
    text.includes('commission') ||
    text.includes('rent') ||
    text.includes('royalt') ||
    text.includes('interest') ||
    text.includes('loan') ||
    text.includes('inventory') ||
    text.includes('stock in trade') ||
    text.includes('sale') ||
    text.includes('borrowed') ||
    text.includes('amounts loaned')
  ) {
    return 2;
  }
  return 1;
}

function groupLabelForTx(label: string): string {
  const text = label.toLowerCase();
  if (
    text.includes('stock in trade') ||
    text.includes('inventory') ||
    text.includes('tangible property') ||
    text.includes('property')
  ) {
    return 'Goods and property';
  }
  if (
    text.includes('service') ||
    text.includes('technical') ||
    text.includes('managerial') ||
    text.includes('engineering') ||
    text.includes('scientific') ||
    text.includes('commission')
  ) {
    return 'Services and commissions';
  }
  if (text.includes('rent') || text.includes('royalt') || text.includes('interest')) {
    return 'Rent, royalty, and interest';
  }
  if (text.includes('loan') || text.includes('borrowed') || text.includes('amounts loaned')) {
    return 'Loans';
  }
  return 'Special or complex items';
}

function getTxCategory(meta?: { category?: number; label?: string }): number {
  if (typeof meta?.category === 'number') return meta.category;
  return classifyTxLabel(meta?.label ?? '');
}

function getTxMessage(category: number): { tone: 'neutral' | 'warning' | 'error'; title: string; body: string } {
  if (category === 1) {
    return {
      tone: 'neutral',
      title: 'Usually workable for self-service',
      body: 'This is generally a simpler transaction type. Complete the details carefully and continue.',
    };
  }
  if (category === 2) {
    return {
      tone: 'warning',
      title: 'May need personal tax review',
      body: 'This transaction may require owner-level US tax review. CPA review is recommended before filing.',
    };
  }
  return {
    tone: 'error',
    title: 'CPA referral required',
    body: 'This transaction is too technical for DIY filing and should be referred to a CPA.',
  };
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '0.75rem',
      }}
    >
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
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
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

const errorSummaryStyle: React.CSSProperties = {
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: '0.5rem',
  padding: '0.875rem 1rem',
  marginBottom: '1rem',
  fontSize: '0.875rem',
};

const groupedCardStyle: React.CSSProperties = {
  border: '1px solid var(--tf-border, #e5e7eb)',
  borderRadius: '0.625rem',
  background: 'var(--tf-surface, #fff)',
  padding: '0.875rem',
};

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
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [rpErrors, setRpErrors] = useState<string[]>([]);
  const [txErrors, setTxErrors] = useState<string[]>([]);

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
  const [txRelatedPartyIdx, setTxRelatedPartyIdx] = useState(0);
  const [txType, setTxType] = useState(() => TX_TYPES[0]?.value ?? '');
  const [txDir, setTxDir] = useState<'paid' | 'received'>('received');
  const [txAmt, setTxAmt] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState('');
  const [txRpNaics, setTxRpNaics] = useState('');

  const [extensionFiled, setExtensionFiled] = useState<boolean | null>(null);
  const [includeReasonableCause, setIncludeReasonableCause] = useState(false);

  const today = new Date();
  const filingTiming = getFilingTimingStatus(taxYear, today);

  const allPartyLabels = [
    ownerName || 'Primary owner',
    ...relatedParties.map((rp, i) => rp.name || `Related party ${i + 1}`),
  ];

  const txTypeMeta = TX_TYPES.find((t: any) => t.value === txType);
  const txCategory = getTxCategory(txTypeMeta as any);
  const txMessage = getTxMessage(txCategory);

  const txUiGroups: TxUiGroup[] = useMemo(() => {
    const buckets = new Map<string, TxUiGroup>();
    TX_TYPES.forEach((t: any) => {
      const label = groupLabelForTx(t.label ?? t.value ?? 'Transaction');
      if (!buckets.has(label)) buckets.set(label, { label, items: [] });
      buckets.get(label)!.items.push({
        value: t.value,
        label: t.label,
        category: getTxCategory(t),
        part: t.part,
      });
    });
    return Array.from(buckets.values());
  }, []);

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

  const handleEinBlur = () => {
    if (ein && !isValidEIN(ein)) setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
    else setEinErr(null);
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
    if (txRelatedPartyIdx < 0 || txRelatedPartyIdx >= allPartyLabels.length) errs.push('Select a related party.');
    if (!txType) errs.push('Select a transaction type.');
    if (!PART_VI_TYPES.has(txType)) {
      if (!txAmt || Number(txAmt) <= 0) errs.push('Enter a valid transaction amount.');
    } else if (txAmt && Number(txAmt) < 0) {
      errs.push('Amount cannot be negative.');
    }
    if (LOAN_TYPES.has(txType) && !txAmt) errs.push('Enter the year-end closing balance for the loan.');
    return errs;
  }

  function validateCurrentStep(): string[] {
    if (step === 1) return validateStep1();
    if (step === 2) return validateStep2();
    if (step === 3) {
      if (showRpForm) return ['Finish or cancel the related party form before continuing.'];
      return [];
    }
    if (step === 4) {
      const errs: string[] = [];
      if (showRpForm) errs.push('Finish or cancel the related party form before continuing.');
      if (transactions.length === 0) errs.push('Add at least one reportable transaction before continuing.');
      return errs;
    }
    if (step === 5) {
      if (filingTiming.originalPassed && extensionFiled === null) return ['Please indicate whether Form 7004 was filed.'];
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

  const saveTransactions = async (): Promise<boolean> => {
    if (!filingId) return false;
    setError(null);
    try {
      const validTxns = transactions.filter(
        (t) => PART_VI_TYPES.has(t.transaction_type) || (t.amount_usd && Number(t.amount_usd) > 0),
      );
      if (validTxns.length === 0) return true;

      const toInsert = validTxns
        .filter((t) => !t.id)
        .map((t) => ({
          filing_id: filingId,
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
          filing_id: filingId,
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

    if (step < 4) {
      const id = await saveStep();
      if (id) {
        const nextStep = (step + 1) as IntakeStep;
        setStep(nextStep);
        const newParams = new URLSearchParams(params.toString());
        newParams.set('filing_id', id);
        newParams.set('step', String(nextStep));
        navigate(`?${newParams.toString()}`, { replace: true });
      }
    } else if (step === 4) {
      const ensuredId = filingId ?? (await saveStep());
      if (!ensuredId) return;
      if (!filingId) setLocalFilingId(ensuredId);
      const saved = await saveTransactions();
      if (saved) {
        setStep(5);
        const newParams = new URLSearchParams(params.toString());
        newParams.set('filing_id', ensuredId);
        newParams.set('step', '5');
        navigate(`?${newParams.toString()}`, { replace: true });
      }
    }
  };

  const handleBack = () => {
    setStepErrors([]);
    setStep((s) => Math.max(1, s - 1) as IntakeStep);
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
    setTxErrors([]);
    setStepErrors([]);
  };

  const removeTransaction = (i: number) => {
    setTransactions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    const errs = validateCurrentStep();
    setStepErrors(errs);
    if (errs.length > 0 || !filingId) return;

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
        .intake-form input[data-invalid="true"],
        .intake-form select[data-invalid="true"],
        .intake-form textarea[data-invalid="true"] {
          border-color: #dc2626;
          box-shadow: 0 0 0 3px rgba(220,38,38,0.15);
        }
        .intake-form .field-error { font-size: 0.78rem; color: #dc2626; margin-top: 0.25rem; }
        .intake-form select option { background: var(--tf-surface, #fff); color: var(--tf-text, #111); }
        .stepper-track { display: inline-flex; align-items: center; background: #f1f5f9; border-radius: 2rem; padding: 0.25rem; gap: 0; margin-bottom: 2rem; flex-wrap: nowrap; overflow-x: auto; max-width: 100%; }
        .stepper-pill { display: flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.9rem; border-radius: 2rem; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; border: none; background: transparent; transition: background 0.15s, color 0.15s; line-height: 1; }
        .stepper-pill--active { background: #0284c7; color: #fff; font-weight: 700; cursor: default; box-shadow: 0 1px 4px rgba(2,132,199,0.25); }
        .stepper-pill--done { background: #e0f2fe; color: #0369a1; font-weight: 600; cursor: pointer; }
        .stepper-pill--done:hover { background: #bae6fd; }
        .stepper-pill--pending { color: #94a3b8; cursor: default; opacity: 0.6; }
        .stepper-check { display: inline-flex; align-items: center; justify-content: center; width: 1rem; height: 1rem; border-radius: 50%; background: #0369a1; color: #fff; font-size: 0.6rem; font-weight: 800; line-height: 1; flex-shrink: 0; }
        .tx-choice { text-align: left; border: 1px solid var(--tf-border, #d1d5db); border-radius: 0.5rem; padding: 0.65rem 0.75rem; background: var(--tf-surface, #fff); cursor: pointer; width: 100%; }
        .tx-choice.active { border-color: #0284c7; box-shadow: 0 0 0 3px rgba(2,132,199,0.12); background: #f0f9ff; }
        .tx-choice small { display: block; margin-top: 0.2rem; color: var(--tf-text-muted, #6b7280); }
        @media (prefers-color-scheme: dark) {
          .stepper-track { background: rgba(255,255,255,0.10); }
          .stepper-pill--done { background: rgba(255,255,255,0.12); color: #7dd3fc; }
          .stepper-pill--done:hover { background: rgba(255,255,255,0.18); }
          .stepper-check { background: #0ea5e9; }
          .tx-choice.active { background: rgba(2,132,199,0.12); }
        }
      `}</style>

      <div className="intake-form" style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>
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
            <h2 style={stepHeadingStyle}>Step 1 — LLC Details</h2>
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company information</h3>
              <div style={gridStyle}>
                <Field label="LLC / Corporation name" style={{ gridColumn: '1 / -1' }} required>
                  <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" />
                </Field>
                <Field label="EIN" hint="Employer Identification Number" required>
                  <input value={ein} onChange={(e) => { setEin(formatEIN(e.target.value)); setEinErr(null); }} onBlur={handleEinBlur} placeholder="XX-XXXXXXX" data-invalid={einErr ? 'true' : undefined} inputMode="numeric" maxLength={10} />
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
                <Field label="Total assets at year end" hint="USD, as of last day of tax year">
                  <input type="number" min="0" value={totalAssets} onChange={(e) => setTotalAssets(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Date of incorporation" required>
                  <input type="date" value={entityDOI} onChange={(e) => setEntityDOI(e.target.value)} />
                </Field>
                <Field label="Principal country where business is conducted" required>
                  <select value={entityPrincipalCountry} onChange={(e) => setEntityPrincipalCountry(e.target.value)}>
                    <option value="">— Select country —</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
              </div>
            </section>
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Principal business activity</h3>
              <div style={gridStyle}>
                <Field label="Activity" hint="What does the LLC primarily do?" required>
                  <select value={entityBizActivity} onChange={(e) => { const value = e.target.value; const sel = BIZ_ACTIVITIES.find((a) => a.label === value); setEntityBizActivity(value); setEntityBizCode(sel ? sel.code : ''); }}>
                    <option value="">— Select activity —</option>
                    {BIZ_ACTIVITIES.map((a) => <option key={`${a.code}-${a.label}`} value={a.label}>{a.label}</option>)}
                    <option value="other">Other — enter manually below</option>
                  </select>
                </Field>
                <Field label="Business activity code" hint="Auto-filled or enter manually" required>
                  <input value={entityBizCode} onChange={(e) => setEntityBizCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="e.g. 541511" inputMode="numeric" maxLength={6} />
                </Field>
              </div>
            </section>
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC mailing address (US)</h3>
              <AddressFields value={mailing} onChange={setMailing} forceUS />
            </section>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 2 — Foreign Owner Details</h2>
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Identity</h3>
              <div style={gridStyle}>
                <Field label="Full legal name" hint="As shown on government ID" style={{ gridColumn: '1 / -1' }} required>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="As shown on government ID" />
                </Field>
                <Field label="Principal country of business" hint="Country where owner primarily operates" required>
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
                <Field label="US SSN" hint="If applicable">
                  <input value={ownerSSN} onChange={(e) => setOwnerSSN(e.target.value)} placeholder="XXX-XX-XXXX" inputMode="numeric" />
                </Field>
                <Field label="Foreign tax ID" hint="PAN, TIN, etc. — required" required>
                  <input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="e.g. ABCDE1234F" />
                </Field>
                <Field label="Owner reference number" hint="Manually editable" required>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input value={ownerRefNumber} onChange={(e) => setOwnerRefNumber(e.target.value)} placeholder="e.g. CHI001" />
                    <button type="button" style={{ ...secondaryBtnStyle, padding: '0.5rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => setOwnerRefNumber(buildOwnerRef(ownerName))}>Auto-fill</button>
                  </div>
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
                <Field label="Activity" hint="Owner's primary business" required>
                  <select value={ownerBizActivity} onChange={(e) => { const value = e.target.value; const sel = BIZ_ACTIVITIES.find((a) => a.label === value); setOwnerBizActivity(value); setOwnerBizCode(sel ? sel.code : ''); }}>
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
            <h2 style={stepHeadingStyle}>Step 3 — Additional Related Parties</h2>
            <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              Each additional related party that had reportable transactions with the LLC requires a separate Form 5472. The primary owner is already included from Step 2.
            </p>
            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Additional related parties ({relatedParties.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {relatedParties.map((rp, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0.875rem', background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600 }}>{rp.name || `Related party ${i + 1}`}</span>
                        {rp.country && <span style={{ color: 'var(--tf-text-muted, #6b7280)', marginLeft: '0.5rem', fontSize: '0.8rem' }}>{COUNTRIES.find((c) => c.value === rp.country)?.label ?? rp.country}</span>}
                        {rp.ref_number && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' }}>{rp.ref_number}</span>}
                      </div>
                      <button type="button" onClick={() => openRpForm(i)} style={{ ...secondaryBtnStyle, padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>Edit</button>
                      <button type="button" onClick={() => removeRp(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }} aria-label="Remove related party">×</button>
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
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{rpErrors.map((msg, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{msg}</li>)}</ul>
                  </div>
                )}
                <div style={gridStyle}>
                  <Field label="Full legal name" style={{ gridColumn: '1 / -1' }} required>
                    <input value={rpDraft.name} onChange={(e) => setRpDraft((p) => ({ ...p, name: e.target.value }))} placeholder="As shown on government ID" />
                  </Field>
                  <Field label="Principal country of business" required>
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
                  <Field label="Foreign tax ID" hint="Required" required>
                    <input value={rpDraft.foreign_tax_id} onChange={(e) => setRpDraft((p) => ({ ...p, foreign_tax_id: e.target.value }))} placeholder="e.g. ABCDE1234F" />
                  </Field>
                  <Field label="Reference number" hint="Manually editable" required>
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
                  <Field label="Principal business activity" required>
                    <select value={rpDraft.biz_activity} onChange={(e) => { const value = e.target.value; const sel = BIZ_ACTIVITIES.find((a) => a.label === value); setRpDraft((p) => ({ ...p, biz_activity: value, biz_code: sel ? sel.code : p.biz_code })); }}>
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
                  <button type="button" onClick={saveRpDraft} style={primaryBtnStyle}>{editingRpIdx !== null ? 'Update party' : 'Add party'}</button>
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
            <h2 style={stepHeadingStyle}>Step 4 — Reportable Transactions</h2>
            <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.55 }}>
              Select the transaction from a plain-language list first. We will then show any review note and ask for the remaining details.
            </p>
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Add a transaction</h3>
              {txErrors.length > 0 && (
                <div style={errorSummaryStyle}>
                  <div style={{ fontWeight: 700, marginBottom: '0.45rem' }}>Please complete the following:</div>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{txErrors.map((msg, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{msg}</li>)}</ul>
                </div>
              )}
              <div style={{ ...gridStyle, marginBottom: '1rem' }}>
                <Field label="Related party" style={{ gridColumn: '1 / -1' }} required>
                  <select value={txRelatedPartyIdx} onChange={(e) => setTxRelatedPartyIdx(Number(e.target.value))}>
                    {allPartyLabels.map((label, i) => <option key={i} value={i}>{label}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                {txUiGroups.map((group) => (
                  <div key={group.label} style={groupedCardStyle}>
                    <div style={{ ...sectionLabelStyle, marginBottom: '0.75rem' }}>{group.label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
                      {group.items.map((item) => {
                        const msg = getTxMessage(item.category);
                        return (
                          <button key={item.value} type="button" className={`tx-choice ${txType === item.value ? 'active' : ''}`} onClick={() => { setTxType(item.value); setTxErrors([]); }}>
                            <span style={{ fontWeight: 600 }}>{item.label}</span>
                            <small>{msg.title}{item.part ? ` · Part ${item.part}` : ''}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ ...infoBoxStyle, marginTop: '1rem', borderColor: txMessage.tone === 'warning' ? '#fbbf24' : txMessage.tone === 'error' ? '#fca5a5' : '#bfdbfe', background: txMessage.tone === 'warning' ? '#fffbeb' : txMessage.tone === 'error' ? '#fef2f2' : '#eff6ff', color: txMessage.tone === 'warning' ? '#92400e' : txMessage.tone === 'error' ? '#991b1b' : '#1d4ed8' }}>
                <strong>{txMessage.title}:</strong> {txMessage.body}
              </div>
              <div style={{ ...gridStyle, marginTop: '1rem' }}>
                {!LOAN_TYPES.has(txType) && (
                  <Field label="Direction" required>
                    <select value={txDir} onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')}>
                      <option value="received">LLC received</option>
                      <option value="paid">LLC paid</option>
                    </select>
                  </Field>
                )}
                <Field label={LOAN_TYPES.has(txType) ? 'Closing balance (USD)' : 'Amount (USD)'} hint={PART_VI_TYPES.has(txType) ? 'Optional for Part VI' : undefined} required={!PART_VI_TYPES.has(txType)}>
                  <input type="number" min="0" value={txAmt} onChange={(e) => setTxAmt(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Date" hint="Optional">
                  <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                </Field>
                <Field label="Related-party NAICS" hint="Type of business of the related party" style={{ gridColumn: '1 / -1' }}>
                  <select value={txRpNaics} onChange={(e) => setTxRpNaics(e.target.value)}>
                    <option value="">— Select NAICS (optional) —</option>
                    {RP_NAICS.map((n) => <option key={`${n.code}-${n.label}`} value={n.code}>{n.code} — {n.label} ({n.hint})</option>)}
                    <option value="__manual__">Other — enter code manually</option>
                  </select>
                </Field>
                <Field label="Description" hint="Optional" style={{ gridColumn: '1 / -1' }}>
                  <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Brief description" />
                </Field>
              </div>
              {PART_VI_TYPES.has(txType) && <p style={infoBoxStyle}>Disclosed in <strong>Part VI statement</strong> — nonmonetary or less-than-fair-market-value transaction. Amount can be left blank if not applicable.</p>}
              <button type="button" onClick={addTransaction} style={addBtnStyle}>Add transaction</button>
            </section>
            {transactions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.5rem' }}>
                {transactions.map((tx, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.875rem', background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.5rem', fontSize: '0.875rem' }}>
                    <div style={{ flex: 1, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{TX_TYPES.find((t: any) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}</span>
                      <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>{allPartyLabels[tx.related_party_index] ?? `Party ${tx.related_party_index}`}</span>
                      {!LOAN_TYPES.has(tx.transaction_type) && <span style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.75rem', alignSelf: 'center' }}>{tx.direction === 'received' ? 'received' : 'paid'}</span>}
                      {tx.related_party_naics && tx.related_party_naics !== '__manual__' && <span style={{ fontSize: '0.72rem', color: '#0284c7', background: '#e0f2fe', padding: '0.1rem 0.4rem', borderRadius: '0.25rem', alignSelf: 'center' }}>NAICS {tx.related_party_naics}</span>}
                      {tx.description && <span style={{ color: 'var(--tf-text-muted, #6b7280)' }}>{tx.description}</span>}
                    </div>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7' }}>{tx.amount_usd ? `$${Number(tx.amount_usd).toLocaleString()}` : '—'}</span>
                    <button type="button" onClick={() => removeTransaction(i)} style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: '1.125rem', cursor: 'pointer', padding: '0 0.25rem', lineHeight: 1 }} aria-label="Remove transaction">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 style={stepHeadingStyle}>Step 5 — Review &amp; Submit</h2>
            {filingTiming.originalPassed && (
              <div style={warningBoxStyle}>
                {filingTiming.extendedPassed ? (
                  <><strong>Filing appears delayed.</strong> The original due date and the extended deadline for tax year {taxYear} have both passed. This return will be filed late.</>
                ) : (
                  <><strong>Original due date has passed.</strong> Was Form 7004 (extension) filed for tax year {taxYear}?</>
                )}
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500, cursor: 'pointer' }}><input type="radio" name="extensionFiled" checked={extensionFiled === true} onChange={() => setExtensionFiled(true)} />Yes, Form 7004 was filed</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500, cursor: 'pointer' }}><input type="radio" name="extensionFiled" checked={extensionFiled === false} onChange={() => setExtensionFiled(false)} />No extension was filed</label>
                </div>
                {(extensionFiled === false || filingTiming.extendedPassed) && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500, cursor: 'pointer' }}><input type="checkbox" checked={includeReasonableCause} onChange={(e) => setIncludeReasonableCause(e.target.checked)} />Include a reasonable cause letter with the filing</label>
                    <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#92400e' }}>A reasonable cause statement may help reduce penalties for late filing. Recommended for delayed returns.</p>
                  </div>
                )}
              </div>
            )}
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
                      <SummaryRow label="Principal country" value={COUNTRIES.find((c) => c.value === rp.country)?.label ?? rp.country} />
                      <SummaryRow label="Country of residence" value={COUNTRIES.find((c) => c.value === rp.country_residence)?.label ?? rp.country_residence} />
                      <SummaryRow label="Citizenship" value={COUNTRIES.find((c) => c.value === rp.country_citizenship)?.label ?? rp.country_citizenship} />
                      <SummaryRow label="Foreign tax ID" value={rp.foreign_tax_id} />
                      <SummaryRow label="Business activity" value={resolveBizActivityLabel(rp.biz_activity)} />
                      <SummaryRow label="Activity code" value={rp.biz_code} />
                      <SummaryRow label="Street" value={rp.address.line1} />
                      <SummaryRow label="City" value={rp.address.city} />
                      <SummaryRow label="State / Region" value={isUSCountry(rp.address.country) ? US_STATES.find((s) => s.value === rp.address.region)?.label ?? rp.address.region : rp.address.region} />
                      <SummaryRow label="Postal code" value={rp.address.postal_code} />
                      <SummaryRow label="Country" value={COUNTRIES.find((c) => c.value === rp.address.country)?.label ?? rp.address.country} />
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
              {transactions.length === 0 ? (
                <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.875rem' }}>No transactions added yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {transactions.map((tx, i) => (
                    <div key={i} style={{ background: 'var(--tf-surface, #fff)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.5rem', padding: '0.875rem 1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div>
                          <span style={{ fontWeight: 700 }}>{TX_TYPES.find((t: any) => t.value === tx.transaction_type)?.label ?? tx.transaction_type}</span>
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)' }}>→ {allPartyLabels[tx.related_party_index] ?? `Party ${tx.related_party_index}`}</span>
                        </div>
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#0284c7' }}>{tx.amount_usd ? `$${Number(tx.amount_usd || 0).toLocaleString()}` : '—'}</span>
                      </div>
                      <div style={reviewGridStyle}>
                        {!LOAN_TYPES.has(tx.transaction_type) && <SummaryRow label="Direction" value={tx.direction === 'received' ? 'LLC received' : 'LLC paid'} />}
                        <SummaryRow label="Date" value={tx.transaction_date} />
                        <SummaryRow label="Description" value={tx.description} />
                        <SummaryRow label="Related-party NAICS" value={tx.related_party_naics === '__manual__' ? 'Manual entry' : tx.related_party_naics} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1.5rem', borderTop: '1px solid var(--tf-border, #e5e7eb)', marginTop: '1.5rem' }}>
          {step > 1 && <button type="button" onClick={handleBack} disabled={saving} style={secondaryBtnStyle}>Back</button>}
          {step < 5 ? (
            <button type="button" onClick={handleNext} disabled={saving} style={primaryBtnStyle}>{saving ? 'Saving…' : step === 4 ? 'Save & Review' : 'Save & Continue'}</button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={saving} style={primaryBtnStyle}>{saving ? 'Submitting…' : 'Submit Intake'}</button>
          )}
        </div>
      </div>
    </>
  );
}

export default Intake;
