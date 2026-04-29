import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

export function Services() {
  usePageMeta({
    title: "Services | FileTax.co",
    description:
      "Form 5472 + Pro Forma 1120 filing, CPA-prepared Reasonable Cause Letters, LLC tax classification changes, and IRS fax submission for foreign-owned U.S. LLCs.",
  });

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.625rem, 4vw, 2.375rem)", marginBottom: "0.75rem" }}>Services</h1>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6 }}>
            Built by a licensed CPA after seeing repeated $25,000 penalty cases among foreign founders. Forms generated based strictly on IRS instructions (Rev. December 2024).
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
                "Ready to mail or fax immediately",
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
              {["Form 5472 (first page)", "Pro Forma 1120 header", "Reasonable Cause Letter (sample)"].map((label) => (
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

          <Link to="/check" style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Check My Eligibility
          </Link>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="s2-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="s2-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>LLC Tax Classification Change</h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            If you need to change how the IRS classifies your LLC for tax purposes, this service covers both Form 8832 (entity classification election) and Form 2553 (S-Corporation election).
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            Form 8832 is used when you want to elect C-Corporation treatment instead of the default disregarded entity status. Form 2553 is used when you want S-Corporation status. Both are standalone filings and must be mailed. The IRS fax add-on is not available for these forms, which must be mailed.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem" }}>One-time filing. No ongoing fees.</p>
          <Link to="/portal" style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Start Filing
          </Link>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="s3-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="s3-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>IRS Fax Submission</h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            The IRS processes faxed filings significantly faster than mailed ones. By faxing your completed forms, you receive a digital confirmation receipt that serves as proof of timely submission. This is useful if you are filing close to a deadline or responding to a penalty notice.
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            This service is an add-on to Form 5472 filings only. It is not available for Form 8832 or Form 2553 filings, which must be mailed.
          </p>
          <Link to="/portal" style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}>
            Add to My Filing
          </Link>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="s4-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="s4-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>Coming Soon</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {[
              "Form 7004 (automatic 6-month extension)",
              "FBAR / FinCEN 114 reporting",
              "Annual report for Delaware",
              "Annual reports for Wyoming and New Mexico",
            ].map((item) => (
              <li key={item} style={{ padding: "0.625rem 0", borderBottom: "1px solid var(--tf-border)", color: "var(--tf-muted)", fontSize: "0.9375rem", display: "flex", gap: "0.75rem" }}>
                <span style={{ color: "var(--tf-border)", fontWeight: 700, flexShrink: 0 }}>&#8250;</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
