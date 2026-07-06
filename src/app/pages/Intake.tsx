// src/app/pages/Intake.tsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Filing } from '../../lib/supabase';
import { mapTransactionForPersist, summarizeTransactions } from '../../lib/filingMapping';
import { loadProfile, saveProfileFromFiling } from '../../lib/filingProfile';
import {
  BIZ_ACTIVITIES,
  COUNTRIES,
  DIRECTION_TYPES,
  FILING_DUE_DATES,
  LOAN_TYPES,
  PART_V_TYPES,
  PART_VI_TYPES,
  type QuickTx,
  REASONABLE_CAUSE_REASONS,
  RELATED_PARTY_TX,
  RP_NAICS,
  SIMPLE_TX,
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
// True when the entity was formed WITHIN the filing period. For a calendar-year
// filer that's simply "formed in the tax year". For a fiscal-year filer the
// period can span two calendar years, so we test membership in the derived
// [begin, end] window.
function isInitialReturn(
  doiISO: string,
  taxYear: string,
  fiscalEndMonth?: number | '',
): boolean {
  if (!doiISO) return false;
  if (fiscalEndMonth && fiscalEndMonth !== 12) {
    const { begin, end } = deriveFiscalPeriod(taxYear, fiscalEndMonth);
    return doiISO >= begin && doiISO <= end;
  }
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

// ── Money formatting ────────────────────────────────────────────────────────
// Amount fields display with thousands separators (1,000,000) while storing a
// plain numeric string in state. Only dollar amounts are formatted — never
// EIN / TIN / reference IDs, which stay raw.

/** Strip everything except digits and a single decimal point. */
function stripMoney(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  // keep only the first decimal point
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

// ── Fiscal period derivation ────────────────────────────────────────────────
// A fiscal tax year is DESIGNATED by the calendar year in which it BEGINS —
// the IRS convention. So "tax year Y" begins on the first day of month (M+1) in
// year Y and ends on the last day of month M in the FOLLOWING year (Y+1).
// e.g. fiscal year ending March, tax year 2025 → April 1, 2025 through
// March 31, 2026 (filed on the 2025 form). A December end (M=12) is the plain
// calendar year Y.
function deriveFiscalPeriod(taxYear: string, endMonth: number): { begin: string; end: string } {
  const y = Number(taxYear);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (endMonth === 12) {
    return { begin: `${y}-01-01`, end: `${y}-12-31` };
  }
  const begin = `${y}-${pad(endMonth + 1)}-01`;
  const endYear = y + 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate(); // last day of endMonth in Y+1
  const end = `${endYear}-${pad(endMonth)}-${pad(lastDay)}`;
  return { begin, end };
}

/** Display an ISO date (YYYY-MM-DD) as MM/DD/YYYY. */
function formatDateMMDDYYYY(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
}

/** Format a numeric string with thousands separators for display. */
function formatMoney(value: string): string {
  if (!value) return '';
  const [intPart, decPart] = value.split('.');
  const withCommas = intPart ? Number(intPart).toLocaleString('en-US') : '';
  if (value.endsWith('.')) return `${withCommas}.`;
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
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
  status,
}: {
  label: string;
  /** Deprecated: longer guidance. Routed into the (i) tooltip, never shown inline. */
  hint?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  required?: boolean;
  /** Guidance shown behind a clickable (i) icon (the single helper per field). */
  tooltip?: string;
  /** Short always-visible status suffix, e.g. "optional" or "locked". */
  status?: string;
}) {
  // Exactly one helper per field: the (i) tooltip carries all guidance. Any
  // legacy `hint` becomes tooltip text (so nothing is duplicated or lost).
  // `status` is the only thing shown inline, for short state words like
  // "optional" — not guidance.
  const tip = tooltip ?? hint;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-muted)' }}>
        {label}
        {required && <span style={{ color: 'var(--tf-error)', marginLeft: '0.2rem' }}>*</span>}
        {status && <span style={{ fontWeight: 400, marginLeft: '0.25rem', fontStyle: 'italic' }}>{status}</span>}
        {tip && <InfoTooltip text={tip} label={`About ${label}`} />}
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
            <option value="">Select state</option>
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
            <option value="">Select country</option>
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

/** One-line readable address from the intake address shape, or null if empty. */
function formatAddress(a?: { line1?: string; city?: string; region?: string; postal_code?: string; country?: string } | null): string | null {
  if (!a) return null;
  const parts = [a.line1, a.city, a.region, a.postal_code, a.country].map((p) => (p ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

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
        The “gross payments” figure (Form 5472 line 1f/1h) counts service, rent, royalty and goods dealings. Money you put in or took out, and loan balances, are reported on their own lines, so the two numbers can differ. That is expected.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
        {bucket('Money in', summary.bucketIn, 'var(--tf-success)')}
        {bucket('Money out', summary.bucketOut, 'var(--tf-accent)')}
        {bucket('Other dealings', summary.bucketOther, 'var(--tf-text)')}
      </div>
    </div>
  );
}

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

  // Anchors for scroll management. On Continue/Back we jump to the top of the
  // step; when validation fails we jump straight to the error summary so the
  // user is never left guessing why the form did not advance.
  const stepTopRef = useRef<HTMLDivElement | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);

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
  // Single-year multi-year nudge: when filing the latest year and the LLC was
  // incorporated earlier, we ask whether earlier returns were already filed.
  // null = not answered, true = already filed (no nudge), false = not filed
  // (offer multi-year).
  const [earlierReturnsFiled, setEarlierReturnsFiled] = useState<boolean | null>(null);
  // Final return + fiscal-year (non-calendar) filing
  const [finalReturn, setFinalReturn] = useState(false);
  const [isFiscalYear, setIsFiscalYear] = useState(false);
  // For a fiscal-year filer we only collect the fiscal YEAR-END MONTH (1–12).
  // The period is then derived deterministically from the tax year, so the user
  // can no longer pick a year that conflicts with the filing year.
  const [fiscalEndMonth, setFiscalEndMonth] = useState<number | ''>('');

  // Step 1b
  const [extensionFiled, setExtensionFiled] = useState<boolean | null>(null);
  const [includeReasonableCause, setIncludeReasonableCause] = useState(false);
  const [reasonableCauseReasons, setReasonableCauseReasons] = useState<string[]>([]);

  // Whether THIS year's return is late for reasonable-cause purposes. The check
  // is year-specific (each tax year has its own deadlines):
  //   • no extension  → late once the ORIGINAL deadline has passed
  //   • extension filed → late once the EXTENDED deadline has passed too
  //     (a 7004 only buys until the extended date; past that the return is late)
  // While the extension is still valid (within_extension) the filing is on time,
  // so no reasonable-cause letter — and no "not required" message — is shown.
  const isLateForRcl =
    extensionFiled === true
      ? filingTiming.extendedPassed
      : extensionFiled === false
        ? filingTiming.originalPassed
        : false;
  const onTimeViaExtension =
    extensionFiled === true && filingTiming.originalPassed && !filingTiming.extendedPassed;

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
  // Signing title (goes on the 1120 signature block + RCL). Defaults to
  // "Managing Member", the usual role for a single-member LLC owner.
  const [signerTitle, setSignerTitle] = useState('Managing Member');
  // Date the owner signs — printed on the Form 1120 "Date" line (all years) so
  // the package prints ready to mail. ISO YYYY-MM-DD.
  const [signatureDate, setSignatureDate] = useState('');

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
  // For a multi-year job: is there another draft year AFTER this one to file?
  const [hasNextDraftYear, setHasNextDraftYear] = useState(false);
  // Once a filing has been completed at least once (submitted / paid), every
  // step is freely navigable — from step 1 the user can jump straight to step 5.
  const [completedOnce, setCompletedOnce] = useState(false);
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
  // Two-tier transaction entry: the detailed category accordion is hidden until
  // the user asks for it (the quick list covers the common ~90%).
  const [showDetailedTx, setShowDetailedTx] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

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

  // Continue/Back: land at the TOP of the new step, not wherever the previous
  // step was scrolled to. Intake changes steps via a query param (?step=N), so
  // the router's pathname-based ScrollToTop does not fire here — we do it.
  useEffect(() => {
    if (loadingFiling) return;
    // Let the new step render before scrolling to it.
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      stepTopRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }, [step, loadingFiling]);

  // When validation fails, jump straight to the error summary so the user sees
  // exactly what needs fixing instead of a form that silently did not advance.
  useEffect(() => {
    if (stepErrors.length === 0 && !error && !einErr) return;
    requestAnimationFrame(() => {
      errorSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [stepErrors, error, einErr]);

  // When the filing turns out to be late (deadline passed — for a 7004 filer,
  // the EXTENDED deadline), pre-select the reasonable-cause letter so the user
  // is asked by default. If the extension is still valid, ensure it is off.
  const rclSectionShown = !jobId && isLateForRcl;
  useEffect(() => {
    if (!rclSectionShown && includeReasonableCause) {
      setIncludeReasonableCause(false);
      setReasonableCauseReasons([]);
    } else if (rclSectionShown && !includeReasonableCause && reasonableCauseReasons.length === 0) {
      // Default the offer ON for a late filing (user can still opt out).
      setIncludeReasonableCause(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rclSectionShown]);

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
      // A filing that has moved past 'draft' has been through every step once,
      // so allow free step navigation on return visits.
      setCompletedOnce(f.status === 'in_progress' || f.status === 'paid' || f.status === 'completed');

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
      setSignerTitle((f as any).signer_title ?? 'Managing Member');
      setSignatureDate((f as any).signature_date ?? '');
      if ((f as any).related_parties) setRelatedParties((f as any).related_parties as RelatedParty[]);
      setNoTransactionsConfirmed((f as any).no_transactions_confirmed ?? false);
      setPartViManagerial((f as any).part_vi_managerial ?? true);
      setJobId((f as any).job_id ?? null);
      // Determine whether a later draft year remains in this job (drives the
      // submit-button label: "File next year" vs "Finish & review").
      const thisJobId = (f as any).job_id ?? null;
      if (thisJobId) {
        const { data: sibs } = await supabase
          .from('filings')
          .select('id, tax_year, status')
          .eq('job_id', thisJobId);
        const remaining = (sibs ?? []).some(
          (s: any) => s.id !== filingId && s.status === 'draft',
        );
        setHasNextDraftYear(remaining);
      } else {
        setHasNextDraftYear(false);
      }
      setFinalReturn((f as any).final_return ?? false);
      setIsFiscalYear((f as any).is_fiscal_year ?? false);
      const storedEnd = (f as any).tax_period_end as string | null | undefined;
      setFiscalEndMonth(storedEnd ? Number(storedEnd.split('-')[1]) : '');

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

      // Backfill entity/owner identity from the saved profile for any field the
      // filing row itself left empty. This matters for multi-year jobs, where a
      // per-year row may have been seeded before the profile existed — e.g. the
      // owner's country should carry across every year, not be re-selected each
      // time. Only empty fields are filled; nothing the row already has is touched.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const profile = user ? await loadProfile(user.id) : null;
        if (profile) {
          const bf = (val: string | null | undefined) => (setter: (u: (c: string) => string) => void) => {
            if (val) setter((c) => (c && c.trim() ? c : (val ?? '')));
          };
          bf(profile.owner_country ?? profile.owner_primary_country)(setOwnerCountry);
          bf(profile.owner_country_residence)(setOwnerCountryRes);
          bf(profile.owner_country_citizenship)(setOwnerCountryCitizenship);
          bf(profile.owner_full_name)(setOwnerName);
          bf(profile.llc_name)(setLlcName);
          bf(profile.state_of_formation)(setStateOfFormation);
        }
      } catch { /* profile backfill is best-effort */ }

      // Honor the step requested in the URL for this filing. When the multi-year
      // walk sends the user to the next year at ?step=3, the component does not
      // remount (same route, new query), so sync the step here after load.
      const rawStep = params.get('step');
      if (rawStep === '1b') setStep('1b');
      else {
        const s = Number(rawStep);
        if (s >= 1 && s <= 5) setStep(s as IntakeStep);
      }

      setLoadingFiling(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setSignerTitle((c) => (c && c !== 'Managing Member' ? c : (profile.signer_title || 'Managing Member')));
      setOwnerAddress((c) => (c && c.line1 ? c : ((profile.owner_address as Address) ?? {})));
      if (profile.related_parties && Array.isArray(profile.related_parties)) {
        setRelatedParties((c) => (c.length ? c : (profile.related_parties as RelatedParty[])));
      }
      setPrefilledFromProfile(true);
    })();
    return () => { cancelled = true; };
  }, [filingId]);

  // Auto-generate the owner reference code whenever we have an owner name but no
  // reference code yet — covers the case where the name was prefilled from the
  // database/profile (not typed), so the user never triggered the onChange path.
  useEffect(() => {
    if (ownerName.trim() && !ownerRefNumber.trim()) {
      setOwnerRefNumber(buildOwnerRef(ownerName));
    }
  }, [ownerName, ownerRefNumber]);

  // Fields that are SPECIFIC to a single tax year and must never be copied to
  // sibling year-rows in a multi-year job. Everything else in a Step-1/2 patch
  // is company/owner identity that is shared across every year.
  const YEAR_SPECIFIC_FIELDS = new Set<string>([
    'tax_year', 'total_assets', 'initial_return', 'final_return',
    'is_fiscal_year', 'tax_period_begin', 'tax_period_end',
    'extension_filed', 'include_rcl', 'include_reasonable_cause',
    'reasonable_cause_reasons',
  ]);

  /** Strip year-specific fields so only shared company/owner data propagates. */
  function sharedJobPatch(
    patch: Partial<Filing> & Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(patch).filter(([k]) => !YEAR_SPECIFIC_FIELDS.has(k)),
    );
  }

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
      // Initial return: the LLC was formed within the filing period (calendar or fiscal).
      initial_return: isInitialReturn(entityDOI, taxYear, isFiscalYear ? fiscalEndMonth : ''),
      // Final return + fiscal-year (non-calendar) period.
      final_return: finalReturn,
      is_fiscal_year: isFiscalYear,
      tax_period_begin: isFiscalYear && fiscalEndMonth ? deriveFiscalPeriod(taxYear, fiscalEndMonth).begin : null,
      tax_period_end: isFiscalYear && fiscalEndMonth ? deriveFiscalPeriod(taxYear, fiscalEndMonth).end : null,
    };
    if (step === '1b') {
      // A reasonable-cause letter only applies to a genuinely late filing. The
      // filing is late once the applicable deadline has passed — the ORIGINAL
      // deadline with no extension, or the EXTENDED deadline for a 7004 filer.
      // If the 7004 extension is still valid the filing is on time, so no RCL.
      const rclApplies = includeReasonableCause && isLateForRcl;
      return {
        extension_filed: extensionFiled,
        include_reasonable_cause: rclApplies,
        reasonable_cause_reasons: rclApplies ? reasonableCauseReasons : [],
        // Canonical flag the PDF generator reads.
        include_rcl: rclApplies,
      };
    }
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
      signer_title: signerTitle.trim() || 'Managing Member',
      signature_date: signatureDate || null,
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
    if (entityDOI && taxYear) {
      const doiYear = Number(entityDOI.slice(0, 4));
      const ty = Number(taxYear);
      if (isFiscalYear && fiscalEndMonth && fiscalEndMonth !== 12) {
        // Fiscal filer: the period can run into the following calendar year, so
        // validate against the derived period end rather than the tax-year number.
        const { end } = deriveFiscalPeriod(taxYear, fiscalEndMonth);
        if (entityDOI > end) {
          errs.push(`The incorporation date (${entityDOI}) is after the end of the ${ty} fiscal year (${end}). An LLC cannot be incorporated after the period it is filing for. Check the date, the tax year, or the fiscal year-end.`);
        } else if (doiYear < 1900) {
          errs.push('Check the date of incorporation. The year does not look right.');
        }
      } else {
        // Calendar filer: the LLC must exist during the tax year.
        if (doiYear > ty) {
          errs.push(`The incorporation date (${entityDOI}) is after the ${ty} tax year. An LLC cannot be incorporated after the year it is filing for. Check the date or the tax year.`);
        } else if (doiYear < 1900) {
          errs.push('Check the date of incorporation. The year does not look right.');
        }
      }
    }
    if (!entityPrincipalCountry) errs.push('Select the principal country where business is conducted.');
    if (!entityBizActivity) errs.push('Select the LLC principal business activity.');
    if (!entityBizCode.trim()) errs.push('Enter the LLC business activity code.');
    if (!isAddressComplete(mailing, true)) errs.push('Complete the LLC mailing address.');
    return errs;
  }

  function validateStep1b(): string[] {
    const errs: string[] = [];
    if (extensionFiled === null) errs.push('Please confirm whether Form 7004 (extension) was filed.');
    // Reasons are only collected here for a single-year, genuinely-late filing.
    // Multi-year jobs collect the RCL + reasons once at job setup; a filing still
    // within its extension is on time, so the RCL section is not shown.
    if (rclSectionShown && includeReasonableCause && reasonableCauseReasons.length === 0) {
      errs.push('Select at least one reason for the reasonable cause letter.');
    }
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

      // Multi-year job: Steps 1 and 2 (company + owner) are the SAME for every
      // year, so once entered on one year they are copied to every other draft
      // year in the job. That way the later years skip straight to Step 3 and
      // the user never re-enters the same company/owner details. Year-specific
      // fields (tax_year, total_assets, initial_return, fiscal period, final
      // return, RCL) are intentionally excluded from the shared patch.
      if (jobId && (step === 1 || step === 2)) {
        const shared = sharedJobPatch(finalPatch);
        if (Object.keys(shared).length > 0) {
          await supabase
            .from('filings')
            .update(shared)
            .eq('job_id', jobId)
            .neq('id', filingId)
            .eq('status', 'draft');
        }
      }
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

      // Reconcile with what is already stored: any DB row whose id is no longer
      // present in the current (valid) set must be DELETED, so an edited filing
      // replaces its transactions rather than accumulating stale ones. This also
      // clears rows that were emptied out or removed in the UI.
      const keptIds = new Set(validTxns.map((t) => t.id).filter(Boolean) as string[]);
      const { data: existing } = await supabase
        .from('reportable_transactions')
        .select('id')
        .eq('filing_id', activeFilingId);
      const toDelete = (existing ?? [])
        .map((r: { id: string }) => r.id)
        .filter((id) => !keptIds.has(id));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('reportable_transactions')
          .delete()
          .in('id', toDelete);
        if (delErr) throw delErr;
      }

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

  // Switch a single-year filing to the multi-year catch-up. Persist whatever
  // company/owner details have been entered so far to the user's profile so the
  // year picker + each year's intake prefill them — the user doesn't re-type
  // Step 1/2. Best-effort: navigate even if the profile write fails.
  const goToMultiYearWithDetails = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await saveProfileFromFiling(user.id, {
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
          owner_address: ownerAddress,
          owner_business_activity: ownerBizActivity.trim() || null,
          owner_business_code: ownerBizCode.trim() || null,
          owner_naics_code: ownerBizCode.trim() || null,
          signer_title: signerTitle.trim() || 'Managing Member',
          related_parties: relatedParties,
        });
      }
    } catch { /* best-effort: still go to the picker */ }
    navigate('/catch-up');
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
          signer_title: signerTitle.trim() || 'Managing Member',
          related_parties: relatedParties,
        });
      } catch { /* profile save is non-critical */ }

      // Multi-year catch-up: file chronologically. After finishing this year,
      // jump forward to the EARLIEST remaining draft year (ascending), so the
      // user walks 2022 → 2023 → 2024 → 2025. When every year is done, go to the
      // job's package page to review/download the whole catch-up.
      if (jobId) {
        const { data: siblings } = await supabase
          .from('filings')
          .select('id, tax_year, current_step, status')
          .eq('job_id', jobId)
          .order('tax_year', { ascending: true });
        const nextYear = (siblings ?? []).find(
          (s) => s.id !== filingId && s.status === 'draft',
        );
        if (nextYear) {
          // Company + owner (Steps 1-2) were just propagated to this year, so
          // send the user straight to Step 3 (related parties). The stepper
          // still lets them step back to review Steps 1-2 for this year if a
          // year-specific detail needs changing.
          navigate(`/intake?filing_id=${nextYear.id}&step=3`);
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
    setOpenCategory(null);
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
        {/* Intake page header — a clean, consistent title bar above the stepper */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              style={{ background: 'none', border: 'none', color: 'var(--tf-muted)', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, padding: 0, marginBottom: '0.35rem' }}
            >
              ← Dashboard
            </button>
            <h1 style={{ fontSize: '1.375rem', lineHeight: 1.2, margin: 0, color: 'var(--tf-text)' }}>
              {llcName?.trim() || 'Your Form 5472 filing'}
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--tf-muted)', margin: '0.2rem 0 0' }}>
              Form 5472 + pro forma 1120 · Tax year {taxYear}
            </p>
          </div>
        </div>

        {jobId && (
          <div style={{ background: 'rgba(var(--tf-accent-rgb), 0.08)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.625rem 1rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: 'var(--tf-text)' }}>
            <strong>Catch-up filing for tax year {taxYear}.</strong> Finish this year and we’ll take you to the next one. Your LLC and owner details are shared across all the years you selected.
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
              // Navigable if it's an already-completed step, OR the whole filing
              // has been completed once (then any step — including jumping from
              // step 1 straight to step 5 — is reachable).
              const navigable = isDone || completedOnce;
              return (
                <button
                  key={String(s)}
                  type="button"
                  className={['stepper-pill', isActive ? 'stepper-pill--active' : '', isDone ? 'stepper-pill--done' : '', isPending ? 'stepper-pill--pending' : ''].join(' ')}
                  onClick={() => { if (navigable && !isActive) goToStepByIndex(idx); }}
                  aria-current={isActive ? 'step' : undefined}
                  tabIndex={navigable ? 0 : -1}
                  style={navigable && !isActive ? { cursor: 'pointer' } : undefined}
                >
                  {isDone && <span className="stepper-check" aria-hidden="true">✓</span>}
                  {typeof s === 'number' ? `${s}. ` : ''}{shortLabel}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Scroll anchor: Continue/Back lands here (top of the step). */}
        <div ref={stepTopRef} aria-hidden="true" />

        {completedOnce && step !== 5 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-0.25rem', marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={() => goToStepByIndex(stepOrder.length - 1)}
              style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, padding: '0.25rem 0' }}
            >
              Done editing? Jump back to review →
            </button>
          </div>
        )}

        {isPaidLocked && (
          <div className={editsRemaining > 0 ? 'cat-banner-amber' : 'cat-banner-red'} style={{ marginBottom: '1.25rem' }}>
            <strong>This filing has been paid.</strong> Your company and owner identity (EIN, LLC name, tax year, owner name &amp; tax ID, incorporation date) are locked. To file for a different company or year, start a new filing.{' '}
            {editsRemaining > 0
              ? `You can still correct other details (addresses, transactions) and re-download. ${editsRemaining} correction${editsRemaining > 1 ? 's' : ''} remaining.`
              : 'You have used all available corrections; contact support@filetax.co for further changes. You can still re-download anytime.'}
          </div>
        )}

        <div ref={errorSummaryRef}>
          {error && <div style={errorSummaryStyle}>{error}</div>}
          {stepErrors.length > 0 && (
            <div style={errorSummaryStyle}>
              <div style={{ fontWeight: 700, marginBottom: '0.45rem' }}>Please complete the following before continuing</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {stepErrors.map((msg, i) => <li key={i} style={{ marginBottom: '0.25rem' }}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>

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

            {/* Single-year multi-year nudge. Two situations lead to offering a
                multi-year catch-up:
                  A) Filing the LATEST filable year, but the LLC was incorporated
                     in an earlier year. We first ASK whether earlier returns
                     were already filed. If yes → caught up, no nudge. If no →
                     offer multi-year.
                  B) Filing a year that is NOT the latest — earlier years are
                     almost certainly outstanding, so offer multi-year directly. */}
            {!jobId && !isPaidLocked && (() => {
              const latestFilable = new Date().getUTCFullYear() - 1;
              const ty = Number(taxYear);
              const doiYear = entityDOI ? Number(entityDOI.slice(0, 4)) : null;
              const incorpBefore = doiYear != null && doiYear < ty;
              const isLatest = ty === latestFilable;

              // Offer text + CTA, shared by both branches. Agreeing saves the
              // current company/owner details to the profile so the multi-year
              // form prefills them, then goes to the year picker.
              const offer = (
                <>
                  Catching up on every missed year together means one
                  reasonable-cause letter covers them all, and you don't pay the
                  letter fee per year.{' '}
                  <button
                    type="button"
                    onClick={goToMultiYearWithDetails}
                    style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    File multiple years →
                  </button>
                </>
              );

              // Situation B: not the latest year → offer directly.
              if (!isLatest && ty >= 2019) {
                return (
                  <div className="cat-banner-amber" style={{ marginBottom: '1.5rem' }}>
                    <strong>Filing more than one year?</strong> You're filing {ty},
                    which isn't the most recent year. {offer}
                  </div>
                );
              }

              // Situation A: latest year, incorporated earlier → ask first.
              if (isLatest && incorpBefore) {
                return (
                  <div className="cat-banner-amber" style={{ marginBottom: '1.5rem' }}>
                    <strong>Have you already filed for earlier years?</strong>{' '}
                    Your LLC was formed in {doiYear}, so Form 5472 may be due for
                    each year since.
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => setEarlierReturnsFiled(true)}
                        className={`select-card${earlierReturnsFiled === true ? ' is-selected' : ''}`}
                        style={{ cursor: 'pointer', flex: 1 }}
                      >
                        <span className="select-card-label">Yes, earlier years are filed</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEarlierReturnsFiled(false)}
                        className={`select-card${earlierReturnsFiled === false ? ' is-selected' : ''}`}
                        style={{ cursor: 'pointer', flex: 1 }}
                      >
                        <span className="select-card-label">No, not yet</span>
                      </button>
                    </div>
                    {earlierReturnsFiled === false && (
                      <div style={{ marginTop: '0.75rem' }}>{offer}</div>
                    )}
                    {earlierReturnsFiled === true && (
                      <div style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
                        Great, you're caught up. Continue with just {ty} below.
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            })()}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Company information</h3>
              <div style={gridStyle}>
                <Field label="LLC / Corporation name" style={{ gridColumn: '1 / -1' }} required status={isPaidLocked ? 'locked after payment' : undefined}>
                  <input value={llcName} onChange={(e) => setLlcName(e.target.value)} placeholder="e.g. Acme Global LLC" disabled={isPaidLocked} />
                </Field>
                <Field label="EIN" status={isPaidLocked ? 'locked after payment' : undefined} required tooltip="Your LLC's 9-digit federal tax ID (format 12-3456789). Find it on your IRS EIN confirmation (CP-575), your formation service dashboard (Stripe Atlas, Doola, Firstbase), or by searching your email for 'EIN'.">
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
                <Field label="Tax year" required status={isPaidLocked ? 'locked after payment' : undefined}>
                  <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)} disabled={isPaidLocked}>
                    {TAX_YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </Field>
                <Field label="Total assets (USD)" status="optional" tooltip="Usually your LLC's bank balance on December 31, plus the value of anything else it owns (equipment, inventory). A rough figure is fine.">
                  <input type="text" inputMode="numeric" value={formatMoney(totalAssets)} onChange={(e) => setTotalAssets(stripMoney(e.target.value))} placeholder="e.g. 50,000" />
                </Field>
                <Field label="Date of incorporation" required status={isPaidLocked ? 'locked after payment' : undefined} tooltip="The date your LLC was officially formed, shown on your formation documents (Articles of Organization / Certificate of Formation).">
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
                    <Field label="Fiscal year-end month" required tooltip="The month your LLC's fiscal year ends. We derive the exact tax period from your tax year, so it always lines up with the year you're filing.">
                      <select value={fiscalEndMonth} onChange={(e) => setFiscalEndMonth(e.target.value ? Number(e.target.value) : '')}>
                        <option value="">Select month</option>
                        {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                          <option key={m} value={i + 1}>{m}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {fiscalEndMonth !== '' && (
                    <div className="cat-banner-amber" style={{ marginTop: '0.875rem' }}>
                      <strong>Fiscal-year filing.</strong> For tax year {taxYear}, your period runs{' '}
                      {(() => { const p = deriveFiscalPeriod(taxYear, fiscalEndMonth); return `${p.begin} through ${p.end}`; })()}.
                      Double-check your filing due date before submitting.
                    </div>
                  )}
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
                    Only if the LLC closed or dissolved this year, not for a quiet year.
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

            {jobId && isLateForRcl && (
              <section style={sectionStyle}>
                <div className="cat-banner-green">
                  <strong>Your reasonable cause letter is handled for the whole catch-up.</strong> You
                  chose whether to include it, and gave your reasons, when you selected your years — one
                  letter covers every year, so there's nothing to repeat here.
                </div>
              </section>
            )}

            {rclSectionShown && (
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
                      const toggle = () => setReasonableCauseReasons((prev) => checked ? prev.filter((x) => x !== r.value) : [...prev, r.value]);
                      return (
                        <div
                          key={r.value}
                          role="checkbox"
                          aria-checked={checked}
                          tabIndex={0}
                          className={`select-card${checked ? ' is-selected' : ''}`}
                          style={{ cursor: 'pointer' }}
                          onClick={toggle}
                          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
                        >
                          <input type="checkbox" checked={checked} readOnly tabIndex={-1} style={{ pointerEvents: 'none' }} />
                          <div>
                            <div className="select-card-label">{r.label}</div>
                            <div className="select-card-hint">{r.hint}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
            )}

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
                <Field label="Your full legal name" status={isPaidLocked ? 'locked after payment' : undefined} tooltip="As shown on your government ID / passport." style={{ gridColumn: '1 / -1' }} required>
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
                <Field label="Your title / role" tooltip="How you'll sign the return, e.g. Managing Member, Member, President. This prints on the Form 1120 signature block and any reasonable-cause letter. Defaults to Managing Member.">
                  <input
                    value={signerTitle}
                    onChange={(e) => setSignerTitle(e.target.value)}
                    placeholder="Managing Member"
                  />
                </Field>
                <Field label="Signature date" hint="The date you'll sign the return" tooltip="We print this as the signature date on the Form 1120 for every year, so your forms are ready to print and mail as-is. Use the date you plan to sign and send them.">
                  <input
                    type="date"
                    value={signatureDate}
                    onChange={(e) => setSignatureDate(e.target.value)}
                  />
                </Field>
                <Field label="Country where you do business" required tooltip="The country where you mainly carry out your own work or business activity. For many owners this is where they live and work.">
                  <select value={ownerCountry} onChange={(e) => setOwnerCountry(e.target.value)}>
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Country where you pay taxes" required tooltip="The country where you are a tax resident, i.e. where you file your personal income taxes.">
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
                <Field label="Your foreign tax ID" status={isPaidLocked ? 'locked after payment' : undefined} required tooltip="The tax ID number your home country issues you, such as PAN (India), UTR (UK), NIF (Spain), or SIN (Canada). If your country does not issue one, enter 'None'.">
                  <input value={ownerForeignTaxId} onChange={(e) => setOwnerForeignTaxId(e.target.value)} placeholder="Your local tax ID" disabled={isPaidLocked} />
                </Field>
                <Field label="US tax ID" hint="SSN, ITIN, or EIN, if you have one" tooltip="Only if you happen to have a US tax ID (SSN, ITIN, or your own EIN). Most foreign owners don't have one, so leave it blank if so.">
                  <input value={ownerSSN} onChange={(e) => setOwnerSSN(e.target.value)} placeholder="XXX-XX-XXXX or XX-XXXXXXX" />
                </Field>
                <Field label="Your reference code" required tooltip="A short code that identifies you. It is printed on Form 5472. We suggest one automatically (e.g. your initials + 001); keep it or change it, it just needs to stay consistent.">
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
                    <Field label="Reference code" required tooltip="A short code identifying this related party. It is printed on Form 5472; keep it consistent.">
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
              Tell us about any money or assets that moved between the LLC and you (or another related party) this year: money you put in, money you took out, loans, and so on. Don’t include normal business sales to customers or payments to vendors like Stripe or AWS.
            </p>

            {/* Owner managerial-services Part VI disclosure — pre-selected, can opt out */}
            <label className={`confirm-check-row${partViManagerial ? ' is-selected' : ''}`} style={{ cursor: 'pointer', background: 'var(--tf-offset)', borderColor: 'var(--tf-border)', marginTop: 0, marginBottom: '1.5rem' }}>
              <input type="checkbox" checked={partViManagerial} onChange={(e) => setPartViManagerial(e.target.checked)} style={{ accentColor: 'var(--tf-accent)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text)' }}>
                  I run the LLC myself (include the standard owner-services note)
                  <InfoTooltip text="As the foreign owner, you typically provide management and services to the LLC that have no set market price. The IRS expects this disclosed on Form 5472 Part VI. We include a standard statement for you. Untick only if this does not apply, and then no Part VI statement is generated." label="About owner services" />
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

              {(() => {
                const isOwnerParty = txRelatedPartyIdx === 0;
                const quickList: QuickTx[] = isOwnerParty ? SIMPLE_TX : RELATED_PARTY_TX;
                const selectQuick = (q: QuickTx) => {
                  setTxType(q.value);
                  if (q.direction) setTxDir(q.direction);
                  else if (!DIRECTION_TYPES.has(q.value)) setTxDir('received');
                  setShowDetailedTx(false);
                  setTxErrors([]);
                };
                return (
                  <>
                    <div style={{ ...sectionLabelStyle, marginBottom: '0.5rem' }}>
                      {isOwnerParty ? 'What happened?' : 'What kind of dealing was this?'}
                    </div>
                    {txErrors.some((e) => e.includes('transaction type')) && (
                      <div style={{ ...errorSummaryStyle, marginBottom: '0.75rem' }}>Choose an option below.</div>
                    )}

                    {/* Quick options — owner gets first-person shortcuts;
                        a related party gets neutral, LLC<->party wording. */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                      {quickList.map((q) => (
                        <button
                          key={q.value}
                          type="button"
                          className={`tx-type-card${txType === q.value ? ' is-selected' : ''}`}
                          onClick={() => selectQuick(q)}
                        >
                          <span className="tx-type-label">{q.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* "Record a different transaction" reveals the full category
                        accordion. No complexity/CPA wording appears until a
                        specific type is actually selected (the tier note below). */}
                    <button
                      type="button"
                      onClick={() => setShowDetailedTx((v) => !v)}
                      style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', padding: '0.75rem 0 0', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                    >
                      {showDetailedTx ? 'Hide other transaction types' : 'Record a different kind of transaction'}
                    </button>

                    {showDetailedTx && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                        {TX_CATEGORIES.map((cat) => {
                          const isOpen = openCategory === cat.key;
                          const typesInCat = TX_TYPES.filter((t) => cat.values.includes(t.value));
                          const hasSelection = typesInCat.some((t) => t.value === txType);
                          return (
                            <div key={cat.key} style={{ ...groupedCardStyle, borderColor: hasSelection ? 'var(--tf-accent)' : 'var(--tf-border)' }}>
                              <div
                                className={`tx-cat-header${isOpen ? ' is-open' : ''}`}
                                onClick={() => setOpenCategory(isOpen ? null : cat.key)}
                                role="button"
                                aria-expanded={isOpen}
                              >
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--tf-text)' }}>{cat.label}</span>
                                    {hasSelection && <span style={{ fontSize: '0.72rem', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', padding: '0.1rem 0.45rem', borderRadius: '1rem', fontWeight: 700 }}>Selected</span>}
                                  </div>
                                  <div style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.2rem' }}>{cat.description}</div>
                                </div>
                                <div className={`tx-cat-chevron${isOpen ? ' is-open' : ''}`}>
                                  <svg viewBox="0 0 20 20" fill="currentColor" width={18} height={18}>
                                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              </div>
                              {isOpen && (
                                <div className="tx-cat-body">
                                  {typesInCat.map((item) => (
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
                                      <span className="tx-type-sentence">{item.sentence.replace('{party}', isOwnerParty ? 'you' : (allPartyLabels[txRelatedPartyIdx] || 'the related party'))}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
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
                {/* Categories 1 (routine) and 2 (standard reportable) show no
                    banner — we only surface a note when the user needs a warning
                    or must give an explicit acknowledgment (category 3). */}
                {txType && txCategory === 3 && (
                  <div className="cat-banner-red" style={{ marginBottom: '1rem' }}>
                    <strong>This one’s more involved.</strong> This type of transaction can get complex. We’ll fill in everything we can from your answers, but we recommend a quick CPA review before you submit.
                    <div className="cat3-ack-row" style={{ marginTop: '0.625rem' }}>
                      <input type="checkbox" checked={cat3Acknowledged} onChange={(e) => setCat3Acknowledged(e.target.checked)} id="cat3ack" />
                      <label htmlFor="cat3ack" style={{ fontSize: '0.8125rem', cursor: 'pointer' }}>I understand, proceed anyway</label>
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
                      <input type="text" inputMode="numeric" value={formatMoney(txLoanBegin)} onChange={(e) => setTxLoanBegin(stripMoney(e.target.value))} placeholder="0" />
                    </Field>
                  )}
                  <Field
                    label={selectedTxMeta?.amountLabel ?? 'Amount (USD)'}
                    status={selectedTxMeta?.amountOptional ? 'optional' : undefined}
                    tooltip={selectedTxMeta?.amountOptional ? undefined : selectedTxMeta?.amountHint}
                    required={!selectedTxMeta?.amountOptional && !PART_V_TYPES.has(txType) && !PART_VI_TYPES.has(txType)}
                  >
                    <input type="text" inputMode="numeric" value={formatMoney(txAmt)} onChange={(e) => setTxAmt(stripMoney(e.target.value))} placeholder="0" />
                  </Field>
                  <Field label="Transaction date" status="optional">
                    <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                  </Field>
                  <Field label="Description" status="optional" style={{ gridColumn: '1 / -1' }}>
                    <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Short description" />
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
                <SummaryRow label="State of formation" value={stateOfFormation} />
                <SummaryRow label="Tax year" value={taxYear} />
                <SummaryRow label="Total assets" value={totalAssets ? `USD ${Number(totalAssets).toLocaleString()}` : null} />
                <SummaryRow label="Date of incorporation" value={formatDateMMDDYYYY(entityDOI)} />
                <SummaryRow label="Principal country" value={entityPrincipalCountry} />
                <SummaryRow label="Business type" value={entityBizActivity} />
                <SummaryRow label="Business code" value={entityBizCode} />
                <SummaryRow label="Mailing address" value={formatAddress(mailing)} />
                <SummaryRow label="Initial return" value={isInitialReturn(entityDOI, taxYear, isFiscalYear ? fiscalEndMonth : '') ? 'Yes' : 'No'} />
                <SummaryRow label="Final return" value={finalReturn ? 'Yes' : 'No'} />
                {isFiscalYear && <SummaryRow label="Fiscal year" value={fiscalEndMonth !== '' ? (() => { const p = deriveFiscalPeriod(taxYear, fiscalEndMonth); return `${p.begin} to ${p.end}`; })() : '—'} />}
              </div>
            </section>

            {show1b && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Filing status</h3>
                <div style={reviewGridStyle}>
                  <SummaryRow label="Extension (Form 7004) filed" value={extensionFiled === null ? '—' : extensionFiled ? 'Yes' : 'No'} />
                  <SummaryRow label="Reasonable cause letter" value={includeReasonableCause ? 'Yes (+$200)' : 'No'} />
                </div>
                {includeReasonableCause && reasonableCauseReasons.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                      Reasons selected
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {reasonableCauseReasons.map((r) => (
                        <li key={r} style={{ fontSize: '0.875rem', color: 'var(--tf-text)' }}>
                          {REASONABLE_CAUSE_REASONS.find((x) => x.value === r)?.label ?? r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                <SummaryRow label="US tax ID" value={ownerSSN} />
                <SummaryRow label="Reference code" value={ownerRefNumber} />
                <SummaryRow label="Business type" value={ownerBizActivity || RP_NAICS.find((n) => n.code === ownerBizCode)?.label} />
                <SummaryRow label="Business code" value={ownerBizCode} />
                <SummaryRow label="Address" value={formatAddress(ownerAddress)} />
              </div>
            </section>

            {relatedParties.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Related parties ({relatedParties.length})</h3>
                {relatedParties.map((rp, i) => (
                  <div key={i} style={{ ...reviewGridStyle, marginBottom: '0.75rem' }}>
                    <SummaryRow label="Name" value={rp.name} />
                    <SummaryRow label="Country of business" value={rp.country} />
                    <SummaryRow label="Tax residence" value={rp.country_residence} />
                    <SummaryRow label="Foreign tax ID" value={rp.foreign_tax_id} />
                    <SummaryRow label="US tax ID" value={rp.us_tin} />
                    <SummaryRow label="Reference code" value={rp.ref_number} />
                    <SummaryRow label="Business type" value={rp.biz_activity} />
                    <SummaryRow label="Business code" value={rp.biz_code} />
                    <SummaryRow label="Address" value={formatAddress(rp.address)} />
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
                  const isLoan = LOAN_TYPES.has(t.transaction_type);
                  return (
                    <div key={i} style={{ ...reviewGridStyle, marginBottom: '0.5rem' }}>
                      <SummaryRow label="Type" value={meta?.label ?? t.transaction_type} />
                      <SummaryRow label="Party" value={allPartyLabels[t.related_party_index] ?? '—'} />
                      <SummaryRow label={isLoan ? 'Closing balance' : 'Amount'} value={t.amount_usd ? `USD ${Number(t.amount_usd).toLocaleString()}` : '—'} />
                      {isLoan && <SummaryRow label="Beginning balance" value={t.loan_begin_usd ? `USD ${Number(t.loan_begin_usd).toLocaleString()}` : 'USD 0'} />}
                      {DIRECTION_TYPES.has(t.transaction_type) && <SummaryRow label="Direction" value={t.direction === 'received' ? 'Money in' : 'Money out'} />}
                      <SummaryRow label="Date" value={t.transaction_date || null} />
                      <SummaryRow label="Description" value={t.description || null} />
                    </div>
                  );
                })}
              </section>
            )}

            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Owner services (Part VI)</h3>
              <div style={reviewGridStyle}>
                <SummaryRow label="Include managerial-services statement" value={partViManagerial ? 'Yes' : 'No'} />
              </div>
            </section>

            {noTransactionsConfirmed && (
              <div style={infoBoxStyle}>No reportable transactions confirmed.</div>
            )}

            {!isPaidLocked && (
              <div className="cat-banner-amber" style={{ marginTop: '1.5rem' }}>
                <strong>Before you submit:</strong> once you pay, your company and owner identity (EIN, LLC name, tax year, your legal name and foreign tax ID, and incorporation date) are locked and cannot be changed. To file for a different company or year you’d start a new
                filing. Other details (addresses, transactions) can still be corrected afterward. Please
                double-check these now.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="button" style={secondaryBtnStyle} onClick={handleBack}>Back</button>
              <button type="button" style={primaryBtnStyle} onClick={handleSubmit} disabled={saving || (isPaidLocked && editsRemaining === 0)}>
                {saving
                  ? 'Submitting…'
                  : isPaidLocked
                    ? 'Save corrections & re-download'
                    : jobId
                      ? (hasNextDraftYear ? 'Save & file next year →' : 'Finish & review all years')
                      : 'Save & continue to review'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
