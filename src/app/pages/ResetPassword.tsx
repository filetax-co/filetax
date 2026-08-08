import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { usePageMeta } from '../hooks/usePageMeta';
import { validatePassword, meetsAllRules } from '../../lib/passwordSecurity';
import { PasswordField } from '../components/PasswordField';
import { PasswordChecklist } from '../components/PasswordChecklist';

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
    const params = new URLSearchParams(window.location.search);
    const token_hash = params.get('token_hash');
    const type = params.get('type');

    async function exchangeRecoveryToken() {
      if (token_hash && type === 'recovery') {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash,
          type: 'recovery',
        });
        if (!verifyError) {
          setSessionReady(true);
          return;
        }
        setError('This reset link is invalid or has expired. Please request a new one.');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) setSessionReady(true);
    }

    exchangeRecoveryToken();

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
    // Same gate as signup, in the same order. This page used to check only
    // `password.length < 8`, so a filer could set a password on reset that
    // signup would have rejected, and the server-side policy would then answer
    // with a raw Supabase message instead of the checklist shown below.
    if (!meetsAllRules(password)) {
      setError('Please meet all the password requirements shown below the field.');
      return;
    }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);

    const pwCheck = await validatePassword(password);
    if (!pwCheck.ok) {
      setError(pwCheck.error);
      setSubmitting(false);
      return;
    }

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
            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.375rem' }}>Password updated!</p>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>Redirecting you to your dashboard…</p>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' }}>Set a new password</h1>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginBottom: '1.75rem' }}>Choose a password that meets the requirements below.</p>

            {!sessionReady && !error && (
              <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
                <p style={{ color: '#92400e', fontSize: '0.875rem' }}>Verifying your reset link… If this takes too long, go back to your email and click the link again.</p>
              </div>
            )}

            {!sessionReady && error && (
              <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.25rem' }}>
                <p style={{ color: '#DC2626', fontSize: '0.875rem' }}>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ marginBottom: '1.125rem' }}>
                <label htmlFor="rp-password" style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>New password</label>
                <PasswordField
                  id="rp-password"
                  autoComplete="new-password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={setPassword}
                  disabled={!sessionReady}
                  style={{ opacity: sessionReady ? 1 : 0.5 }}
                />
                {/* Same checklist as signup, same component. A reset that
                    enforces the signup gates must also show them, or the filer
                    is guessing at what the form wants. */}
                <PasswordChecklist password={password} />
              </div>
              <div style={{ marginBottom: error ? '0.75rem' : '1.5rem' }}>
                <label htmlFor="rp-confirm" style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>Confirm password</label>
                <PasswordField
                  id="rp-confirm"
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={setConfirm}
                  disabled={!sessionReady}
                  style={{ opacity: sessionReady ? 1 : 0.5 }}
                />
              </div>
              {error && sessionReady && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginBottom: '0.875rem' }}>{error}</p>}
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
