import { Outlet, useLocation } from "react-router";
import { useEffect } from "react";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

const MARQUEE_TEXT = "The IRS penalty for a missing Form 5472 starts at $25,000 per form per year. Every unfiled year adds another.";

const COPIES = 6;

export function Layout() {
  return (
    <div style={{ background: "var(--tf-bg)", color: "var(--tf-text)", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <ScrollToTop />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Sticky top: warning bar + nav */}
      <div style={{ position: "sticky", top: 0, zIndex: 100 }}>
        {/* Warning marquee */}
        <div
          aria-label="Warning: IRS penalty notice"
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
          <div
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