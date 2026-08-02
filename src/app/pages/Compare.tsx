import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { useJsonLd } from "../hooks/useJsonLd";
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
// COMPETITORS ARE NOT NAMED, deliberately. Only one competitor has ever been
// seen from the inside, so a named factual claim would rest on a single
// walkthrough and would need re-verifying every time they shipped. The
// "questions to ask" section below converts each finding into a test the
// reader can run themselves, which is both safer and more persuasive than an
// accusation they cannot check.
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
      "One letter can cover every late year in the same request, so being charged " +
      "per year for it is a pricing choice, not a requirement.",
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
      "Your forms are assembled in your browser. We never ask for a bank login, " +
      "and we never ask you to upload bank statements.",
    diy: "Stays with you",
    filetax: "Assembled in your browser, no bank login, no statements",
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

// Questions worth asking of ANY tool, including this one. Each is a real
// failure mode observed in this market, phrased as something the reader can
// check for themselves.
const QUESTIONS: { q: string; why: string }[] = [
  {
    q: "Does it use the correct form revision for each year I am filing?",
    why:
      "Ask to see a back year before you pay. A tool that renders every year on " +
      "the same revision will show you the same form twice.",
  },
  {
    q: "Can it file more than one year in a single job?",
    why:
      "Several tools sell one tax year per package while advertising catch-up " +
      "filing. Check whether three missed years means one purchase or three.",
  },
  {
    q: "Is the reasonable cause letter charged once, or once per year?",
    why:
      "One letter can cover every late year. Being charged per year for it can " +
      "quietly double the cost of a catch-up.",
  },
  {
    q: "Can I see the completed forms before I pay?",
    why: "If you cannot, you are buying an outcome you have not seen.",
  },
  {
    q: "What happens if I find a typo after paying?",
    why: "Ask before you buy, not after you notice.",
  },
  {
    q: "Do I have to hand over bank statements or a bank login?",
    why:
      "Convenient, but it is a lot of financial history to give a website. Ask " +
      "whether it is required or optional.",
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
      `Compare the three ways to file Form 5472 and the pro forma 1120: yourself, with FileTax at $${PRICE_PER_YEAR} per year, or with a CPA at $${CPA_LOW} to $${CPA_HIGH} per year. Includes the questions to ask before you pay for any of them.`,
    canonical: "https://filetax.co/compare",
  });

  useJsonLd("compare-faq", {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: QUESTIONS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.why },
    })),
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
            A comparison page that concludes you should always buy the product is not
            a comparison. Go to a CPA if any of these apply:
          </p>
          <ul style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, paddingLeft: "1.25rem", marginBottom: "1.25rem" }}>
            <li>Your LLC has more than one member, or is taxed as a corporation.</li>
            <li>You have income the IRS treats as U.S.-source, or staff or premises in the U.S. Your own return is then in question, and this flow does not prepare it.</li>
            <li>The IRS has already contacted you about a penalty. Voluntary catch-up is a different position from responding to a notice.</li>
            <li>You are not sure what your LLC actually did in a given year.</li>
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

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="questions-heading">
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <h2 id="questions-heading" style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "0.75rem" }}>
            What to ask before you pay for any Form 5472 tool
          </h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, marginBottom: "1.5rem" }}>
            Including this one. Every question below describes something that
            genuinely goes wrong in this market.
          </p>
          {QUESTIONS.map((item) => (
            <div key={item.q} style={{ paddingBottom: "1.125rem", marginBottom: "1.125rem", borderBottom: "1px solid var(--tf-border)" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.3rem", lineHeight: 1.4 }}>{item.q}</h3>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.6 }}>{item.why}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem 4rem" }}>
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
