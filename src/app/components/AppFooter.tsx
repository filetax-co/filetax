import { Link } from 'react-router';

const SUPPORT_EMAIL = 'support@filetax.co';

/**
 * Footer for the signed-in portal: a legal strip, nothing more.
 *
 * The marketing footer rendered here previously, carrying the full sitemap.
 * On a filing screen that is noise, and every link in it is a way out of a
 * half-finished return.
 *
 * What survives is what has to. The disclaimer moved out of individual article
 * bodies into the layout, so it has to be present wherever the layout is, and
 * the refund policy must stay linked from somewhere reachable. Terms, Privacy
 * and Refunds are compliance surfaces, not navigation, and the support address
 * is the one thing a stuck filer actually needs at the bottom of a page.
 *
 * Deliberately NOT sticky and deliberately quiet: it should be findable when
 * looked for and invisible otherwise.
 */
export function AppFooter() {
  const linkStyle: React.CSSProperties = {
    color: 'var(--tf-muted)',
    textDecoration: 'none',
    fontSize: '0.8125rem',
    whiteSpace: 'nowrap',
  };

  return (
    <footer
      style={{
        borderTop: '1px solid var(--tf-border)',
        background: 'var(--tf-bg)',
        padding: '1.25rem 1rem 1.75rem',
        marginTop: '2rem',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem 1.25rem',
            marginBottom: '0.75rem',
          }}
        >
          <Link to="/terms" style={linkStyle}>Terms</Link>
          <Link to="/privacy" style={linkStyle}>Privacy</Link>
          <Link to="/refunds" style={linkStyle}>Refunds</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ ...linkStyle, color: 'var(--tf-accent)' }}>
            {SUPPORT_EMAIL}
          </a>
        </div>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.75rem', lineHeight: 1.6, margin: 0 }}>
          FileTax.co is a software platform for generating IRS forms based on your inputs. It is not
          a law firm and does not provide legal or tax advice. Forms are generated according to the
          official IRS Instructions for Form 5472 (Rev. December 2024).
        </p>
      </div>
    </footer>
  );
}

export default AppFooter;
