import { Outlet, useLocation } from 'react-router';
import { useEffect } from 'react';
import { AppNav } from './AppNav';
import { AppFooter } from './AppFooter';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

/**
 * Layout for the signed-in portal: dashboard, intake, catch-up and the filing
 * wizard. Everything else keeps the marketing `Layout`.
 *
 * Applied at the pathless `RequireAuth` route in routes.tsx, which already
 * grouped exactly these four, so this needed no restructuring.
 *
 * The most important difference is not the smaller nav, it is the ABSENCE of
 * the marketing warning marquee. That bar reads "The IRS penalty for a missing
 * Form 5472 starts at $25,000 per form per year", scrolling, in red, fixed to
 * the top of the viewport. It is the right message for a visitor who does not
 * yet know they have a problem, and the wrong one for a customer who has
 * already bought and is part way through fixing it. Keeping it here would mean
 * a frightened filer completes the whole wizard with a penalty counter over
 * their head, which the design principles in the handoff explicitly argue
 * against: reassure at anxiety points, do not manufacture new ones.
 */
export function AppLayout() {
  return (
    <div
      style={{
        background: 'var(--tf-bg)',
        color: 'var(--tf-text)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ScrollToTop />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <AppNav />
      <main id="main-content" style={{ flex: 1 }}>
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}

export default AppLayout;
