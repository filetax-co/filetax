import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { usePageMeta } from '../hooks/usePageMeta';

export function ResetPassword() {
  usePageMeta({
    title: 'Set New Password | FileTax.co',
    description: 'Set a new password for your FileTax.co account.',
  });

  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // 1. Check whether Supabase already exchanged the recovery token before
    //    this component mounted (common when PKCE + detectSessionInUrl is on).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    // 2. Subscribe for the PASSWORD_RECOVERY event specifically.
    //    We intentionally do NOT set sessionReady on a plain SIGNED_IN event
    //    here — that would allow any logged-in user who navigates to
    //    /reset-password to submit the form without actually coming from a
    //    reset email. Only PASSWORD_RECOVERY guarantees the intent.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
    setTimeout(() => navigate('/dashboard'), 2500);
  };

  return (
    <section style={{ background: 'var(--tf-bg)', minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: '440px', background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '2rem', boxShadow: '0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)' }}>

        {done ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.375rem' }}>Password updated!</p>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>Redirecting you to your dashboard…</p>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' }}>Set a new password</h1>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginBottom: '1.75rem' }}>Choose a password that is at least 8 characters long.</p>

            {!sessionReady && (
              <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
                <p style={{ color: '#92400e', fontSize: '0.875rem' }}>Verifying your reset link… If this takes too long, go back to your email and click the link again.</p>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ marginBottom: '1.125rem' }}>
                <label htmlFor="rp-password" style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>New password</label>
                <input id="rp-password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!sessionReady} style={{ width: '100%', padding: '0.625rem 0.875rem', borderRadius: '0.5rem', border: '1px solid var(--tf-border)', background: 'var(--tf-bg)', color: 'var(--tf-text)', fontSize: '0.9375rem', outline: 'none', boxSizing: 'border-box', minHeight: '44px', opacity: sessionReady ? 1 : 0.5 }} />
              </div>
              <div style={{ marginBottom: error ? '0.75rem' : '1.5rem' }}>
                <label htmlFor="rp-confirm" style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>Confirm password</label>
                <input id="rp-confirm" type="password" autoComplete="new-password" placeholder="Repeat your password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={!sessionReady} style={{ width: '100%', padding: '0.625rem 0.875rem', borderRadius: '0.5rem', border: '1px solid var(--tf-border)', background: 'var(--tf-bg)', color: 'var(--tf-text)', fontSize: '0.9375rem', outline: 'none', boxSizing: 'border-box', minHeight: '44px', opacity: sessionReady ? 1 : 0.5 }} />
              </div>
              {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginBottom: '0.875rem' }}>{error}</p>}
              <button type="submit" disabled={submitting || !sessionReady} style={{ width: '100%', background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '1rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: (submitting || !sessionReady) ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: (submitting || !sessionReady) ? 0.7 : 1 }}>
                {submitting ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
