import { useState, useEffect } from "react";
import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";

// ---------------------------------------------------------------------
// TEMPORARY: Services are not yet live. The "Create Your Free Account"
// CTA at the end of the eligibility flow routes to /waitlist instead
// of the portal. To revert when services launch, change PORTAL_PATH
// back to "/portal".
// ---------------------------------------------------------------------
const PORTAL_PATH = "/waitlist"; // original: "/portal"
const TAXCLAIM_URL = "https://taxclaim.co/filetax"; // original: "https://taxclaim.co"

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type Outcome = "pass" | "refer" | null;
type YesNo = "yes" | "no";

interface SubAnswers {
  llcEIN?: YesNo;
  llcResidency?: YesNo;
  llcTaxTreatment?: YesNo;
  usIncome?: YesNo;
  usPresence?: YesNo;
}

interface Answers {
  entityType?: string;
  filingYears?: string;
  includeRCL?: boolean;
  complexTransactions: string[];
  relatedPartyCount?: number;
}

const totalSteps = 6;

const PORTAL_SECTION_NAMES: Record<string, string> = {
  "import-goods": "Related-Party Import Transactions",
  "formal-loans": "Intercompany Loan Reporting",
  "property-transfer": "Non-Cash Asset Transfers",
  "royalties-ip": "IP Licensing and Royalties",
  "owns-entity": "Subsidiary Ownership Disclosure",
  "digital-assets": "Digital Asset Transactions",
  "dissolution": "Ownership Change and Dissolution",
};

const HIGH_COMPLEXITY = new Set(["owns-entity", "dissolution"]);

const TRANSACTION_OPTIONS: { value: string; label: string; hint?: string }[] = [
  {
    value: "import-goods",
    label: "Goods purchased from a foreign company in which you or a related party hold an ownership stake",
  },
  {
    value: "formal-loans",
    label: "A loan between the LLC and the foreign owner or a related party, with a set interest rate and repayment terms",
    hint: "Adding cash to the LLC or withdrawing profit does not count as a loan. A loan requires an agreed repayment date and an interest rate.",
  },
  {
    value: "property-transfer",
    label: "Assets other than cash moved into or out of the LLC, such as equipment, real estate, or a patent",
    hint: "Putting only cash into the LLC, or contributing your personal time and services, does not count.",
  },
  {
    value: "royalties-ip",
    label: "Payments for the right to use intellectual property, or interest on a loan, sent to a person or company outside the U.S.",
    hint: "Paying for software subscriptions the LLC uses, or paying a contractor for their work, is not the same as licensing intellectual property.",
  },
  {
    value: "owns-entity",
    label: "The LLC holds at least a 20% ownership interest in another business, partnership, or trust",
  },
  {
    value: "digital-assets",
    label: "Receipts or payments during the year involving cryptocurrency, NFTs, or other digital tokens",
    hint: "Holding crypto in a wallet with no transactions during the year does not need to be reported here.",
  },
  {
    value: "dissolution",
    label: "A change in who owns the LLC, or steps taken to close, sell, or wind down the LLC at any point during the year",
  },
  { value: "none", label: "None of the above" },
];

const INITIAL_ANSWERS: Answers = { complexTransactions: [] };
const INITIAL_SUB: SubAnswers = {};

// ── Pricing helpers ───────────────────────────────────────────────

/**
 * Returns the cost of additional Form 5472s beyond the first.
 * Forms 2–3: $75 each.  Form 4+: $50 each (volume discount).
 */
function calcAdditionalFormsCost(totalForms: number): number {
  if (totalForms <= 1) return 0;
  let cost = 0;
  for (let i = 2; i <= totalForms; i++) {
    cost += i <= 3 ? 75 : 50;
  }
  return cost;
}

/** Human-readable breakdown string for the party-count selector */
function additionalFormsBreakdown(totalForms: number): string {
  const additional = totalForms - 1;
  const cost = calcAdditionalFormsCost(totalForms);
  if (totalForms <= 3) {
    return `${additional} additional Form 5472${additional > 1 ? "s" : ""} at $75 each = +$${cost}.`;
  }
  const atSeventy = 2; // forms 2–3
  const atFifty   = totalForms - 3; // forms 4+
  return `${additional} additional forms: ${atSeventy} x $75 + ${atFifty} x $50 = +$${cost}. Volume discount applied.`;
}

// ── Helpers ──────────────────────────────────────────────────────

function buildPortalPath(answers: Answers): string {
  const params = new URLSearchParams();
  if (answers.filingYears && answers.filingYears !== "current") {
    params.set("years", answers.filingYears);
  }
  const active = answers.complexTransactions.filter((v) => v !== "none");
  if (active.length > 0) params.set("sections", active.join(","));
  const parties = answers.relatedPartyCount ?? 1;
  if (parties > 1) params.set("parties", String(parties));
  if (answers.includeRCL) params.set("rcl", "true");
  const q = params.toString();
  return PORTAL_PATH + (q ? "?" + q : "");
}

function yearCountFor(filingYears?: string): number | null {
  return filingYears === "1-prior" ? 1 : filingYears === "2-prior" ? 2 : null;
}

// ── Sub-components ───────────────────────────────────────────────

function ProgressBar({ current }: { current: number }) {
  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.5rem" }}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: "4px",
              borderRadius: "9999px",
              background: i < current ? "#0284C7" : "var(--tf-border)",
            }}
          />
        ))}
      </div>
      <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400 }}>
        Step {current} of {totalSteps}
      </p>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <p style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--tf-muted)", marginBottom: "1rem" }}>
      {text}
    </p>
  );
}

function OptionButton({ label, sublabel, onClick }: { label: string; sublabel?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", padding: "0.875rem 1.125rem", borderRadius: "0.5rem", border: "1px solid var(--tf-border)", background: "var(--tf-surface)", color: "var(--tf-text)", fontWeight: 500, fontSize: "0.9375rem", cursor: "pointer", minHeight: "44px", lineHeight: 1.4 }}
    >
      {label}
      {sublabel && <span style={{ display: "block", color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginTop: "0.2rem" }}>{sublabel}</span>}
    </button>
  );
}

function YesNoButtons({ selected, onYes, onNo }: { selected?: YesNo; onYes: () => void; onNo: () => void }) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
      {(["yes", "no"] as const).map((val) => {
        const isYes = val === "yes";
        const active = selected === val;
        return (
          <button
            key={val}
            onClick={isYes ? onYes : onNo}
            style={{
              padding: "0.625rem 2rem",
              borderRadius: "0.5rem",
              border: active ? `1.5px solid ${isYes ? "#0284C7" : "#B31D1D"}` : "1px solid var(--tf-border)",
              background: active ? (isYes ? "#0284C7" : "rgba(179,29,29,0.06)") : "var(--tf-surface)",
              color: active ? (isYes ? "white" : "#B31D1D") : "var(--tf-text)",
              fontWeight: 600, fontSize: "0.9375rem", cursor: "pointer", minHeight: "44px",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
            }}
          >
            {isYes ? "Yes" : "No"}
          </button>
        );
      })}
    </div>
  );
}

function HintBox({ text }: { text: string }) {
  return (
    <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.5rem", padding: "0.875rem 1rem", marginTop: "0.75rem", fontSize: "0.875rem", color: "var(--tf-muted)", fontWeight: 400, lineHeight: 1.65 }}>
      {text}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid var(--tf-border)", margin: "1.5rem 0" }} />;
}

function CheckOption({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", padding: "0.875rem 1.125rem", borderRadius: "0.5rem", border: `1px solid ${checked ? "#0284C7" : "var(--tf-border)"}`, background: checked ? "rgba(2,132,199,0.06)" : "var(--tf-surface)", cursor: "pointer", minHeight: "44px", lineHeight: 1.4, transition: "background 0.15s, border-color 0.15s" }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ marginTop: "3px", accentColor: "#0284C7", width: "16px", height: "16px", flexShrink: 0 }} />
      <div>
        <span style={{ fontWeight: 500, fontSize: "0.9375rem", color: "var(--tf-text)" }}>{label}</span>
        {hint && <span style={{ display: "block", color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, marginTop: "0.25rem", lineHeight: 1.5 }}>{hint}</span>}
      </div>
    </label>
  );
}

function PriceRow({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: total ? "0.9375rem" : "0.875rem", fontWeight: total ? 700 : 400, color: total ? "var(--tf-text)" : "var(--tf-muted)", paddingTop: total ? "0.5rem" : "0", marginTop: total ? "0.375rem" : "0", borderTop: total ? "1px solid var(--tf-border)" : "none" }}>
      <span>{label}</span>
      <span style={{ fontWeight: total ? 700 : 500, color: total ? "var(--tf-text)" : "var(--tf-text)" }}>{value}</span>
    </div>
  );
}

function StepNav({ onBack, onReset, showContinue, onContinue, continueDisabled, continueLabel }: { onBack?: () => void; onReset: () => void; showContinue?: boolean; onContinue?: () => void; continueDisabled?: boolean; continueLabel?: string }) {
  return (
    <div style={{ marginTop: "1.5rem" }}>
      {showContinue && onContinue && (
        <button onClick={onContinue} disabled={continueDisabled} style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "0.9375rem", padding: "0.75rem 1.5rem", borderRadius: "0.5rem", border: "none", cursor: continueDisabled ? "not-allowed" : "pointer", opacity: continueDisabled ? 0.5 : 1, minHeight: "44px", marginBottom: "0.75rem", display: "block", width: "100%" }}>
          {continueLabel ?? "Continue"}
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
        {onBack && (
          <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, padding: 0 }}>
            &#8592; Back
          </button>
        )}
        <button onClick={onReset} style={{ background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.8125rem", fontWeight: 400, padding: 0, textDecoration: "underline", textUnderlineOffset: "2px" }}>
          Start over
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export function EligibilityCheck() {
  usePageMeta({
    title: "Check Your Eligibility | FileTax.co",
    description:
      "Answer a few questions to confirm your Form 5472 filing is a good fit for FileTax.co. Takes about 2 minutes. Your answers are never stored.",
  });

  const [step, setStep] = useState<Step>(1);
  const [subAnswers, setSubAnswers] = useState<SubAnswers>(INITIAL_SUB);
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [referReason, setReferReason] = useState("");
  const [showMultiYearNote, setShowMultiYearNote] = useState(false);
  const [showPriorYearNote, setShowPriorYearNote] = useState(false);
  const [showRelatedPartyNote, setShowRelatedPartyNote] = useState(false);
  const [showPartyCount, setShowPartyCount] = useState(false);
  const [selectedPartyCount, setSelectedPartyCount] = useState<number | null>(null);

  // Scroll to top whenever the step or outcome changes
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [step, outcome]);

  const setSub = (key: keyof SubAnswers, val: YesNo) =>
    setSubAnswers((s) => ({ ...s, [key]: val }));

  const triggerRefer = (reason: string) => {
    setReferReason(reason);
    setOutcome("refer");
  };

  const pass = () => setOutcome("pass");

  const hasPriorYears = answers.filingYears && answers.filingYears !== "current";
  const yearCount = yearCountFor(answers.filingYears);

  const resetAll = () => {
    setStep(1);
    setSubAnswers(INITIAL_SUB);
    setAnswers(INITIAL_ANSWERS);
    setOutcome(null);
    setReferReason("");
    setShowMultiYearNote(false);
    setShowPriorYearNote(false);
    setShowRelatedPartyNote(false);
    setShowPartyCount(false);
    setSelectedPartyCount(null);
  };

  const toggleComplex = (value: string) => {
    setAnswers((prev) => {
      const arr = prev.complexTransactions;
      if (value === "none") {
        return { ...prev, complexTransactions: arr.includes("none") ? [] : ["none"] };
      }
      const filtered = arr.filter((v) => v !== "none");
      return {
        ...prev,
        complexTransactions: filtered.includes(value)
          ? filtered.filter((v) => v !== value)
          : [...filtered, value],
      };
    });
  };

  const activeSections = answers.complexTransactions.filter((v) => v !== "none");
  const hasHighComplexity = activeSections.some((v) => HIGH_COMPLEXITY.has(v));
  const additionalParties = (answers.relatedPartyCount ?? 1) - 1;

  // ── Pass screen ──────────────────────────────────────────────

  if (outcome === "pass") {
    const basePerYear = 150;
    const rclPerYear = 200;
    const numYears = yearCount ?? 1;
    const totalForms = answers.relatedPartyCount ?? 1;
    const additionalFormsCostPerYear = calcAdditionalFormsCost(totalForms);
    const additionalFormsTotal = numYears * additionalFormsCostPerYear;
    const baseTotal = numYears * basePerYear;
    const rclTotal = answers.includeRCL ? numYears * rclPerYear : 0;
    const grandTotal = answers.filingYears !== "3-plus"
      ? baseTotal + additionalFormsTotal + rclTotal
      : null;
    const portalPath = buildPortalPath(answers);

    return (
      <section style={{ background: "var(--tf-bg)", minHeight: "80vh", padding: "3rem 1rem" }}>
        <div style={{ maxWidth: "580px", margin: "0 auto" }}>
          <div style={{ background: "var(--tf-surface)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "2rem", boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)" }}>
            <span style={{ display: "inline-block", background: "#059669", color: "white", borderRadius: "9999px", padding: "0.25rem 0.875rem", fontSize: "0.8125rem", fontWeight: 600, marginBottom: "1rem" }}>
              Ready to file
            </span>
            <h1 style={{ fontSize: "clamp(1.375rem, 4vw, 1.875rem)", marginBottom: "0.75rem" }}>
              Your filing is configured.
            </h1>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>
              Based on your answers, here is exactly what will be prepared for you.
            </p>

            {/* Filing summary */}
            <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.625rem", padding: "1.25rem", marginBottom: "1.25rem" }}>
              <p style={{ fontWeight: 700, fontSize: "0.8125rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--tf-muted)", marginBottom: "0.875rem" }}>
                Filing Summary
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.875rem" }}>
                <PriceRow
                  label={`Form 5472 + Pro Forma 1120${yearCount && yearCount > 1 ? ` x ${yearCount} years` : ""}`}
                  value={yearCount && yearCount > 1 ? `$${baseTotal}` : "$150"}
                />

                {answers.includeRCL && hasPriorYears && (
                  <PriceRow
                    label={`CPA-Authored Reasonable Cause Letter${yearCount && yearCount > 1 ? ` x ${yearCount} years` : ""}`}
                    value={yearCount && yearCount > 1 ? `+$${rclTotal}` : "+$200"}
                  />
                )}

                {additionalParties > 0 && (
                  <>
                    <PriceRow
                      label={`Additional Form 5472${additionalParties > 1 ? "s" : ""} (${additionalParties} more ${additionalParties === 1 ? "party" : "parties"}${numYears > 1 ? `, ${numYears} years` : ""})`}
                      value={numYears > 1 ? `+$${additionalFormsTotal}` : `+$${additionalFormsCostPerYear}`}
                    />
                    {totalForms > 3 && (
                      <p style={{ fontSize: "0.75rem", color: "var(--tf-muted)", fontWeight: 400, paddingLeft: "0.25rem", marginTop: "-0.25rem" }}>
                        Volume discount applied (forms 4+: $50/form)
                      </p>
                    )}
                  </>
                )}

                {grandTotal !== null && (
                  <PriceRow
                    label={answers.filingYears === "2-prior" ? "Total for 2 years" : "Total"}
                    value={`$${grandTotal}`}
                    total
                  />
                )}

                {answers.filingYears === "3-plus" && (
                  <p style={{ fontSize: "0.8125rem", color: "var(--tf-muted)", fontWeight: 400, paddingTop: "0.5rem", borderTop: "1px solid var(--tf-border)" }}>
                    Multi-year package pricing is confirmed at checkout.
                  </p>
                )}
              </div>

              {activeSections.length > 0 && (
                <>
                  <div style={{ borderTop: "1px solid var(--tf-border)", paddingTop: "0.875rem", marginTop: "0.375rem" }}>
                    <p style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--tf-text)", marginBottom: "0.5rem" }}>
                      Portal sections pre-activated for you:
                    </p>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                      {activeSections.map((s) => (
                        <li key={s} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--tf-text)" }}>
                          <span style={{ color: "#059669", fontWeight: 700, flexShrink: 0, fontSize: "0.75rem" }}>&#10003;</span>
                          {PORTAL_SECTION_NAMES[s]}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>

            {/* original CTA copy: "Create Your Free Account to Begin" — revert when services go live */}
            <Link
              to={portalPath}
              style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "1rem", padding: "0.875rem 1.5rem", borderRadius: "0.5rem", textDecoration: "none", display: "block", textAlign: "center", minHeight: "44px", lineHeight: "1.5", marginBottom: "0.75rem" }}
            >
              Join the Waitlist
            </Link>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.8125rem", fontWeight: 400, textAlign: "center", lineHeight: 1.6 }}>
              We will email you the moment this is live.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // ── Refer screen (hard stops only) ───────────────────────────

  if (outcome === "refer") {
    return (
      <section style={{ background: "var(--tf-bg)", minHeight: "80vh", padding: "3rem 1rem" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ background: "var(--tf-surface)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "2rem", boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)" }}>
            <span style={{ display: "inline-block", background: "#B31D1D", color: "white", borderRadius: "9999px", padding: "0.25rem 0.875rem", fontSize: "0.8125rem", fontWeight: 600, marginBottom: "1rem" }}>
              Outside our current scope
            </span>
            <h1 style={{ fontSize: "clamp(1.375rem, 4vw, 1.75rem)", marginBottom: "0.75rem" }}>
              This is one case our platform does not currently cover.
            </h1>
            <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.65, marginBottom: "1.5rem" }}>
              {referReason}
            </p>

            <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.625rem", padding: "1.125rem", marginBottom: "1.25rem" }}>
              <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.25rem" }}>TaxClaim.co</p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.6, marginBottom: "0.875rem" }}>
                A team of licensed CPAs who specialise in Form 5472 and foreign-owned LLC compliance. They handle cases our platform currently does not.
              </p>
              <a
                href={TAXCLAIM_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "0.9375rem", padding: "0.75rem 1.25rem", borderRadius: "0.5rem", textDecoration: "none", display: "block", textAlign: "center", minHeight: "44px", lineHeight: "1.6" }}
              >
                Connect with a CPA at TaxClaim.co
              </a>
            </div>

            <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => { setOutcome(null); setReferReason(""); }}
                style={{ background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, padding: "0.5rem 0" }}
              >
                &#8592; Go back and change my answer
              </button>
              <button
                onClick={resetAll}
                style={{ background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.8125rem", fontWeight: 400, padding: "0.5rem 0", textDecoration: "underline", textUnderlineOffset: "2px" }}
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ── Step flow ─────────────────────────────────────────────────

  return (
    <section style={{ background: "var(--tf-bg)", minHeight: "80vh", padding: "3rem 1rem" }}>
      <div style={{ maxWidth: "560px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "clamp(1.25rem, 3.5vw, 1.625rem)", marginBottom: "0.5rem" }}>
          Before you begin, let us confirm this is the right fit.
        </h1>
        <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "2rem" }}>
          This takes about 2 minutes. Your answers stay in your browser and are never stored.
        </p>

        <div style={{ background: "var(--tf-surface)", border: "1px solid var(--tf-border)", borderRadius: "0.75rem", padding: "2rem", boxShadow: "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)" }}>
          <ProgressBar current={step} />

          {/* ── Step 1: Entity type ── */}
          {step === 1 && (
            <div>
              <SectionLabel text="Entity Type" />
              <h2 style={{ fontSize: "1.125rem", marginBottom: "1.25rem" }}>
                What type of U.S. entity are you filing for?
              </h2>
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="Single-member LLC (I am the only owner)"
                  onClick={() => { setAnswers((a) => ({ ...a, entityType: "sm-llc" })); setStep(2); }}
                />
                <OptionButton
                  label="Multi-member LLC (2 or more owners)"
                  onClick={() => triggerRefer("When a U.S. LLC has two or more owners, different rules apply. A licensed CPA should determine the correct forms and ownership thresholds before anything is filed.")}
                />
                <OptionButton
                  label="C-Corporation"
                  onClick={() => triggerRefer("C-Corporations face a different set of Form 5472 rules. Professional guidance from a CPA is needed to make sure the right forms are prepared correctly.")}
                />
                <OptionButton
                  label="I am not sure"
                  onClick={() => triggerRefer("Confirming the entity type before filing is important. Filing under the wrong classification can create IRS issues that are difficult to correct. A CPA can confirm your entity type quickly.")}
                />
              </div>
              <StepNav onReset={resetAll} />
            </div>
          )}

          {/* ── Step 2: LLC Setup ── */}
          {step === 2 && (
            <div>
              <SectionLabel text="LLC Setup" />

              <div>
                <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
                  Has the IRS issued an Employer Identification Number (EIN) for this LLC?
                </h2>
                <YesNoButtons
                  selected={subAnswers.llcEIN}
                  onYes={() => setSub("llcEIN", "yes")}
                  onNo={() => { setSub("llcEIN", "no"); triggerRefer("An EIN is needed before the forms can be filed. Applications are free and can be submitted at IRS.gov. Return here once the number has been assigned."); }}
                />
              </div>

              {subAnswers.llcEIN === "yes" && (
                <>
                  <Divider />
                  <div>
                    <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
                      Is the person who owns this LLC a non-U.S. individual?
                    </h2>
                    <HintBox text="This means you do not hold U.S. Citizenship or a U.S. Green Card, and have not met the IRS Substantial Presence Test. The test is based on days you spent in the U.S. over the past three years. Most people who live outside the U.S. and visited only briefly will clear this." />
                    <YesNoButtons
                      selected={subAnswers.llcResidency}
                      onYes={() => setSub("llcResidency", "yes")}
                      onNo={() => { setSub("llcResidency", "no"); triggerRefer("This filing path is for LLCs owned entirely by non-U.S. individuals. If you hold U.S. Citizenship, a Green Card, or have met the Substantial Presence Test, different tax rules apply and a CPA should advise you."); }}
                    />
                  </div>
                </>
              )}

              {subAnswers.llcResidency === "yes" && (
                <>
                  <Divider />
                  <div>
                    <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
                      Is the LLC taxed the same way it was when it was first formed, with no elections filed to change that?
                    </h2>
                    <HintBox text="Answer Yes if you have not submitted Form 8832 or Form 2553 to the IRS. The large majority of single-member LLCs have never filed either form and remain on the default treatment as a disregarded entity." />
                    <YesNoButtons
                      selected={subAnswers.llcTaxTreatment}
                      onYes={() => setSub("llcTaxTreatment", "yes")}
                      onNo={() => { setSub("llcTaxTreatment", "no"); triggerRefer("Once a tax election is on file, the LLC is no longer treated as a disregarded entity. A different return type is required, and a CPA should review the situation before filing."); }}
                    />
                  </div>
                </>
              )}

              <StepNav
                onBack={() => setStep(1)}
                onReset={resetAll}
                showContinue={subAnswers.llcTaxTreatment === "yes"}
                onContinue={() => setStep(3)}
              />
            </div>
          )}

          {/* ── Step 3: Filing years ── */}
          {step === 3 && (
            <div>
              <SectionLabel text="Filing Years" />
              <h2 style={{ fontSize: "1.125rem", marginBottom: "1.25rem" }}>
                Which tax year or years are you filing for?
              </h2>

              {showPriorYearNote ? (
                <div>
                  {/* RCL Product Card */}
                  <div style={{ border: "2px solid #0284C7", borderRadius: "0.75rem", padding: "1.25rem 1.375rem", marginBottom: "1rem", background: "rgba(2,132,199,0.03)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "0.875rem" }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ display: "inline-block", background: "#059669", color: "white", borderRadius: "9999px", padding: "0.2rem 0.75rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                          Recommended Add-On
                        </span>
                        <p style={{ fontWeight: 700, fontSize: "1rem", color: "var(--tf-text)", lineHeight: 1.3 }}>
                          CPA-Authored Reasonable Cause Letter
                        </p>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ fontWeight: 700, fontSize: "1.125rem", color: "var(--tf-text)", lineHeight: 1 }}>+$200</p>
                        <p style={{ fontSize: "0.8125rem", color: "var(--tf-muted)", fontWeight: 400 }}>per year</p>
                      </div>
                    </div>
                    <p style={{ fontSize: "0.875rem", color: "var(--tf-text)", lineHeight: 1.65, marginBottom: "1rem" }}>
                      Because the original filing deadline was missed, the IRS imposes an automatic $25,000 penalty. Our letter is authored by a licensed CPA and aligned with IRS reasonable cause standards. You select the situation that fits your case, the system populates it with your filing details, and the completed letter is included in your download alongside the forms.
                    </p>
                    <div style={{ borderTop: "1px solid var(--tf-border)", paddingTop: "0.875rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                      <PriceRow label="Form 5472 + Pro Forma 1120" value={yearCount && yearCount > 1 ? `$${yearCount * 150}` : "$150"} />
                      <PriceRow label="Reasonable Cause Letter" value={yearCount && yearCount > 1 ? `+$${yearCount * 200}` : "+$200"} />
                      <PriceRow
                        label={yearCount && yearCount > 1 ? `Total for ${yearCount} years` : "Total"}
                        value={yearCount && yearCount > 1 ? `$${yearCount * 350}` : "$350"}
                        total
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => { setAnswers((a) => ({ ...a, includeRCL: true })); setStep(4); }}
                    style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "0.9375rem", padding: "0.75rem 1.5rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", minHeight: "44px", width: "100%", marginBottom: "0.5rem" }}
                  >
                    Include Reasonable Cause Letter and continue
                  </button>
                  <button
                    onClick={() => { setAnswers((a) => ({ ...a, includeRCL: false })); setStep(4); }}
                    style={{ background: "transparent", color: "var(--tf-muted)", fontWeight: 500, fontSize: "0.875rem", padding: "0.625rem 1rem", borderRadius: "0.5rem", border: "1px solid var(--tf-border)", cursor: "pointer", minHeight: "44px", width: "100%", marginBottom: "0.875rem" }}
                  >
                    Continue without the letter (not recommended)
                  </button>
                  <a
                    href={TAXCLAIM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "block", textAlign: "center", fontSize: "0.8125rem", color: "var(--tf-muted)", fontWeight: 400, textDecoration: "underline", textUnderlineOffset: "2px", marginBottom: "1rem" }}
                  >
                    Need more hands-on help? Speak with a CPA at TaxClaim.co
                  </a>
                  <button
                    onClick={() => setShowPriorYearNote(false)}
                    style={{ background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, padding: 0 }}
                  >
                    &#8592; Change my selection
                  </button>
                </div>
              ) : showMultiYearNote ? (
                <div>
                  {/* Multi-year product note */}
                  <div style={{ border: "2px solid #0284C7", borderRadius: "0.75rem", padding: "1.25rem 1.375rem", marginBottom: "1rem", background: "rgba(2,132,199,0.03)" }}>
                    <span style={{ display: "inline-block", background: "#059669", color: "white", borderRadius: "9999px", padding: "0.2rem 0.75rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "0.625rem" }}>
                      Multi-Year Package
                    </span>
                    <p style={{ fontWeight: 700, fontSize: "1rem", color: "var(--tf-text)", marginBottom: "0.625rem" }}>
                      CPA-Authored Reasonable Cause Letter included per year
                    </p>
                    <p style={{ fontSize: "0.875rem", color: "var(--tf-text)", lineHeight: 1.65, marginBottom: "0.875rem" }}>
                      Filing three or more years at once is handled through our multi-year package. A Reasonable Cause Letter is included for each year. Pricing is confirmed at checkout based on the number of years filed.
                    </p>
                    <p style={{ fontSize: "0.875rem", color: "var(--tf-muted)", fontWeight: 400, lineHeight: 1.6 }}>
                      Each year filed: $350 (Form 5472 + Reasonable Cause Letter). Three or more years may qualify for package pricing.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => { setAnswers((a) => ({ ...a, filingYears: "3-plus", includeRCL: true })); setStep(4); }}
                      style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "0.9375rem", padding: "0.75rem 1.25rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", minHeight: "44px", textAlign: "center" }}
                    >
                      Continue with my filing
                    </button>
                    <a
                      href={TAXCLAIM_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "block", textAlign: "center", padding: "0.75rem 1.25rem", borderRadius: "0.5rem", border: "1px solid var(--tf-border)", color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", textDecoration: "none", minHeight: "44px", lineHeight: "1.6" }}
                    >
                      Speak with a CPA at TaxClaim.co instead
                    </a>
                  </div>
                  <button
                    onClick={() => setShowMultiYearNote(false)}
                    style={{ marginTop: "1rem", background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, padding: 0 }}
                  >
                    &#8592; Change my selection
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <OptionButton
                    label="Current year only"
                    onClick={() => { setAnswers((a) => ({ ...a, filingYears: "current" })); setStep(4); }}
                  />
                  <OptionButton
                    label="1 prior year"
                    sublabel="Reasonable Cause Letter available as an add-on."
                    onClick={() => { setAnswers((a) => ({ ...a, filingYears: "1-prior" })); setShowPriorYearNote(true); }}
                  />
                  <OptionButton
                    label="2 prior years"
                    sublabel="Reasonable Cause Letter available per year."
                    onClick={() => { setAnswers((a) => ({ ...a, filingYears: "2-prior" })); setShowPriorYearNote(true); }}
                  />
                  <OptionButton
                    label="3 or more prior years"
                    sublabel="Multi-year package with Reasonable Cause Letter per year."
                    onClick={() => setShowMultiYearNote(true)}
                  />
                </div>
              )}

              {!showPriorYearNote && !showMultiYearNote && (
                <StepNav onBack={() => setStep(2)} onReset={resetAll} />
              )}
            </div>
          )}

          {/* ── Step 4: U.S. Activity ── */}
          {step === 4 && (
            <div>
              <SectionLabel text="U.S. Activity" />

              <div>
                <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
                  Did the LLC receive income that the IRS would consider to have originated in the United States?
                </h2>
                <HintBox text="Income is U.S.-source when the work producing it was done in the U.S., or when it comes from U.S. real estate or U.S. royalties. Having U.S. customers or a U.S. bank account on its own does not make income U.S.-source." />
                <YesNoButtons
                  selected={subAnswers.usIncome}
                  onYes={() => { setSub("usIncome", "yes"); triggerRefer("An LLC with U.S.-source income may need to file a full Form 1120 in addition to Form 5472. FileTax.co prepares Form 5472 and the Pro Forma 1120 only and is not set up for that scenario. A licensed CPA should advise on the right path."); }}
                  onNo={() => setSub("usIncome", "no")}
                />
              </div>

              {subAnswers.usIncome === "no" && (
                <>
                  <Divider />
                  <div>
                    <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
                      Does the LLC have employees based in the U.S., rent a U.S. office or storage space, or have anyone whose full-time role is working for the LLC from inside the U.S.?
                    </h2>
                    <YesNoButtons
                      selected={subAnswers.usPresence}
                      onYes={() => { setSub("usPresence", "yes"); triggerRefer("Hiring staff or maintaining a physical location in the U.S. can create what the IRS calls a U.S. Trade or Business. That situation requires a Form 1120-F filing, which is outside what this platform handles. A CPA should review this."); }}
                      onNo={() => setSub("usPresence", "no")}
                    />
                  </div>
                </>
              )}

              <StepNav
                onBack={() => setStep(3)}
                onReset={resetAll}
                showContinue={subAnswers.usIncome === "no" && subAnswers.usPresence === "no"}
                onContinue={() => setStep(5)}
              />
            </div>
          )}

          {/* ── Step 5: Transactions ── */}
          {step === 5 && (
            <div>
              <SectionLabel text="Transactions and Complexity" />
              <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
                Did the LLC have any of the following during the tax year?
              </h2>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.25rem" }}>
                Select all that apply. These determine which sections of your portal are activated.
              </p>
              <div className="flex flex-col gap-3">
                {TRANSACTION_OPTIONS.map((opt) => (
                  <CheckOption
                    key={opt.value}
                    label={opt.label}
                    hint={opt.hint}
                    checked={answers.complexTransactions.includes(opt.value)}
                    onChange={() => toggleComplex(opt.value)}
                  />
                ))}
              </div>

              {/* Portal sections info - shown when complex transactions are selected */}
              {activeSections.length > 0 && (
                <div style={{ background: "rgba(2,132,199,0.04)", border: "1px solid rgba(2,132,199,0.2)", borderRadius: "0.5rem", padding: "1rem 1.125rem", marginTop: "1rem" }}>
                  <p style={{ fontWeight: 600, fontSize: "0.875rem", color: "#0284C7", marginBottom: "0.5rem" }}>
                    These sections will be ready in your portal:
                  </p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.625rem" }}>
                    {activeSections.map((s) => (
                      <li key={s} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.875rem", color: "var(--tf-text)" }}>
                        <span style={{ color: "#059669", fontWeight: 700, flexShrink: 0, marginTop: "1px", fontSize: "0.75rem" }}>&#10003;</span>
                        <span>
                          {PORTAL_SECTION_NAMES[s]}
                          {HIGH_COMPLEXITY.has(s) && (
                            <span style={{ marginLeft: "0.375rem", fontSize: "0.75rem", color: "#B45309", fontWeight: 600 }}>
                              requires additional detail
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {hasHighComplexity && (
                    <p style={{ fontSize: "0.8125rem", color: "#B45309", fontWeight: 400, lineHeight: 1.55, paddingTop: "0.5rem", borderTop: "1px solid rgba(180,83,9,0.15)" }}>
                      The platform guides you through each section step by step. A CPA review is available at TaxClaim.co if you want extra assurance.
                    </p>
                  )}
                  {!hasHighComplexity && (
                    <p style={{ fontSize: "0.8125rem", color: "var(--tf-muted)", fontWeight: 400 }}>
                      No CPA required. The platform guides you through each section.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-3 mt-5 flex-wrap items-center">
                <button
                  onClick={() => setStep(6)}
                  disabled={answers.complexTransactions.length === 0}
                  style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "0.9375rem", padding: "0.75rem 1.5rem", borderRadius: "0.5rem", border: "none", cursor: answers.complexTransactions.length === 0 ? "not-allowed" : "pointer", opacity: answers.complexTransactions.length === 0 ? 0.5 : 1, minHeight: "44px" }}
                >
                  Continue
                </button>
                <button onClick={() => setStep(4)} style={{ background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, padding: "0.75rem 0" }}>
                  &#8592; Back
                </button>
                <button onClick={resetAll} style={{ background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.8125rem", fontWeight: 400, padding: "0.75rem 0", textDecoration: "underline", textUnderlineOffset: "2px" }}>
                  Start over
                </button>
              </div>
            </div>
          )}

          {/* ── Step 6: Related parties ── */}
          {step === 6 && (
            <div>
              <SectionLabel text="Related Parties" />
              <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
                Did the LLC conduct reportable transactions with more than one foreign related party?
              </h2>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.25rem" }}>
                A separate Form 5472 is required for each foreign related party. For most single-member LLCs, the only related party is the foreign owner. Related parties also include any foreign entity where you or the LLC hold 25% or more ownership.
              </p>

              {!showPartyCount && !showRelatedPartyNote && (
                <div className="flex flex-col gap-3">
                  <OptionButton
                    label="No, only with me as the foreign owner"
                    sublabel="One Form 5472 required. This is the most common situation."
                    onClick={() => { setAnswers((a) => ({ ...a, relatedPartyCount: 1 })); pass(); }}
                  />
                  <OptionButton
                    label="Yes, the LLC also dealt with other foreign related parties"
                    sublabel="Each additional related party requires its own Form 5472 (+$75/form, volume pricing for 4+ forms)."
                    onClick={() => setShowPartyCount(true)}
                  />
                  <OptionButton
                    label="I am not certain who qualifies as a related party"
                    onClick={() => setShowRelatedPartyNote(true)}
                  />
                </div>
              )}

              {/* Party count selector */}
              {showPartyCount && (
                <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.625rem", padding: "1.25rem" }}>
                  <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.875rem" }}>
                    How many foreign related parties in total, including yourself?
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "1rem" }}>
                    {[2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setSelectedPartyCount(n)}
                        style={{ padding: "0.75rem 0.5rem", borderRadius: "0.5rem", border: selectedPartyCount === n ? "1.5px solid #0284C7" : "1px solid var(--tf-border)", background: selectedPartyCount === n ? "#0284C7" : "var(--tf-surface)", color: selectedPartyCount === n ? "white" : "var(--tf-text)", fontWeight: 700, fontSize: "1.0625rem", cursor: "pointer", minHeight: "48px", transition: "background 0.15s, color 0.15s, border-color 0.15s" }}
                      >
                        {n === 5 ? "5+" : n}
                      </button>
                    ))}
                  </div>

                  {selectedPartyCount !== null && (
                    <div>
                      <div style={{ background: "rgba(2,132,199,0.04)", border: "1px solid rgba(2,132,199,0.2)", borderRadius: "0.5rem", padding: "0.875rem 1rem", marginBottom: "0.875rem" }}>
                        <p style={{ fontSize: "0.875rem", color: "var(--tf-text)", lineHeight: 1.65 }}>
                          {selectedPartyCount === 5
                            ? "For 5 or more related parties, a Form 5472 is prepared for each one. Our platform handles this, though a careful review of your output before filing is recommended."
                            : `Your filing will include ${selectedPartyCount} Form 5472s, one per related party. ${additionalFormsBreakdown(selectedPartyCount)}`}
                        </p>
                        {selectedPartyCount !== null && selectedPartyCount > 3 && selectedPartyCount < 5 && (
                          <p style={{ fontSize: "0.75rem", color: "#0284C7", fontWeight: 600, marginTop: "0.375rem" }}>
                            Volume discount applied. Forms 4 and beyond: $50/form
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => { setAnswers((a) => ({ ...a, relatedPartyCount: selectedPartyCount })); pass(); }}
                        style={{ background: "#0284C7", color: "white", fontWeight: 600, fontSize: "0.9375rem", padding: "0.75rem 1.25rem", borderRadius: "0.5rem", border: "none", cursor: "pointer", minHeight: "44px", width: "100%", marginBottom: "0.5rem" }}
                      >
                        Continue to filing
                      </button>
                      {selectedPartyCount === 5 && (
                        <a
                          href={TAXCLAIM_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "block", textAlign: "center", padding: "0.625rem 1rem", borderRadius: "0.5rem", border: "1px solid var(--tf-border)", color: "var(--tf-text)", fontWeight: 600, fontSize: "0.875rem", textDecoration: "none", minHeight: "44px", lineHeight: "1.8" }}
                        >
                          Speak with a CPA at TaxClaim.co instead
                        </a>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => { setShowPartyCount(false); setSelectedPartyCount(null); }}
                    style={{ marginTop: "0.875rem", background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, padding: 0 }}
                  >
                    &#8592; Back
                  </button>
                </div>
              )}

              {/* Related party explanation */}
              {showRelatedPartyNote && (
                <div style={{ background: "var(--tf-bg)", border: "1px solid var(--tf-border)", borderRadius: "0.625rem", padding: "1.125rem" }}>
                  <p style={{ color: "var(--tf-text)", fontSize: "0.875rem", lineHeight: 1.65, marginBottom: "0.875rem" }}>
                    A foreign related party includes your foreign owner (you), any foreign entity in which you personally own 25% or more, and any entity that owns 25% or more of your LLC. For most single-member LLCs formed by a sole non-U.S. founder with no other connected entities, the owner is the only related party.
                  </p>
                  <div className="flex flex-col gap-2">
                    <OptionButton
                      label="I only have myself as the related party"
                      onClick={() => { setAnswers((a) => ({ ...a, relatedPartyCount: 1 })); pass(); }}
                    />
                    <a
                      href={TAXCLAIM_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "block", textAlign: "center", padding: "0.75rem 1.25rem", borderRadius: "0.5rem", background: "transparent", border: "1px solid var(--tf-border)", color: "var(--tf-text)", fontWeight: 600, fontSize: "0.9375rem", textDecoration: "none", minHeight: "44px", lineHeight: "1.6" }}
                    >
                      I would like a CPA to confirm. TaxClaim.co can help.
                    </a>
                  </div>
                  <button
                    onClick={() => setShowRelatedPartyNote(false)}
                    style={{ marginTop: "0.875rem", background: "none", border: "none", color: "var(--tf-muted)", cursor: "pointer", fontSize: "0.875rem", fontWeight: 500, padding: 0 }}
                  >
                    &#8592; Back
                  </button>
                </div>
              )}

              {!showPartyCount && !showRelatedPartyNote && (
                <StepNav
                  onBack={() => { setStep(5); }}
                  onReset={resetAll}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
