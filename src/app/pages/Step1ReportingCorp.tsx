import { useMemo } from 'react';

// ── constants ────────────────────────────────────────────────────────────────

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

const CURRENT_TAX_YEAR = String(new Date().getFullYear() - 1);
const TAX_YEARS = Array.from({ length: 5 }, (_, i) => String(Number(CURRENT_TAX_YEAR) - i));

const MONTHS = [
  { value: '01', label: 'January' },  { value: '02', label: 'February' },
  { value: '03', label: 'March' },    { value: '04', label: 'April' },
  { value: '05', label: 'May' },      { value: '06', label: 'June' },
  { value: '07', label: 'July' },     { value: '08', label: 'August' },
  { value: '09', label: 'September' },{ value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const YEARS_INCORP = Array.from({ length: 30 }, (_, i) => String(new Date().getFullYear() - i));

// ── helpers ──────────────────────────────────────────────────────────────────

function buildIso(m: string, d: string, y: string): string | null {
  if (!m || !d || !y || y.length < 4) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Exported so FilingWizard can call it when persisting Step 1. */
export { buildIso };

// ── shared primitives ────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  width: '100%', padding: '0.575rem 0.85rem',
  border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
  background: 'var(--tf-bg)', color: 'var(--tf-text)',
  fontSize: '0.9375rem', boxSizing: 'border-box', minHeight: '42px',
  outline: 'none', transition: 'border-color 140ms ease',
};

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputBase, ...props.style }} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{ ...inputBase, cursor: 'pointer', ...props.style }}
    />
  );
}

function Field({
  label, required, hint, lineRef, children,
}: {
  label: string; required?: boolean; hint?: string; lineRef?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <label style={{
        display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.35rem',
        fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.3rem',
        color: 'var(--tf-text)',
      }}>
        {label}
        {required && <span style={{ color: '#B91C1C' }}>*</span>}
        {lineRef && (
          <span style={{
            fontSize: '0.6875rem', fontWeight: 500,
            background: 'var(--tf-border)', color: 'var(--tf-muted)',
            borderRadius: '0.25rem', padding: '0.1rem 0.35rem', letterSpacing: '0.02em',
          }}>
            {lineRef}
          </span>
        )}
        {hint && (
          <span style={{ fontWeight: 400, color: 'var(--tf-muted)', fontSize: '0.75rem' }}>{hint}</span>
        )}
      </label>
      {children}
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      {children}
    </div>
  );
}

function Row3({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.25fr', gap: '0.75rem' }}>
      {children}
    </div>
  );
}

/** Visual divider with a label — mirrors IRS section headings */
function PartLabel({ part, title, subtitle }: { part: string; title: string; subtitle?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      margin: '1.75rem 0 1.1rem',
    }}>
      <div style={{
        flexShrink: 0, background: '#0284C7', color: 'white',
        fontWeight: 800, fontSize: '0.75rem', letterSpacing: '0.04em',
        borderRadius: '0.3rem', padding: '0.2rem 0.55rem',
        whiteSpace: 'nowrap',
      }}>
        {part}
      </div>
      <div style={{ flex: 1, borderTop: '1px solid var(--tf-border)' }} />
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--tf-text)' }}>{title}</span>
        {subtitle && (
          <span style={{ color: 'var(--tf-muted)', fontSize: '0.75rem', marginLeft: '0.4rem' }}>{subtitle}</span>
        )}
      </div>
    </div>
  );
}

/** Inline info callout */
function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
      background: 'rgba(2,132,199,0.05)', border: '1px solid rgba(2,132,199,0.18)',
      borderRadius: '0.5rem', padding: '0.75rem 1rem',
      fontSize: '0.8125rem', color: 'var(--tf-muted)', lineHeight: 1.55,
      marginBottom: '1.1rem',
    }}>
      <svg width="15" height="15" viewBox="0 0 20 20" fill="#0284C7" style={{ flexShrink: 0, marginTop: '0.05rem' }}>
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
      </svg>
      <span>{children}</span>
    </div>
  );
}

/** Checkbox toggle for return type flags */
function FlagCheckbox({
  id, checked, onChange, label, hint,
}: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
        cursor: 'pointer', padding: '0.35rem 0',
      }}
    >
      <input
        id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: '0.15rem', width: '16px', height: '16px', cursor: 'pointer', accentColor: '#0284C7' }}
      />
      <span>
        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--tf-text)' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tf-muted)', marginTop: '0.1rem' }}>{hint}</span>}
      </span>
    </label>
  );
}

// ── Date picker (Month / Day / Year dropdowns) ────────────────────────────────

function DatePicker({
  label, lineRef, required,
  month, day, year,
  onMonth, onDay, onYear,
}: {
  label: string; lineRef?: string; required?: boolean;
  month: string; day: string; year: string;
  onMonth: (v: string) => void; onDay: (v: string) => void; onYear: (v: string) => void;
}) {
  return (
    <Field label={label} lineRef={lineRef} required={required}>
      <Row3>
        <Select value={month} onChange={e => onMonth(e.target.value)} aria-label="Month">
          <option value="">Month</option>
          {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
        <Select value={day} onChange={e => onDay(e.target.value)} aria-label="Day">
          <option value="">Day</option>
          {DAYS.map(d => <option key={d} value={d}>{Number(d)}</option>)}
        </Select>
        <Select value={year} onChange={e => onYear(e.target.value)} aria-label="Year">
          <option value="">Year</option>
          {YEARS_INCORP.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
      </Row3>
    </Field>
  );
}

// ── Address fields ────────────────────────────────────────────────────────────

export interface Address {
  line1?: string; line2?: string; city?: string;
  region?: string; postal_code?: string; country?: string;
}

function AddressFields({ value, onChange, countryLocked }: {
  value: Address; onChange: (v: Address) => void; countryLocked?: boolean;
}) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <Field label="Street address">
        <Input value={value.line1 ?? ''} onChange={set('line1')} placeholder="123 Main St" />
      </Field>
      <Field label="Suite / unit / floor / c/o" hint="(optional)">
        <Input value={value.line2 ?? ''} onChange={set('line2')} placeholder="c/o Registered Agent" />
      </Field>
      <Row2>
        <Field label="City / Town">
          <Input value={value.city ?? ''} onChange={set('city')} placeholder="Wilmington" />
        </Field>
        <Field label="State">
          <Select
            value={value.region ?? ''}
            onChange={e => onChange({ ...value, region: e.target.value })}
          >
            <option value="">Select state…</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </Row2>
      <Row2>
        <Field label="ZIP code">
          <Input value={value.postal_code ?? ''} onChange={set('postal_code')} placeholder="19801" maxLength={10} />
        </Field>
        <Field label="Country">
          <Input
            value={countryLocked ? 'United States' : (value.country ?? '')}
            onChange={countryLocked ? undefined : set('country')}
            placeholder="United States"
            readOnly={countryLocked}
            style={countryLocked ? { background: 'var(--tf-border)', color: 'var(--tf-muted)' } : {}}
          />
        </Field>
      </Row2>
    </>
  );
}

// ── EIN formatter ─────────────────────────────────────────────────────────────

function formatEin(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

// ── Step 1 data interface ─────────────────────────────────────────────────────

export interface Step1Data {
  llcName: string;
  ein: string;
  stateOfFormation: string;
  taxYear: string;
  mailingAddress: Address;
  totalAssets: string;
  naicsCode: string;
  naicsDescription: string;
  incorpMonth: string;
  incorpDay: string;
  incorpYear: string;
  dateOfClosure: string;
  // return-type checkboxes (Initial Return is auto-derived, not stored here)
  finalReturn: boolean;
  nameChange: boolean;
  addressChange: boolean;
}

export interface Step1Props {
  data: Step1Data;
  onChange: (patch: Partial<Step1Data>) => void;
  onNext: () => void;
  saving: boolean;
  error: string;
}

// ── MAIN EXPORT ────────────────────────────────────────────────────────────────

export function Step1ReportingCorp({ data, onChange, onNext, saving, error }: Step1Props) {

  /**
   * "Initial Return" is auto-derived — true when the LLC was incorporated
   * in the calendar year immediately preceding the selected tax year.
   * Example: incorp 2024 + tax year 2025 → initial return = true.
   * This is never manually toggled; we display it as a read-only badge.
   */
  const isInitialReturn = useMemo(
    () => Boolean(data.incorpYear && data.taxYear && data.incorpYear === String(Number(data.taxYear) - 1)),
    [data.incorpYear, data.taxYear],
  );

  const set = <K extends keyof Step1Data>(k: K) => (v: Step1Data[K]) => onChange({ [k]: v });

  const handleEin = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ein: formatEin(e.target.value) });
  };

  // ── card styles ──────────────────────────────────────────────────────────

  const cardStyle: React.CSSProperties = {
    background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
    borderRadius: '0.875rem', overflow: 'hidden',
  };

  const btnPrimary: React.CSSProperties = {
    background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.9375rem',
    padding: '0.6rem 1.5rem', borderRadius: '0.5rem', border: 'none',
    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.65 : 1,
    minHeight: '42px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
  };

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div style={cardStyle}>

      {/* ── Card header ─────────────────────────────────────────────────── */}
      <div style={{
        padding: '1.5rem 2rem 1.25rem',
        borderBottom: '1px solid var(--tf-border)',
        background: 'var(--tf-bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: '#0284C7',
            background: 'rgba(2,132,199,0.08)', border: '1px solid rgba(2,132,199,0.2)',
            borderRadius: '0.3rem', padding: '0.15rem 0.5rem',
          }}>
            Form 5472 · Page 1
          </span>
          <span style={{
            fontSize: '0.6875rem', fontWeight: 600, color: 'var(--tf-muted)',
            background: 'var(--tf-border)', borderRadius: '0.3rem',
            padding: '0.15rem 0.5rem', letterSpacing: '0.03em',
          }}>
            Pro Forma 1120 Header
          </span>
        </div>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 800, margin: 0, color: 'var(--tf-text)', lineHeight: 1.25 }}>
          Reporting Corporation
        </h2>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginTop: '0.3rem', fontWeight: 400, maxWidth: '52ch' }}>
          Your US LLC is the "reporting corporation." All fields below map directly to Form 5472 Part I and the Pro Forma 1120 header.
        </p>
      </div>

      <div style={{ padding: '1.5rem 2rem 1.75rem' }}>

        {/* ── Error banner ── */}
        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: '0.5rem', padding: '0.7rem 1rem',
            marginBottom: '1.25rem', color: '#991B1B',
            fontSize: '0.875rem', fontWeight: 600,
            display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
          }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style={{ flexShrink: 0, marginTop: '0.05rem' }}>
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            {error}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            HEADER — Tax Year & Return Type
        ══════════════════════════════════════════════════════════════ */}

        <PartLabel part="HEADER" title="Tax Year & Return Type" />

        <Row2>
          {/* Tax year selector */}
          <Field label="Tax year" lineRef="Line 1a" required>
            <Select value={data.taxYear} onChange={e => onChange({ taxYear: e.target.value })}>
              {TAX_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>

          {/* Return-type checkboxes */}
          <div>
            <label style={{
              fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.3rem',
              color: 'var(--tf-text)', display: 'flex', alignItems: 'center', gap: '0.35rem',
            }}>
              Return type boxes
              <span style={{
                fontSize: '0.6875rem', fontWeight: 500,
                background: 'var(--tf-border)', color: 'var(--tf-muted)',
                borderRadius: '0.25rem', padding: '0.1rem 0.35rem',
              }}>Header</span>
            </label>

            {/* Initial Return — auto-detected, display-only */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0' }}>
              <div style={{
                width: '16px', height: '16px', borderRadius: '3px', flexShrink: 0,
                border: isInitialReturn ? 'none' : '1.5px solid var(--tf-border)',
                background: isInitialReturn ? '#0284C7' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isInitialReturn && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span style={{
                fontSize: '0.875rem', fontWeight: isInitialReturn ? 700 : 500,
                color: isInitialReturn ? 'var(--tf-text)' : 'var(--tf-muted)',
              }}>
                Initial return
              </span>
              {isInitialReturn && (
                <span style={{
                  fontSize: '0.6875rem', fontWeight: 700, color: '#075985',
                  background: '#E0F2FE', border: '1px solid #BAE6FD',
                  borderRadius: '9999px', padding: '0.1rem 0.5rem',
                }}>
                  Auto-detected
                </span>
              )}
            </div>

            <FlagCheckbox
              id="finalReturn"
              checked={data.finalReturn}
              onChange={set('finalReturn')}
              label="Final return"
              hint="LLC dissolved this year"
            />
            <FlagCheckbox
              id="nameChange"
              checked={data.nameChange}
              onChange={set('nameChange')}
              label="Name change"
            />
            <FlagCheckbox
              id="addressChange"
              checked={data.addressChange}
              onChange={set('addressChange')}
              label="Address change"
            />
          </div>
        </Row2>

        {/* ══════════════════════════════════════════════════════════════
            PART I — Reporting Corporation Identity (Lines 1a – 1g)
        ══════════════════════════════════════════════════════════════ */}

        <PartLabel
          part="PART I"
          title="Reporting Corporation"
          subtitle="Form 5472 Lines 1a – 1k"
        />

        <InfoNote>
          The <strong>reporting corporation</strong> is your US LLC. Fields below map to exact IRS Form 5472 Part I lines — shown as grey pill labels. Complete fields marked <span style={{ color: '#B91C1C', fontWeight: 700 }}>*</span> before continuing.
        </InfoNote>

        {/* 1a — LLC Name */}
        <Field label="LLC legal name" lineRef="1a" required hint="Exactly as registered with the IRS / EIN letter">
          <Input
            value={data.llcName}
            onChange={e => onChange({ llcName: e.target.value })}
            placeholder="Acme Technologies LLC"
            autoComplete="organization"
          />
        </Field>

        {/* 1b — EIN | 1g — State */}
        <Row2>
          <Field label="Employer Identification Number (EIN)" lineRef="1b" required>
            <Input
              value={data.ein}
              onChange={handleEin}
              placeholder="XX-XXXXXXX"
              maxLength={10}
              inputMode="numeric"
            />
          </Field>
          <Field label="State of formation" lineRef="1g">
            <Select value={data.stateOfFormation} onChange={e => onChange({ stateOfFormation: e.target.value })}>
              <option value="">Select state…</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </Row2>

        {/* 1c — Date of incorporation | 1d — Date of dissolution */}
        <Row2>
          <DatePicker
            label="Date of incorporation"
            lineRef="1c"
            month={data.incorpMonth} day={data.incorpDay} year={data.incorpYear}
            onMonth={v => onChange({ incorpMonth: v })}
            onDay={v => onChange({ incorpDay: v })}
            onYear={v => onChange({ incorpYear: v })}
          />
          <Field label="Date of dissolution" lineRef="1d" hint="(leave blank if still active)">
            <Input
              type="date"
              value={data.dateOfClosure}
              onChange={e => onChange({ dateOfClosure: e.target.value })}
            />
          </Field>
        </Row2>

        {/* 1e — Total assets | 1f — NAICS code */}
        <Row2>
          <Field label="Total assets at year-end (USD)" lineRef="1e" hint="(from balance sheet — optional)">
            <Input
              type="number" min="0" step="0.01"
              value={data.totalAssets}
              onChange={e => onChange({ totalAssets: e.target.value })}
              placeholder="0.00"
            />
          </Field>
          <Field label="NAICS code" lineRef="1f" hint="(6-digit — optional)">
            <Input
              value={data.naicsCode}
              onChange={e => onChange({ naicsCode: e.target.value })}
              placeholder="e.g. 541511"
              maxLength={6}
              inputMode="numeric"
            />
          </Field>
        </Row2>

        {/* 1f description */}
        <Field label="Principal business activity" lineRef="1f" hint="(description — optional)">
          <Input
            value={data.naicsDescription}
            onChange={e => onChange({ naicsDescription: e.target.value })}
            placeholder="e.g. Custom Computer Programming Services"
          />
        </Field>

        {/* ══════════════════════════════════════════════════════════════
            1h – 1k — US Mailing Address
        ══════════════════════════════════════════════════════════════ */}

        <PartLabel
          part="1h – 1k"
          title="US Mailing Address"
          subtitle="Pro Forma 1120 header and Form 5472 header"
        />

        <InfoNote>
          Enter the LLC's US mailing address as it will appear on the return. For Delaware LLCs without a physical US office, use your registered agent's address and add <strong>c/o [Agent Name]</strong> in the suite/unit field.
        </InfoNote>

        <AddressFields
          value={data.mailingAddress}
          onChange={v => onChange({ mailingAddress: v })}
          countryLocked
        />

        {/* ── Actions ── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid var(--tf-border)',
        }}>
          <button style={btnPrimary} onClick={onNext} disabled={saving}>
            {saving ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ animation: 'spin 0.8s linear infinite' }}>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                Saving…
              </>
            ) : (
              <>Save &amp; Continue — Part II: Foreign Owner →</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
