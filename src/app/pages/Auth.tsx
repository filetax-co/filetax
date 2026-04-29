import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

export function Auth() {
  usePageMeta({
    title: 'Sign In | FileTax.co',
    description: 'Sign in to your FileTax account to check your filing status and download completed forms.',
  });

  const { session, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && session) {
      navigate('/dashboard');
    }
  }, [session, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    setError('');
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + '/dashboard' },
    });
    setSubmitting(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  };

  if (loading) return null;

  return (
    <section style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', marginBottom: '0.5rem' }}>Sign in to FileTax</h1>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '2rem' }}>
          We'll send a magic link to your inbox. No password needed.
        </p>

        {sent ? (
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.75rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📬</div>
            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.375rem' }}>Check your email</p>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>
              A sign-in link has been sent to <strong>{email}</strong>. Click the link to access your dashboard.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.75rem', boxShadow: '0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)' }}>
            <label htmlFor="auth-email" style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.375rem', color: 'var(--tf-text)' }}>
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '0.625rem 0.875rem', borderRadius: '0.5rem', border: '1px solid var(--tf-border)', background: 'var(--tf-bg)', color: 'var(--tf-text)', fontSize: '0.9375rem', outline: 'none', boxSizing: 'border-box', minHeight: '44px', marginBottom: '1rem' }}
            />
            {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              style={{ width: '100%', background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '1rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? 'Sending…' : 'Send magic link'}
            </button>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', textAlign: 'center', marginTop: '1rem' }}>
              First time? <a href="/portal" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>Start your filing here</a>.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
