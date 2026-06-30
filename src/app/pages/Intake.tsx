// src/app/pages/Intake.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import { mapTransactionForPersist, summarizeTransactions } from '../../lib/filingMapping';
import { loadProfile, saveProfileFromFiling } from '../../lib/filingProfile';
import {
  BIZ_ACTIVITIES,
  COUNTRIES,
  DETAILED_TX_GROUPS,
  DIRECTION_TYPES,
  FILING_DUE_DATES,
  LOAN_TYPES,
  PART_V_TYPES,
  PART_VI_TYPES,
  REASONABLE_CAUSE_REASONS,
  RP_NAICS,
  SIMPLE_TX,
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
  us_tin?: string;
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
  /** Beginning-of-year balance for loan rows (Form 5472 lines 17a / 31a). */
  loan_begin_usd?: string;
  description: string;
  transaction_date: string;
};

function formatEIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function isValidEIN(val: string): boolean {
  return /^\d{2}-\d{7}$/.test(val);
}

/**
 * An initial (first-ever) return is one where the LLC was formed during the
 * tax year being filed. Drives the Form 5472 / 1120 "Initial return" checkbox
 * and the short-year begin date.
 */
function isInitialReturn(doiISO: string, taxYear: string): boolean {
  if (!doiISO) return false;
  const y = Number(doiISO.slice(0, 4));
  return y > 0 && y === Number(taxYear);
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


function getStepOrder(show1b: boolean): IntakeStep[] {
  if (show1b) return [1, '1b', 2, 3, 4, 5];
  return [1, 2, 3, 4, 5];
}

function getCategoryForTxType(txType: string): 1 | 2 | 3 | null {
  const found = TX_TYPES.find((t) => t.value === txType);
  return found ? found.category : null;
}

/**
 * Accessible info tooltip — a small "i" the user can hover OR click/focus to
 * reveal a plain-language hint. Click/focus toggles it so it works on touch and
 * for keyboard users (not hover-only). Uses --tf-* tokens so it adapts to dark
 * mode. The popover is a sibling positioned relative to the trigger.
 */
function InfoTooltip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        aria-label={label ?? 'More information'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        style={{
          width: '15px', height: '15px', borderRadius: '9999px',
          border: '1px solid var(--tf-border)', background: 'var(--tf-offset)',
          color: 'var(--tf-muted)', fontSize: '10px', fontWeight: 700,
          lineHeight: 1, cursor: 'pointer', padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginLeft: '0.35rem',
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
            width: 'max-content', maxWidth: '260px', zIndex: 20,
            background: 'var(--tf-text)', color: 'var(--tf-surface)',
            fontSize: '0.75rem', fontWeight: 400, lineHeight: 1.5,
            padding: '0.5rem 0.625rem', borderRadius: '0.375rem',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)', textTransform: 'none', letterSpacing: 'normal',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

function Field({
  label,
  hint,
  children,
  style,
  required,
  tooltip,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  required?: boolean;
  /** Optional plain-language hint shown behind a clickable (i) icon. */
  tooltip?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-muted)' }}>
        {label}
        {required && <span style={{ color: 'var(--tf-error)', marginLeft: '0.2rem' }}>*</span>}
        {hint && <span style={{ fontWeight: 400, marginLeft: '0.25rem' }}>{hint}</span>}
        {tooltip && <InfoTooltip text={tooltip} label={`About ${label}`} />}
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
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 500, color: value ? 'var(--tf-text)' : 'var(--tf-muted)' }}>
        {value || '—'}
      </div>
    </div>
  );
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Reportable-total + money-bucket panel. Shows what the user entered AND the
 * true Form 5472 gross-payments figure (Part IV flows), so the form number is
 * honest while nothing looks missing. Reused on the transaction step (live) and
 * the review step (static).
 */
function TxSummaryPanel({ summary, count }: { summary: ReturnType<typeof summarizeTransactions>; count: number }) {
  if (count === 0) return null;
  const bucket = (label: string, b: { count: number; total: number }, color: string) => (
    <div style={{ background: 'var(--tf-offset)', borderRadius: '0.5rem', padding: '0.7rem 0.85rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)' }}>{label}{b.count ? ` · ${b.count}` : ''}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{usd(b.total)}</div>
    </div>
  );
  return (
    <div style={{ ...groupedCardStyle, padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tf-muted)' }}>Total you’ve entered</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--tf-text)', lineHeight: 1.1 }}>{usd(summary.totalEntered)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tf-muted)' }}>On Form 5472 (gross payments)</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--tf-text)' }}>{usd(summary.formGross)}</div>
        </div>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--tf-muted)', margin: '0.5rem 0 0.85rem', lineHeight: 1.5 }}>
        The “gross payments” figure (Form 5472 line 1f/1h) counts service, rent, royalty and goods dealings. Money you put in or took out, and loan balances, are reported on their own lines — so the two numbers can differ, and that’s expected.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
        {bucket('Money in', summary.bucketIn, 'var(--tf-success)')}
        {bucket('Money out', summary.bucketOut, 'var(--tf-accent)')}
        {bucket('Other dealings', summary.bucketOther, 'var(--tf-text)')}
      </div>
    </div>
  );
}

// Simple-transaction glyphs (kept lightweight — no icon dependency).
const SIMPLE_TX_ICON: Record<string, string> = {
  'in': '↘', 'out': '↗', 'loan-in': '↘', 'loan-out': '↗', 'setup': '🧾', 'dividend': '💵',
};

const stepHeadingStyle: React.CSSProperties = { fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' };
const stepSubheadStyle: React.CSSProperties = { fontSize: '0.9rem', color: 'var(--tf-muted)', marginBottom: '1.75rem', lineHeight: 1.55 };
const sectionStyle: React.CSSProperties = { marginBottom: '2rem' };
const sectionLabelStyle: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 700, color: 'var(--tf-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.875rem' };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' };
const reviewGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem', padding: '1rem 1.25rem' };
const primaryBtnStyle: React.CSSProperties = { padding: '0.6rem 1.5rem', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', border: 'none', borderRadius: '0.5rem', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' };
const secondaryBtnStyle: React.CSSProperties = { padding: '0.6rem 1.25rem', background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer' };
const addBtnStyle: React.CSSProperties = { marginTop: '0.75rem', alignSelf: 'flex-start', padding: '0.4375rem 1rem', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', border: 'none', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' };
const infoBoxStyle: React.CSSProperties = { background: 'var(--tf-offset)', border: '1px solid var(--tf-border)', borderRadius: '0.375rem', padding: '0.625rem 0.875rem', fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.75rem' };
const errorSummaryStyle: React.CSSProperties = { background: 'var(--tf-error-bg)', color: 'var(--tf-error-text)', border: '1px solid var(--tf-error-border)', borderRadius: '0.5rem', padding: '0.875rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' };
const groupedCardStyle: React.CSSProperties = { border: '1px solid var(--tf-border)', borderRadius: '0.625rem', background: 'var(--tf-surface)', overflow: 'hidden' };

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

  // Step 1
  const [llcName, setLlcName] = useState('');
  const [ein, setEin] = useState('');
  const [stateOfFormation, setStateOfFormation] = useState('');
  const [totalAssets, setTotalAssets] = useState('');
  const [entityDOI, setEntityDOI] = useState('');
  const [entityPrincipalCountry, setEntityPrincipalCountry] = useState('');
  const [mailing, setMailing] = useState<Address>({ country: 'US' });
  const [entityBizActivity, setEntityBizActivity] = useState('');
  const [entityBizCode, setEntityBizCode] = useState('');
  // Final return + fiscal-year (non-calendar) filing
  const [finalReturn, setFinalReturn] = useState(false);
  const [isFiscalYear, setIsFiscalYear] = useState(false);
  const [fiscalBegin, setFiscalBegin] = useState('');
  const [fiscalEnd, setFiscalEnd] = useState('');

  // Step 1b
  const [extensionFiled, setExtensionFiled] = useState<boolean | null>(null);
  const [includeReasonableCause, setIncludeReasonableCause] = useState(false);
  const [reasonableCauseReasons, setReasonableCauseReasons] = useState<string[]>([]);

  // Step 2
  const [ownerName, setOwnerName] = useState('');
  const [ownerCountry, setOwnerCountry] = useState('');
  const [ownerCountryRes, setOwnerCountryRes] = useState('');
  const [ownerCountryCitizenship, setOwnerCountryCitizenship] = useState('');
  const [ownerSSN, setOwnerSSN] = useState('');
  const [ownerForeignTaxId, setOwnerForeignTaxId] = useState('');
  const [ownerRefNumber, setOwnerRefNumber] = useState('');
  const [ownerAddress, setOwnerAddress] = useState<Address>({});
  const [ownerBizActivity, setOwnerBizActivity] = useState('');
  const [ownerBizCode, setOwnerBizCode] = useState('');

  // Step 3
  const [relatedParties, setRelatedParties] = useState<RelatedParty[]>([]);
  const [rpDraft, setRpDraft] = useState<RelatedParty>({
    name: '',
    ref_number: '',
    country: '',
    country_residence: '',
    us_tin: '',
    foreign_tax_id: '',
    address: {},
    biz_activity: '',
    biz_code: '',
  });
  const [showRpForm, setShowRpForm] = useState(false);
  const [editingRpIdx, setEditingRpIdx] = useState<number | null>(null);

  // Step 4
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [noTransactionsConfirmed, setNoTransactionsConfirmed] = useState(false);
  // Owner managerial-services Part VI disclosure. Pre-selected (true): the owner
  // of a foreign-owned DE provides managerial services with no determinable FMV.
  // If the owner deselects it, the Part VI box is not ticked and no statement is
  // generated (unless an actual non-monetary transaction exists).
  const [partViManagerial, setPartViManagerial] = useState(true);
  // True once we auto-fill entity/owner data from the saved profile, so we can
  // show a "we pre-filled this — please review" banner on a returning user.
  const [prefilledFromProfile, setPrefilledFromProfile] = useState(false);
  // Set when this filing is part of a multi-year catch-up job; drives "next
  // year" routing after each year's intake is submitted.
  const [jobId, setJobId] = useState<string | null>(null);
  // Payment-integrity state: a paid filing locks its identity fields forever
  // and allows only a capped number of corrections to other fields.
  const [isPaidLocked, setIsPaidLocked] = useState(false);
  const [postPaymentEdits, setPostPaymentEdits] = useState(0);
  const POST_PAYMENT_EDIT_CAP = 2;
  const editsRemaining = Math.max(0, POST_PAYMENT_EDIT_CAP - postPaymentEdits);
  const [txRelatedPartyIdx, setTxRelatedPartyIdx] = useState(0);
  const [txType, setTxType] = useState('');
  const [txDir, setTxDir] = useState<'paid' | 'received'>('received');
  const [txAmt, setTxAmt] = useState('');
  const [txLoanBegin, setTxLoanBegin] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState('');
  const [cat3Acknowledged, setCat3Acknowledged] = useState(false);
  // Two-tier transaction entry: the detailed picker is hidden until the user
  // asks for it (the simple one-tap list covers the common ~90%).
  const [showDetailedTx, setShowDetailedTx] = useState(false);
  const [detailedSearch, setDetailedSearch] = useState('');

  const allPartyLabels = [
    ownerName || 'Primary owner',
    ...relatedParties.map((rp, i) => rp.name || `Related party ${i + 1}`),
  ];

  const selectedTxMeta = TX_TYPES.find((t) => t.value === txType);
  const currentStepIdx = stepOrder.indexOf(step);
  const txCategory = getCategoryForTxType(txType);
  // Live money summary (reconciles with the generator's 1f/1h gross).
  const txSummary = summarizeTransactions(transactions);

  const goToStepByIndex = (idx: number, nextFilingId?: string) => {
    const target = stepOrder[idx];
    if (target === undefined) return;
    setStep(target);
    const resolvedFilingId = nextFilingId ?? localFilingId ?? params.get('filing_id');
    const newParams = new URLSearchParams(params.toString());
    newParams.set('step', String(target));
    if (resolvedFilingId) newParams.set('filing_id', resolvedFilingId);
    navigate(`?${newParams.toString()}`, { replace: true });
  };

  useEffect(() => {
    if (step === '1b' && !show1b) setStep(1);
  }, [show1b, step]);

  useEffect(() => {
    const newParams = new URLSearchParams(params.toString());
    newParams.set('step', String(step));
    if (filingId) newParams.set('filing_id', filingId);
    navigate(`?${newParams.toString()}`, { replace: true });
  }, [step, filingId, navigate, params]);

  useEffect(() => {
    if (!filingId) { setLoadingFiling(false); return; }
    setLoadingFiling(true);
    (async () => {
      const { data: f, error: err } = await supabase.from('filings').select('*').eq('id', filingId).single();
      if (err || !f) { setLoadingFiling(false); return; }

      // Payment integrity: once paid, a filing's IDENTITY (EIN, LLC name, tax
      // year, owner identity, incorporation date) is permanently frozen so one
      // payment can't be re-skinned into a different company's forms. Genuine
      // corrections to other fields (addresses, transactions) are still allowed,
      // capped at a small number of edits. We surface that lock in the UI rather
      // than blocking the whole filing.
      setIsPaidLocked(f.status === 'paid' || f.status === 'completed');
      setPostPaymentEdits((f as any).post_payment_edits ?? 0);

      setLlcName(f.llc_name ?? '');
      setEin(f.ein ?? '');
      setStateOfFormation(f.state_of_formation ?? '');
      setTaxYear(String(f.tax_year ?? '2024'));
      setTotalAssets(String((f as any).total_assets ?? ''));
      setEntityDOI((f as any).entity_date_of_incorporation ?? (f as any).date_of_incorporation ?? '');
      setEntityPrincipalCountry((f as any).entity_principal_country ?? '');
      setMailing((f.mailing_address as Address) ?? { country: 'US' });
      setEntityBizActivity((f as any).entity_business_activity ?? (f as any).naics_description ?? '');
      setEntityBizCode((f as any).entity_business_code ?? '');
      setExtensionFiled((f as any).extension_filed ?? null);
      setIncludeReasonableCause((f as any).include_reasonable_cause ?? false);
      setReasonableCauseReasons((f as any).reasonable_cause_reasons ?? []);
      setOwnerName(f.owner_full_name ?? '');
      setOwnerCountry((f as any).owner_country ?? f.owner_primary_country ?? '');
      setOwnerCountryRes(f.owner_country_residence ?? '');
      setOwnerCountryCitizenship(f.owner_country_citizenship ?? '');
      setOwnerSSN((f as any).owner_ssn ?? f.owner_us_tin ?? '');
      setOwnerForeignTaxId(f.owner_foreign_tax_id ?? '');
      setOwnerRefNumber((f as any).owner_ref_number ?? '');
      setOwnerAddress((f.owner_address as Address) ?? {});
      setOwnerBizActivity(f.owner_business_activity ?? '');
      setOwnerBizCode((f as any).owner_business_code ?? '');
      if ((f as any).related_parties) setRelatedParties((f as any).related_parties as RelatedParty[]);
      setNoTransactionsConfirmed((f as any).no_transactions_confirmed ?? false);
      setPartViManagerial((f as any).part_vi_managerial ?? true);
      setJobId((f as any).job_id ?? null);
      setFinalReturn((f as any).final_return ?? false);
      setIsFiscalYear((f as any).is_fiscal_year ?? false);
      setFiscalBegin((f as any).tax_period_begin ?? '');
      setFiscalEnd((f as any).tax_period_end ?? '');

      const { data: txns } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId)
        .order('created_at', { ascending: true });

      if (txns) {
        setTransactions(txns.map((t: any) => ({
          id: t.id,
          related_party_index: t.related_party_index ?? 0,
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: String(t.amount_usd ?? ''),
          loan_begin_usd: String(t.loan_begin_usd ?? ''),
          description: t.description ?? '',
          transaction_date: t.transaction_date ?? '',
        })));
      }
      setLoadingFiling(false);
    })();
  }, [filingId]);

  // Prefill a BRAND-NEW filing (no filing_id) from the user's saved profile so
  // year 2+ is auto-populated for review. Only fills empty fields; never
  // overwrites anything the user has already typed this session.
  useEffect(() => {
    if (filingId) return; // existing filing is loaded by the effect above
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const profile = await loadProfile(user.id);
      if (cancelled || !profile) return;

      const fill = (cur: string, val?: string | null) => (cur ? cur : (val ?? ''));
      setLlcName((c) => fill(c, profile.llc_name));
      setEin((c) => fill(c, profile.ein));
      setStateOfFormation((c) => fill(c, profile.state_of_formation));
      setEntityDOI((c) => fill(c, profile.date_of_incorporation));
      setEntityBizActivity((c) => fill(c, profile.entity_business_activity ?? profile.naics_description));
      setEntityBizCode((c) => fill(c, profile.entity_business_code ?? profile.naics_code));
      setMailing((c) => (c && c.line1 ? c : ((profile.mailing_address as Address) ?? { country: 'US' })));

      setOwnerName((c) => fill(c, profile.owner_full_name));
      setOwnerCountry((c) => fill(c, profile.owner_country ?? profile.owner_primary_country));
      setOwnerCountryRes((c) => fill(c, profile.owner_country_residence));
      setOwnerCountryCitizenship((c) => fill(c, profile.owner_country_citizenship));
      setOwnerForeignTaxId((c) => fill(c, profile.owner_foreign_tax_id));
      setOwnerSSN((c) => fill(c, profile.owner_us_tin));
      setOwnerRefNumber((c) => fill(c, profile.owner_reference_id ?? profile.owner_ref_number));
      setOwnerBizActivity((c) => fill(c, profile.owner_business_activity));
      setOwnerBizCode((c) => fill(c, profile.owner_business_code ?? profile.owner_naics_code));
      setOwnerAddress((c) => (c && c.line1 ? c : ((profile.owner_address as Address) ?? {})));
      if (profile.related_parties && Array.isArray(profile.related_parties)) {
        setRelatedParties((c) => (c.length ? c : (profile.related_parties as RelatedParty[])));
      }
      setPrefilledFromProfile(true);
    })();
    return () => { cancelled = true; };
  }, [filingId]);

  function patchFromCurrentStep(): Partial<Filing> & Record<string, unknown> {
    if (step === 1) return {
      llc_name: llcName.trim() || null,
      ein: ein.trim() || null,
      state_of_formation: stateOfFormation.trim() || null,
      tax_year: taxYear,
      total_assets: totalAssets ? Number(totalAssets) : null,
      // Wizard columns (kept for resume/load compatibility)
      entity_date_of_incorporation: entityDOI.trim() || null,
      entity_principal_country: entityPrincipalCountry.trim() || null,
      mailing_address: mailing,
      entity_business_activity: entityBizActivity.trim() || null,
      entity_business_code: entityBizCode.trim() || null,
      // Canonical columns read directly by the PDF generator
      date_of_incorporation: entityDOI.trim() || null,
      naics_code: entityBizCode.trim() || null,
      naics_description: entityBizActivity.trim() || null,
      // Initial return: the LLC was formed during the tax year being filed.
      initial_return: isInitialReturn(entityDOI, taxYear),
      // Final return + fiscal-year (non-calendar) period.
      final_return: finalReturn,
      is_fiscal_year: isFiscalYear,
      tax_period_begin: isFiscalYear && fiscalBegin ? fiscalBegin : null,
      tax_period_end: isFiscalYear && fiscalEnd ? fiscalEnd : null,
    };
    if (step === '1b') return {
      extension_filed: extensionFiled,
      include_reasonable_cause: includeReasonableCause,
      reasonable_cause_reasons: reasonableCauseReasons,
    };
    if (step === 2) return {
      owner_full_name: ownerName.trim() || null,
      // Wizard columns (kept for resume/load compatibility)
      owner_country: ownerCountry.trim() || null,
      owner_country_residence: ownerCountryRes.trim() || null,
      owner_ssn: ownerSSN.trim() || null,
      owner_foreign_tax_id: ownerForeignTaxId.trim() || null,
      owner_ref_number: ownerRefNumber.trim() || null,
      owner_address: ownerAddress,
      owner_business_activity: ownerBizActivity.trim() || null,
      owner_business_code: ownerBizCode.trim() || null,
      // Canonical columns read directly by the PDF generator
      owner_primary_country: ownerCountry.trim() || null,   // "country where you do business"
      owner_country_citizenship: ownerCountryCitizenship.trim() || null,
      owner_us_tin: ownerSSN.trim() || null,
      owner_reference_id: ownerRefNumber.trim() || null,
      owner_naics_code: ownerBizCode.trim() || null,
    };
    if (step === 3) return { related_parties: relatedParties };
    if (step === 4) return {
      no_transactions_confirmed: noTransactionsConfirmed,
      part_vi_managerial: partViManagerial,
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

  function validateStep1b(): string[] {
    const errs: string[] = [];
    if (extensionFiled === null) errs.push('Please confirm whether Form 7004 (extension) was filed.');
    if (includeReasonableCause && reasonableCauseReasons.length === 0) errs.push('Select at least one reason for the reasonable cause letter.');
    return errs;
  }

  function validateStep2(): string[] {
    const errs: string[] = [];
    if (!ownerName.trim()) errs.push('Enter your full legal name.');
    if (!ownerCountry) errs.push('Select the country where you do business.');
    if (!ownerCountryRes) errs.push('Select the country where you pay taxes.');
    if (!ownerCountryCitizenship) errs.push('Select your country of citizenship.');
    if (!ownerForeignTaxId.trim()) errs.push('Enter your foreign tax ID.');
    if (!ownerRefNumber.trim()) errs.push('Enter your reference code.');
    if (!ownerBizActivity) errs.push('Select your type of business.');
    if (!ownerBizCode.trim()) errs.push('Enter your business code.');
    if (!isAddressComplete(ownerAddress, false)) errs.push('Complete your address.');
    return errs;
  }

  function validateRelatedPartyDraft(draft: RelatedParty): string[] {
    const errs: string[] = [];
    if (!draft.name.trim()) errs.push('Enter the related party full legal name.');
    if (!draft.country) errs.push('Select the country where they do business.');
    if (!draft.country_residence) errs.push('Select the country where they pay taxes.');
    if (!draft.foreign_tax_id.trim()) errs.push('Enter the related party tax ID (their country).');
    if (!draft.ref_number.trim()) errs.push('Enter the related party reference code.');
    if (!draft.biz_activity) errs.push('Select the related party type of business.');
    if (!draft.biz_code.trim()) errs.push('Enter the related party business code.');
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
      if (transactions.length === 0 && !noTransactionsConfirmed) return ['Confirm that the LLC had no reportable transactions this year, or add at least one.'];
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
        const { data, error: err } = await supabase.from('filings').insert({ ...patch, user_id: user.id }).select('id').single();
        if (err) throw err;
        const newId = data.id as string;
        setLocalFilingId(newId);
        return newId;
      }
      let finalPatch = patch;
      if (isPaidLocked) {
        // Never attempt to write frozen identity fields on a paid filing (the
        // DB trigger would reject the whole update). Strip them client-side so
        // legitimate corrections to other fields still go through.
        const FROZEN = ['llc_name', 'ein', 'tax_year', 'owner_full_name', 'owner_foreign_tax_id', 'date_of_incorporation', 'entity_date_of_incorporation'];
        finalPatch = Object.fromEntries(
          Object.entries(patch).filter(([k]) => !FROZEN.includes(k)),
        ) as typeof patch;
      }
      const { error: err } = await supabase.from('filings').update(finalPatch).eq('id', filingId);
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
        (t) => PART_V_TYPES.has(t.transaction_type) || PART_VI_TYPES.has(t.transaction_type) || (t.amount_usd && Number(t.amount_usd) > 0),
      );
      if (validTxns.length === 0) return true;

      // Translate each row from the rich UI vocabulary into the canonical
      // transaction_type the DB CHECK constraint and the PDF generator
      // understand, carrying is_royalty / loan beginning balance.
      const mapRow = (t: TransactionRow) => {
        const m = mapTransactionForPersist({
          transaction_type: t.transaction_type,
          direction: t.direction,
          amount_usd: t.amount_usd ? Number(t.amount_usd) : null,
          loan_begin_usd: t.loan_begin_usd ? Number(t.loan_begin_usd) : null,
          description: t.description,
          transaction_date: t.transaction_date,
        });
        return {
          filing_id: activeFilingId,
          related_party_index: t.related_party_index,
          transaction_type: m.transaction_type,
          direction: m.direction,
          amount_usd: m.amount_usd,
          loan_begin_usd: m.loan_begin_usd,
          is_royalty: m.is_royalty,
          description: m.description,
          transaction_date: m.transaction_date,
        };
      };

      const toInsert = validTxns.filter((t) => !t.id).map(mapRow);
      const toUpsert = validTxns.filter((t) => !!t.id).map((t) => ({
        id: t.id!,
        ...mapRow(t),
      }));

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('reportable_transactions').insert(toInsert);
        if (insErr) throw insErr;
      }
      if (toUpsert.length > 0) {
        const { error: upErr } = await supabase.from('reportable_transactions').upsert(toUpsert, { onConflict: 'id' });
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
    if (step === 1 && ein && !isValidEIN(ein)) setEinErr('EIN must be in the format XX-XXXXXXX (e.g. 12-3456789)');
    if (errs.length > 0) return;
    const nextIdx = currentStepIdx + 1;
    if (nextIdx >= stepOrder.length) return;
    if (step !== 4) {
      const id = await saveStep();
      if (!id) return;
      if (!filingId) setLocalFilingId(id);
      goToStepByIndex(nextIdx, id);
      return;
    }
    const ensuredId = filingId ?? (await saveStep());
    if (!ensuredId) return;
    if (!filingId) setLocalFilingId(ensuredId);
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
    if (!filingId) { setError('Missing filing ID.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Save transactions before navigating
      const saved = await saveTransactions(filingId);
      if (!saved) return;

      if (isPaidLocked) {
        // Paid filing: this submit is a correction round. Increment the edit
        // counter (DB enforces the cap) and go straight to the download page —
        // do NOT touch status (it stays paid/completed).
        if (editsRemaining > 0) {
          await supabase.from('filings')
            .update({ post_payment_edits: postPaymentEdits + 1 })
            .eq('id', filingId);
        }
        navigate(`/filing/${filingId}`);
        return;
      }

      const { error: err } = await supabase.from('filings').update({ status: 'in_progress' }).eq('id', filingId);
      if (err) throw err;

      // Remember entity + owner details so the next year's filing prefills.
      // Best-effort: never block submission on a profile write.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await saveProfileFromFiling(user?.id, {
          llc_name: llcName.trim() || null,
          ein: ein.trim() || null,
          state_of_formation: stateOfFormation.trim() || null,
          date_of_incorporation: entityDOI.trim() || null,
          mailing_address: mailing,
          entity_business_activity: entityBizActivity.trim() || null,
          entity_business_code: entityBizCode.trim() || null,
          naics_code: entityBizCode.trim() || null,
          naics_description: entityBizActivity.trim() || null,
          owner_full_name: ownerName.trim() || null,
          owner_country: ownerCountry.trim() || null,
          owner_primary_country: ownerCountry.trim() || null,
          owner_country_residence: ownerCountryRes.trim() || null,
          owner_country_citizenship: ownerCountryCitizenship.trim() || null,
          owner_foreign_tax_id: ownerForeignTaxId.trim() || null,
          owner_us_tin: ownerSSN.trim() || null,
          owner_reference_id: ownerRefNumber.trim() || null,
          owner_business_activity: ownerBizActivity.trim() || null,
          owner_business_code: ownerBizCode.trim() || null,
          owner_naics_code: ownerBizCode.trim() || null,
          owner_address: ownerAddress,
          related_parties: relatedParties,
        });
      } catch { /* profile save is non-critical */ }

      // Multi-year catch-up: after finishing this year, jump to the next year
      // in the same job that still needs work; if all years are done, go to the
      // (most-recent) filing's package page to review/download the whole job.
      if (jobId) {
        const { data: siblings } = await supabase
          .from('filings')
          .select('id, tax_year, current_step, status')
          .eq('job_id', jobId)
          .order('tax_year', { ascending: false });
        const nextYear = (siblings ?? []).find(
          (s) => s.id !== filingId && s.status === 'draft',
        );
        if (nextYear) {
          navigate(`/intake?filing_id=${nextYear.id}`);
          return;
        }
      }

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
      setRpDraft({ name: '', ref_number: '', country: '', country_residence: '', us_tin: '', foreign_tax_id: '', address: {}, biz_activity: '', biz_code: '' });
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
      prev.filter((t) => t.related_party_index !== i + 1)
          .map((t) => ({ ...t, related_party_index: t.related_party_index > i + 1 ? t.related_party_index - 1 : t.related_party_index })),
    );
  };

  const addTransaction = () => {
    const errs = validateTransactionDraft();
    setTxErrors(errs);
    if (errs.length > 0) return;
    setTransactions((prev) => [...prev, {
      related_party_index: txRelatedPartyIdx,
      transaction_type: txType,
      direction: txDir,
      amount_usd: txAmt,
      loan_begin_usd: LOAN_TYPES.has(txType) ? txLoanBegin : '',
      description: txDesc,
      transaction_date: txDate,
    }]);
    setTxAmt('');
    setTxLoanBegin('');
    setTxDesc('');
    setTxDate('');
    setTxType('');
    setShowDetailedTx(false);
    setDetailedSearch('');
    setCat3Acknowledged(false);
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
          border-color: var(--tf-accent);
          box-shadow: 0 0 0 3px rgba(var(--tf-accent-rgb), 0.18);
        }
        .intake-form input::placeholder { color: var(--tf-muted); opacity: 1; }
        .intake-form input[data-invalid="true"],
        .intake-form select[data-invalid="true"] {
          border-color: var(--tf-error);
          box-shadow: 0 0 0 3px rgba(var(--tf-error-rgb), 0.15);
        }
        .intake-form .field-error { font-size: 0.78rem; color: var(--tf-error-text); margin-top: 0.25rem; }
        .intake-form select option {
          background: var(--tf-surface);
          color: var(--tf-text);
        }

        /* ── Stepper ── */
        .stepper-track {
          display: inline-flex; align-items: center;
          background: var(--tf-offset, #f1f5f9); border-radius: 2rem;
          padding: 0.25rem; gap: 0; margin-bottom: 2rem;
          flex-wrap: nowrap; overflow-x: auto; max-width: 100%;
          scrollbar-width: none; -ms-overflow-style: none;
        }
        .stepper-track::-webkit-scrollbar { display: none; }
        .stepper-pill {
          display: flex; align-items: center; gap: 0.35rem;
          padding: 0.35rem 0.9rem; border-radius: 2rem;
          font-size: 0.8125rem; font-weight: 500;
          white-space: nowrap; border: none; background: transparent;
          transition: background 0.15s, color 0.15s; line-height: 1;
        }
        .stepper-pill--active { background: var(--tf-accent); color: var(--tf-on-accent); font-weight: 700; cursor: default; box-shadow: 0 1px 4px rgba(var(--tf-accent-rgb), 0.25); }
        .stepper-pill--done { background: rgba(var(--tf-accent-rgb), 0.12); color: var(--tf-accent); font-weight: 600; cursor: pointer; }
        .stepper-pill--done:hover { background: rgba(var(--tf-accent-rgb), 0.20); }
        .stepper-pill--pending { color: var(--tf-muted); cursor: default; }
        .stepper-check { display: inline-flex; align-items: center; justify-content: center; width: 1rem; height: 1rem; border-radius: 50%; background: var(--tf-accent); color: var(--tf-on-accent); font-size: 0.6rem; font-weight: 800; line-height: 1; flex-shrink: 0; }

        /* ── Radio / checkbox selection cards ── */
        .select-card {
          display: flex; gap: 0.75rem; align-items: flex-start;
          padding: 0.875rem 1rem;
          border: 1px solid var(--tf-border);
          border-radius: 0.5rem; cursor: pointer;
          background: var(--tf-surface);
          transition: border-color 0.12s, background 0.12s;
        }
        .select-card:hover { border-color: var(--tf-accent-soft); background: var(--tf-offset); }
        .select-card.is-selected { border-color: var(--tf-accent); background: rgba(var(--tf-accent-rgb), 0.08); }
        .select-card input[type="radio"],
        .select-card input[type="checkbox"] {
          width: 1.1rem !important; height: 1.1rem !important;
          flex-shrink: 0; margin-top: 0.15rem;
          accent-color: var(--tf-accent);
          padding: 0 !important; border: none !important;
          box-shadow: none !important;
        }
        .select-card-label { font-weight: 600; font-size: 0.9rem; color: var(--tf-text); }
        .select-card-hint { font-size: 0.8rem; color: var(--tf-muted); margin-top: 0.15rem; line-height: 1.4; }

        /* ── Transaction category accordion ── */
        .tx-cat-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.875rem 1rem; cursor: pointer; user-select: none;
          background: var(--tf-surface);
          transition: background 0.12s;
        }
        .tx-cat-header:hover { background: var(--tf-offset); }
        .tx-cat-header.is-open { background: rgba(var(--tf-accent-rgb), 0.08); }
        .tx-cat-chevron {
          width: 1.25rem; height: 1.25rem; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: var(--tf-muted);
          transition: transform 0.2s;
        }
        .tx-cat-chevron.is-open { transform: rotate(180deg); }
        .tx-cat-body {
          border-top: 1px solid var(--tf-border);
          padding: 0.875rem; background: var(--tf-offset);
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 0.5rem;
        }
        .tx-type-card {
          text-align: left; border: 1px solid var(--tf-border);
          border-radius: 0.5rem; padding: 0.75rem 0.875rem;
          background: var(--tf-surface); cursor: pointer; width: 100%;
          transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
        }
        .tx-type-card:hover { border-color: var(--tf-accent-soft); background: var(--tf-offset); }
        .tx-type-card.is-selected { border-color: var(--tf-accent); box-shadow: 0 0 0 3px rgba(var(--tf-accent-rgb), 0.12); background: rgba(var(--tf-accent-rgb), 0.08); }
        .tx-type-label { font-weight: 600; font-size: 0.9rem; color: var(--tf-text); }
        .tx-type-sentence { display: block; margin-top: 0.25rem; font-size: 0.8125rem; color: var(--tf-muted); line-height: 1.45; }

        /* ── Confirm no-transactions row ── */
        .confirm-check-row {
          display: flex; gap: 0.75rem; align-items: flex-start;
          padding: 1rem 1.25rem;
          background: var(--tf-banner-amber-bg); border: 1px solid var(--tf-banner-amber-border); border-radius: 0.5rem;
          margin-top: 1.25rem;
        }
        .confirm-check-row input[type="checkbox"] {
          width: 1.1rem !important; height: 1.1rem !important;
          flex-shrink: 0; margin-top: 0.15rem;
          accent-color: var(--tf-warn);
          padding: 0 !important; border: none !important;
          box-shadow: none !important;
        }

        /* ── Transaction tier banners (green = routine, amber = review, red = complex) ── */
        .cat-banner-green { background: var(--tf-banner-green-bg); border: 1px solid var(--tf-banner-green-border); border-radius: 0.5rem; padding: 0.75rem 1rem; font-size: 0.8125rem; color: var(--tf-banner-green-text); margin-bottom: 1rem; line-height: 1.5; }
        .cat-banner-amber { background: var(--tf-banner-amber-bg); border: 1px solid var(--tf-banner-amber-border); border-radius: 0.5rem; padding: 0.75rem 1rem; font-size: 0.8125rem; color: var(--tf-banner-amber-text); margin-bottom: 1rem; line-height: 1.5; }
        .cat-banner-red { background: var(--tf-banner-red-bg); border: 1px solid var(--tf-banner-red-border); border-radius: 0.5rem; padding: 0.75rem 1rem; font-size: 0.8125rem; color: var(--tf-banner-red-text); margin-bottom: 1rem; line-height: 1.5; }
        .cat3-ack-row { display: flex; gap: 0.75rem; align-items: flex-start; margin-top: 0.75rem; }
        .cat3-ack-row input[type="checkbox"] { width: 1.1rem !important; height: 1.1rem !important; flex-shrink: 0; margin-top: 0.1rem; accent-color: var(--tf-error); padding: 0 !important; border: none !important; box-shadow: none !important; }

        /* ── Dark-mode-only structural tweak (colors already resolve via tokens) ── */
        .dark .stepper-track { background: rgba(255,255,255,0.06); }
      `}</style>

      <div className="intake-form" style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>
        {jobId && (
          <div style={{ background: 'rgba(var(--tf-accent-rgb), 0.08)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.625rem 1rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: 'var(--tf-text)' }}>
            <strong>Catch-up filing — tax year {taxYear}.</strong> Finish this year and we’ll take you to the next one. Your LLC and owner details are shared across all the years you selected.
          </div>
        )}

        {/* Stepper */}
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
                  className={['stepper-pill', isActive ? 'stepper-pill--active' : '', isDone ? 'stepper-pill--done' : '', isPending ? 'stepper-pill--pending' : ''].join(' ')}
                  onClick={() => { if (isDone) goToStepByIndex(idx); }}
                  aria-current={isActive ? 'step' : undefined}
                  tabIndex={isDone ? 0 : -1}
                >
                  {isDone && <span className="stepper-check" aria-hidden="true">✓</span>}
                  {typeof s === 'number' ? `${s}. ` : ''}{shortLabel}
                </button>
              );
            })}
          </div>
        </nav>

        {isPaidLocked && (
          <div className={editsRemaining > 0 ? 'cat-banner-amber' : 'cat-banner-red'} style={{ marginBottom: '1.25rem' }}>
            <strong>This filing has been paid.</strong> Your company and owner identity (EIN, LLC name, tax year, owner name &amp; tax ID, incorporation date) are locked — to file for a different company or year, start a new filing.{' '}
            {editsRemaining > 0
              ? `You can still correct other details (addresses, transactions) and re-download — ${editsRemaining} correction${editsRemaining > 1 ? 's' : ''} remaining.`
              : 'You have used all available corrections; contact support@filetax.co for further changes. You can still re-download anytime.'}
          </div>
        )}

        {error && <div style={errorSummaryStyle}>{error}</div>}
        {stepErrors.length > 0 && (
          <div style={errorSummaryStyle}>
            <div style={{ fontWeight: 700, marginBottom: '0.45rem' }}>Please complete the following before continuing</div>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {stepErrors.map((msg, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{msg}</li>)}
            </ul>
          </div>
        )}

        {/* ── Step 1: LLC Details ── */}
        {step === 1 && (
          <div>
            <h2 style={stepHeadingStyle}>Your LLC details</h2>
            <p style={stepSubheadStyle}>Basic information about the US company. This goes on the pro forma 1120 and all Form 5472 filings.</p>

            {prefilledFromProfile && (
              <div className="cat-banner-green" style={{ marginBottom: '1.5rem' }}>
                <strong>We’ve pre-filled your details from your last filing.</strong> Please review everything below and update anything that changed. Your edits here apply to this filing only.
              </div>
            )}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company information</h3>
              <div style={gridStyle}>
                <Field label="LLC / Corporation name" style={{ gridColumn: '1 / -1' }} required hint={isPaidLocked ? '🔒 locked after payment' : undefined}>
                  <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" disabled={isPaidLocked} />
                </Field>
                <Field label="EIN" hint={isPaidLocked ? '🔒 locked after payment' : 'Employer Identification Number'} required tooltip="Your LLC's 9-digit federal tax ID (format 12-3456789). Find it on your IRS EIN confirmation (CP-575), your formation service dashboard (Stripe Atlas, Doola, Firstbase), or by searching your email for 'EIN'.">
                  <input
                    value={ein}
                    onChange={(e) => { setEin(formatEIN(e.target.value)); setEinErr(null); }}
                    onBlur={handleEinBlur}
                    placeholder="12-3456789"
                    data-invalid={!!einErr}
                    disabled={isPaidLocked}
                  />
                  {einErr && <div className="field-error">{einErr}</div>}
                </Field>
                <Field label="State of formation" required>
                  <select value={stateOfFormation} onChange={(e) => setStateOfFormation(e.target.value)}>
                    <option value="">Select state</option>
                    {US_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Tax year" required hint={isPaidLocked ? '🔒 locked after payment' : undefined}>
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)} disabled={isPaidLocked}>
                    {TAX_YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </Field>
                <Field label="Total assets (USD)" hint="optional" tooltip="Usually your LLC's bank balance on December 31, plus the value of anything else it owns (equipment, inventory). A rough figure is fine.">
                  <input type="number" value={totalAssets} onChange={(e) => setTotalAssets(e.target.value)} placeholder="e.g. 50000" />
                </Field>
                <Field label="Date of incorporation" required hint={isPaidLocked ? '🔒 locked after payment' : undefined} tooltip="The date your LLC was officially formed, shown on your formation documents (Articles of Organization / Certificate of Formation).">
                  <input type="date" value={entityDOI} onChange={(e) => setEntityDOI(e.target.value)} disabled={isPaidLocked} />
                </Field>
                <Field label="Principal country where business is conducted" required>
                  <select value={entityPrincipalCountry} onChange={(e) => setEntityPrincipalCountry(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Type of business" required>
                  <select
                    value={entityBizActivity}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEntityBizActivity(val);
                      const match = BIZ_ACTIVITIES.find((a) => a.label === val);
                      if (match) setEntityBizCode(match.code);
                    }}
                  >
                    <option value="">Select activity</option>
                    {BIZ_ACTIVITIES.map((a) => <option key={a.label} value={a.label}>{a.label}</option>)}
                  </select>
                </Field>
                <Field label="Business code" required tooltip="The 6-digit NAICS code that best matches what your LLC does. We fill this in automatically when you pick a type of business.">
                  <input value={entityBizCode} onChange={(e) => setEntityBizCode(e.target.value)} placeholder="e.g. 541511" />
                </Field>
              </div>
            </section>

            {/* ── Fiscal year + final return ─────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Tax period</h3>
              <label className={`confirm-check-row${isFiscalYear ? ' is-selected' : ''}`} style={{ cursor: 'pointer', background: 'var(--tf-offset)', borderColor: 'var(--tf-border)', marginTop: 0 }}>
                <input type="checkbox" checked={isFiscalYear} onChange={(e) => setIsFiscalYear(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                    My LLC uses a fiscal year (not January–December)
                    <InfoTooltip text="Most LLCs use the calendar year (Jan 1 – Dec 31). Only tick this if your LLC was set up with a different tax year-end. If you're not sure, leave it unticked." label="About fiscal year" />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                    Leave unticked for the normal calendar year.
                  </div>
                </div>
              </label>
              {isFiscalYear && (
                <>
                  <div style={{ ...gridStyle, marginTop: '0.875rem' }}>
                    <Field label="Tax period begins" required tooltip="The first day of your LLC's fiscal year for this filing.">
                      <input type="date" value={fiscalBegin} onChange={(e) => setFiscalBegin(e.target.value)} />
                    </Field>
                    <Field label="Tax period ends" required tooltip="The last day of your LLC's fiscal year for this filing.">
                      <input type="date" value={fiscalEnd} onChange={(e) => setFiscalEnd(e.target.value)} />
                    </Field>
                  </div>
                  <div className="cat-banner-amber" style={{ marginTop: '0.875rem' }}>
                    <strong>Fiscal-year filing — please review carefully.</strong> Fiscal-year returns are less common. We'll generate your forms using these dates; double-check the period and your filing due date before submitting.
                  </div>
                </>
              )}

              <label className={`confirm-check-row${finalReturn ? ' is-selected' : ''}`} style={{ cursor: 'pointer', background: 'var(--tf-offset)', borderColor: 'var(--tf-border)', marginTop: '0.875rem' }}>
                <input type="checkbox" checked={finalReturn} onChange={(e) => setFinalReturn(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                    This is my LLC's final return
                    <InfoTooltip text="Tick this only if the LLC was dissolved, closed, or permanently stopped operating during this tax year. Do NOT tick it for a year with no activity or a temporary pause." label="About final return" />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                    Only if the LLC closed or dissolved this year — not for a quiet year.
                  </div>
                </div>
              </label>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC mailing address (US)</h3>
              <AddressFields value={mailing} onChange={setMailing} forceUS />
            </section>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtnStyle} onClick={handleNext} disabled={saving}>
                {saving ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1b: Filing Status ── */}
        {step === '1b' && (
          <div>
            <h2 style={stepHeadingStyle}>Filing status</h2>
            <p style={stepSubheadStyle}>
              The original filing deadline for this tax year has passed. We need a couple of extra details before generating your forms.
            </p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Extension</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[
                  { val: true, label: 'Yes, Form 7004 was filed before the original deadline' },
                  { val: false, label: 'No, no extension was filed' },
                ].map(({ val, label }) => (
                  <label
                    key={String(val)}
                    className={`select-card${extensionFiled === val ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="extensionFiled"
                      checked={extensionFiled === val}
                      onChange={() => setExtensionFiled(val)}
                    />
                    <span className="select-card-label">{label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Reasonable cause letter</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--tf-text-muted, #6b7280)', marginBottom: '0.875rem', lineHeight: 1.55 }}>
                A reasonable cause letter can help reduce or waive the $25,000 penalty for late filing. It's a +$200 add-on that we draft for you alongside your forms.
              </p>
              <label className={`select-card${includeReasonableCause ? ' is-selected' : ''}`} style={{ marginBottom: '1.25rem' }}>
                <input
                  type="checkbox"
                  checked={includeReasonableCause}
                  onChange={(e) => { setIncludeReasonableCause(e.target.checked); if (!e.target.checked) setReasonableCauseReasons([]); }}
                />
                <div>
                  <div className="select-card-label">Yes, include a reasonable cause letter (+$200)</div>
                  <div className="select-card-hint">We will draft a personalised letter to the IRS on your behalf.</div>
                </div>
              </label>

              {includeReasonableCause && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.625rem' }}>
                    Select all reasons that apply
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {REASONABLE_CAUSE_REASONS.map((r) => {
                      const checked = reasonableCauseReasons.includes(r.value);
                      return (
                        <label
                          key={r.value}
                          className={`select-card${checked ? ' is-selected' : ''}`}
                          onClick={() => setReasonableCauseReasons((prev) => checked ? prev.filter((x) => x !== r.value) : [...prev, r.value])}
                        >
                          <input type="checkbox" checked={checked} readOnly />
                          <div>
                            <div className="select-card-label">{r.label}</div>
                            <div className="select-card-hint">{r.hint}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" style={secondaryBtnStyle} onClick={handleBack}>Back</button>
              <button type="button" style={primaryBtnStyle} onClick={handleNext} disabled={saving}>{saving ? 'Saving…' : 'Continue'}</button>
            </div>
          </div>
        )}

        {/* ── Step 2: Owner Details ── */}
        {step === 2 && (
          <div>
            <h2 style={stepHeadingStyle}>Your details as the foreign owner</h2>
            <p style={stepSubheadStyle}>Details about you as the individual or entity that owns 25%+ of this LLC. This goes directly on Form 5472, Part II.</p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Your identity</h3>
              <div style={gridStyle}>
                <Field label="Your full legal name" hint={isPaidLocked ? '🔒 locked after payment' : 'As shown on government ID'} style={{ gridColumn: '1 / -1' }} required>
                  <input
                    value={ownerName}
                    onChange={(e) => {
                      setOwnerName(e.target.value);
                      if (!ownerRefNumber || ownerRefNumber === buildOwnerRef(ownerName)) {
                        setOwnerRefNumber(buildOwnerRef(e.target.value));
                      }
                    }}
                    placeholder="e.g. Rahul Sharma"
                    disabled={isPaidLocked}
                  />
                </Field>
                <Field label="Country where you do business" required tooltip="The country where you mainly carry out your own work or business activity. For many owners this is where they live and work.">
                  <select value={ownerCountry} onChange={(e) => setOwnerCountry(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Country where you pay taxes" required tooltip="The country where you are a tax resident — i.e. where you file your personal income taxes.">
                  <select value={ownerCountryRes} onChange={(e) => setOwnerCountryRes(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Country of citizenship" hint="The country on your passport" required tooltip="The country that issued your passport. If you hold more than one, use the one you'll list on the form.">
                  <select value={ownerCountryCitizenship} onChange={(e) => setOwnerCountryCitizenship(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Your foreign tax ID" hint={isPaidLocked ? '🔒 locked after payment' : 'e.g. PAN, UTR, NIF, SIN'} required tooltip="The tax ID number your home country issues you — e.g. PAN (India), UTR (UK), NIF (Spain), SIN (Canada). If your country doesn't issue one, enter 'None'.">
                  <input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="Your local tax ID" disabled={isPaidLocked} />
                </Field>
                <Field label="US tax ID" hint="SSN, ITIN, or EIN — if you have one" tooltip="Only if you happen to have a US tax ID (SSN, ITIN, or your own EIN). Most foreign owners don't — leave it blank if so.">
                  <input value={ownerSSN} onChange={(e) => setOwnerSSN(e.target.value)} placeholder="XXX-XX-XXXX or XX-XXXXXXX" />
                </Field>
                <Field label="Your reference code" hint="Used internally on Form 5472" required tooltip="A short code that identifies you on the form (e.g. your initials + 001). We suggest one automatically — you can keep it or change it. It just needs to be consistent.">
                  <input value={ownerRefNumber} onChange={(e) => setOwnerRefNumber(e.target.value)} placeholder="e.g. RAH001" />
                </Field>
              </div>
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Your address</h3>
              <AddressFields value={ownerAddress} onChange={setOwnerAddress} />
            </section>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Your type of business</h3>
              <div style={gridStyle}>
                <Field label="Type of business" hint="Your own business, not the LLC's" required>
                  <select
                    value={ownerBizCode}
                    onChange={(e) => {
                      const match = RP_NAICS.find((n) => n.code === e.target.value);
                      setOwnerBizCode(e.target.value);
                      setOwnerBizActivity(match?.label ?? '');
                    }}
                  >
                    <option value="">Select type</option>
                    {RP_NAICS.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
                  </select>
                </Field>
              </div>
            </section>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" style={secondaryBtnStyle} onClick={handleBack}>Back</button>
              <button type="button" style={primaryBtnStyle} onClick={handleNext} disabled={saving}>{saving ? 'Saving…' : 'Continue'}</button>
            </div>
          </div>
        )}

        {/* ── Step 3: Related Parties ── */}
        {step === 3 && (
          <div>
            <h2 style={stepHeadingStyle}>Related parties</h2>
            <p style={stepSubheadStyle}>
              Add any other foreign individuals or entities that had reportable transactions with this LLC. Each one generates a separate Form 5472. If it's just you and the LLC, you can skip this step.
            </p>

            {relatedParties.length > 0 && (
              <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {relatedParties.map((rp, i) => (
                  <div key={i} style={{ ...groupedCardStyle, padding: '0.875rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{rp.name || `Related party ${i + 1}`}</div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.2rem' }}>
                          {rp.country}
                          {rp.country_residence && rp.country_residence !== rp.country ? ` · Tax resident: ${rp.country_residence}` : ''}
                          {rp.ref_number ? ` · Ref: ${rp.ref_number}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="button" style={secondaryBtnStyle} onClick={() => openRpForm(i)}>Edit</button>
                        {!isPaidLocked && (
                          <button type="button" style={{ ...secondaryBtnStyle, color: 'var(--tf-error-text)', borderColor: 'var(--tf-error-border)' }} onClick={() => removeRp(i)}>Remove</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showRpForm && (
              <div style={{ ...groupedCardStyle, padding: '1.25rem', marginBottom: '1.5rem' }}>
                <h3 style={{ ...sectionLabelStyle, marginBottom: '1rem' }}>{editingRpIdx !== null ? 'Edit related party' : 'Add related party'}</h3>
                {rpErrors.length > 0 && (
                  <div style={{ ...errorSummaryStyle, marginBottom: '1rem' }}>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {rpErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={gridStyle}>
                    <Field label="Full legal name" style={{ gridColumn: '1 / -1' }} required>
                      <input
                        value={rpDraft.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRpDraft((p) => ({ ...p, name: val, ref_number: p.ref_number || buildRelatedPartyRef(val, relatedParties.length) }));
                        }}
                        placeholder="Full legal name"
                      />
                    </Field>
                    <Field label="Country where they do business" required>
                      <select value={rpDraft.country} onChange={(e) => setRpDraft((p) => ({ ...p, country: e.target.value }))}>
                        <option value="">Select country</option>
                        {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Country where they pay taxes" required>
                      <select value={rpDraft.country_residence} onChange={(e) => setRpDraft((p) => ({ ...p, country_residence: e.target.value }))}>
                        <option value="">Select country</option>
                        {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </Field>
                    <Field label="US TIN" hint="If any (EIN or ITIN)">
                      <input value={rpDraft.us_tin ?? ''} onChange={(e) => setRpDraft((p) => ({ ...p, us_tin: e.target.value }))} placeholder="XX-XXXXXXX or XXX-XX-XXXX" />
                    </Field>
                    <Field label="Tax ID (their country)" hint="e.g. PAN, UTR, NIF, SIN" required>
                      <input value={rpDraft.foreign_tax_id} onChange={(e) => setRpDraft((p) => ({ ...p, foreign_tax_id: e.target.value }))} placeholder="Local tax ID" />
                    </Field>
                    <Field label="Reference code" hint="Used internally on Form 5472" required>
                      <input value={rpDraft.ref_number} onChange={(e) => setRpDraft((p) => ({ ...p, ref_number: e.target.value }))} placeholder="e.g. REL002" />
                    </Field>
                    <Field label="Type of business" required>
                      <select
                        value={rpDraft.biz_code}
                        onChange={(e) => {
                          const match = RP_NAICS.find((n) => n.code === e.target.value);
                          setRpDraft((p) => ({ ...p, biz_code: e.target.value, biz_activity: match?.label ?? '' }));
                        }}
                      >
                        <option value="">Select type</option>
                        {RP_NAICS.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
                      </select>
                    </Field>
                  </div>

                  <div>
                    <div style={{ ...sectionLabelStyle, marginBottom: '0.625rem' }}>Address</div>
                    <AddressFields value={rpDraft.address} onChange={(a) => setRpDraft((p) => ({ ...p, address: a }))} />
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                    <button type="button" style={secondaryBtnStyle} onClick={() => { setShowRpForm(false); setEditingRpIdx(null); setRpErrors([]); }}>Cancel</button>
                    <button type="button" style={primaryBtnStyle} onClick={saveRpDraft}>{editingRpIdx !== null ? 'Save changes' : 'Add party'}</button>
                  </div>
                </div>
              </div>
            )}

            {!showRpForm && !isPaidLocked && (
              <button type="button" style={addBtnStyle} onClick={() => openRpForm()}>Add related party</button>
            )}
            {!showRpForm && isPaidLocked && (
              <div className="cat-banner-amber" style={{ marginTop: '0.5rem' }}>
                Adding another related party after payment generates an additional Form 5472 and is a paid add-on. Email{' '}
                <a href="mailto:hello@filetax.co" style={{ color: 'inherit', fontWeight: 700 }}>hello@filetax.co</a> to add a party to this filing.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
              <button type="button" style={secondaryBtnStyle} onClick={handleBack}>Back</button>
              <button type="button" style={primaryBtnStyle} onClick={handleNext} disabled={saving}>{saving ? 'Saving…' : 'Continue'}</button>
            </div>
          </div>
        )}

        {/* ── Step 4: Transactions ── */}
        {step === 4 && (
          <div>
            <h2 style={stepHeadingStyle}>Money between you and the LLC</h2>
            <p style={stepSubheadStyle}>
              Tell us about any money or assets that moved between the LLC and you (or another related party) this year — money you put in, money you took out, loans, and so on. Don’t include normal business sales to customers or payments to vendors like Stripe or AWS.
            </p>

            {/* Owner managerial-services Part VI disclosure — pre-selected, can opt out */}
            <label className={`confirm-check-row${partViManagerial ? ' is-selected' : ''}`} style={{ cursor: 'pointer', background: 'var(--tf-offset)', borderColor: 'var(--tf-border)', marginTop: 0, marginBottom: '1.5rem' }}>
              <input type="checkbox" checked={partViManagerial} onChange={(e) => setPartViManagerial(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                  I run the LLC myself (include the standard owner-services note)
                  <InfoTooltip text="As the foreign owner, you typically provide management and services to the LLC that have no set market price. The IRS expects this disclosed on Form 5472 Part VI. We include a standard statement for you. Untick only if this does not apply — then no Part VI statement is generated." label="About owner services" />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--tf-muted)', marginTop: '0.15rem' }}>
                  Recommended for almost all single-owner LLCs. Untick if it doesn’t apply.
                </div>
              </div>
            </label>

            {transactions.length > 0 && (
              <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={sectionLabelStyle}>Added transactions</div>
                {transactions.map((t, i) => {
                  const meta = TX_TYPES.find((x) => x.value === t.transaction_type);
                  const partyLabel = allPartyLabels[t.related_party_index] || 'Unknown party';
                  const isOwner = t.related_party_index === 0;
                  return (
                    <div key={i} style={{ ...groupedCardStyle, padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{meta?.label ?? t.transaction_type}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.15rem' }}>
                          {partyLabel}
                          {t.amount_usd && Number(t.amount_usd) > 0 ? ` · USD ${Number(t.amount_usd).toLocaleString()}` : ''}
                          {DIRECTION_TYPES.has(t.transaction_type) ? ` · ${t.direction}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        style={{ ...secondaryBtnStyle, fontSize: '0.8rem', padding: '0.3rem 0.75rem', color: 'var(--tf-error-text)', borderColor: 'var(--tf-error-border)' }}
                        onClick={() => removeTransaction(i)}
                      >
                        Remove
                      </button>
         
                    </div>
                  );
                })}
              </div>
            )}

            <TxSummaryPanel summary={txSummary} count={transactions.length} />

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Add a transaction</h3>

              <Field label="Who was this transaction with?" required style={{ marginBottom: '1rem' }}>
                <select value={txRelatedPartyIdx} onChange={(e) => setTxRelatedPartyIdx(Number(e.target.value))}>
                  {allPartyLabels.map((label, i) => (
                    <option key={i} value={i}>{label}</option>
                  ))}
                </select>
              </Field>

              <div style={{ ...sectionLabelStyle, marginBottom: '0.5rem' }}>What happened?</div>
              {txErrors.some((e) => e.includes('transaction type')) && (
                <div style={{ ...errorSummaryStyle, marginBottom: '0.75rem' }}>Pick what happened below.</div>
              )}

              {/* Tier 1 — simple one-tap transactions (cover ~90% of filings). */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                {SIMPLE_TX.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`tx-type-card${txType === s.value ? ' is-selected' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}
                    onClick={() => {
                      setTxType(s.value);
                      setTxDir(s.direction);
                      setShowDetailedTx(false);
                      setTxErrors([]);
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: '1.1rem', lineHeight: 1 }}>{SIMPLE_TX_ICON[s.icon]}</span>
                    <span className="tx-type-label">{s.label}</span>
                  </button>
                ))}
              </div>

              {/* Tier 2 — "record a different transaction" reveals the full set. */}
              <button
                type="button"
                onClick={() => setShowDetailedTx((v) => !v)}
                style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', padding: '0.75rem 0 0', textDecoration: 'underline', textUnderlineOffset: '2px' }}
              >
                {showDetailedTx ? '− Hide other transaction types' : '+ Record a different kind of transaction'}
              </button>

              {showDetailedTx && (
                <div style={{ ...groupedCardStyle, padding: '1rem 1.25rem', marginTop: '0.75rem' }}>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
                    For less common dealings. Pick the closest match — we’ll place it on the right part of the form for you.
                  </p>
                  <input
                    type="text"
                    value={detailedSearch}
                    onChange={(e) => setDetailedSearch(e.target.value)}
                    placeholder="Search (e.g. royalty, services, IP, insurance)…"
                    style={{ marginBottom: '0.875rem' }}
                  />
                  {DETAILED_TX_GROUPS.map((grp) => {
                    const items = TX_TYPES.filter(
                      (t) => grp.values.includes(t.value) &&
                        (!detailedSearch.trim() ||
                          t.label.toLowerCase().includes(detailedSearch.toLowerCase()) ||
                          t.sentence.toLowerCase().includes(detailedSearch.toLowerCase())),
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={grp.key} style={{ marginBottom: '0.875rem' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tf-muted)', marginBottom: '0.4rem' }}>
                          {grp.label}
                          {grp.note && <span style={{ color: 'var(--tf-warn)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}> · {grp.note}</span>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {items.map((item) => (
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
                              <span className="tx-type-sentence">{item.sentence.replace('{party}', allPartyLabels[txRelatedPartyIdx] || 'the related party')}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {txType && (
              <section style={{ ...sectionStyle, background: 'var(--tf-offset, #f8fafc)', border: '1px solid var(--tf-border, #e5e7eb)', borderRadius: '0.625rem', padding: '1.25rem', marginTop: '0.75rem' }}>
                <h3 style={{ ...sectionLabelStyle, marginBottom: '0.75rem' }}>Transaction details</h3>

                {txErrors.length > 0 && (
                  <div style={{ ...errorSummaryStyle, marginBottom: '0.875rem' }}>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                      {txErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                    </ul>
                  </div>
                )}

                {/* Tier note — revealed only AFTER a transaction type is picked, so we
                    never pre-signal complexity in the picker. Driven by TX_TYPES.category:
                      1 → routine, nothing extra needed (green)
                      2 → reportable but straightforward, we handle it (amber/blue)
                      3 → complex, CPA review recommended + acknowledgment (red) */}
                {txType && txCategory === 1 && (
                  <div className="cat-banner-green" style={{ marginBottom: '1rem' }}>
                    <strong>Straightforward — nothing extra needed from you.</strong> This is a routine item between you and the LLC. Just enter the amount below; we handle the paperwork.
                  </div>
                )}
                {txType && txCategory === 2 && (
                  <div className="cat-banner-amber" style={{ marginBottom: '1rem' }}>
                    <strong>Reportable, and we’ve got it.</strong> This needs to be reported, but it’s a standard case. Enter the details below and we’ll put it on the right part of the form for you.
                  </div>
                )}
                {txType && txCategory === 3 && (
                  <div className="cat-banner-red" style={{ marginBottom: '1rem' }}>
                    <strong>This one’s more involved.</strong> This type of transaction can get complex. We’ll fill in everything we can from your answers, but we recommend a quick CPA review before you submit.
                    <div className="cat3-ack-row" style={{ marginTop: '0.625rem' }}>
                      <input type="checkbox" checked={cat3Acknowledged} onChange={(e) => setCat3Acknowledged(e.target.checked)} id="cat3ack" />
                      <label htmlFor="cat3ack" style={{ fontSize: '0.8125rem', cursor: 'pointer' }}>I understand — proceed anyway</label>
                    </div>
                  </div>
                )}

                <div style={gridStyle}>
                  {DIRECTION_TYPES.has(txType) && (
                    <Field label="Who paid?" required>
                      <select value={txDir} onChange={(e) => setTxDir(e.target.value as 'paid' | 'received')}>
                        <option value="received">LLC received the money</option>
                        <option value="paid">LLC paid the money</option>
                      </select>
                    </Field>
                  )}
                  {LOAN_TYPES.has(txType) && (
                    <Field
                      label="Beginning balance (USD)"
                      hint="Outstanding loan balance at the START of the tax year (0 if the loan started this year)"
                    >
                      <input type="number" min={0} value={txLoanBegin} onChange={(e) => setTxLoanBegin(e.target.value)} placeholder="0" />
                    </Field>
                  )}
                  <Field
                    label={selectedTxMeta?.amountLabel ?? 'Amount (USD)'}
                    hint={selectedTxMeta?.amountOptional ? '(optional)' : selectedTxMeta?.amountHint}
                    required={!selectedTxMeta?.amountOptional && !PART_V_TYPES.has(txType) && !PART_VI_TYPES.has(txType)}
                  >
                    <input type="number" min={0} value={txAmt} onChange={(e) => setTxAmt(e.target.value)} placeholder="0" />
                  </Field>
                  <Field label="Transaction date" hint="optional">
                    <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                  </Field>
                  <Field label="Description" hint="optional" style={{ gridColumn: '1 / -1' }}>
                    <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Short description (optional)" />
                  </Field>
                </div>

                <button
                  type="button"
                  style={{ ...primaryBtnStyle, marginTop: '1rem' }}
                  onClick={addTransaction}
                  disabled={txCategory === 3 && !cat3Acknowledged}
                >
                  Add transaction
                </button>
              </section>
            )}

            {transactions.length === 0 && (
              <label className={`confirm-check-row${noTransactionsConfirmed ? ' is-selected' : ''}`} style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={noTransactionsConfirmed}
                  onChange={(e) => setNoTransactionsConfirmed(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text, #111)' }}>
                    The LLC had no reportable transactions this year
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--tf-text-muted, #6b7280)', marginTop: '0.15rem' }}>
                    This is uncommon. If the LLC received any capital contributions or made any payments, those are reportable.
                  </div>
                </div>
              </label>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="button" style={secondaryBtnStyle} onClick={handleBack}>Back</button>
              <button type="button" style={primaryBtnStyle} onClick={handleNext} disabled={saving}>{saving ? 'Saving…' : 'Continue'}</button>
            </div>
          </div>
        )}

        {/* ── Step 5: Review ── */}
        {step === 5 && (
          <div>
            <h2 style={stepHeadingStyle}>Review & submit</h2>
            <p style={stepSubheadStyle}>Check everything below before we start preparing your forms.</p>

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>LLC details</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Name" value={llcName} />
                <SummaryRow label="EIN" value={ein} />
                <SummaryRow label="State" value={stateOfFormation} />
                <SummaryRow label="Tax year" value={taxYear} />
                <SummaryRow label="Total assets" value={totalAssets ? `USD ${Number(totalAssets).toLocaleString()}` : null} />
                <SummaryRow label="Incorporated" value={entityDOI} />
                <SummaryRow label="Principal country" value={entityPrincipalCountry} />
                <SummaryRow label="Business type" value={entityBizActivity} />
                <SummaryRow label="Business code" value={entityBizCode} />
              </div>
            </section>

            {show1b && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Filing status</h3>
                <div style={reviewGridStyle}>
                  <SummaryRow label="Extension filed" value={extensionFiled === null ? '—' : extensionFiled ? 'Yes' : 'No'} />
                  <SummaryRow label="Reasonable cause letter" value={includeReasonableCause ? 'Yes (+$200)' : 'No'} />
                  {includeReasonableCause && reasonableCauseReasons.length > 0 && (
                    <SummaryRow label="Reasons" value={reasonableCauseReasons.join(', ')} />
                  )}
                </div>
              </section>
            )}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Primary owner</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Name" value={ownerName} />
                <SummaryRow label="Country of business" value={ownerCountry} />
                <SummaryRow label="Tax residence" value={ownerCountryRes} />
                <SummaryRow label="Citizenship" value={ownerCountryCitizenship} />
                <SummaryRow label="Foreign tax ID" value={ownerForeignTaxId} />
                <SummaryRow label="Reference code" value={ownerRefNumber} />
                <SummaryRow label="Business type" value={ownerBizActivity || RP_NAICS.find((n) => n.code === ownerBizCode)?.label} />
                <SummaryRow label="Business code" value={ownerBizCode} />
              </div>
            </section>

            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Related parties ({relatedParties.length})</h3>
                {relatedParties.map((rp, i) => (
                  <div key={i} style={{ ...reviewGridStyle, marginBottom: '0.75rem' }}>
                    <SummaryRow label="Name" value={rp.name} />
                    <SummaryRow label="Country" value={rp.country} />
                    <SummaryRow label="Tax residence" value={rp.country_residence} />
                    <SummaryRow label="Ref code" value={rp.ref_number} />
                    <SummaryRow label="Business type" value={rp.biz_activity} />
                  </div>
                ))}
              </section>
            )}

            {transactions.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
                <TxSummaryPanel summary={txSummary} count={transactions.length} />
                {transactions.map((t, i) => {
                  const meta = TX_TYPES.find((x) => x.value === t.transaction_type);
                  return (
                    <div key={i} style={{ ...reviewGridStyle, marginBottom: '0.5rem' }}>
                      <SummaryRow label="Type" value={meta?.label ?? t.transaction_type} />
                      <SummaryRow label="Party" value={allPartyLabels[t.related_party_index] ?? '—'} />
                      <SummaryRow label="Amount" value={t.amount_usd ? `USD ${Number(t.amount_usd).toLocaleString()}` : '—'} />
                      {DIRECTION_TYPES.has(t.transaction_type) && <SummaryRow label="Direction" value={t.direction} />}
                    </div>
                  );
                })}
              </section>
            )}

            {noTransactionsConfirmed && (
              <div style={infoBoxStyle}>No reportable transactions confirmed.</div>
            )}

            {!isPaidLocked && (
              <div className="cat-banner-amber" style={{ marginTop: '1.5rem' }}>
                <strong>Before you submit:</strong> once you pay, your company and owner identity —
                EIN, LLC name, tax year, your legal name &amp; foreign tax ID, and incorporation date —
                are locked and cannot be changed. To file for a different company or year you’d start a new
                filing. Other details (addresses, transactions) can still be corrected afterward. Please
                double-check these now.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="button" style={secondaryBtnStyle} onClick={handleBack}>Back</button>
              <button type="button" style={primaryBtnStyle} onClick={handleSubmit} disabled={saving || (isPaidLocked && editsRemaining === 0)}>
                {saving ? 'Submitting…' : isPaidLocked ? 'Save corrections & re-download' : 'Submit for processing'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
