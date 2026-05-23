import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';

/**
 * /auth is no longer the sign-in entry point.
 * Magic-link auth has been removed; all auth flows live at /portal.
 * This component redirects existing bookmarks/links to the correct place.
 */
export function Auth() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    // Already signed in → go straight to dashboard
    if (session) {
      navigate('/dashboard', { replace: true });
    } else {
      navigate('/portal?mode=login', { replace: true });
    }
  }, [session, loading, navigate]);

  return null;
}
