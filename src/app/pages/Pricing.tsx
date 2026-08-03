import { Link } from "react-router";
import { IRSClock } from "../components/IRSClock";
import { InfoTip } from "../components/InfoTip";
import { usePageMeta } from "../hooks/usePageMeta";
import { useJsonLd } from "../hooks/useJsonLd";
import { PRICE_PER_YEAR, PRICE_RCL, PRICE_ADDITIONAL_PARTY, PRICE_FAX, PRICE_CLASSIFICATION_CHANGE, SERVICES } from "../../lib/pricing";
import type { ServiceId } from "../../lib/pricing";

const CHECK_URL = "/check";
// The Form 8832 classification change is PRICED BUT NOT BUILT, so it collects
// interest rather than starting a filing. A priced card with a confident CTA
// is a promise, and "Start Filing" on something that does not exist is the
// worst version of that. Swap this for the real link in the commit that ships
// it, and flip `available` in SERVICES, which is what the Offer catalog below
// now keys `PreOrder` off. It used to key off the words "Not yet available" at
// the start of the card description, so rewording one sentence would have
// quietly advertised an unbuilt service as InStock.
//
// IRS FAX IS LIVE as of 3 Aug 2026, per the owner. It carried "not yet
// available" copy and a waitlist CTA across four pages long after that stopped
// being true. If you are reading an older note saying fax is unbuilt, that note
// is the stale one.
const CLASSIFICATION_URL = "/waitlist?service=classification_change";

interface PricingCard {
  title: string;
  price: string;
  /** Which entry in SERVICES this card sells. Drives the Offer availability
   *  below, so a card cannot claim to be buyable when the map says it is not. */
  serviceId: ServiceId;
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

// SOLD BY SITUATION, NOT BY SKU. Read this before adding a card.
//
// This page used to carry SEVEN cards for what is really two decisions. Three
// of them were the SAME $99 product under three names: "Past Year", "Current
// Year" and "Multi-Year Past Filing Package". The first card's own copy said
// "Same output as current year", which is the tell. A buyer does not arrive
// thinking "I need a current-year filing"; they arrive thinking "I just found
// out about this and I have three unfiled years". Four cards answered that one
// thought, so the page made a simple decision look like a product catalogue.
//
// The reasonable cause letter STAYS ITS OWN CARD. Folding it into the catch-up
// card was tried on 3 Aug 2026 and rejected by the owner. What did change is
// its position and its badge: it used to sit third, beside "Current Year", the
// one buyer it cannot apply to, since a current-year filer is not late and has
// nothing to abate. It now leads the add-ons and carries "Recommended for Late
// Filers", because catching up is what a late filer is already doing by the
// time they reach that card, while the letter is the part they might skip and
// should not. It cannot be sold alone, and §4 forbids implying it is required,
// so it must not become a headline card either.
//
// The rule: PRIMARY is a situation the buyer recognises. ADD_ONS are things
// that modify a filing and cannot be bought by themselves. A new SKU is not a
// new card. See handoff item 46.
const PRIMARY: PricingCard[] = [
  {
    title: "Filing one tax year",
    serviceId: "filing",
    price: `$${PRICE_PER_YEAR}`,
    priceNote: "per year",
    // KEEP CARDS SHORT. The detail goes in the tooltip, not the body. These
    // descriptions ran to four and five lines each on 3 Aug 2026, which made
    // a two-choice page read as a wall and buried the choice itself. If a fact
    // is needed to decide, it belongs in the body; if it is needed to feel
    // safe, it belongs in the tooltip.
    description: "Form 5472 and the pro forma 1120, on the IRS revision in force for that year.",
    microcopy: `Current or past year, same price. Your next two filings are guaranteed at $${PRICE_PER_YEAR}.`,
    tooltip:
      "One filing. Two forms. One price. The IRS requires these to be filed together, so this is not two products bundled and you are not paying for extras. A past year costs the same as the current one and produces the same output.",
    // Both primary cards carry `highlight`, so the two situations look like
    // equal choices rather than a recommendation and an also-ran. The buyer
    // already knows which one they are; the page should not push. What steers
    // a late filer is the badge on the reasonable cause letter below.
    cta: "Start My Filing",
    ctaLink: CHECK_URL,
    highlight: true,
  },
  {
    title: "Catching up on multiple missed years",
    serviceId: "filing",
    price: `$${PRICE_PER_YEAR}`,
    priceNote: "per year",
    description: "Every unfiled year back to 2019, filed as one job rather than one purchase at a time.",
    microcopy: "Add the reasonable cause letter below to ask for the penalty to be waived.",
    tooltip:
      "You enter your LLC and owner details once and they carry across every year. Each year is rendered on the IRS form revision in force for it, not on the current year's form for all of them. Voluntary catch-up works best before the IRS contacts you.",
    // The "Recommended for Late Filers" badge sits on the reasonable cause
    // letter, not here. Catching up is what a late filer is already doing by
    // the time they read this card; the letter is the part they might skip and
    // should not.
    cta: "Start My Catch-Up",
    ctaLink: CHECK_URL,
    highlight: true,
  },
];

// Things that modify a filing. None can be bought on their own. They stay
// cards in the same grid, deliberately: a demoted plain-text list was tried on
// 3 Aug 2026 and looked worse, and the $199 letter in particular does not
// deserve to be visually buried.
const ADD_ONS: PricingCard[] = [
  {
    title: "Add-On: CPA-Authored Reasonable Cause Letter",
    serviceId: "rcl",
    price: `+$${PRICE_RCL}`,
    priceNote: "one letter, covers every year",
    badge: "Recommended for Late Filers",
    description: `An argument for abating the automatic $25,000 penalty, built from your filing details.`,
    microcopy: `Charged once, never per year. One missed year $${PRICE_PER_YEAR + PRICE_RCL}, three years $${3 * PRICE_PER_YEAR + PRICE_RCL}.`,
    tooltip:
      "Generated from a framework written by a practising U.S. CPA and populated with your filing details and the circumstances you select. It does not include an individual CPA review of your filing, and it is not tax advice. One letter names every late year in the job, which is why it is charged once however many years you are catching up on.",
    // Add-on CTAs describe HOW YOU GET the thing, they do not repeat the
    // funnel. Every one of these used to say "Check My Eligibility", the same
    // words as the filings above, so four modifiers read as four more products
    // and no button told you what it would actually do.
    //
    // "Offered", not "added", and the distinction is the point: the letter is a
    // choice the filer makes, not something we attach to a late filing on their
    // behalf. §4 forbids implying it is required, and a button reading "Add a
    // Reasonable Cause Letter" edges toward exactly that. See handoff item 46.
    cta: "Offered when you file a late year",
    ctaLink: CHECK_URL,
  },
  {
    title: "Add-On: Additional Related Party (Form 5472)",
    serviceId: "additional_party",
    price: `+$${PRICE_ADDITIONAL_PARTY}`,
    priceNote: "per party, per year",
    description: "A separate Form 5472 for each foreign related party, for each year you file.",
    microcopy: "Most single-member LLCs have one, the owner, and pay nothing extra.",
    tooltip:
      "The IRS requires a separate Form 5472 per foreign related party. You would need this if the LLC transacted with a foreign parent company or another entity you own 25% or more of. Totals across the forms are reconciled on lines 1f and 1h.",
    cta: "Added in the portal as you file",
    ctaLink: CHECK_URL,
  },
  {
    title: "Add-On: IRS Fax Transmission",
    serviceId: "fax",
    price: `+$${PRICE_FAX}`,
    priceNote: "one fee, however many years",
    description: "We fax the completed package to the IRS for you, so you never need a printer.",
    microcopy: "One fee for the whole job. Not available for Form 8832.",
    // The receipt-is-not-acceptance line matters MORE now that fax is live,
    // not less: a filer who reads "receipt" as "the IRS accepted my return"
    // stops chasing it. It is in the tooltip here only because this is a
    // pricing card; /services and /refunds both still state it in full body
    // text. Do not remove it from those two.
    tooltip:
      "A transmission receipt records the date, time and page count, and is stored against your filing. It is proof that the IRS received the fax. It is not proof that the IRS has accepted or processed your filing, and no preparer can give you that.",
    cta: "Offered when you file",
    ctaLink: CHECK_URL,
  },
  {
    title: "LLC Tax Classification Change",
    serviceId: "classification_change",
    price: `$${PRICE_CLASSIFICATION_CHANGE}`,
    priceNote: "per filing",
    description: `${SERVICES.classification_change.available ? "" : "Not yet available. "}A standalone Form 8832, to be taxed as a C-Corporation.`,
    microcopy: "Must be mailed. The fax add-on will not cover it.",
    tooltip:
      "Form 8832 elects C-Corporation treatment instead of the default disregarded entity status. It is separate from Form 5472, and making the election does not remove the Form 5472 obligation.",
    cta: "Notify Me When This Launches",
    ctaLink: CLASSIFICATION_URL,
  },
];

// Kept as one list for the Offer catalog below, so the structured data cannot
// fall out of step with what the page renders.
const cards: PricingCard[] = [...PRIMARY, ...ADD_ONS];

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
    // Matches a price anywhere in the string rather than only at the start. A
    // "From $298" card was drafted and dropped, and the anchored pattern had
    // silently excluded it from the catalog: a card can be priced without the
    // digits leading, and losing an offer should not be the quiet default.
    offers: cards
      .filter((card) => /\$\d/.test(card.price))
      .map((card) => ({
        "@type": "Offer",
        name: card.title,
        description: card.description,
        price: card.price.replace(/[^0-9.]/g, ""),
        priceCurrency: "USD",
        url: "https://filetax.co/pricing",
        // Read off SERVICES, so structured data and page copy cannot disagree.
        // This used to test `card.description.startsWith("Not yet available")`,
        // which made one sentence of marketing copy load-bearing for schema:
        // rewording it would have advertised an unbuilt service as InStock,
        // and the comment warning about that was the only thing stopping it.
        // Item 51.
        availability: SERVICES[card.serviceId].available
          ? "https://schema.org/InStock"
          : "https://schema.org/PreOrder",
      })),
  });

  return (
    <>
      <IRSClock />

      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 1.5rem" }}>
        {/* 1100px, matching the pricing card grid below, so the callout lines up
            with the cards instead of sitting inset and narrower than them. The
            prose keeps its own narrower measure: a 1100px line length is not
            readable, but a full-width callout is what makes the section look
            deliberate. */}
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.5rem" }}>
            Per-filing pricing. No subscriptions.
          </h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "1.0625rem", fontWeight: 400, marginBottom: "1.5rem", maxWidth: "760px" }}>
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
                    <InfoTip text={card.tooltip} label={`About ${card.title}`} />
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
