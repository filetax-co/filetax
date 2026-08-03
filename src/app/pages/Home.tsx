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
                // Centred rather than top-padded, and carrying a transparent
                // border to match the outlined button beside it. Without the
                // border the two labels sit a border-width apart vertically.
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid transparent",
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
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid oklch(from var(--tf-text, #0F172A) l c h / 0.2)",
                minHeight: "44px",
              }}
            >
              See Pricing
            </Link>
          </div>

          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "2.5rem" }}>
            Live now. Start without an account, and pay only when your forms are ready to download.
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
          {/* fontWeight 400 explicitly: `body` is 500, so a paragraph that does
              not override it renders as semi-bold running text.
              Shortened 3 Aug 2026, then partly restored. "Reasonable cause
              statement" and the non-U.S. single-member-LLC audience line are
              load-bearing and must survive any future trim: the first names the
              $199 product and is a real search term, the second is the whole
              positioning. Cut around them, not through them. */}
          <p style={{ color: "var(--tf-text)", fontSize: "1rem", fontWeight: 400, lineHeight: 1.7, marginBottom: "1.25rem" }}>
            Formation services rarely mention Form 5472 to non-U.S. founders. Most owners find out years later, when a bank, a visa preparer or an acquirer asks for prior filings and the penalty clock has already been running. The IRS allows voluntary catch-up with a reasonable cause statement, and self-correcting before they contact you is a far stronger position than answering a notice.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400 }}>
            Prepared to the IRS Instructions for Form 5472, on the revision in force for your tax year. Built for non-U.S. founders with U.S. single-member LLCs.
          </p>
        </div>
      </section>

      {/* What You Receive */}
      <section style={{ background: "var(--tf-bg)", padding: "4rem 1rem" }} aria-labelledby="receive-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="receive-heading" style={{ fontSize: "clamp(1.375rem, 3vw, 1.875rem)", marginBottom: "1.25rem" }}>
            Built for the filings other tools turn away
          </h2>
          {/* The positioning line. It states the thesis; the five items below are
              the proof of it, in the same order. Keep them in step: if a claim
              here stops being true, the bullet under it goes too. */}
          <p style={{ color: "var(--tf-text)", fontSize: "1.0625rem", fontWeight: 500, lineHeight: 1.6, marginBottom: "1.25rem", maxWidth: "680px" }}>
            The only Form 5472 platform built for complicated cases: multiple related
            parties, multiple missed years, fiscal and final-year returns, and one
            CPA-authored reasonable cause letter covering all of it.
          </p>
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
            You receive print-ready Form 5472 and pro forma 1120 with every required schedule, and you review everything before you download. You sign in your browser, by drawing your signature or typing your name, and your signature is applied to the pro forma 1120 and to your reasonable cause letter if you order one. Then you send the package to the IRS.
          </p>
          {/* The anchor, and the whole commercial argument in two sentences. It is
              deliberately a CPA, not the $30 tier: competing on price against the
              commodity band is a race we do not want to win. Kept to one line so
              the comparison itself lives on /compare and does not re-inflate this
              page, which was thinned on purpose. See handoff item 32. */}
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, marginTop: "1rem" }}>
            A CPA typically charges $400 to $900 per year for this filing. FileTax is ${PRICE_PER_YEAR}.{" "}
            <Link to="/compare" style={{ color: "var(--tf-accent)", fontWeight: 600 }}>
              See how the three options compare
            </Link>
            .
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
              // "LLC" was too narrow: intake also collects the owner and every
              // foreign related party, which is the part that surprises people.
              // Duplicated verbatim in the product repo's Home.tsx, change both.
              { step: "2", title: "Enter your details and transactions" },
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
              {/* THE FILING. One card for the year, whether it is the current
                  one or a missed one, because it is one product at one price
                  with one output. This card and the next used to be "Past Year
                  Filing + Reasonable Cause Letter" and "Form 5472 + Pro Forma
                  1120 Filing", which sold the same $99 filing twice and hid the
                  letter inside one of them. The letter is now its own card, the
                  same split /pricing uses. Keep them in step. */}
              <h3 style={{ fontSize: "1.125rem", marginBottom: "0.375rem" }}>Form 5472 + Pro Forma 1120</h3>
              <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.75rem", marginBottom: "0.25rem" }}>${PRICE_PER_YEAR}</p>
              <p style={{ color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Per tax year. Two forms, one price.</p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem", flex: 1 }}>The current year or any missed year back to 2019, at the same price, each rendered on the IRS form revision in force for it. Catching up on several years is one job, not one purchase at a time. Your next two filings are guaranteed at ${PRICE_PER_YEAR}.</p>
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
                Start My Filing
              </Link>
            </div>

            {/* The reasonable cause letter, its own card */}
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
              <h3 style={{ fontSize: "1.125rem", marginBottom: "0.375rem" }}>CPA-Authored Reasonable Cause Letter</h3>
              <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.75rem", marginBottom: "0.25rem" }}>+${PRICE_RCL}</p>
              <p style={{ color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Added to a late filing. Charged once, never per year.</p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem", flex: 1 }}>Asks the IRS to waive the automatic $25,000 penalty. One letter names every late year in the job, so three missed years is ${3 * PRICE_PER_YEAR + PRICE_RCL} in total, not ${3 * (PRICE_PER_YEAR + PRICE_RCL)}.</p>
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

            {/* Small cards column. IRS fax first because it is a service you
                can actually buy today; the Form 8832 classification change is
                not built yet and sits below it. */}
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
                  flex: 1,
                }}
              >
                <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>IRS Fax Transmission</h3>
                <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.375rem", marginBottom: "0.25rem" }}>+${PRICE_FAX} add-on</p>
                {/* Aligned with the Services page fax section on 3 Aug 2026.
                    Two facts that sell the add-on were only on Services: one
                    fee covers the whole job however many years, and it is an
                    add-on to 5472 filings only. The card read as $9 per year
                    to anyone catching up, which is the exact filer this page
                    is written for. */}
                <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginBottom: "1rem", flex: 1 }}>You sign in your browser, we fax the package to the IRS so you never need a printer, and the transmission receipt is stored against your filing. One fee covers the whole job however many years you are filing.</p>
                <Link
                  to="/check"
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
                  {/* "Offered when you file", not "Check My Eligibility".
                      Fax is an add-on to a 5472 filing, never a standalone
                      purchase, so a CTA that reads like the start of its own
                      checkout misdescribes it. Pricing.tsx has said this since
                      45ae987; Home and Services were the two that disagreed.
                      All three now carry the same label, and all three still
                      link to /check, which is where the filing actually
                      starts. Keep them in step. */}
                  Offered when you file
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
                  flex: 1,
                }}
              >
                {/* Not built. Carried a "Start Filing" button into the portal
                    until 3 Aug 2026, for a service that does not exist. The
                    "(at launch)" title marker is gone at the owner's request,
                    so the body copy is now the ONLY thing saying this cannot be
                    bought. Do not soften it. See handoff item 51. */}
                <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>LLC Tax Classification Change</h3>
                <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "1.375rem", marginBottom: "0.25rem" }}>$50</p>
                <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginBottom: "1rem", flex: 1 }}><strong style={{ color: "var(--tf-text)" }}>Not yet available.</strong> Form 8832, to be taxed as a C-Corporation instead of a disregarded entity. Print-ready PDF, mailed by you.</p>
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
                  Notify Me When This Launches
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
            Get Notified
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
