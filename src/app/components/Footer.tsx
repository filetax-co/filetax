import { Link } from "react-router";

const footerLogo = `${import.meta.env.BASE_URL}footer.png`;

const footerLinks = [
  { to: "/pricing", label: "Pricing" },
  { to: "/services", label: "Services" },
  { to: "/past-filings", label: "Past Filings" },
  { to: "/resources", label: "Resources" },
  { to: "/faq", label: "FAQ" },
  { to: "/waitlist", label: "Waitlist" },
];

export function Footer() {
  return (
    <footer
      style={{
        background: "var(--tf-surface)",
        borderTop: "1px solid var(--tf-border)",
        color: "var(--tf-text)",
      }}
    >
      <div
        style={{ maxWidth: "1200px", margin: "0 auto", padding: "3rem 1rem 1.5rem" }}
      >
        {/* Main footer grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Left: Brand */}
          <div>
            <Link
              to="/"
              aria-label="Home"
              style={{ display: "inline-flex", alignItems: "center", marginBottom: "0.5rem" }}
            >
              <img
                src={footerLogo}
                alt="Logo"
                height={32}
                style={{ height: 32, width: "auto", display: "block" }}
              />
            </Link>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
              IRS-ready forms for foreign-owned U.S. entities.
            </p>
          </div>

          {/* Center: Links */}
          <div>
            <p
              style={{
                fontWeight: 600,
                fontSize: "0.875rem",
                color: "var(--tf-muted)",
                marginBottom: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Pages
            </p>
            <div className="flex flex-col gap-2">
              {footerLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  style={{
                    color: "var(--tf-text)",
                    textDecoration: "none",
                    fontSize: "0.9375rem",
                    fontWeight: 500,
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Right: Contact */}
          <div>
            <p
              style={{
                fontWeight: 600,
                fontSize: "0.875rem",
                color: "var(--tf-muted)",
                marginBottom: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Contact
            </p>
            <a
              href="mailto:hello@filetax.co"
              style={{
                color: "#0284C7",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.9375rem",
                display: "block",
                marginBottom: "0.375rem",
              }}
            >
              hello@filetax.co
            </a>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>
              We respond within 1 business day.
            </p>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            borderTop: "1px solid var(--tf-border)",
            paddingTop: "1.25rem",
          }}
        >
          <p
            style={{
              color: "var(--tf-muted)",
              fontSize: "0.8125rem",
              fontWeight: 400,
              lineHeight: 1.6,
              marginBottom: "0.75rem",
            }}
          >
            FileTax.co is a software platform for generating IRS forms based on your inputs. It is not a law firm and does not provide legal or tax advice. Forms are generated according to the official IRS Instructions for Form 5472 (Rev. December 2024).
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.5rem 1rem",
              color: "var(--tf-muted)",
              fontSize: "0.8125rem",
              fontWeight: 400,
            }}
          >
            <span>&copy; 2026 FileTax.co</span>
            <span aria-hidden="true">&middot;</span>
            <Link
              to="/terms"
              style={{ color: "var(--tf-muted)", textDecoration: "none" }}
            >
              Terms of Service
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link
              to="/privacy"
              style={{ color: "var(--tf-muted)", textDecoration: "none" }}
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
