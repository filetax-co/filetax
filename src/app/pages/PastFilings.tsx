import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

export function PastFilings() {
  usePageMeta({
    title: "Missed Form 5472? Fix It Now | FileTax.co",
    description:
      "Late Form 5472 filing with a CPA-prepared Reasonable Cause Letter costs $350 per year. File past-year returns and request IRS penalty abatement before exposure compounds.",
  });

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2.25rem)", marginBottom: "1.25rem", lineHeight: 1.2 }}>
            Most foreign founders discover this requirement only after penalties have already started.
          </h1>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7 }}>
            Many foreign LLC owners discover the Form 5472 requirement years after forming their LLC, often when opening a U.S. bank account, applying for an L-1 or O-1 visa, or preparing to sell or exit the business. By then, the IRS penalty clock has already been running.
          </p>
        </div>
      </section>

      {/* Penalty Risk Scale */}
      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="penalty-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="penalty-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1.5rem" }}>Penalty Risk Scale</h2>
          <div style={{ marginBottom: "0.75rem" }}>
            <div className="penalty-scale" role="img" aria-label="Penalty scale from $25,000 to $150,000+" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.375rem" }}>
            {["$25,000", "$50,000", "$75,000", "$100,000", "$150,000+"].map((tick) => (
              <span key={tick} style={{ color: "var(--tf-muted)", fontSize: "0.75rem", fontWeight: 600 }}>{tick}</span>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.25rem" }}>
            <span style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400 }}>1 LLC, 1 year</span>
            <span style={{ color: "#B31D1D", fontSize: "0.8125rem", fontWeight: 600 }}>2 LLCs, 3 years</span>
          </div>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400 }}>
            Two LLCs, three unfiled years = $150,000 in potential penalties. Our $350 total solution covers one year completely.
          </p>
        </div>
      </section>

      {/* Reasonable Cause Letter */}
      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="rcl-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="rcl-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>
            What is a Reasonable Cause Letter?
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            A reasonable cause letter is a written argument submitted to the IRS alongside a late filing, requesting that the automatic $25,000 penalty be waived. The IRS may grant relief if the failure to file was due to reasonable cause and not willful neglect.
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            The most common argument for foreign founders is that they were not aware of the filing requirement. This is a credible position, given that the requirement is rarely disclosed by LLC formation services. However, the argument must be presented correctly and supported with facts.
          </p>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7 }}>
            A CPA-prepared letter carries significantly more weight than a self-written one. Our letters are drafted by a licensed CPA and tailored to your specific situation, covering the facts, the applicable IRS standards, and the request for abatement.
          </p>
        </div>
      </section>

      {/* Pricing block */}
      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="pricing-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="pricing-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1.5rem" }}>What it costs</h2>
          <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "1.75rem", marginBottom: "1.5rem", boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.625rem 0", borderBottom: "1px solid var(--tf-border)" }}>
              <span style={{ fontWeight: 500, color: "var(--tf-text)", fontSize: "0.9375rem" }}>Past Year Form 5472 + Pro Forma 1120</span>
              <span style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1rem" }}>$150</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.625rem 0", borderBottom: "1px solid var(--tf-border)" }}>
              <span style={{ fontWeight: 500, color: "var(--tf-text)", fontSize: "0.9375rem" }}>CPA-Prepared Reasonable Cause Letter</span>
              <span style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1rem" }}>+$200</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0 0" }}>
              <span style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1.0625rem" }}>Total per year</span>
              <span style={{ fontWeight: 700, color: "#0284C7", fontSize: "1.375rem" }}>$350</span>
            </div>
          </div>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.5rem" }}>One-time cost. No subscription.</p>

          <div style={{ background: "#B31D1D", color: "white", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "2rem" }}>
            <p style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
              The longer you wait, the harder it gets to argue reasonable cause. File now.
            </p>
          </div>

          <Link
            to="/check"
            style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}
          >
            Fix a Missed Year
          </Link>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginTop: "0.625rem" }}>
            Start without an account. Takes about 10 minutes.
          </p>
        </div>
      </section>
    </>
  );
}