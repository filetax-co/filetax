import { Outlet, useLocation } from "react-router";
import { useEffect } from "react";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { MicrosoftClarity } from "./MicrosoftClarity";
import { GoogleAnalytics } from "./GoogleAnalytics";
import { useJsonLd } from "@/app/hooks/useJsonLd";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

function CanonicalTag() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Writes the canonical for every route unconditionally. A noindex page
    // must not carry one, but that decision is NOT made here: this component
    // renders before <Outlet/>, so its effect runs before the page's, and it
    // would be reading the previous page's robots meta. usePageMeta removes the
    // tag instead, which always runs after this. Do not add a noindex test here.
    const canonical = `https://filetax.co${pathname}`;
    let tag = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (!tag) {
      tag = document.createElement("link");
      tag.setAttribute("rel", "canonical");
      document.head.appendChild(tag);
    }
    tag.setAttribute("href", canonical);
  }, [pathname]);
  return null;
}

// Site-wide identity graph. Renders nothing, head-only JSON-LD.
function SiteJsonLd() {
  useJsonLd("organization", {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": "https://filetax.co/#organization",
    name: "FileTax.co",
    url: "https://filetax.co",
    logo: "https://filetax.co/favicon-192.png",
    email: "support@filetax.co",
    description:
      "Print-ready IRS Form 5472 and Pro Forma 1120 filings for non-U.S. founders with U.S. single-member LLCs, including past-year catch-up filings with reasonable cause letters.",
    areaServed: "US",
    knowsAbout: [
      "IRS Form 5472",
      "Pro Forma Form 1120",
      "Foreign-owned single-member LLC compliance",
      "IRS penalty abatement",
      "Reasonable cause statements",
    ],
  });

  useJsonLd("website", {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": "https://filetax.co/#website",
    url: "https://filetax.co",
    name: "FileTax.co",
    publisher: { "@id": "https://filetax.co/#organization" },
  });

  return null;
}

const MARQUEE_TEXT ="The IRS penalty for a missing Form 5472 starts at $25,000 per form per year. Every unfiled year adds another.";

const COPIES = 6;

export function Layout() {
  return (
    <div style={{ background: "var(--tf-bg)", color: "var(--tf-text)", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <ScrollToTop />
      <MicrosoftClarity />
      <GoogleAnalytics />
      <CanonicalTag />
      <SiteJsonLd />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Sticky top: warning bar + nav */}
      <div style={{ position: "sticky", top: 0, zIndex: 100 }}>
        {/* Warning marquee */}
        <div
          style={{
            background: "#B31D1D",
            color: "white",
            overflow: "hidden",
            whiteSpace: "nowrap",
            height: "36px",
            display: "flex",
            alignItems: "center",
          }}
        >
          {/* All COPIES copies exist only to make the scroll seamless, and every
              one of them was exposed as real content, so a screen reader read
              the whole $25,000 warning six times before reaching the nav. The
              sr-only paragraph is now the single accessible copy. Hide the whole
              animated strip rather than all but the first: a copy index test
              would break silently the next time COPIES changes. An aria-label on
              the container was tried and is not enough, a plain div with no role
              does not reliably carry one. */}
          <p className="sr-only">IRS warning. {MARQUEE_TEXT}</p>
          <div
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              animation: "tf-marquee 28s linear infinite",
              willChange: "transform",
            }}
          >
            {Array.from({ length: COPIES }).map((_, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  letterSpacing: "0.01em",
                  paddingRight: "3rem",
                }}
              >
                <span style={{
                  display: "inline-block",
                  background: "rgba(255,255,255,0.2)",
                  borderRadius: "9999px",
                  padding: "0.1rem 0.625rem",
                  fontSize: "0.6875rem",
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginRight: "0.75rem",
                  flexShrink: 0,
                }}>
                  ⚠ IRS Warning
                </span>
                {MARQUEE_TEXT}
              </span>
            ))}
          </div>

          <style>{`
            @keyframes tf-marquee {
              from { transform: translateX(0); }
              to   { transform: translateX(-${100 / COPIES}%); }
            }
            @media (prefers-reduced-motion: reduce) {
              [style*="tf-marquee"] { animation: none; }
            }
          `}</style>
        </div>

        {/* Nav */}
        <Nav />
      </div>

      <main id="main-content" style={{ flex: 1 }}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
