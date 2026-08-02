import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { PenaltyCalculator } from "../components/PenaltyCalculator";
import { PRICE_PER_YEAR, PRICE_RCL } from "../../lib/pricing";

const FIX_MISSED_YEAR_URL = "/check";

export function PastFilings() {
  usePageMeta({
    title: "Missed Form 5472? Fix It Now | FileTax.co",
    description:
      `Late Form 5472 filing costs $${PRICE_PER_YEAR} per year plus one $${PRICE_RCL} CPA-authored Reasonable Cause Letter covering every year. File past-year returns and request IRS penalty abatement before the IRS notices.`,
    canonical: "https://filetax.co/past-filings",
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

      {/* Penalty calculator. Was a static scale showing one hardcoded example
          (2 LLCs, 3 years, $150,000), which left every other filer doing the
          arithmetic themselves and, because it assumed a single related party,
          understated the common case. The gradient bar is deliberately kept:
          it was the piece of this page people responded to, so the calculator
          is built around it rather than replacing it with a form. */}
      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="penalty-heading">
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h2 id="penalty-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "0.5rem" }}>
            What this is costing you
          </h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, marginBottom: "1.75rem" }}>
            The IRS penalty is $25,000 per form, per tax year, and it is automatic.
            Set your situation to see the exposure and what clearing it costs.
          </p>
          <PenaltyCalculator />
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
            The letter is generated from a framework written by a practising U.S. CPA. You select the situation that best describes your case from a structured set of categories aligned with IRS reasonable cause standards, and the system populates the letter with your filing details. The output covers the facts of your filing, the applicable IRS standards, and the request for abatement, in the format the IRS expects. It does not include an individual CPA review of your filing.
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
              <span style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1rem" }}>${PRICE_PER_YEAR} per year</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.625rem 0", borderBottom: "1px solid var(--tf-border)" }}>
              <span style={{ fontWeight: 500, color: "var(--tf-text)", fontSize: "0.9375rem" }}>CPA-Authored Reasonable Cause Letter <span style={{ color: "var(--tf-muted)", fontWeight: 400 }}>(one letter, covers every year)</span></span>
              <span style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1rem" }}>+${PRICE_RCL} once</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0 0" }}>
              <span style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1.0625rem" }}>One missed year, total</span>
              <span style={{ fontWeight: 700, color: "#0284C7", fontSize: "1.375rem" }}>${PRICE_PER_YEAR + PRICE_RCL}</span>
            </div>
          </div>
          <div style={{ background: "var(--tf-bg)", border: "2px solid #0284C7", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: 700, color: "var(--tf-text)", fontSize: "1.0625rem", marginBottom: "0.375rem" }}>
              Missed three years? ${3 * PRICE_PER_YEAR + PRICE_RCL} total, not ${3 * (PRICE_PER_YEAR + PRICE_RCL)}.
            </p>
            <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.6 }}>
              ${PRICE_PER_YEAR} per year covers the filings. The reasonable cause letter is ${PRICE_RCL} once, however many years you are catching up on. You never pay for it twice.
            </p>
          </div>

          <div style={{ background: "#B31D1D", color: "white", borderRadius: "0.75rem", padding: "1.25rem 1.5rem", marginBottom: "2rem" }}>
            <p style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
              The longer you wait, the harder it gets to argue reasonable cause. File now.
            </p>
          </div>

          <Link
            to={FIX_MISSED_YEAR_URL}
            style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none", display: "inline-block", minHeight: "44px" }}
          >
            Fix a Missed Year
          </Link>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginTop: "0.625rem" }}>
            Start with the eligibility check. About 2 minutes, and you do not need an account to begin.
          </p>
        </div>
      </section>
    </>
  );
}
