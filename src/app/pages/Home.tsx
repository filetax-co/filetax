import { Link } from "react-router";
import { IRSClock } from "../components/IRSClock";
import { usePageMeta } from "../hooks/usePageMeta";

export function Home() {
  usePageMeta({
    title: "File Form 5472 + Pro Forma 1120 | FileTax.co",
    description:
      "Generate IRS-ready Form 5472 and Pro Forma 1120 for foreign-owned U.S. single-member LLCs. Catch up on missed years before the IRS notices. Pay per filing. Start without an account.",
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
                background: "#0284C7",
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
            Start without an account. Eligibility check takes about 2 minutes.
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
            LLC formation services rarely mention Form 5472 to non-U.S. founders. Most owners only discover the requirement when a U.S. bank, a visa preparer, or an acquirer asks for prior tax filings. By that point, the $25,000 per year penalty clock has been running, often for two or three years. The good news: the IRS allows voluntary catch-up filings with a reasonable cause statement, and self-correcting before the IRS contacts you significantly improves the outcome.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            Forms generated strictly per IRS Instructions for Form 5472 (Rev. December 2024). Designed specifically for non-U.S. founders with U.S. single-member LLCs.
          </p>
        </div>
      </section>

      {/* What You Receive */}
      <section style={{ background: "var(--tf-bg)", padding: "4rem 1rem" }} aria-labelledby="receive-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="receive-heading" style={{ fontSize: "clamp(1.375rem, 3vw, 1.875rem)", marginBottom: "1.25rem" }}>
            What you receive
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
            {[
              "Print-ready Form 5472 and Pro Forma 1120",
              "Structured exactly as required by the IRS",
              "Ready to sign and send by mail or fax",
              "Includes all required schedules and disclosures",
              "Reasonable cause letter for past-year filings",
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
                <span style={{ color: "#059669", fontWeight: 700, fontSize: "1.125rem", flexShrink: 0 }}>&#10003;</span>
                {item}
              </li>
            ))}
          </ul>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            You review everything before downloading. You sign and submit, or add the optional fax transmission.
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
                    background: "#0284C7",
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
                Recommended for Late Filers
              </span>
              <h3 style={{ fontSize: "1.125rem", marginBottom: "0.375rem" }}>Past Year Filing + Reasonable Cause Letter</h3>
              <p style={{ color: "#0284C7", fontWeight: 700, fontSize: "1.75rem", marginBottom: "0.25rem" }}>from $350</p>
              <p style={{ color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Catch up on a missed year. Filed correctly the first time.</p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem", flex: 1 }}>$150 filing + $200 reasonable cause letter per year. One-time cost.</p>
              <Link
                to="/past-filings"
                style={{
                  background: "#0284C7",
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
              <p style={{ color: "#0284C7", fontWeight: 700, fontSize: "1.75rem", marginBottom: "0.25rem" }}>$150</p>
              <p style={{ color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Current-year filing. Two forms, one price.</p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem", flex: 1 }}>For LLCs filing on time or within the October 15 extension window.</p>
              <Link
                to="/check"
                style={{
                  background: "#0284C7",
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
                <p style={{ color: "#0284C7", fontWeight: 700, fontSize: "1.375rem", marginBottom: "0.25rem" }}>$50</p>
                <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginBottom: "1rem", flex: 1 }}>Form 8832 or Form 2553. Print-ready PDF, mailed by you.</p>
                {/* Original link (restore when portal is ready): <Link to="/portal" ...>Start Filing</Link> */}
                <Link
                  to="/waitlist?service=llc-classification"
                  style={{
                    color: "#0284C7",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    textDecoration: "none",
                    border: "1px solid #0284C7",
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
                <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>IRS Fax Transmission</h3>
                <p style={{ color: "#0284C7", fontWeight: 700, fontSize: "1.375rem", marginBottom: "0.25rem" }}>+$30 add-on</p>
                <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginBottom: "1rem", flex: 1 }}>You sign the forms. We transmit them by fax to the IRS. Receipt for your records.</p>
                {/* Original link (restore when portal is ready): <Link to="/portal" ...>Add to Filing</Link> */}
                <Link
                  to="/waitlist?service=irs-fax"
                  style={{
                    color: "#0284C7",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    textDecoration: "none",
                    border: "1px solid #0284C7",
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
              color: "#0284C7",
              fontWeight: 600,
              fontSize: "1rem",
              padding: "0.75rem 1.75rem",
              borderRadius: "0.5rem",
              textDecoration: "none",
              display: "inline-block",
              border: "1px solid #0284C7",
              minHeight: "44px",
            }}
          >
            Join the Waitlist
          </Link>
        </div>
      </section>

      {/* Trust signals strip */}
      <section style={{ background: "#0F172A", padding: "2rem 1rem" }} aria-label="Trust signals">
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          <div className="flex flex-wrap gap-3 justify-center">
            {[
              "Forms per IRS Instructions Rev. December 2024",
              "Pay-per-filing. No subscription.",
              "Start without an account.",
              "IRS penalty starts at $25,000 per missed form, per year",
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
      <section style={{ background: "#B31D1D", padding: "3rem 1rem" }} aria-label="Filing urgency">
        <div style={{ maxWidth: "760px", margin: "0 auto", textAlign: "center" }}>
          <p style={{ color: "white", fontWeight: 700, fontSize: "clamp(1.125rem, 3vw, 1.5rem)", marginBottom: "0.75rem", lineHeight: 1.3 }}>
            Voluntary catch-up filings work best before the IRS contacts you.
          </p>
          <p style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500, fontSize: "1rem", marginBottom: "1.75rem" }}>
            Each unfiled year carries a $25,000 IRS penalty. Filing now keeps you in voluntary territory.
          </p>
          <Link
            to="/past-filings"
            style={{
              background: "white",
              color: "#B31D1D",
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
            style={{ color: "#0284C7", fontWeight: 600, fontSize: "1.125rem", display: "block", marginBottom: "0.375rem" }}
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
