import { Link } from "react-router";
import { IRSClock } from "../components/IRSClock";
import { usePageMeta } from "../hooks/usePageMeta";
import { PRICE_PER_YEAR, PRICE_RCL, PRICE_FAX } from "../../lib/pricing";

export function Home() {
  usePageMeta({
    title: "File Form 5472 + Pro Forma 1120 | FileTax.co",
    description:
      "Generate IRS-ready Form 5472 and Pro Forma 1120 for foreign-owned U.S. single-member LLCs. Catch up on missed years before the IRS notices. Pay per filing. Start without an account.",
    canonical: "https://filetax.co/",
  });

  return (
    <>
      {/* Hero */}
      <section
        style={{ background: "var(--tf-bg)", padding: "4rem 1rem 3rem" }}
        aria-labelledby="hero-heading"
      >
        <div style={{ maxWidth: "760px", margin: "0 auto", textAlign: "center" }}>
          <h1
            id="hero-heading"
            style={{
              fontSize: "clamp(1.875rem, 5vw, 3rem)",
              fontWeight: 700,
              color: "var(--tf-text)",
              lineHeight: 1.2,
              marginBottom: "1.25rem",
            }}
          >
            Missed Form 5472? Fix it before the IRS notices.
          </h1>
          <p
            style={{
              fontSize: "clamp(1rem, 2.5vw, 1.25rem)",
              color: "var(--tf-muted)",
              fontWeight: 500,
              lineHeight: 1.6,
              marginBottom: "2rem",
              maxWidth: "600px",
              margin: "0 auto 2rem",
            }}
          >
            Foreign founders often discover this $25,000 filing requirement years late. Voluntary catch-up filing with a reasonable cause letter often qualifies for full penalty relief, but only if you file before the IRS contacts you.
          </p>

          <div className="flex flex-wrap gap-3 justify-center mb-3">
            <Link
              to="/check"
              style={{
                background: "var(--tf-accent)",
                color: "white",
                fontWeight: 600,
                fontSize: "1rem",
                padding: "0.75rem 1.75rem",
                borderRadius: "0.5rem",
                textDecoration: "none",
                display: "inline-block",
                minHeight: "44px",
              }}
            >
              Check Eligibility
            </Link>
            <Link
              to="/pricing"
              style={{
                background: "transparent",
                color: "var(--tf-text)",
                fontWeight: 600,
                fontSize: "1rem",
                padding: "0.75rem 1.75rem",
                borderRadius: "0.5rem",
                textDecoration: "none",
                display: "inline-block",
                border: "1px solid oklch(from var(--tf-text, #0F172A) l c h / 0.2)",
                minHeight: "44px",
              }}
            >
              See Pricing
            </Link>
          </div>

          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "2.5rem" }}>
            The eligibility check is live now and takes about 2 minutes. Filing opens ahead of the April 15, 2027 deadline.
          </p>
        </div>

        <IRSClock />
      </section>

      {/* Why FileTax.co Exists */}
      <section style={{ background: "var(--tf-surface)", padding: "4rem 1rem" }} aria-labelledby="why-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="why-heading" style={{ fontSize: "clamp(1.375rem, 3vw, 1.875rem)", marginBottom: "1rem" }}>
            Why this keeps happening
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "1rem", lineHeight: 1.7, marginBottom: "1.25rem" }}>
            LLC formation services rarely mention Form 5472 to non-U.S. founders. Most owners only discover the requirement when a U.S. bank, a visa preparer, or an acquirer asks for prior tax filings. By that point the penalty clock has been running, often for two or three years. The good news: the IRS allows voluntary catch-up filings with a reasonable cause statement, and self-correcting before the IRS contacts you significantly improves the outcome.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            Prepared per the IRS Instructions for Form 5472, on the form revision the IRS had in force for the tax year you are filing. Designed specifically for non-U.S. founders with U.S. single-member LLCs.
          </p>
        </div>
      </section>

      {/* What You Receive */}
      <section style={{ background: "var(--tf-bg)", padding: "4rem 1rem" }} aria-labelledby="receive-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="receive-heading" style={{ fontSize: "clamp(1.375rem, 3vw, 1.875rem)", marginBottom: "1.25rem" }}>
            Built for the filings other tools turn away
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
            {[
              `Multiple missed years, one CPA-authored reasonable cause letter covering all of them, charged once, not per year`,
              "Multiple foreign related parties, with a separate Form 5472 for each",
              "Fiscal-year filers, and final returns for an LLC you have closed",
              "We never ask for your bank statements, and your eligibility answers never leave your browser",
              "Download your filing again any time, years later",
            ].map((item) => (
              <li
                key={item}
                style={{
                  padding: "0.625rem 0",
                  borderBottom: "1px solid var(--tf-border)",
                  color: "var(--tf-text)",
                  fontSize: "1rem",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                }}
              >
                <span style={{ color: "var(--tf-success)", fontWeight: 700, fontSize: "1.125rem", flexShrink: 0 }}>&#10003;</span>
                {item}
              </li>
            ))}
          </ul>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            You receive print-ready Form 5472 and pro forma 1120 with every required schedule, and you review everything before you download. You sign and send them to the IRS.
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section style={{ background: "var(--tf-surface)", padding: "4rem 1rem" }} aria-labelledby="how-heading">
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <h2 id="how-heading" style={{ fontSize: "clamp(1.375rem, 3vw, 1.875rem)", marginBottom: "0.5rem" }}>
            How it works
          </h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", marginBottom: "2.5rem" }}>
            Four steps from eligibility check to print-ready forms.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: "1", title: "Complete a short eligibility check" },
              { step: "2", title: "Enter your LLC details and transactions" },
              { step: "3", title: "Review your complete filing summary" },
              { step: "4", title: "Download IRS-ready forms" },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  background: "var(--tf-bg)",
                  border: "1px solid var(--tf-border)",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
                }}
              >
                <div
                  style={{
                    width: "2rem",
                    height: "2rem",
                    background: "var(--tf-accent)",
                    color: "white",
                    borderRadius: "9999px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: "0.9375rem",
                    marginBottom: "0.875rem",
                  }}
                >
                  {item.step}
                </div>
                <p style={{ fontWeight: 600, color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.4 }}>
                  {item.title}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Services Overview */}
      <section style={{ background: "var(--tf-bg)", padding: "4rem 1rem" }} aria-labelledby="services-heading">
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <h2 id="services-heading" style={{ fontSize: "clamp(1.375rem, 3vw, 1.875rem)", marginBottom: "2rem" }}>
            Services
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Large card - Past Year filing leads */}
            <div
              style={{
                gridColumn: "span 1",
                background: "var(--tf-surface)",
                border: "1px solid var(--tf-border)",
                borderRadius: "0.75rem",
                padding: "2rem",
                boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
                display: "flex",
                flexDirection: "column",
              }}
              className="lg:col-span-1"
            >
              <span
                style={{
                  display: "inline-block",
                  background: "var(--tf-error)",
                  color: "white",
                  borderRadius: "9999px",
                  padding: "0.2rem 0.75rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  marginBottom: "0.75rem",
                  width: "fit-content",
                }}
              >
                Recommended for Late Filers
              </span>
              <h3 style={{ fontSize: "1.125rem", marginBottom: "0.375rem" }}>Past Year Filing + Reasonable Cause Letter</h3>
              <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.75rem", marginBottom: "0.25rem" }}>from ${PRICE_PER_YEAR + PRICE_RCL}</p>
              <p style={{ color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Catch up on a missed year. Filed correctly the first time.</p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem", flex: 1 }}>${PRICE_PER_YEAR} per year, plus one ${PRICE_RCL} reasonable cause letter covering every year. Three missed years is ${3 * PRICE_PER_YEAR + PRICE_RCL} in total, not ${3 * (PRICE_PER_YEAR + PRICE_RCL)}. The letter is never charged twice.</p>
              <Link
                to="/past-filings"
                style={{
                  background: "var(--tf-accent)",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  padding: "0.625rem 1.25rem",
                  borderRadius: "0.5rem",
                  textDecoration: "none",
                  display: "block",
                  textAlign: "center",
                  minHeight: "44px",
                  lineHeight: "1.8",
                }}
              >
                Fix a Missed Year
              </Link>
            </div>

            {/* Current year card */}
            <div
              style={{
                background: "var(--tf-surface)",
                border: "1px solid var(--tf-border)",
                borderRadius: "0.75rem",
                padding: "2rem",
                boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <h3 style={{ fontSize: "1.125rem", marginBottom: "0.375rem" }}>Form 5472 + Pro Forma 1120 Filing</h3>
              <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.75rem", marginBottom: "0.25rem" }}>${PRICE_PER_YEAR}</p>
              <p style={{ color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Current-year filing. Two forms, one price.</p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem", flex: 1 }}>For LLCs filing on time or within the October 15 extension window. Your next two filings are guaranteed at ${PRICE_PER_YEAR}.</p>
              <Link
                to="/check"
                style={{
                  background: "var(--tf-accent)",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  padding: "0.625rem 1.25rem",
                  borderRadius: "0.5rem",
                  textDecoration: "none",
                  display: "block",
                  textAlign: "center",
                  minHeight: "44px",
                  lineHeight: "1.8",
                }}
              >
                Check Eligibility
              </Link>
            </div>

            {/* Small cards column */}
            <div className="flex flex-col gap-5">
              <div
                style={{
                  background: "var(--tf-surface)",
                  border: "1px solid var(--tf-border)",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>LLC Tax Classification Change</h3>
                <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.375rem", marginBottom: "0.25rem" }}>$50</p>
                <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginBottom: "1rem", flex: 1 }}>Form 8832, to be taxed as a C-Corporation instead of a disregarded entity. Print-ready PDF, mailed by you.</p>
                {/* Original link (restore when portal is ready): <Link to="/portal" ...>Start Filing</Link> */}
                <Link
                  to="/waitlist?service=llc-classification"
                  style={{
                    color: "var(--tf-accent)",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    textDecoration: "none",
                    border: "1px solid var(--tf-accent)",
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    display: "block",
                    textAlign: "center",
                    minHeight: "44px",
                    lineHeight: "1.8",
                  }}
                >
                  Start Filing
                </Link>
              </div>

              <div
                style={{
                  background: "var(--tf-surface)",
                  border: "1px solid var(--tf-border)",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>IRS Fax Transmission (at launch)</h3>
                <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.375rem", marginBottom: "0.25rem" }}>+${PRICE_FAX} add-on</p>
                <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginBottom: "1rem", flex: 1 }}>Not yet available. At launch: you sign the forms, we fax them to the IRS so you never need a printer, and you get a transmission receipt.</p>
                {/* Original link (restore when portal is ready): <Link to="/portal" ...>Add to Filing</Link> */}
                <Link
                  to="/waitlist?service=irs-fax"
                  style={{
                    color: "var(--tf-accent)",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    textDecoration: "none",
                    border: "1px solid var(--tf-accent)",
                    padding: "0.5rem 1rem",
                    borderRadius: "0.5rem",
                    display: "block",
                    textAlign: "center",
                    minHeight: "44px",
                    lineHeight: "1.8",
                  }}
                >
                  Add to Filing
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* More services on the way / Waitlist CTA */}
      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="waitlist-cta-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto", textAlign: "center" }}>
          <h2 id="waitlist-cta-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.625rem)", marginBottom: "0.75rem" }}>
            More services on the way
          </h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", lineHeight: 1.6, marginBottom: "1.5rem", maxWidth: "560px", marginLeft: "auto", marginRight: "auto" }}>
            Form 7004 extensions, FBAR reporting, and Wyoming annual reports are launching soon. Join the waitlist to get notified when each one is ready.
          </p>
          <Link
            to="/waitlist"
            style={{
              background: "transparent",
              color: "var(--tf-accent)",
              fontWeight: 600,
              fontSize: "1rem",
              padding: "0.75rem 1.75rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              display: "inline-block",
              border: "1px solid var(--tf-accent)",
              minHeight: "44px",
            }}
          >
            Join the Waitlist
          </Link>
        </div>
      </section>

      {/* Trust signals strip */}
      <section style={{ background: "var(--tf-nav)", padding: "2rem 1rem" }} aria-label="Trust signals">
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <div className="flex flex-wrap gap-3 justify-center">
            {[
              "Each year prepared on the IRS form revision in force for that year",
              "Reasonable cause letter written by a practising U.S. CPA",
              "Not every LLC is a fit. The eligibility check will tell you.",
            ].map((item) => (
              <span
                key={item}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "9999px",
                  padding: "0.375rem 1rem",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Urgency band */}
      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-label="Filing urgency">
        <div style={{ maxWidth: "760px", margin: "0 auto", textAlign: "center" }}>
          <p style={{ color: "var(--tf-text)", fontWeight: 700, fontSize: "clamp(1.125rem, 3vw, 1.5rem)", marginBottom: "0.75rem", lineHeight: 1.3 }}>
            Voluntary catch-up filings work best before the IRS contacts you.
          </p>
          <p style={{ color: "var(--tf-muted)", fontWeight: 500, fontSize: "1rem", marginBottom: "1.75rem" }}>
            Every unfiled year adds to your exposure. Filing now keeps you in voluntary territory.
          </p>
          <Link
            to="/past-filings"
            style={{
              background: "var(--tf-error)",
              color: "white",
              fontWeight: 700,
              fontSize: "1rem",
              padding: "0.75rem 1.75rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              display: "inline-block",
              minHeight: "44px",
            }}
          >
            Fix a Missed Year
          </Link>
        </div>
      </section>

      {/* Contact */}
      <section style={{ background: "var(--tf-surface)", padding: "4rem 1rem" }} aria-labelledby="contact-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="contact-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>
            Have a question before you start?
          </h2>
          <a
            href="mailto:hello@filetax.co"
            style={{ color: "var(--tf-accent)", fontWeight: 600, fontSize: "1.125rem", display: "block", marginBottom: "0.375rem" }}
          >
            hello@filetax.co
          </a>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            We respond within 1 business day.
          </p>
        </div>
      </section>
    </>
  );
}
