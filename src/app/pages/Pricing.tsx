import { Link } from "react-router";
import { IRSClock } from "../components/IRSClock";
import { Info } from "lucide-react";
import { usePageMeta } from "../hooks/usePageMeta";
import { useJsonLd } from "../hooks/useJsonLd";
import { PRICE_PER_YEAR, PRICE_RCL, PRICE_ADDITIONAL_PARTY, PRICE_FAX } from "../../lib/pricing";

const CHECK_URL = "/check";
const PORTAL_URL = "/portal";
// IRS fax is priced and sold but NOT BUILT. Its card is the one place on this
// page that still collects interest rather than starting a filing. Remove this
// and the card's copy in the same commit that ships fax. See handoff item 1.
const FAX_URL = "/waitlist?service=irs-fax";

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
    title: "Form 5472 + Pro Forma 1120: Past Year",
    price: `$${PRICE_PER_YEAR}`,
    priceNote: "per year",
    description: "Any prior unfiled year. Same output as current year. Pair with the CPA-Authored Reasonable Cause Letter for the strongest abatement case.",
    microcopy: "One-time filing. No ongoing fees.",
    badge: "Recommended for Late Filers",
    cta: "Start My Filing",
    ctaLink: CHECK_URL,
    highlight: true,
  },
  {
    title: "Form 5472 + Pro Forma 1120: Current Year",
    price: `$${PRICE_PER_YEAR}`,
    description: "One filing year. Print-ready PDF. Ready to mail or fax.",
    microcopy: `One-time filing. No subscription. Your next two filings are guaranteed at $${PRICE_PER_YEAR}.`,
    tooltip: "One Filing. Two Forms. One Price. The IRS requires these to be filed together. You are not paying for extras.",
    cta: "Start My Filing",
    ctaLink: CHECK_URL,
  },
  {
    title: "Add-On: CPA-Authored Reasonable Cause Letter",
    price: `+$${PRICE_RCL}`,
    priceNote: "one letter, covers every year",
    description: `Generated from a framework written by a practising U.S. CPA to argue for abatement of the automatic $25,000 penalty, populated with your filing details. Charged once, however many years you are catching up on, never per year. Total with a single past-year filing: $${PRICE_PER_YEAR + PRICE_RCL}. Three years: $${3 * PRICE_PER_YEAR + PRICE_RCL}.`,
    cta: "Check My Eligibility",
    ctaLink: CHECK_URL,
  },
  {
    title: "Add-On: Additional Related Party (Form 5472)",
    price: `+$${PRICE_ADDITIONAL_PARTY}`,
    priceNote: "per related party, per year",
    description: "Required when the LLC had reportable transactions with more than one foreign related party. A separate Form 5472 is prepared for each party, for each year filed, with the totals reconciled on lines 1f and 1h.",
    cta: "Check My Eligibility",
    ctaLink: CHECK_URL,
  },
  {
    title: "Add-On: IRS Fax Transmission (at launch)",
    price: `+$${PRICE_FAX}`,
    priceNote: "one fee, however many years",
    description: "Not yet available. At launch: you sign the completed forms, we fax them to the IRS for you so you never need a printer, and a transmission receipt recording the date, time and page count is stored against your filing.",
    note: "A transmission receipt is proof that the IRS received the fax. It is not proof that the IRS has accepted the filing. Not available for Form 8832.",
    cta: "Notify Me When Fax Launches",
    ctaLink: FAX_URL,
  },
  {
    title: "LLC Tax Classification Change",
    price: "$50",
    priceNote: "per filing",
    description: "Standalone Form 8832, electing to be taxed as a C-Corporation instead of the default disregarded entity. Print-ready PDF. Must be mailed. Fax add-on not available.",
    microcopy: "One-time filing. No ongoing fees.",
    cta: "Start Filing",
    ctaLink: PORTAL_URL,
  },
  {
    title: "Multi-Year Past Filing Package",
    price: `$${PRICE_PER_YEAR}`,
    priceNote: `per year + one $${PRICE_RCL} letter`,
    description: `Catch up on several unfiled years at once, back to 2019. $${PRICE_PER_YEAR} per year, plus a single $${PRICE_RCL} reasonable cause letter covering all of them.`,
    cta: "Start My Filing",
    ctaLink: CHECK_URL,
  },
];

export function Pricing() {
  usePageMeta({
    title: "Pricing | FileTax.co",
    description:
      `Per-filing pricing. Form 5472 + Pro Forma 1120: $${PRICE_PER_YEAR}. One CPA-authored reasonable cause letter covers every late year for $${PRICE_RCL}, never per year. No subscription. No ongoing fees.`,
    canonical: "https://filetax.co/pricing",
  });

  // Service + offer catalog, derived from the same `cards` array the page
  // renders. Any card without a numeric price is skipped.
  useJsonLd("service", {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "IRS Form 5472 and Pro Forma 1120 preparation",
    serviceType: "Tax form preparation",
    provider: { "@id": "https://filetax.co/#organization" },
    areaServed: "US",
    audience: {
      "@type": "Audience",
      audienceType: "Non-U.S. founders of U.S. single-member LLCs",
    },
    url: "https://filetax.co/pricing",
    offers: cards
      .filter((card) => /^\+?\$\d/.test(card.price))
      .map((card) => ({
        "@type": "Offer",
        name: card.title,
        description: card.description,
        price: card.price.replace(/[^0-9.]/g, ""),
        priceCurrency: "USD",
        url: "https://filetax.co/pricing",
        // IRS fax is priced but not built, so it stays pre-order while
        // everything else is purchasable. See handoff item 1.
        availability: card.title.includes("IRS Fax")
          ? "https://schema.org/PreOrder"
          : "https://schema.org/InStock",
      })),
  });

  return (
    <>
      <IRSClock />

      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 1.5rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.5rem" }}>
            Per-filing pricing. No subscriptions.
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "1.0625rem", fontWeight: 400, marginBottom: "1.5rem" }}>
            The IRS penalty for a missed Form 5472 is $25,000 per form, per tax year. Catching up on a missed year costs ${PRICE_PER_YEAR + PRICE_RCL}.
          </p>
          <div style={{ background: "var(--tf-surface)", border: "2px solid #0284C7", borderRadius: "0.75rem", padding: "1.25rem 1.5rem" }}>
            <p style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1.0625rem", marginBottom: "0.375rem" }}>
              Missed three years? ${3 * PRICE_PER_YEAR + PRICE_RCL} total, not ${3 * (PRICE_PER_YEAR + PRICE_RCL)}.
            </p>
            <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.6 }}>
              The reasonable cause letter is charged once for the whole job, however many years you are catching up on. It is never charged per year.
            </p>
          </div>
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
