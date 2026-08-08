/**
 * A password input with a reveal control in its right inset.
 *
 * Every password on this site is TYPED BLIND and most of them are typed once,
 * against a checklist of rules, on a phone keyboard: signup, reset, and the
 * confirm field that only says whether two invisible strings matched. The
 * commonest failure there is a typo the filer cannot see and the form cannot
 * explain.
 *
 * The eye is styled as the intake's other in-field controls are, which is to
 * say `#64748B` in light and `#94A3B8` in dark, the same pair baked into the
 * select chevron and used by the date picker's filter. Those rules live in
 * `taxfile.css` on `.pw-reveal`, next to the date-picker theming, because a
 * control that needs theming needs it on every screen it appears on.
 *
 * It starts hidden and stays wherever the filer puts it, per instance. Nothing
 * about the choice is persisted or shared between fields.
 */
import { useState } from 'react';

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.875rem',
  // Room for the eye, on the same 1rem inset the chevron uses.
  paddingRight: '2.75rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--tf-border)',
  background: 'var(--tf-bg)',
  color: 'var(--tf-text)',
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  minHeight: '44px',
};

export function PasswordField({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled = false,
  style,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  /** Merged over the shared input style, for the disabled dimming on reset. */
  style?: React.CSSProperties;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{ ...INPUT_STYLE, ...style }}
      />
      {/* tabIndex -1 so tabbing out of the password goes to the next FIELD, not
          to a control that changes nothing about what gets submitted. It is
          still reachable by pointer and by screen reader, and it says which
          state it is in rather than what it looks like. */}
      <button
        type="button"
        className="pw-reveal"
        onClick={() => setShown((s) => !s)}
        disabled={disabled}
        tabIndex={-1}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
      >
        {shown ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

function Eye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.8 3.7M6.6 6.6A17.6 17.6 0 0 0 2 13s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1" />
      <path d="M9.9 10.1a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
