import { createBrowserRouter } from 'react-router';
import { Link } from 'react-router';
import { Layout } from './components/Layout';
import { AppLayout } from './components/AppLayout';
import { RequireAuth } from './components/RequireAuth';
import { Home } from './pages/Home';
import { Pricing } from './pages/Pricing';
import { Services } from './pages/Services';
import { PastFilings } from './pages/PastFilings';
import { EligibilityCheck } from './pages/EligibilityCheck';
import { Portal } from './pages/Portal';
import { Resources } from './pages/Resources';
import { Article } from './pages/Article';
import { FAQ } from './pages/FAQ';
import { Auth } from './pages/Auth';
import { AuthConfirm } from './pages/AuthConfirm';
import { Dashboard } from './pages/Dashboard';
import { Intake } from './pages/Intake';
import { MultiYearStart } from './pages/MultiYearStart';
import FilingWizard from './pages/FilingWizard';
import { Waitlist } from './pages/Waitlist';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';
import { Refunds } from './pages/Refunds';
import { ResetPassword } from './pages/ResetPassword';

function NotFound() {
  return (
    <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
      <h1 style={{ marginBottom: '1rem' }}>Page not found</h1>
      <Link to="/" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>← Back to Home</Link>
    </section>
  );
}

export const router = createBrowserRouter(
  [
    // ── Signed-in portal ──────────────────────────────────────────────────
    // Listed FIRST, and lifted out of the marketing `Layout` it used to sit
    // inside, so these four routes get the app chrome instead: a small header
    // (logo to dashboard, guides, help, theme, account) and a legal-strip
    // footer, with no marketing nav and no penalty marquee. See AppLayout for
    // why the marquee in particular must not follow a paying customer into the
    // wizard.
    //
    // A pathless layout route with ABSOLUTE-path children, rather than a second
    // `path: '/'` entry, so there is no ambiguity about which of two identical
    // parent paths a URL belongs to.
    {
      Component: AppLayout,
      children: [
        {
          Component: RequireAuth,
          children: [
            { path: '/dashboard', Component: Dashboard },
            // intake uses ?filing_id= query-string, not a path param
            { path: '/intake', Component: Intake },
            { path: '/catch-up', Component: MultiYearStart },
            { path: '/filing/:id', Component: FilingWizard },
          ],
        },
      ],
    },
    // ── Marketing site ────────────────────────────────────────────────────
    {
      path: '/',
      Component: Layout,
      children: [
        { index: true, Component: Home },
        { path: 'pricing', Component: Pricing },
        { path: 'services', Component: Services },
        { path: 'past-filings', Component: PastFilings },
        { path: 'check', Component: EligibilityCheck },
        { path: 'portal', Component: Portal },
        { path: 'resources', Component: Resources },
        { path: 'resources/:slug', Component: Article },
        { path: 'faq', Component: FAQ },
        { path: 'auth', Component: Auth },
        { path: 'auth/confirm', Component: AuthConfirm },
        { path: 'waitlist', Component: Waitlist },
        { path: 'terms', Component: Terms },
        { path: 'privacy', Component: Privacy },
        { path: 'refunds', Component: Refunds },
        { path: 'reset-password', Component: ResetPassword },
        { path: '*', Component: NotFound },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL }
);
