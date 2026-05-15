import { useEffect } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      const next = encodeURIComponent(location.pathname + location.search);
      navigate(`/portal?mode=login&next=${next}`, { replace: true });
    }
  }, [user, loading, navigate, location]);

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
