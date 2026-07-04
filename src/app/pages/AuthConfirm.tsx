import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';

/**
 * /auth/confirm — landing page after Supabase's email confirmation link.
 * With implicit flow + detectSessionInUrl: true, the Supabase client
 * automatically parses the access_token from the URL hash fragment and
 * creates the session before this component even mounts. We just check
 * if a session now exists and redirect accordingly.
 */
export function AuthConfirm() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error || !data.session) {
        setErrorMsg('Invalid confirmation link. Please try signing up again.');
        setStatus('error');
      } else {
        navigate('/dashboard', { replace: true });
      }
    });
  }, [navigate]);

  const containerStyle: React.CSSProperties = {
    minHeight: '60vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem 1rem',
    background: 'var(--tf-bg)',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--tf-surface)',
    border: '1px solid var(--tf-border)',
    borderRadius: '0.75rem',
    padding: '2.5rem 2rem',
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)',
  };

  if (status === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--tf-text)', marginBottom: '0.375rem' }}>
            Confirming your email…
          </p>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>
            Please wait a moment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tf-text)', marginBottom: '0.5rem' }}>
          Confirmation failed
        </p>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          {errorMsg}
        </p>
        <a
          href="/portal"
          style={{
            display: 'inline-block',
            background: '#0284C7',
            color: 'white',
            fontWeight: 700,
            fontSize: '0.9375rem',
            padding: '0.625rem 1.5rem',
            borderRadius: '0.5rem',
            textDecoration: 'none',
          }}
        >
          Back to sign up
        </a>
      </div>
    </div>
  );
}
