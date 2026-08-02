import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { InfoTip } from "../components/InfoTip";
import {
  PRICE_PER_YEAR,
  PRICE_RCL,
  PRICE_ADDITIONAL_PARTY,
  computeTotal,
} from "../../lib/pricing";

// ---------------------------------------------------------------------
// Comparison page. Handoff item 32.
//
// THE ANCHOR IS A CPA, NOT THE $30 TIER. Competing on price against the
// commodity band is a race we lose and do not want to win: those products
// serve the simplest possible case. The buyer this page is written for has
// several missed years, or more than one related party, or a fiscal or final
// year, and their real alternative is a CPA quoting $400 to $900 per year.
// Against that anchor we are the cheap option, which is the correct frame.
//
// NO DOLLAR LITERALS. Every figure comes from pricing.ts. The $350 that sat
// wrong on /past-filings for weeks was a hardcoded literal, and two separate
// AI reviews then built recommendations on the wrong number.
//
// COMPETITORS ARE NOT DISCUSSED AT ALL. An earlier version carried a
// "questions to ask before you pay for any tool" section. It was removed on
// purpose: every question in it was a free product brief for a competitor,
// and one of them ("can I see the forms before I pay") described something we
// do not currently offer either. The page compares us to a CPA and to doing
// it yourself. That is the whole scope.
// ---------------------------------------------------------------------

// Typical CPA engagement for this filing, per year. Used as the anchor.
const CPA_LOW = 400;
const CPA_HIGH = 900;

// The worked example this page is built around: a filer catching up three
// missed years with one foreign related party.
const EXAMPLE_YEARS = 3;
const exampleTotal = computeTotal(EXAMPLE_YEARS, true);
const exampleCpaLow = CPA_LOW * EXAMPLE_YEARS;
const exampleCpaHigh = CPA_HIGH * EXAMPLE_YEARS;

interface Row {
  label: string;
  tip?: string;
  diy: string;
  filetax: string;
  cpa: string;
}

const ROWS: Row[] = [
  {
    label: "Cost for one tax year",
    diy: "Free, plus your time",
    filetax: `$${PRICE_PER_YEAR}`,
    cpa: `$${CPA_LOW} to $${CPA_HIGH}`,
  },
  {
    label: "Catching up several missed years",
    tip:
      "A reasonable cause statement is what asks the IRS to abate the penalty. " +
      "One letter can cover every late year in the same request, so we charge for " +
      "it once no matter how many years you are catching up.",
    diy: "You write the reasonable cause statement yourself",
    filetax: `$${PRICE_PER_YEAR} per year, plus one $${PRICE_RCL} letter covering every year`,
    cpa: "Usually billed per year, letter included",
  },
  {
    label: "More than one foreign related party",
    tip:
      "The IRS requires a separate Form 5472 for each foreign related party. Most " +
      "single-member LLCs have one, the owner. If yours transacted with a foreign " +
      "parent company or another entity you control, each one needs its own form.",
    diy: "One Form 5472 per party, prepared by you",
    filetax: `+$${PRICE_ADDITIONAL_PARTY} per additional party, per year`,
    cpa: "Included, at the hourly rate",
  },
  {
    label: "Fiscal-year and final returns",
    tip:
      "A final return is the one you file for the year the LLC was dissolved. " +
      "Closing the company does not remove the obligation, it adds one more filing.",
    diy: "Possible, but the period dates are easy to get wrong",
    filetax: "Supported",
    cpa: "Supported",
  },
  {
    label: "Correct IRS form revision for each year",
    tip:
      "Form 1120 has a separate revision for every tax year. A 2021 filing belongs " +
      "on the 2021 form. Filing a back year on the current year's form is a common " +
      "and avoidable error.",
    diy: "Your responsibility to find the right one",
    filetax: "Selected automatically by tax year",
    cpa: "Handled",
  },
  {
    label: "Where your data goes",
    tip:
      "We hold the details you enter so we can prepare and re-open your filing. " +
      "Your EIN and any foreign tax ID are encrypted. We never ask for a bank " +
      "login, and we never ask you to upload bank statements.",
    diy: "Stays with you",
    filetax: "Held by us, EIN and foreign tax ID encrypted, no bank login, no statements",
    cpa: "You send documents to your accountant",
  },
  {
    label: "Turnaround",
    diy: "However long it takes you",
    filetax: "About 10 minutes, same day",
    cpa: "Days to weeks, depending on their workload",
  },
  {
    label: "Judgement on a complicated position",
    tip:
      "This is the honest limit of a self-serve tool. If your situation turns on " +
      "facts a form cannot capture, you want a person, and we will tell you so.",
    diy: "None",
    filetax: "No. If your case is not a fit, we say so and refer you out",
    cpa: "Yes, this is what you are paying for",
  },
];

const cellStyle: React.CSSProperties = {
  padding: "0.875rem 1rem",
  fontSize: "0.875rem",
  lineHeight: 1.5,
  verticalAlign: "top",
  borderBottom: "1px solid var(--tf-border)",
};

export function Compare() {
  usePageMeta({
    title: "FileTax vs a CPA vs Doing It Yourself | Form 5472 | FileTax.co",
    description:
      `Compare the three ways to file Form 5472 and the pro forma 1120: yourself, with FileTax at $${PRICE_PER_YEAR} per year, or with a CPA at $${CPA_LOW} to $${CPA_HIGH} per year, including when a CPA is the right choice.`,
    canonical: "https://filetax.co/compare",
  });

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2.25rem)", marginBottom: "0.75rem", lineHeight: 1.2 }}>
            FileTax, a CPA, or doing it yourself
          </h1>
          <p style={{ color: "var(--tf-text)", fontSize: "1.0625rem", fontWeight: 500, lineHeight: 1.6, maxWidth: "700px", marginBottom: "0.75rem" }}>
            There are three ways to file Form 5472 and the pro forma 1120. This page
            is an honest account of when each one is the right choice, including
            when we are not.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, maxWidth: "700px" }}>
            Missing this filing carries a $25,000 penalty per form, per year, so the
            question is rarely whether to file. It is who should prepare it.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "0 1rem 2.5rem" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <div style={{ overflowX: "auto", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", background: "var(--tf-surface)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
              <caption className="sr-only">
                Comparison of doing it yourself, using FileTax, and hiring a CPA
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ ...cellStyle, textAlign: "left", fontWeight: 700, fontSize: "0.8125rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--tf-muted)" }}>
                    &nbsp;
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: "left", fontWeight: 700 }}>Doing it yourself</th>
                  <th scope="col" style={{ ...cellStyle, textAlign: "left", fontWeight: 700, color: "var(--tf-accent)" }}>FileTax</th>
                  <th scope="col" style={{ ...cellStyle, textAlign: "left", fontWeight: 700 }}>A CPA</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" style={{ ...cellStyle, textAlign: "left", fontWeight: 600, color: "var(--tf-text)" }}>
                      {row.label}
                      {row.tip && <InfoTip text={row.tip} label={`About ${row.label}`} />}
                    </th>
                    <td style={cellStyle}>{row.diy}</td>
                    <td style={{ ...cellStyle, fontWeight: 500, color: "var(--tf-text)" }}>{row.filetax}</td>
                    <td style={cellStyle}>{row.cpa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="example-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="example-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1rem" }}>
            A worked example: {EXAMPLE_YEARS} missed years
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            This is the most common situation we see. The LLC was formed a few years
            ago, nobody mentioned Form 5472, and the owner found out from a bank, an
            acquirer, or an accountant.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
            {[
              { k: "With FileTax", v: `$${exampleTotal}`, note: `${EXAMPLE_YEARS} years at $${PRICE_PER_YEAR}, plus one $${PRICE_RCL} reasonable cause letter covering all ${EXAMPLE_YEARS}` },
              { k: "With a CPA", v: `$${exampleCpaLow.toLocaleString()} to $${exampleCpaHigh.toLocaleString()}`, note: `at $${CPA_LOW} to $${CPA_HIGH} per year` },
              { k: "Yourself", v: "Free", note: "plus the reading, and the risk of getting the form revision or the period dates wrong" },
            ].map((item) => (
              <li key={item.k} style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--tf-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, color: "var(--tf-text)", fontSize: "0.9375rem" }}>{item.k}</span>
                  <span style={{ fontWeight: 700, color: "var(--tf-accent)", fontSize: "1.0625rem" }}>{item.v}</span>
                </div>
                <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginTop: "0.2rem" }}>{item.note}</p>
              </li>
            ))}
          </ul>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400 }}>
            CPA figures are a typical range for this filing, not a quote. Ask for one.
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="when-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="when-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "1.25rem" }}>
            When you should not use FileTax
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            We are not the right answer for every LLC. Go to a CPA if any of these
            apply to you:
          </p>
          <ul style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, paddingLeft: "1.25rem", marginBottom: "1.25rem" }}>
            <li>
              <strong style={{ fontWeight: 600 }}>Your LLC is not a single-member LLC.</strong>{" "}
              More than one member, or taxed as a corporation, means a different return.
            </li>
            <li>
              <strong style={{ fontWeight: 600 }}>You have a U.S. footprint.</strong>{" "}
              U.S.-source income, staff, or premises puts your own return in question, and
              this flow does not prepare it.
            </li>
            <li>
              <strong style={{ fontWeight: 600 }}>The IRS has already contacted you about a penalty.</strong>{" "}
              Responding to a notice is a different position from a voluntary catch-up.
            </li>
            <li>
              <strong style={{ fontWeight: 600 }}>You are not sure what your LLC actually did in a given year.</strong>{" "}
              The numbers have to come from somewhere before any form can be filled in.
            </li>
          </ul>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6 }}>
            Our eligibility check screens for most of this and will tell you to see a
            CPA rather than taking your money.{" "}
            <Link to="/check" style={{ color: "var(--tf-accent)", fontWeight: 600 }}>
              Run the check
            </Link>
            .
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem 4rem" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "0.75rem" }}>
            Find out where you stand
          </h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, marginBottom: "1.5rem" }}>
            The eligibility check takes about a minute, runs entirely in your browser,
            and tells you honestly whether we can help.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              to="/check"
              style={{
                background: "var(--tf-accent)", color: "white", fontWeight: 600, fontSize: "1rem",
                padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                border: "1px solid transparent", minHeight: "44px",
              }}
            >
              Check My Eligibility
            </Link>
            <Link
              to="/pricing"
              style={{
                background: "transparent", color: "var(--tf-text)", fontWeight: 600, fontSize: "1rem",
                padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                border: "1px solid oklch(from var(--tf-text, #0F172A) l c h / 0.2)", minHeight: "44px",
              }}
            >
              See Pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
