import { useState } from "react";
import { Link } from "react-router";
import { PRICE_PER_YEAR, PRICE_RCL, PRICE_ADDITIONAL_PARTY, computeTotal } from "../../lib/pricing";

// ---------------------------------------------------------------------
// PENALTY CALCULATOR. Replaces the static "Penalty Risk Scale" on
// /past-filings, which showed one hardcoded worked example (2 LLCs, 3 years,
// $150,000) and left every other filer doing the arithmetic themselves.
//
// The gradient bar is kept deliberately. It was the one piece of this page
// people responded to, so the calculator is built AROUND it rather than
// replacing it with a form: same bar, same ticks, now with a marker that
// moves. The numbers below it change; the thing you look at does not.
//
// THE MATH, and it is worth stating because the per-form detail is what
// people get wrong:
//
//   penalty = $25,000 x LLCs x years x forms per LLC per year
//
// The IRS penalty is per FORM, per YEAR, not per LLC per year. One Form 5472
// is required for each foreign related party, so a filer with two related
// parties is exposed to twice what they expect. The old static example
// assumed exactly one party and so understated the common case.
//
// Cost comes from computeTotal so it cannot drift from pricing.ts. One
// reasonable cause letter covers every year of ONE LLC's catch-up, so the
// letter is charged per LLC, not per year and not once overall: two LLCs are
// two separate jobs and two separate letters.
//
// NO DOLLAR LITERALS except the IRS penalty itself, which is statutory and
// not ours to change.
// ---------------------------------------------------------------------

/** IRS penalty under IRC 6038A, per Form 5472, per tax year. */
const PENALTY_PER_FORM_PER_YEAR = 25_000;

// The tick labels under the bar are EVENLY SPACED but their values are NOT
// evenly spaced: the last gap is $50,000 while the others are $25,000. So the
// bar is a piecewise scale, not a linear one, and the marker has to be placed
// against the same stops the reader is looking at.
//
// Positioning the marker linearly against $150,000 put $25,000 at 16.7% of the
// bar, which sits between the $25,000 and $50,000 labels and reads as roughly
// $37,500. Anything that moves along this bar must go through scalePct.
const STOPS = [25_000, 50_000, 75_000, 100_000, 150_000];

/**
 * Place something at fraction `f` (0 to 1) along the full-width track.
 *
 * The transform percentage is relative to the element's OWN width, so the
 * element shifts from flush-left at f=0, through centred at f=0.5, to
 * flush-right at f=1. That does three things at once: the bar can run the
 * entire width, the first and last labels line up with its ends instead of
 * being inset, and the marker never hangs off either end.
 *
 * Marker and labels both use this, which is the point. They previously used
 * different maths and disagreed: the labels were a `space-between` flex, whose
 * centres sit inward of the stops they name, so the marker sat at a true 50%
 * for $75,000 and read as visibly left of the "$75,000" label.
 */
const trackLeft = (f: number) => `${f * 100}%`;
const trackShift = (f: number) => `-${f * 100}%`;

/** Position on the bar, 0 to 100, matching where the tick labels actually sit. */
function scalePct(value: number): number {
  if (value <= STOPS[0]) return 0;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (value <= STOPS[i + 1]) {
      const within = (value - STOPS[i]) / (STOPS[i + 1] - STOPS[i]);
      return ((i + within) / (STOPS.length - 1)) * 100;
    }
  }
  return 100;
}

/**
 * Earliest tax year the product supports. The years stepper is capped at the
 * number of filable years from here to the last completed tax year, because
 * that cap is REAL: we cannot prepare a 2018 return, so offering to count one
 * would price a filing we would then refuse.
 */
const EARLIEST_TAX_YEAR = 2019;
const MAX_YEARS = Math.max(1, new Date().getFullYear() - 1 - EARLIEST_TAX_YEAR + 1);

interface Field {
  key: "llcs" | "years" | "parties";
  label: string;
  hint: string;
  min: number;
  /** Omit where no real limit exists. Only cap what the product actually caps. */
  max?: number;
}

// LLCs and related parties are DELIBERATELY UNCAPPED. They were capped at 5
// and 4 on 3 Aug 2026 for tidiness, which was wrong twice: it invented a limit
// the product does not have, and it showed a filer with six LLCs a "5+" that
// silently understated their own exposure on a page whose entire job is to
// state that exposure honestly. Only cap a number the product genuinely caps.
const FIELDS: Field[] = [
  {
    key: "llcs",
    label: "Foreign-owned LLCs",
    hint: "Each one files separately.",
    min: 1,
  },
  {
    key: "years",
    label: "Unfiled years",
    hint: `We support back to ${EARLIEST_TAX_YEAR}.`,
    min: 1,
    max: MAX_YEARS,
  },
  {
    key: "parties",
    label: "Related parties with transactions",
    hint: "Usually just you, the owner.",
    min: 1,
  },
];

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export function PenaltyCalculator() {
  // All three default to 1: the calculator opens on the smallest true case and
  // the filer adds to it. Starting at 3 years pre-loaded a $75,000 headline
  // nobody had told us was theirs, which is the kind of number that reads as a
  // scare tactic rather than an estimate.
  const [llcs, setLlcs] = useState(1);
  const [years, setYears] = useState(1);
  const [parties, setParties] = useState(1);

  const values = { llcs, years, parties };
  const setters = { llcs: setLlcs, years: setYears, parties: setParties };

  const formsPerYear = parties;
  const totalForms = llcs * years * formsPerYear;
  const penalty = totalForms * PENALTY_PER_FORM_PER_YEAR;

  // One job per LLC, so one reasonable cause letter per LLC.
  const cost = llcs * computeTotal(years, true, parties);

  const pct = scalePct(penalty);

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        {FIELDS.map((field) => {
          const value = values[field.key];
          const setValue = setters[field.key];
          const atMax = field.max !== undefined && value >= field.max;
          return (
            <div key={field.key}>
              <label
                htmlFor={`calc-${field.key}`}
                style={{ display: "block", fontWeight: 600, fontSize: "0.875rem", color: "var(--tf-text)", marginBottom: "0.4rem" }}
              >
                {field.label}
              </label>
              {/* Steppers rather than a free text field. The realistic range is
                  tiny, and a number input invites "0" and "1000", both of which
                  produce a nonsense headline figure on a page about a $25,000
                  penalty.
                  A card-style redesign of this stepper was tried on 3 Aug 2026
                  and rejected by the owner as worse. Keep it plain. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid var(--tf-border)",
                  borderRadius: "0.5rem",
                  background: "var(--tf-bg)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  // Functional updates, not setValue(value - 1). The plain
                  // form closes over the value from its own render, so several
                  // clicks landing in one tick all compute from the same
                  // snapshot and only the last one counts.
                  onClick={() => setValue((v) => Math.max(field.min, v - 1))}
                  disabled={value <= field.min}
                  aria-label={`Decrease ${field.label}`}
                  style={{
                    width: "44px", minHeight: "44px", border: "none", background: "none",
                    color: value <= field.min ? "var(--tf-border)" : "var(--tf-accent)",
                    fontSize: "1.25rem", fontWeight: 700,
                    cursor: value <= field.min ? "not-allowed" : "pointer",
                  }}
                >
                  &#8722;
                </button>
                <output
                  id={`calc-${field.key}`}
                  style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: "1.0625rem", color: "var(--tf-text)", fontVariantNumeric: "tabular-nums" }}
                >
                  {value}
                </output>
                <button
                  type="button"
                  onClick={() => setValue((v) => (field.max ? Math.min(field.max, v + 1) : v + 1))}
                  disabled={atMax}
                  aria-label={`Increase ${field.label}`}
                  style={{
                    width: "44px", minHeight: "44px", border: "none", background: "none",
                    color: atMax ? "var(--tf-border)" : "var(--tf-accent)",
                    fontSize: "1.25rem", fontWeight: 700,
                    cursor: atMax ? "not-allowed" : "pointer",
                  }}
                >
                  +
                </button>
              </div>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.75rem", fontWeight: 400, marginTop: "0.35rem" }}>
                {field.hint}
              </p>
            </div>
          );
        })}
      </div>

      {/* THE MARKER AND THE TICK LABELS SHARE ONE COORDINATE SPACE, and they
          have to. The labels were previously a `space-between` flex, which
          puts the FIRST label's left edge at 0 and the LAST label's right edge
          at 100%, so their centres land inward of the stops they name. The
          marker sat at a true 50% for $75,000 and read as visibly left of the
          "$75,000" label.
          Both are now absolutely positioned with the same expression against
          the same track, so they cannot disagree again. The transform is a
          percentage of each element's OWN width, which is what lets the bar run
          full width while the first and last labels sit flush to its ends. */}
      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ position: "relative" }}>
          <div
            className="penalty-scale"
            role="img"
            aria-label={`Penalty exposure ${money(penalty)} on a scale from ${money(STOPS[0])} to ${money(STOPS[STOPS.length - 1])} or more`}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "50%",
              left: trackLeft(pct / 100),
              transform: `translate(${trackShift(pct / 100)}, -50%)`,
              width: "22px",
              height: "22px",
              borderRadius: "9999px",
              background: "var(--tf-bg)",
              border: "3px solid var(--tf-text)",
              boxShadow: "0 1px 4px oklch(0.2 0.01 80 / 0.25)",
              transition: "left 0.25s ease, transform 0.25s ease",
            }}
          />
        </div>

        <div style={{ position: "relative", height: "1rem", marginTop: "0.5rem" }}>
          {STOPS.map((stop, i) => {
            const f = i / (STOPS.length - 1);
            return (
              <span
                key={stop}
                style={{
                  position: "absolute",
                  left: trackLeft(f),
                  transform: `translateX(${trackShift(f)})`,
                  whiteSpace: "nowrap",
                  color: "var(--tf-muted)",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {money(stop)}
                {i === STOPS.length - 1 ? "+" : ""}
              </span>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          marginBottom: "1.25rem",
        }}
      >
        <div
          style={{
            border: "1px solid var(--tf-border)",
            borderLeft: "3px solid #B31D1D",
            borderRadius: "0.625rem",
            background: "var(--tf-bg)",
            padding: "1.125rem 1.25rem",
          }}
        >
          <p style={{ color: "var(--tf-muted)", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.3rem" }}>
            If you do nothing
          </p>
          <p style={{ color: "#B31D1D", fontWeight: 700, fontSize: "clamp(1.5rem, 4vw, 2rem)", lineHeight: 1.1, marginBottom: "0.3rem" }}>
            {money(penalty)}
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.5 }}>
            {totalForms} missed {totalForms === 1 ? "form" : "forms"} at {money(PENALTY_PER_FORM_PER_YEAR)} each. The penalty is per form, per year, and it is automatic.
          </p>
        </div>

        <div
          style={{
            border: "1px solid var(--tf-border)",
            borderLeft: "3px solid var(--tf-accent)",
            borderRadius: "0.625rem",
            background: "var(--tf-bg)",
            padding: "1.125rem 1.25rem",
          }}
        >
          <p style={{ color: "var(--tf-muted)", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.3rem" }}>
            To catch up with FileTax
          </p>
          <p style={{ color: "var(--tf-accent)", fontWeight: 700, fontSize: "clamp(1.5rem, 4vw, 2rem)", lineHeight: 1.1, marginBottom: "0.3rem" }}>
            {money(cost)}
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.5 }}>
            {llcs * years} {llcs * years === 1 ? "filing" : "filings"} at ${PRICE_PER_YEAR}
            {parties > 1 && `, plus ${money(PRICE_ADDITIONAL_PARTY)} per extra party per year`}
            , plus {llcs === 1 ? "one" : llcs} reasonable cause {llcs === 1 ? "letter" : "letters"} at ${PRICE_RCL}
            {llcs === 1 ? " covering every year" : ", one per LLC"}.
          </p>
        </div>
      </div>

      {/* Stated as the two figures rather than a ratio. "151 times less" is
          both awkward English and reads as a sales claim; the bare comparison
          is more striking and cannot be argued with. */}
      <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.25rem" }}>
        <strong style={{ fontWeight: 700 }}>{money(cost)} to clear {money(penalty)} of exposure.</strong>{" "}
        The reasonable cause letter asks the IRS to waive the penalty entirely, and filing
        voluntarily is a far stronger position than replying to a notice.
      </p>

      <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.6 }}>
        An estimate of statutory exposure, not a prediction. The IRS assesses the penalty
        automatically, and abatement is at its discretion. Nobody can promise it will be granted.
      </p>

      <div style={{ marginTop: "1.5rem" }}>
        <Link
          to="/check"
          style={{
            background: "var(--tf-accent)", color: "white", fontWeight: 600, fontSize: "1rem",
            padding: "0.75rem 1.75rem", borderRadius: "0.5rem", textDecoration: "none",
            display: "inline-block", minHeight: "44px", lineHeight: "1.6",
          }}
        >
          Check My Eligibility
        </Link>
      </div>
    </div>
  );
}
