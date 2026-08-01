import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../context/AuthContext';

/**
 * /auth is no longer the sign-in entry point.
 * Magic-link auth has been removed; all auth flows live at /portal.
 * This component redirects existing bookmarks/links to the correct place.
 */
export function Auth() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (loading) return;
    const next = searchParams.get('next');
    if (session) {
      // Already signed in, go to the deep-link destination or dashboard.
      navigate(next ?? '/dashboard', { replace: true });
    } else {
      // Not signed in, forward to Portal, preserving the deep link.
      const portalUrl = next
        ? `/portal?mode=login&next=${encodeURIComponent(next)}`
        : '/portal?mode=login';
      navigate(portalUrl, { replace: true });
    }
  }, [session, loading, navigate, searchParams]);

  return null;
}
