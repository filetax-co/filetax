import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { PRICE_PER_YEAR, PRICE_RCL, PRICE_ADDITIONAL_PARTY, PRICE_FAX, SERVICES, waitlistServices } from "../../lib/pricing";

const CHECK_URL = "/check";
// The Form 8832 classification change is PRICED BUT NOT BUILT, so its section
// collects interest rather than starting a filing. It carried a confident
// "Start Filing" button into the portal until 3 Aug 2026, for a service that
// does not exist. Swap this for the real link and flip `available` in SERVICES
// in the commit that ships it; the "Not yet available" opener is derived from
// that flag now and needs no separate edit.
//
// IRS FAX IS LIVE as of 3 Aug 2026, per the owner. Older notes calling it
// unbuilt are the stale ones.
const CLASSIFICATION_URL = "/waitlist?service=classification_change";

export function Services() {
  usePageMeta({
    title: "Services | FileTax.co",
    description:
      "Form 5472 + Pro Forma 1120 filing, CPA-Authored Reasonable Cause Letters, LLC tax classification changes, and IRS fax transmission for foreign-owned U.S. LLCs.",
    canonical: "https://filetax.co/services",
  });

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.75rem" }}>Services</h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6 }}>
            Built specifically for foreign-owned U.S. single-member LLCs. Forms generated strictly to the IRS Instructions for Form 5472, and rendered on the revision of Form 5472 and Form 1120 that the IRS had in force for the tax year you are filing, not on the current year's form for every year.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="s1-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="s1-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>
            Form 5472 + Pro Forma 1120 Filing
          </h2>
          <div style={{ background: "var(--tf-bg)", border: "1px solid #0284C7", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: 600, color: "var(--tf-text)", fontSize: "0.9375rem" }}>
              One Filing. Two Forms. One Price. The IRS requires Form 5472 to be attached to a Pro Forma 1120. They cannot be filed separately.
            </p>
          </div>
          {/* Four explainer blocks lived here until 3 Aug 2026: who needs to
              file, what counts as a reportable transaction, non-monetary and
              below-market transfers, and the penalty stakes. All accurate, all
              on the wrong page. This is where a buyer decides whether to buy,
              and they were being handed a tax lesson first. The "what is this
              form" material belongs in /resources, and "what happens when I
              file" belongs in /guide. Both are linked below. Do not reinstate
              them here: the page grew to 276 lines this way. */}
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.7, marginBottom: "1.5rem" }}>
            New to this filing? The{" "}
            <Link to="/guide" style={{ color: "#0284C7", fontWeight: 600 }}>
              filing guide
            </Link>{" "}
            walks through every screen before you start, and the{" "}
            <Link to="/resources" style={{ color: "#0284C7", fontWeight: 600 }}>
              guides
            </Link>{" "}
            cover who has to file, what counts as a reportable transaction, and
            what the $25,000 penalty actually applies to.
          </p>

          <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "1.0625rem", marginBottom: "0.875rem" }}>What you receive</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {[
                "Print-ready Form 5472 and Pro Forma 1120",
                "Structured exactly as required by the IRS",
                "Signed in your browser, ready to send by mail or fax",
                "Includes all required schedules and disclosures",
              ].map((item) => (
                <li key={item} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--tf-border)", display: "flex", gap: "0.75rem", fontSize: "0.9375rem" }}>
                  <span style={{ color: "#059669", fontWeight: 700 }}>&#10003;</span>
                  {item}
                </li>
              ))}
            </ul>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginTop: "0.75rem" }}>
              You review everything before downloading your forms.
            </p>
          </div>

          <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1rem" }}>
            <p style={{ fontWeight: 600, fontSize: "0.9375rem", color: "var(--tf-text)", marginBottom: "0.25rem" }}>Transaction entry: Manual</p>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>Enter transactions manually. No bank login required.</p>
          </div>

          <div style={{ background: "rgba(2,132,199,0.04)", border: "1px solid rgba(2,132,199,0.25)", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1.75rem" }}>
            <p style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--tf-text)", marginBottom: "0.375rem" }}>
              More than one foreign related party?
            </p>
            <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.65, marginBottom: "0.5rem" }}>
              The IRS requires a separate Form 5472 for each foreign related party. Most single-member LLCs have only one, the foreign owner. If your LLC transacted with additional related parties such as a foreign parent company or an entity you own 25% or more of, each requires its own Form 5472.
            </p>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>
              Each additional related party: <strong style={{ color: "var(--tf-text)" }}>+${PRICE_ADDITIONAL_PARTY} per year</strong> (one extra Form 5472 per party, for each year you file). You add each related party in the portal, and your total updates as you go. You will see the full itemised amount before you are asked to pay.
            </p>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: 600, color: "var(--tf-muted)", fontSize: "0.875rem", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Sample Output Preview
            </p>
            {/* The forms are shown complete: they are mostly the filer's own data,
                so showing them costs nothing. The reasonable cause letter is the
                opposite, the argument IS the product, so its body is obscured and
                only the structure, citations, perjury declaration and signature
                show. Do not "improve" this by revealing the argument paragraphs.
                See handoff item 22. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { src: "/samples/sample-5472.webp", label: "Form 5472, page 1" },
                { src: "/samples/sample-1120.webp", label: "Pro forma 1120, page 1" },
                { src: "/samples/sample-rcl.webp", label: "Reasonable cause letter" },
              ].map((s) => (
                <figure key={s.src} style={{ margin: 0 }}>
                  <img
                    src={s.src}
                    alt={`${s.label}, completed with sample data and marked SAMPLE`}
                    width={1224}
                    height={1584}
                    loading="lazy"
                    style={{ width: "100%", height: "auto", display: "block", borderRadius: "0.5rem", border: "1px solid var(--tf-border)", background: "white" }}
                  />
                  <figcaption style={{ color: "var(--tf-muted)", fontSize: "0.75rem", fontWeight: 600, marginTop: "0.375rem" }}>
                    {s.label}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginTop: "0.625rem" }}>
              You sign in the portal, by drawing your signature or typing your name, and it is applied to your forms before you download. Delivered as a print-ready PDF, ready to mail or fax to the IRS. No printing and scanning to sign.
            </p>
          </div>

          <Link to={CHECK_URL} style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Check My Eligibility
          </Link>
        </div>
      </section>

      {/* THE REASONABLE CAUSE LETTER, as an add-on to the filing above.
          Until 3 Aug 2026 this was a second SERVICE headed "Past Year Filing +
          CPA-Authored Reasonable Cause Letter", which duplicated the section
          above: a past year and a current year are the same $99 product with
          the same output, and saying so twice made one service look like two.
          What is genuinely different about a late filing is the letter, so the
          letter is what this section is now about. Do not turn it back into a
          filing service. */}
      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="s2-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
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
            }}
          >
            Recommended for Late Filers
          </span>
          <h2 id="s2-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>
            Add-on: CPA-Authored Reasonable Cause Letter
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            Filing a year late is the same filing as above, at the same ${PRICE_PER_YEAR}. What a late filing also needs is a reason. This letter asks the IRS to abate the automatic $25,000 penalty, and it is added to the filing rather than bought on its own. Voluntary catch-up works best before the IRS contacts you.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", lineHeight: 1.7, fontWeight: 400, marginBottom: "1rem" }}>
            To be precise about what CPA-Authored means: the letter is generated from a framework written by a practising U.S. CPA, populated with your filing details and the circumstances you select. It does not include an individual CPA review of your filing, and it is not tax advice.
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            <strong>${PRICE_PER_YEAR + PRICE_RCL} for one missed year</strong> (${PRICE_PER_YEAR} filing + one ${PRICE_RCL} reasonable cause letter). The letter is charged once however many years you file, so three missed years is ${3 * PRICE_PER_YEAR + PRICE_RCL}, not ${3 * (PRICE_PER_YEAR + PRICE_RCL)}.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <Link to={CHECK_URL} style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
              Fix a Missed Year
            </Link>
            <Link to="/past-filings" style={{ color: "#0284C7", fontWeight: 600, fontSize: "0.9375rem", textDecoration: "none", padding: "0.75rem 0.5rem" }}>
              Read full details &#8594;
            </Link>
          </div>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="s3-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="s3-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>LLC Tax Classification Change</h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            {/* Read from SERVICES rather than asserted here. Availability was
                wrong in both directions four times in two days while every page
                carried its own sentence about it. */}
            {!SERVICES.classification_change.available && <strong>Not yet available. </strong>}
            This prepares a standalone Form 8832, the entity classification election, for an LLC that wants to be taxed as a C-Corporation instead of the default disregarded entity. It is a standalone filing and must be mailed, and the IRS fax add-on will not cover it.
          </p>
          {/* The four-sentence Form 2553 explanation moved to the FAQ on
              3 Aug 2026. It answered a question nobody browsing a services page
              has asked, then spent a paragraph explaining why something we do
              not sell does not apply to them. Its one genuinely valuable fact,
              that an S corp cannot have a nonresident alien shareholder, is the
              clearest statement of who this product is for, and it belongs
              where someone who read "S corp election" on a forum will look. */}
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", lineHeight: 1.7, marginBottom: "1rem", fontWeight: 400 }}>
            We do not prepare Form 2553, the S-Corporation election.{" "}
            <Link to="/faq" style={{ color: "#0284C7", fontWeight: 600 }}>
              Why it is not open to you
            </Link>
            .
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem" }}>One-time filing. No ongoing fees.</p>
          <Link to={CLASSIFICATION_URL} style={{ background: "transparent", color: "#0284C7", border: "1px solid #0284C7", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Notify Me When This Launches
          </Link>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="s4-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="s4-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>IRS Fax Transmission</h2>
          {/* Cut from four paragraphs to two on 3 Aug 2026. It was explaining
              an add-on's fine print at more length than the $99 product that
              pays for the site. The receipt-is-not-acceptance paragraph stays,
              and should: it is the one point in this section the rest of the
              market blurs, and it protects a filer who would otherwise stop
              chasing a return the IRS never accepted. */}
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            For ${PRICE_FAX} we fax your completed package to the IRS, so you do not need a printer or a post office. You sign the forms in your browser, we transmit them, and a receipt recording the date, time and page count is stored against your filing. One fee covers the whole job however many years you are filing. It is an add-on to Form 5472 filings only, and not available for Form 8832, which must be mailed.
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            One point worth stating plainly, because the rest of this market blurs it: a transmission receipt is proof that the IRS received the fax. It is not proof that the IRS has accepted or processed your filing, and no preparer can give you that.
          </p>
          {/* Same label as the fax cards on Home and Pricing. Fax is an add-on
              to a 5472 filing and cannot be bought on its own, so this must not
              read like the start of its own checkout. Still links to /check. */}
          <Link to={CHECK_URL} style={{ background: "transparent", color: "#0284C7", border: "1px solid #0284C7", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Offered when you file
          </Link>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="s5-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="s5-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "0.5rem" }}>Coming Soon</h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, marginBottom: "1.25rem" }}>
            Join the waitlist to get notified when these services launch.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem" }}>
            {/*
              Derived from SERVICES, not written out. The hand-written version
              led with Form 7004, which generates, merges into the combined PDF
              and downloads separately, so this page was offering to notify a
              filer about something already inside the package they had paid
              for. That is item 51 in reverse and the same defect the portal
              dashboard had.

              Two entries were removed earlier because they are not real
              obligations for a foreign-owned LLC, and they stay out of the map
              for the same reason:
                - Annual report for Delaware: Delaware LLCs do not file one,
                  they pay a $300 annual franchise tax instead.
                - Annual report for New Mexico: no annual or biennial report
                  requirement exists.
            */}
            {waitlistServices().map(({ id, service }) => (
              <li key={id} style={{ padding: "0.625rem 0", borderBottom: "1px solid var(--tf-border)", color: "var(--tf-muted)", fontSize: "0.9375rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                <span style={{ display: "flex", gap: "0.75rem" }}>
                  <span style={{ color: "var(--tf-border)", fontWeight: 700, flexShrink: 0 }}>&#8250;</span>
                  {service.label}
                </span>
                <Link
                  to={`/waitlist?service=${id}`}
                  style={{ color: "#0284C7", fontSize: "0.8125rem", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  Notify me
                </Link>
              </li>
            ))}
          </ul>
          <Link
            to="/waitlist"
            style={{
              color: "#0284C7",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
              border: "1px solid #0284C7",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              display: "inline-block",
              minHeight: "44px",
              lineHeight: "1.8",
            }}
          >
            Join the Waitlist
          </Link>
        </div>
      </section>
    </>
  );
}
