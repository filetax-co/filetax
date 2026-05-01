import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

// ---------------------------------------------------------------------
// TEMPORARY: Services are not yet live. All "start filing" CTAs route
// to /waitlist instead of their original destinations. To revert when
// services launch, change CHECK_URL and PORTAL_URL back to their
// originals (shown in comments below).
// ---------------------------------------------------------------------
const CHECK_URL = "/waitlist";  // original: "/check"
const PORTAL_URL = "/waitlist"; // original: "/portal"

export function Services() {
  usePageMeta({
    title: "Services | FileTax.co",
    description:
      "Form 5472 + Pro Forma 1120 filing, CPA-Authored Reasonable Cause Letters, LLC tax classification changes, and IRS fax transmission for foreign-owned U.S. LLCs.",
  });

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.75rem" }}>Services</h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6 }}>
            Built specifically for foreign-owned U.S. single-member LLCs. Forms generated strictly to IRS Instructions for Form 5472 (Rev. December 2024). Reasonable cause letters authored by a licensed CPA, structured to align with IRS standards.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="s1-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="s1-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>
            Form 5472 + Pro Forma 1120 Filing
          </h2>
          <div style={{ background: "var(--tf-bg)", border: "1px solid #0284C7", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: 600, color: "var(--tf-text)", fontSize: "0.9375rem" }}>
              One Filing. Two Forms. One Price. The IRS requires Form 5472 to be attached to a Pro Forma 1120. They cannot be filed separately.
            </p>
          </div>
          <h3 style={{ fontSize: "1.0625rem", marginBottom: "0.5rem" }}>Who needs to file?</h3>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.25rem" }}>
            Any single-member LLC that is owned 25% or more by a non-U.S. person must file Form 5472 annually, even if the LLC had no revenue during the year. LLC formation itself is typically a reportable transaction.
          </p>
          <h3 style={{ fontSize: "1.0625rem", marginBottom: "0.5rem" }}>What counts as a reportable transaction?</h3>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.25rem" }}>
            Reportable transactions include any monetary or non-monetary exchange between the foreign-owned LLC and a foreign related party: capital contributions, distributions, loans, payments for services, and the act of forming the LLC itself.
          </p>
          <h3 style={{ fontSize: "1.0625rem", marginBottom: "0.5rem" }}>The penalty stakes</h3>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            The IRS imposes an automatic $25,000 penalty per missed form, per tax year. There is no minimum revenue threshold. A company with two unfiled years faces $50,000 in potential exposure immediately.
          </p>

          <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "1.0625rem", marginBottom: "0.875rem" }}>What you receive</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {[
                "Print-ready Form 5472 and Pro Forma 1120",
                "Structured exactly as required by the IRS",
                "Ready to sign and send by mail or fax",
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
              Additional forms: <strong style={{ color: "var(--tf-text)" }}>+$75/form</strong> (forms 2 and 3). Volume discount for the 4th form onwards: <strong style={{ color: "var(--tf-text)" }}>+$50/form</strong>. The eligibility check will ask about this and calculate your total automatically.
            </p>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: 600, color: "var(--tf-muted)", fontSize: "0.875rem", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Sample Output Preview
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {["Form 5472 (first page)", "Pro Forma 1120 header", "CPA-Authored Reasonable Cause Letter (sample)"].map((label) => (
                <div key={label} style={{ background: "var(--tf-border)", borderRadius: "0.5rem", aspectRatio: "8.5/11", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)" }} />
                  <p style={{ color: "var(--tf-muted)", fontSize: "0.75rem", fontWeight: 600, textAlign: "center", padding: "0.5rem", position: "relative", zIndex: 1 }}>{label}</p>
                </div>
              ))}
            </div>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginTop: "0.625rem" }}>
              Delivered as a print-ready PDF. Download, sign where required, and mail or fax to the IRS.
            </p>
          </div>

          {/* original CTA: <Link to="/check">Check My Eligibility</Link> - revert when services go live */}
          <Link to={CHECK_URL} style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Join the Waitlist
          </Link>
        </div>
      </section>

      {/* Past Year Filing + CPA-Authored Reasonable Cause Letter (compact - full pitch lives at /past-filings) */}
      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="s2-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
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
            Past Year Filing + CPA-Authored Reasonable Cause Letter
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            For LLCs that missed one or more prior years. We prepare the past-year Form 5472 and Pro Forma 1120 and pair them with a CPA-Authored Reasonable Cause Letter requesting that the automatic $25,000 penalty be waived. Voluntary catch-up filings work best before the IRS contacts you.
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            <strong>$350 per year total</strong> ($150 filing + $200 reasonable cause letter). Multi-year package available for three or more unfiled years.
          </p>
          {/* original CTA: <Link to="/check">Fix a Missed Year</Link> - revert when services go live */}
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
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="s3-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>LLC Tax Classification Change</h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            If you need to change how the IRS classifies your LLC for tax purposes, this service covers both Form 8832 (entity classification election) and Form 2553 (S-Corporation election).
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            Form 8832 is used when you want to elect C-Corporation treatment instead of the default disregarded entity status. Form 2553 is used when you want S-Corporation status. Both are standalone filings and must be mailed. The IRS fax add-on is not available for these forms, which must be mailed.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem" }}>One-time filing. No ongoing fees.</p>
          {/* original CTA: <Link to="/portal">Start Filing</Link> - revert when services go live */}
          <Link to={PORTAL_URL} style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Join the Waitlist
          </Link>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="s4-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="s4-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>IRS Fax Transmission</h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            The IRS processes faxed filings significantly faster than mailed ones. You sign the completed forms. We transmit them by fax to the IRS on your behalf and provide you with a digital transmission receipt for your records. This is useful if you are filing close to a deadline or responding to a penalty notice.
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            This service is an add-on to Form 5472 filings only. It is not available for Form 8832 or Form 2553 filings, which must be mailed.
          </p>
          {/* original CTA: <Link to="/portal">Add to My Filing</Link> - revert when services go live */}
          <Link to={PORTAL_URL} style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Join the Waitlist
          </Link>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="s5-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="s5-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "0.5rem" }}>Coming Soon</h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, marginBottom: "1.25rem" }}>
            Join the waitlist to get notified when these services launch.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem" }}>
            {/*
              Removed two entries that don't represent real obligations for foreign-owned LLCs:
                - "Annual report for Delaware" (id: "delaware-annual"): Delaware LLCs do not file
                  annual reports; they pay a $300 annual franchise tax instead.
                - "Annual reports for Wyoming and New Mexico" (id: "wy-nm-annual"): split — only
                  Wyoming kept; New Mexico LLCs have no annual or biennial report requirement.
            */}
            {[
              { label: "Form 7004 (automatic 6-month extension)", id: "form-7004" },
              { label: "FBAR / FinCEN 114 reporting", id: "fbar" },
              { label: "Annual report for Wyoming", id: "wyoming-annual" },
            ].map((item) => (
              <li key={item.id} style={{ padding: "0.625rem 0", borderBottom: "1px solid var(--tf-border)", color: "var(--tf-muted)", fontSize: "0.9375rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                <span style={{ display: "flex", gap: "0.75rem" }}>
                  <span style={{ color: "var(--tf-border)", fontWeight: 700, flexShrink: 0 }}>&#8250;</span>
                  {item.label}
                </span>
                <Link
                  to={`/waitlist?service=${item.id}`}
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
