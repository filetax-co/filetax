import { createBrowserRouter } from 'react-router';
import { usePageMeta } from './hooks/usePageMeta';
import { Layout } from './components/Layout';
import { AppLayout } from './components/AppLayout';
import { RequireAuth } from './components/RequireAuth';
import { RouteError } from './components/RouteError';
import { Home } from './pages/Home';
import { Pricing } from './pages/Pricing';
import { Services } from './pages/Services';
import { PastFilings } from './pages/PastFilings';
import { Compare } from './pages/Compare';
import { Guide } from './pages/Guide';
import { EligibilityCheck } from './pages/EligibilityCheck';
import { Portal } from './pages/Portal';
import { Resources } from './pages/Resources';
import { Article } from './pages/Article';
import { FAQ } from './pages/FAQ';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { AuthConfirm } from './pages/AuthConfirm';
import { Intake } from './pages/Intake';
import { MultiYearStart } from './pages/MultiYearStart';
import FilingWizard from './pages/FilingWizard';
import { ResetPassword } from './pages/ResetPassword';
import { Waitlist } from './pages/Waitlist';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';
import { Refunds } from './pages/Refunds';

function NotFound() {
  // This set no meta at all, so it kept the previous page's title and
  // description on an SPA navigation and index.html's homepage pair on a direct
  // hit, while Layout's CanonicalTag pointed a canonical at the missing URL and
  // nothing said noindex. A crawler could therefore index unlimited nonexistent
  // URLs as distinct pages. noindex also stops CanonicalTag writing the tag.
  usePageMeta({
    title: "Page not found | FileTax.co",
    description: "This page does not exist. Find Form 5472 filing, pricing and guidance on FileTax.co.",
    noindex: true,
  });
  return (
    <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
      <h1 style={{ marginBottom: '1rem' }}>Page not found</h1>
      <a href="/" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>← Back to Home</a>
    </section>
  );
}

export const router = createBrowserRouter([
  {
    Component: AppLayout,
    ErrorBoundary: RouteError,
    children: [
      {
        Component: RequireAuth,
        children: [
          { path: '/dashboard', Component: Dashboard },
          { path: '/intake', Component: Intake },
          { path: '/catch-up', Component: MultiYearStart },
          { path: '/filing/:id', Component: FilingWizard },
        ],
      },
    ],
  },
  {
    path: '/',
    Component: Layout,
    // Without this, a render error anywhere under Layout shows React Router's
    // developer screen: "Unexpected Application Error!", a raw stack trace and
    // a note addressed to "Hey developer". Fine locally, not for someone who
    // arrived here about a $25,000 penalty. See RouteError.
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: Home },
      { path: 'pricing', Component: Pricing },
      { path: 'services', Component: Services },
      { path: 'past-filings', Component: PastFilings },
      { path: 'compare', Component: Compare },
      { path: 'guide', Component: Guide },
      { path: 'check', Component: EligibilityCheck },
      { path: 'portal', Component: Portal },
      { path: 'resources', Component: Resources },
      { path: 'resources/:slug', Component: Article },
      { path: 'faq', Component: FAQ },
      { path: 'auth', Component: Auth },
      { path: 'auth/confirm', Component: AuthConfirm },
      { path: 'reset-password', Component: ResetPassword },
      { path: 'waitlist', Component: Waitlist },
      { path: 'terms', Component: Terms },
      { path: 'privacy', Component: Privacy },
      { path: 'refunds', Component: Refunds },
      { path: '*', Component: NotFound },
    ],
  },
]);
