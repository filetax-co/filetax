import { useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';

// SECURITY: real auth runs by default in dev too. Set VITE_SKIP_AUTH=true in
// .env.local ONLY for local-only experimentation. Never set this in any shared
// or preview environment (Codespaces, staging, demo), it leaves every gated
// route wide open.
const DEV_SKIP_AUTH = import.meta.env.DEV && import.meta.env.VITE_SKIP_AUTH === 'true';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (DEV_SKIP_AUTH) return;
    // Only redirect once we're sure there's no session, never redirect while
    // still loading, to avoid a flash-redirect when the session is already
    // present in storage but hasn't resolved yet.
    if (!loading && !user) {
      const next = encodeURIComponent(location.pathname + location.search);
      navigate(`/portal?mode=login&next=${next}`, { replace: true });
    }
  }, [user, loading, navigate, location]);

  if (DEV_SKIP_AUTH) return <Outlet />;

  // Show a neutral loading screen while the session is resolving.
  // Previously this rendered null, which caused a brief blank flash before
  // the redirect or the protected page appeared.
  if (loading) {
    return (
      <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 500 }}>Loading...</p>
      </section>
    );
  }

  if (!user) return null;

  return <Outlet />;
}
