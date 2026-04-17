import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
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
import { Dashboard } from './pages/Dashboard';

function NotFound() {
  return (
    <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
      <h1 style={{ marginBottom: '1rem' }}>Page not found</h1>
      <a href="/" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>← Back to Home</a>
    </section>
  );
}

export const router = createBrowserRouter([
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
      { path: 'dashboard', Component: Dashboard },
      { path: '*', Component: NotFound },
    ],
  },
]);
