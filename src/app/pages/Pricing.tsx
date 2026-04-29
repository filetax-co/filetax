import { Link } from "react-router";
import { IRSClock } from "../components/IRSClock";
import { Info } from "lucide-react";
import { usePageMeta } from "../hooks/usePageMeta";

// ---------------------------------------------------------------------
// TEMPORARY: Services are not yet live. All pricing-card CTAs route
// to /waitlist instead of their original destinations. To revert when
// services launch, change CHECK_URL and PORTAL_URL back to their
// originals (shown in comments below).
// ---------------------------------------------------------------------
const CHECK_URL = "/waitlist";  // original: "/check"
const PORTAL_URL = "/waitlist"; // original: "/portal"

interface PricingCard {
  title: string;
  price: string;
  priceNote?: string;
  description: string;
  microcopy?: string;
  badge?: string;
  tooltip?: string;
  cta: string;
  ctaLink: string;
  note?: string;
  highlight?: boolean;
}

const cards: PricingCard[] = [
  {
    title: "Form 5472 + Pro Forma 1120: Current Year",
    price: "$150",
    description: "One filing year. Print-ready PDF. Ready to mail or fax.",
    microcopy: "One-time filing. No ongoing fees.",
    tooltip: "One Filing. Two Forms. One Price. The IRS requires these to be filed together. You are not paying for extras.",
    cta: "Join the Waitlist",
    ctaLink: CHECK_URL, // original: "/check"
    highlight: true,
  },
  {
    title: "Form 5472 + Pro Forma 1120: Past Year",
    price: "$150",
    priceNote: "per year",
    description: "Any prior unfiled year. Same output as current year.",
    microcopy: "One-time filing. No ongoing fees.",
    cta: "Join the Waitlist",
    ctaLink: CHECK_URL, // original: "/check"
  },
  {
    title: "Add-On: Additional Form 5472",
    price: "+$75",
    priceNote: "per form",
    description: "Required when the LLC had reportable transactions with more than one foreign related party. A separate Form 5472 is needed for each.",
    note: "Volume discount: $50/form from the 4th form filed.",
    cta: "Join the Waitlist",
    ctaLink: CHECK_URL, // original: "/check"
  },
  {
    title: "Add-On: CPA-Prepared Reasonable Cause Letter",
    price: "+$200",
    priceNote: "per year",
    description: "Added to any past-year filing. Total with past-year filing: $350 per year.",
    badge: "Recommended for Late Filers",
    cta: "Join the Waitlist",
    ctaLink: PORTAL_URL, // original: "/portal"
  },
  {
    title: "Add-On: IRS Fax Submission",
    price: "+$30",
    description: "IRS processes faxed forms significantly faster than mailed ones. Digital confirmation receipt included.",
    note: "Not available for Form 8832.",
    cta: "Join the Waitlist",
    ctaLink: PORTAL_URL, // original: "/portal"
  },
  {
    title: "LLC Tax Classification Change",
    price: "$50",
    priceNote: "per filing",
    description: "Standalone. Form 8832 or Form 2553. Print-ready PDF. Must be mailed. Fax add-on not available.",
    microcopy: "One-time filing. No ongoing fees.",
    cta: "Join the Waitlist",
    ctaLink: PORTAL_URL, // original: "/portal"
  },
  {
    title: "Multi-Year Past Filing Package",
    price: "Custom",
    description: "3 or more unfiled years. Contact via portal. Reasonable cause letter available per year.",
    cta: "Join the Waitlist",
    ctaLink: PORTAL_URL, // original: "/portal"
  },
];

// Original card CTA copy preserved for revert:
//   1. "Start My Filing"      → /check
//   2. "Start My Filing"      → /check
//   3. "Check My Eligibility" → /check
//   4. "Add to Filing"        → /portal
//   5. "Add to Filing"        → /portal
//   6. "Start Filing"         → /portal
//   7. "Get in Touch"         → /portal

export function Pricing() {
  usePageMeta({
    title: "Pricing | FileTax.co",
    description:
      "Simple per-filing pricing. Form 5472 + Pro Forma 1120: $150. Past year with CPA-Prepared Reasonable Cause Letter: $350 per year. No subscription. No ongoing fees.",
  });

  return (
    <>
      <IRSClock />

      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 1.5rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.5rem" }}>
            Simple, per-filing pricing. No subscriptions.
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "1.0625rem", fontWeight: 400 }}>
            Pay only for what you file. Start without an account.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "2rem 1rem 4rem" }} aria-labelledby="pricing-heading">
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {cards.map((card) => (
              <div
                key={card.title}
                style={{
                  background: "var(--tf-surface)",
                  border: card.highlight ? "2px solid #0284C7" : "1px solid var(--tf-border)",
                  borderRadius: "0.75rem",
                  padding: "1.75rem",
                  boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                }}
              >
                {card.badge && (
                  <span
                    style={{
                      display: "inline-block",
                      background: "#B31D1D",
                      color: "white",
                      borderRadius: "9999px",
                      padding: "0.2rem 0.75rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      marginBottom: "0.75rem",
                      width: "fit-content",
                    }}
                  >
                    {card.badge}
                  </span>
                )}

                <div className="flex items-start justify-between gap-2 mb-1">
                  <h2 style={{ fontSize: "1rem", lineHeight: 1.4, flex: 1 }}>{card.title}</h2>
                  {card.tooltip && (
                    <div className="tf-tooltip" style={{ flexShrink: 0 }}>
                      <button
                        aria-label="More info"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--tf-muted)",
                          padding: "2px",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <Info size={16} />
                      </button>
                      <div className="tf-tooltip-text">{card.tooltip}</div>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: "0.5rem" }}>
                  <span style={{ color: "#0284C7", fontWeight: 700, fontSize: "1.75rem" }}>{card.price}</span>
                  {card.priceNote && (
                    <span style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginLeft: "0.25rem" }}>{card.priceNote}</span>
                  )}
                </div>

                <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.5, marginBottom: "0.5rem" }}>
                  {card.description}
                </p>

                {card.note && (
                  <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginBottom: "0.5rem" }}>
                    {card.note}
                  </p>
                )}

                {card.microcopy && (
                  <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "0", flex: 1 }}>
                    {card.microcopy}
                  </p>
                )}

                <div style={{ flex: 1 }} />

                <Link
                  to={card.ctaLink}
                  style={{
                    background: card.highlight ? "#0284C7" : "transparent",
                    color: card.highlight ? "white" : "#0284C7",
                    border: card.highlight ? "none" : "1px solid #0284C7",
                    fontWeight: 600,
                    fontSize: "0.9375rem",
                    padding: "0.625rem 1.25rem",
                    borderRadius: "0.5rem",
                    textDecoration: "none",
                    display: "block",
                    textAlign: "center",
                    marginTop: "1.25rem",
                    minHeight: "44px",
                    lineHeight: "1.8",
                  }}
                >
                  {card.cta}
                </Link>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "2.5rem", textAlign: "center" }}>
            <p style={{ color: "var(--tf-muted)", fontWeight: 500, marginBottom: "0.25rem" }}>
              No payment until you are ready to generate your filing.
            </p>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>
              All prices in USD. Pay per filing. No subscription.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
