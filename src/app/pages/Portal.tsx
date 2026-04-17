import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { usePageMeta } from '../hooks/usePageMeta';
import { supabase } from '../../lib/supabase';

const FILING_YEARS_DISPLAY: Record<string, string> = {
  '1': '1 year (current)',
  '2': '2 years',
  '3': '3 years',
  '4': '4 years',
  '5': '5+ years',
};

const PORTAL_SECTION_NAMES: Record<string, string> = {
  b: 'Part III – Monetary transactions',
  c: 'Part IV – Non-monetary transactions',
  d: 'Part V – Rents/royalties/licenses',
  e: 'Part VI – Cost-sharing',
  f: 'Part VII – Compensation',
  g: 'Part VIII – Other transactions',
  h: 'Part IX – Foreign related party info',
};

const checklistItems = [
  "Your LLC's EIN (Employer Identification Number)",
  "The tax year you are filing for",
  "Owner details: full legal name, country of residence, passport number",
  "Bank transaction details for the filing year",
  "Details of any capital contributions, distributions, loans, or payments between you and the LLC during the year",
];

const howItWorksSteps = [
  { step: '1', title: 'Enter your LLC details', body: 'Provide your LLC name, EIN, state of formation, and the tax year you are filing for. This takes about 2 minutes.' },
  { step: '2', title: 'Enter or import your transactions', body: 'Add reportable transactions manually or connect via Plaid for automatic import. No bank login is required if you prefer to enter details by hand.' },
  { step: '3', title: 'Review your filing summary', body: 'See a plain-language summary of your Form 5472 before anything is generated. Confirm all details are correct.' },
  { step: '4', title: 'Download IRS-ready forms', body: 'Pay once and download your completed Form 5472 and Pro Forma 1120 as a print-ready PDF, ready to mail or fax to the IRS.' },
];

export function Portal() {
  usePageMeta({
    title: 'Start Your Filing | FileTax.co',
    description: 'Create your free account and begin your Form 5472 + Pro Forma 1120 filing. Your eligibility answers carry forward automatically. No payment until you download.',
  });

  const [searchParams] = useSearchParams();
  const years = searchParams.get('years');
  const sectionsParam = searchParams.get('sections');
  const partiesParam = searchParams.get('parties');
  const rclParam = searchParams.get('rcl');

  const activeSections = sectionsParam ? sectionsParam.split(',').filter(Boolean) : [];
  const parties = partiesParam ? Number(partiesParam) : 1;
  const includeRCL = rclParam === 'true';
  const hasPriorYears = !!years;
  const hasConfig = hasPriorYears || activeSections.length > 0 || parties > 1;

  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    if (mode === 'signup' && !name.trim()) { setError('Please enter your full name.'); return; }
    setSubmitting(true);

    // Sign up or sign in via magic link
    const { data: authData, error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + '/dashboard',
        data: mode === 'signup' ? { full_name: name.trim() } : {},
      },
    });

    if (authError) {
      setError(authError.message);
      setSubmitting(false);
      return;
    }

    // Save intake submission to Supabase
    await supabase.from('intake_submissions').insert({
      user_id: authData?.user?.id ?? null,
      full_name: name.trim() || email.trim(),
      email: email.trim(),
      years_param: years ?? null,
      sections_param: sectionsParam ?? null,
      parties_param: parties > 1 ? parties : null,
      rcl_param: includeRCL || null,
      status: 'pending',
    });

    setSubmitting(false);
    setSubmitted(true);
  };

  return (
    <>
      {/* Header */}
      <section style={{ background: 'var(--tf-bg)', padding: '3rem 1rem 2rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <span style={{ display: 'inline-block', background: '#059669', color: 'white', borderRadius: '9999px', padding: '0.2rem 0.875rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.875rem' }}>
            Filing Portal
          </span>
          <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', marginBottom: '0.5rem', lineHeight: 1.2 }}>
            Create your account and start filing.
          </h1>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, maxWidth: '520px' }}>
            Free to start. No payment until you are ready to download your completed forms. Takes about 10 minutes.
          </p>
        </div>
      </section>

      {/* Filing configuration panel */}
      {hasConfig && (
        <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 0' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto', paddingBottom: '1rem' }}>
            <div style={{ border: '2px solid #0284C7', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', background: 'rgba(2,132,199,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem' }}>
                <span style={{ display: 'inline-block', background: '#0284C7', color: 'white', borderRadius: '9999px', padding: '0.2rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Your Filing is Pre-Configured
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div>
                  <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tf-muted)', marginBottom: '0.5rem' }}>What will be filed</p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    <li style={{ display: 'flex', gap: '0.5rem', fontSize: '0.9375rem', color: 'var(--tf-text)' }}>
                      <span style={{ color: '#059669', fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
                      Form 5472 + Pro Forma 1120
                      {hasPriorYears && ` (${FILING_YEARS_DISPLAY[years!] ?? years})`}
                    </li>
                    {includeRCL && (
                      <li style={{ display: 'flex', gap: '0.5rem', fontSize: '0.9375rem', color: 'var(--tf-text)' }}>
                        <span style={{ color: '#059669', fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
                        CPA-Prepared Reasonable Cause Letter
                      </li>
                    )}
                    {parties > 1 && (
                      <li style={{ display: 'flex', gap: '0.5rem', fontSize: '0.9375rem', color: 'var(--tf-text)' }}>
                        <span style={{ color: '#059669', fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
                        {parties} Form 5472s ({parties - 1} additional {parties - 1 === 1 ? 'party' : 'parties'})
                      </li>
                    )}
                  </ul>
                </div>
                {activeSections.length > 0 && (
                  <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tf-muted)', marginBottom: '0.5rem' }}>Sections activated</p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {activeSections.map((s) => (
                        <li key={s} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--tf-text)' }}>
                          <span style={{ color: '#0284C7', fontWeight: 700, flexShrink: 0, fontSize: '0.75rem' }}>&#10003;</span>
                          {PORTAL_SECTION_NAMES[s] ?? s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', fontWeight: 400, marginTop: '0.875rem', paddingTop: '0.875rem', borderTop: '1px solid var(--tf-border)' }}>
                Your answers from the eligibility check are carried into the portal automatically.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Main: form + checklist */}
      <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 3rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', paddingBottom: '1.5rem' }}>
          <div style={{ border: '1px solid var(--tf-border)', borderRadius: '0.75rem', overflow: 'hidden', background: 'var(--tf-surface)' }}>
            <button
              onClick={() => setHowItWorksOpen((v) => !v)}
              aria-expanded={howItWorksOpen}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1rem 1.25rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', minHeight: '52px' }}
            >
              <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--tf-text)' }}>How it works</span>
              <span style={{ color: '#0284C7', fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}>{howItWorksOpen ? '−' : '+'}</span>
            </button>
            {howItWorksOpen && (
              <div style={{ borderTop: '1px solid var(--tf-border)', padding: '1.25rem 1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {howItWorksSteps.map((item) => (
                    <div key={item.step} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                      <div style={{ width: '1.75rem', height: '1.75rem', background: '#0284C7', color: 'white', borderRadius: '9999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.875rem', flexShrink: 0, marginTop: '1px' }}>{item.step}</div>
                      <div>
                        <p style={{ fontWeight: 600, color: 'var(--tf-text)', fontSize: '0.9375rem', marginBottom: '0.2rem' }}>{item.title}</p>
                        <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.5 }}>{item.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: '2rem', alignItems: 'start' }} className="portal-grid">
          {/* Left: Account form */}
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem', boxShadow: '0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)' }}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', background: 'var(--tf-bg)', borderRadius: '0.5rem', padding: '0.25rem', marginBottom: '1.75rem', border: '1px solid var(--tf-border)' }}>
              {(['signup', 'login'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '0.5rem', border: 'none', borderRadius: '0.375rem', background: mode === m ? '#0284C7' : 'transparent', color: mode === m ? 'white' : 'var(--tf-muted)', fontWeight: 600, fontSize: '0.9375rem', cursor: 'pointer', transition: 'background 0.15s, color 0.15s', minHeight: '36px' }}>
                  {m === 'signup' ? 'Create Account' : 'Log In'}
                </button>
              ))}
            </div>

            {submitted ? (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📬</div>
                <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.375rem' }}>Check your email</p>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>
                  A sign-in link has been sent to <strong>{email}</strong>. Click it to access your filing dashboard.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                {mode === 'signup' && (
                  <div style={{ marginBottom: '1.125rem' }}>
                    <label htmlFor="portal-name" style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>Full name</label>
                    <input id="portal-name" type="text" autoComplete="name" placeholder="Your full legal name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '0.625rem 0.875rem', borderRadius: '0.5rem', border: '1px solid var(--tf-border)', background: 'var(--tf-bg)', color: 'var(--tf-text)', fontSize: '0.9375rem', outline: 'none', boxSizing: 'border-box', minHeight: '44px' }} />
                  </div>
                )}
                <div style={{ marginBottom: error ? '0.75rem' : '1.5rem' }}>
                  <label htmlFor="portal-email" style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>Email address</label>
                  <input id="portal-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: '0.625rem 0.875rem', borderRadius: '0.5rem', border: '1px solid var(--tf-border)', background: 'var(--tf-bg)', color: 'var(--tf-text)', fontSize: '0.9375rem', outline: 'none', boxSizing: 'border-box', minHeight: '44px' }} />
                </div>
                {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginBottom: '0.875rem' }}>{error}</p>}
                <button type="submit" disabled={submitting} style={{ width: '100%', background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '1rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', minHeight: '44px', marginBottom: '0.875rem', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? 'Sending…' : mode === 'signup' ? 'Create Free Account' : 'Send Sign-In Link'}
                </button>
                <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, textAlign: 'center', lineHeight: 1.5 }}>
                  {mode === 'signup' ? 'No password needed — we email you a secure sign-in link.' : 'New here? Switch to Create Account above.'}
                </p>
              </form>
            )}

            <div style={{ borderTop: '1px solid var(--tf-border)', marginTop: '1.5rem', paddingTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: '#059669', fontSize: '0.875rem' }}>&#128274;</span>
              <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400 }}>Secure portal. Data encrypted and stored on Supabase.</p>
            </div>
          </div>

          {/* Right: What you will need */}
          <div>
            <h2 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>What you will need</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {checklistItems.map((item, i) => (
                <li key={i} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--tf-border)', display: 'flex', gap: '0.75rem', fontSize: '0.9375rem', color: 'var(--tf-text)', lineHeight: 1.5 }}>
                  <span style={{ color: '#059669', fontWeight: 700, flexShrink: 0, marginTop: '1px' }}>&#10003;</span>
                  {item}
                </li>
              ))}
            </ul>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 400, marginTop: '0.875rem', lineHeight: 1.5 }}>
              No bank login required. Manual entry available.
            </p>
            <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '1rem 1.125rem', marginTop: '1.25rem' }}>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Estimated time</p>
              <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 400 }}>About 10 minutes for a straightforward filing.</p>
            </div>
          </div>
        </div>

        <style>{`@media (max-width: 700px) { .portal-grid { grid-template-columns: 1fr !important; } }`}</style>
      </section>

      <section style={{ background: 'var(--tf-bg)', padding: '2rem 1rem 3rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>
            Questions first? Email us at <a href="mailto:hello@filetax.co" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>hello@filetax.co</a>. We respond within 1 business day.
          </p>
        </div>
      </section>
    </>
  );
}
