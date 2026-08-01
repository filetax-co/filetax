import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { User } from '@supabase/supabase-js';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Sun, Moon, LifeBuoy, ExternalLink } from 'lucide-react';

// Two wordmarks, not one. "file" is white in the original, which is invisible
// against the light-theme header (--tf-surface is #FFFFFF), leaving only "tax"
// legible. The -light variants are the same artwork with the white ink recut to
// --tf-text (#0F172A); "tax" stays #0584C7 in both.
const logoBase = (theme: string) =>
  `${import.meta.env.BASE_URL}header${theme === 'dark' ? '' : '-light'}`;
const headerLogoSrcSet = (theme: string) => {
  const b = logoBase(theme);
  return `${b}.png 1x, ${b}@2x.png 2x, ${b}@3x.png 3x`;
};

const SUPPORT_EMAIL = 'support@filetax.co';

function getDisplayName(user: User): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof meta.full_name === 'string' ? meta.full_name : '';
  const name = typeof meta.name === 'string' ? meta.name : '';
  return fullName || name || (user.email ? user.email.split('@')[0] : 'Account');
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Header for the signed-in portal.
 *
 * The marketing Nav used to render here, which put Home, Pricing, Services,
 * Past Filings, Resources, FAQ, Waitlist and a Check Eligibility button above a
 * half-finished tax filing. Three things were wrong with that:
 *
 *   - "Waitlist" invited someone to join a queue they had already left, and
 *     "Check Eligibility" pointed at a screen whose questions are now re-asked
 *     inside intake step 1, so it was both redundant and a route OUT of a
 *     filing in progress
 *   - seven marketing links are seven ways to lose your place, on an audience
 *     that is frightened, frequently phone-only, and part way through something
 *     they are afraid of getting wrong
 *   - nothing warned before navigating away, and abandonment is the failure
 *     this product cannot measure retrospectively
 *
 * What is kept and why:
 *
 *   - the logo goes to DASHBOARD, not the marketing home. In an app the logo
 *     means "back to my stuff"
 *   - Resources stays, opening in a NEW TAB. The wizard's "I'm not sure"
 *     answers live in the blog, the rule is never to leave a dead end, and a
 *     new tab means reading one does not cost the filing
 *   - help is visible rather than buried, for the same reason
 *   - the theme toggle stays, because a filer who set dark mode on the
 *     marketing site should not have it silently revert here
 */
export function AppNav() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);

  const name = user ? getDisplayName(user) : 'Account';
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const avatarUrl = typeof meta.avatar_url === 'string' ? meta.avatar_url : undefined;
  const onDashboard = pathname === '/dashboard';

  const iconBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '44px',
    background: 'transparent',
    border: 'none',
    borderRadius: '0.5rem',
    color: 'var(--tf-muted)',
    cursor: 'pointer',
    padding: 0,
  };

  return (
    <header
      style={{
        background: 'var(--tf-surface)',
        borderBottom: '1px solid var(--tf-border)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '0.5rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        {/* Logo goes to the dashboard, not the marketing home. */}
        <Link
          to="/dashboard"
          aria-label="Go to your dashboard"
          style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
        >
          <img
            src={`${logoBase(theme)}.png`}
            srcSet={headerLogoSrcSet(theme)}
            alt="FileTax.co"
            width={79}
            height={36}
            decoding="async"
            style={{ height: 36, width: 'auto', display: 'block' }}
          />
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {/* Only shown when it is somewhere to go. */}
          {!onDashboard && (
            <Link
              to="/dashboard"
              style={{
                color: 'var(--tf-text)',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9rem',
                padding: '0 0.75rem',
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '0.5rem',
                whiteSpace: 'nowrap',
              }}
            >
              Dashboard
            </Link>
          )}

          {/* New tab, deliberately: reading an explanation must not cost the
              filing in progress. */}
          <a
            href={`${import.meta.env.BASE_URL}resources`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Guides and answers (opens in a new tab)"
            style={{
              color: 'var(--tf-text)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.9rem',
              padding: '0 0.75rem',
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              borderRadius: '0.5rem',
              whiteSpace: 'nowrap',
            }}
          >
            Guides
            <ExternalLink size={13} aria-hidden="true" />
          </a>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              aria-label="Get help"
              title="Get help"
              style={iconBtn}
            >
              <LifeBuoy size={18} />
            </button>
            {helpOpen && (
              <>
                {/* Click-away layer. A filer who opens this by accident must be
                    able to dismiss it without hunting for a close button. */}
                <div
                  onClick={() => setHelpOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 1 }}
                />
                <div
                  role="dialog"
                  aria-label="Help"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 0.4rem)',
                    right: 0,
                    zIndex: 2,
                    width: 'min(280px, calc(100vw - 2rem))',
                    background: 'var(--tf-surface)',
                    border: '1px solid var(--tf-border)',
                    borderRadius: '0.625rem',
                    boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
                    padding: '0.875rem 1rem',
                    fontSize: '0.85rem',
                    lineHeight: 1.55,
                    color: 'var(--tf-text)',
                  }}
                >
                  <p style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Stuck on something?</p>
                  <p style={{ color: 'var(--tf-muted)', marginBottom: '0.6rem' }}>
                    Your progress is saved as you go, so you can leave this and come back.
                    Nothing is sent to the IRS until you send it yourself.
                  </p>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    style={{ color: 'var(--tf-accent)', fontWeight: 600, textDecoration: 'none' }}
                  >
                    Email {SUPPORT_EMAIL}
                  </a>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={iconBtn}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {user && (
            <Link
              to="/dashboard"
              aria-label={`Signed in as ${name}`}
              title={`Signed in as ${name}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                textDecoration: 'none',
                color: 'var(--tf-text)',
                padding: '0.25rem',
                borderRadius: '9999px',
                minHeight: '44px',
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  style={{ width: 32, height: 32, borderRadius: '9999px', objectFit: 'cover' }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '9999px',
                    background: 'var(--tf-accent)',
                    color: 'var(--tf-on-accent)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.8125rem',
                  }}
                >
                  {getInitials(name)}
                </span>
              )}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export default AppNav;
