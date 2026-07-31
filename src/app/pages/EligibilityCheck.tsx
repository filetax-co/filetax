import { useState, useEffect } from "react";
import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { PRICE_PER_YEAR, PRICE_RCL, PRICE_ADDITIONAL_PARTY } from "../../lib/pricing";

// ---------------------------------------------------------------------
// This screen is a GATE, not an intake form.
//
// Its only job is to answer one question: can FileTax serve this person,
// or should they be sent to a CPA? Everything the filing itself needs
// (which years, which transactions, which related parties, and all the
// party details that go in Form 5472 Part II) is collected once, in the
// portal's intake flow, where it is validated and saved.
//
// The rule: this screen must never ask anything intake will ask again.
// A question asked here and re-asked there costs the user twice and
// tells us nothing, because none of it was ever carried across.
//
// The one exception is the year COUNT in step 3, which exists purely to
// put a real number on the estimate. Which years, specifically, is
// chosen later in the multi-year flow, where the incorporation date is
// known and can rule years out.
//
// TEMPORARY: Services are not yet live. The CTA at the end routes to
// /waitlist instead of the portal. To revert when services launch,
// change PORTAL_PATH back to "/portal".
// ---------------------------------------------------------------------
const PORTAL_PATH = "/waitlist"; // original: "/portal"

type Step = 1 | 2 | 3 | 4;
type Outcome = "pass" | "refer" | null;
type YesNo = "yes" | "no";

interface SubAnswers {
  llcEIN?: YesNo;
  llcResidency?: YesNo;
  llcTaxTreatment?: YesNo;
  usIncome?: YesNo;
  usPresence?: YesNo;
}

const totalSteps = 4;

const INITIAL_SUB: SubAnswers = {};

// Step 2 establishes that the owner is a non-U.S. INDIVIDUAL before either
// U.S.-activity question is reached, so Form 1040-NR is the right return to
// name here. Form 1120 is a corporate return and Form 1120-F is for a foreign
// corporation owner; both were previously named here and both were wrong.
const REFER_US_SOURCE_INCOME =
  "Income the IRS treats as U.S.-source may make you personally liable to file " +
  "Form 1040-NR, and can change how the LLC's income is taxed. Services are " +
  "sourced where the work is performed, so having U.S. customers does not by " +
  "itself make income U.S.-source. This flow prepares Form 5472 and the pro " +
  "forma 1120 only. Please confirm your position with a CPA or tax adviser " +
  "before filing.";

const REFER_US_PRESENCE =
  "Employing people or keeping premises in the U.S. can create what the IRS " +
  "calls a U.S. trade or business. If it does, you would generally report that " +
  "income on Form 1040-NR at graduated rates, and a return is required even " +
  "when no tax is due. This flow prepares Form 5472 and the pro forma 1120 " +
  "only. A CPA or tax adviser should confirm your position before you file.";

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
    <p
      style={{
        fontSize: "0.6875rem",
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--tf-muted)",
        marginBottom: "1rem",
      }}
    >
      {text}
    </p>
  );
}

function OptionButton({
  label,
  sublabel,
  onClick,
}: {
  label: string;
  sublabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "0.875rem 1.125rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--tf-border)",
        background: "var(--tf-surface)",
        color: "var(--tf-text)",
        fontWeight: 500,
        fontSize: "0.9375rem",
        cursor: "pointer",
        minHeight: "44px",
        lineHeight: 1.4,
      }}
    >
      {label}
      {sublabel && (
        <span
          style={{
            display: "block",
            color: "var(--tf-muted)",
            fontSize: "0.8125rem",
            fontWeight: 400,
            marginTop: "0.2rem",
          }}
        >
          {sublabel}
        </span>
      )}
    </button>
  );
}

function YesNoButtons({
  selected,
  onYes,
  onNo,
}: {
  selected?: YesNo;
  onYes: () => void;
  onNo: () => void;
}) {
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
              border: active
                ? `1.5px solid ${isYes ? "#0284C7" : "#B31D1D"}`
                : "1px solid var(--tf-border)",
              background: active
                ? isYes
                  ? "#0284C7"
                  : "rgba(179,29,29,0.06)"
                : "var(--tf-surface)",
              color: active ? (isYes ? "white" : "#B31D1D") : "var(--tf-text)",
              fontWeight: 600,
              fontSize: "0.9375rem",
              cursor: "pointer",
              minHeight: "44px",
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
    <div
      style={{
        background: "var(--tf-bg)",
        border: "1px solid var(--tf-border)",
        borderRadius: "0.5rem",
        padding: "0.875rem 1rem",
        marginTop: "0.75rem",
        fontSize: "0.875rem",
        color: "var(--tf-muted)",
        fontWeight: 400,
        lineHeight: 1.65,
      }}
    >
      {text}
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: "1px solid var(--tf-border)", margin: "1.5rem 0" }} />;
}

function PriceRow({
  label,
  value,
  total,
}: {
  label: string;
  value: string;
  total?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "1rem",
        fontSize: total ? "0.9375rem" : "0.875rem",
        fontWeight: total ? 700 : 400,
        color: total ? "var(--tf-text)" : "var(--tf-muted)",
        paddingTop: total ? "0.5rem" : "0",
        marginTop: total ? "0.375rem" : "0",
        borderTop: total ? "1px solid var(--tf-border)" : "none",
      }}
    >
      <span>{label}</span>
      <span style={{ fontWeight: total ? 700 : 600, color: "var(--tf-text)", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function StepNav({
  onBack,
  onReset,
  showContinue,
  onContinue,
  continueDisabled,
  continueLabel,
}: {
  onBack?: () => void;
  onReset: () => void;
  showContinue?: boolean;
  onContinue?: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
}) {
  return (
    <div style={{ marginTop: "1.5rem" }}>
      {showContinue && onContinue && (
        <button
          onClick={onContinue}
          disabled={continueDisabled}
          style={{
            background: "#0284C7",
            color: "white",
            fontWeight: 600,
            fontSize: "0.9375rem",
            padding: "0.75rem 1.5rem",
            borderRadius: "0.5rem",
            border: "none",
            cursor: continueDisabled ? "not-allowed" : "pointer",
            opacity: continueDisabled ? 0.5 : 1,
            minHeight: "44px",
            marginBottom: "0.75rem",
            display: "block",
            width: "100%",
          }}
        >
          {continueLabel ?? "Continue"}
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              color: "var(--tf-muted)",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: 0,
            }}
          >
            &#8592; Back
          </button>
        )}
        <button
          onClick={onReset}
          style={{
            background: "none",
            border: "none",
            color: "var(--tf-muted)",
            cursor: "pointer",
            fontSize: "0.8125rem",
            fontWeight: 400,
            padding: 0,
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          Start over
        </button>
      </div>
    </div>
  );
}

export function EligibilityCheck() {
  usePageMeta({
    title: "Check Your Eligibility | FileTax.co",
    description:
      "Answer a few questions to confirm your Form 5472 filing is a good fit for FileTax.co. Takes about a minute. Your answers are never stored.",
  });

  const [step, setStep] = useState<Step>(1);
  const [subAnswers, setSubAnswers] = useState<SubAnswers>(INITIAL_SUB);
  const [yearCount, setYearCount] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [referReason, setReferReason] = useState("");

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [step, outcome]);

  const setSub = (key: keyof SubAnswers, val: YesNo) =>
    setSubAnswers((s) => ({ ...s, [key]: val }));

  const triggerRefer = (reason: string) => {
    setReferReason(reason);
    setOutcome("refer");
  };

  const resetAll = () => {
    setStep(1);
    setSubAnswers(INITIAL_SUB);
    setYearCount(null);
    setOutcome(null);
    setReferReason("");
  };

  if (outcome === "pass") {
    const years = yearCount ?? 1;
    const baseTotal = years * PRICE_PER_YEAR;
    const isMany = years >= 4;

    return (
      <section style={{ background: "var(--tf-bg)", minHeight: "80vh", padding: "3rem 1rem" }}>
        <div style={{ maxWidth: "580px", margin: "0 auto" }}>
          <div
            style={{
              background: "var(--tf-surface)",
              border: "1px solid var(--tf-border)",
              borderRadius: "0.75rem",
              padding: "2rem",
              boxShadow:
                "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
            }}
          >
            <span
              style={{
                display: "inline-block",
                background: "#059669",
                color: "white",
                borderRadius: "9999px",
                padding: "0.25rem 0.875rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                marginBottom: "1rem",
              }}
            >
              You are a fit
            </span>
            <h1 style={{ fontSize: "clamp(1.375rem, 4vw, 1.875rem)", marginBottom: "0.75rem" }}>
              We can prepare this filing for you.
            </h1>
            <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", lineHeight: 1.65, marginBottom: "1.5rem" }}>
              A single-member LLC owned by a non-U.S. individual, with no U.S.-source income and no
              U.S. premises, is what this platform is built for. Next you will choose the exact
              years and tell us what moved between you and the LLC.
            </p>

            <div
              style={{
                background: "var(--tf-bg)",
                border: "1px solid var(--tf-border)",
                borderRadius: "0.625rem",
                padding: "1.25rem",
                marginBottom: "1.25rem",
              }}
            >
              <p
                style={{
                  fontWeight: 700,
                  fontSize: "0.8125rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--tf-muted)",
                  marginBottom: "0.875rem",
                }}
              >
                What it costs
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <PriceRow
                  label={
                    isMany
                      ? `Form 5472 + pro forma 1120, per year`
                      : `Form 5472 + pro forma 1120${years > 1 ? ` x ${years} years` : ""}`
                  }
                  value={isMany ? `$${PRICE_PER_YEAR}` : `$${baseTotal}`}
                />
                {!isMany && (
                  <PriceRow
                    label={years > 1 ? `Filings for ${years} years` : "Total for the filing"}
                    value={`$${baseTotal}`}
                    total
                  />
                )}
              </div>

              <div
                style={{
                  paddingTop: "0.875rem",
                  marginTop: "0.875rem",
                  borderTop: "1px solid var(--tf-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <PriceRow
                  label="CPA-authored reasonable cause letter, if any year is late"
                  value={`$${PRICE_RCL} once`}
                />
                <PriceRow
                  label="Each additional related party"
                  value={`$${PRICE_ADDITIONAL_PARTY} per year`}
                />
              </div>

              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--tf-muted)",
                  fontWeight: 400,
                  lineHeight: 1.6,
                  paddingTop: "0.875rem",
                  marginTop: "0.875rem",
                  borderTop: "1px solid var(--tf-border)",
                }}
              >
                The letter is charged once however many late years you file, never per year. We
                work out which of your years are late from the actual deadlines once you pick
                them, and you will see your exact total, itemised, before you are asked to pay.
              </p>
            </div>

            <Link
              to={PORTAL_PATH}
              style={{
                background: "#0284C7",
                color: "white",
                fontWeight: 600,
                fontSize: "1rem",
                padding: "0.875rem 1.5rem",
                borderRadius: "0.5rem",
                textDecoration: "none",
                display: "block",
                textAlign: "center",
                minHeight: "44px",
                lineHeight: "1.5",
                marginBottom: "0.75rem",
              }}
            >
              Join the Waitlist
            </Link>
            <p
              style={{
                color: "var(--tf-muted)",
                fontSize: "0.8125rem",
                fontWeight: 400,
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              We will email you the moment this is live.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (outcome === "refer") {
    return (
      <section style={{ background: "var(--tf-bg)", minHeight: "80vh", padding: "3rem 1rem" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto" }}>
          <div
            style={{
              background: "var(--tf-surface)",
              border: "1px solid var(--tf-border)",
              borderRadius: "0.75rem",
              padding: "2rem",
              boxShadow:
                "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
            }}
          >
            <span
              style={{
                display: "inline-block",
                background: "#B31D1D",
                color: "white",
                borderRadius: "9999px",
                padding: "0.25rem 0.875rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                marginBottom: "1rem",
              }}
            >
              Outside our current scope
            </span>
            <h1 style={{ fontSize: "clamp(1.375rem, 4vw, 1.75rem)", marginBottom: "0.75rem" }}>
              This is one case our platform does not currently cover.
            </h1>
            <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.65, marginBottom: "1.5rem" }}>
              {referReason}
            </p>

            <div
              style={{
                background: "var(--tf-bg)",
                border: "1px solid var(--tf-border)",
                borderRadius: "0.625rem",
                padding: "1.125rem",
                marginBottom: "1.25rem",
              }}
            >
              <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.25rem" }}>
                Speak with a qualified tax professional
              </p>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.6 }}>
                This situation may require forms or tax analysis that fall outside this filing flow. A licensed tax professional can confirm the correct filing path before you continue.
              </p>
            </div>

            <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setOutcome(null);
                  setReferReason("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--tf-muted)",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  padding: "0.5rem 0",
                }}
              >
                &#8592; Go back and change my answer
              </button>
              <button
                onClick={resetAll}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--tf-muted)",
                  cursor: "pointer",
                  fontSize: "0.8125rem",
                  fontWeight: 400,
                  padding: "0.5rem 0",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ background: "var(--tf-bg)", minHeight: "80vh", padding: "3rem 1rem" }}>
      <div style={{ maxWidth: "560px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "clamp(1.25rem, 3.5vw, 1.625rem)", marginBottom: "0.5rem" }}>
          Before you begin, let us confirm this is the right fit.
        </h1>
        <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "2rem" }}>
          A handful of quick questions, about a minute. Your answers stay in your browser and are never stored.
        </p>

        <div
          style={{
            background: "var(--tf-surface)",
            border: "1px solid var(--tf-border)",
            borderRadius: "0.75rem",
            padding: "2rem",
            boxShadow:
              "0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)",
          }}
        >
          <ProgressBar current={step} />

          {step === 1 && (
            <div>
              <SectionLabel text="Entity Type" />
              <h2 style={{ fontSize: "1.125rem", marginBottom: "1.25rem" }}>
                What type of U.S. entity are you filing for?
              </h2>
              <div className="flex flex-col gap-3">
                <OptionButton
                  label="Single-member LLC (I am the only owner)"
                  onClick={() => setStep(2)}
                />
                <OptionButton
                  label="Multi-member LLC (2 or more owners)"
                  onClick={() =>
                    triggerRefer(
                      "When a U.S. LLC has two or more owners, different rules apply. A licensed tax professional should determine the correct forms and ownership thresholds before anything is filed."
                    )
                  }
                />
                <OptionButton
                  label="C-Corporation"
                  onClick={() =>
                    triggerRefer(
                      "C-Corporations face a different set of Form 5472 rules. Professional review is needed to make sure the correct forms are prepared."
                    )
                  }
                />
                <OptionButton
                  label="I am not sure"
                  onClick={() =>
                    triggerRefer(
                      "Confirming the entity type before filing is important. Filing under the wrong classification can create IRS issues that are difficult to correct."
                    )
                  }
                />
              </div>
              <StepNav onReset={resetAll} />
            </div>
          )}

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
                  onNo={() => {
                    setSub("llcEIN", "no");
                    triggerRefer(
                      "An EIN is needed before the forms can be filed. Applications are free and can be submitted at IRS.gov. Return here once the number has been assigned."
                    );
                  }}
                />
              </div>

              {subAnswers.llcEIN === "yes" && (
                <>
                  <Divider />
                  <div>
                    <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
                      Is the person who owns this LLC a non-U.S. individual?
                    </h2>
                    <HintBox text="This means you do not hold U.S. citizenship or a U.S. Green Card, and have not met the IRS Substantial Presence Test. The test is based on days you spent in the U.S. over the past three years." />
                    <YesNoButtons
                      selected={subAnswers.llcResidency}
                      onYes={() => setSub("llcResidency", "yes")}
                      onNo={() => {
                        setSub("llcResidency", "no");
                        triggerRefer(
                          "This filing path is for LLCs owned entirely by non-U.S. individuals. If you hold U.S. citizenship, a Green Card, or have met the Substantial Presence Test, different tax rules apply."
                        );
                      }}
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
                    <HintBox text="Answer Yes if you have not submitted Form 8832 or Form 2553 to the IRS. Most single-member LLCs have never filed either form and remain on the default treatment as a disregarded entity." />
                    <YesNoButtons
                      selected={subAnswers.llcTaxTreatment}
                      onYes={() => setSub("llcTaxTreatment", "yes")}
                      onNo={() => {
                        setSub("llcTaxTreatment", "no");
                        triggerRefer(
                          "Once a tax election is on file, the LLC is no longer treated as a disregarded entity. A different return type is required, and the situation should be reviewed before filing."
                        );
                      }}
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

          {step === 3 && (
            <div>
              <SectionLabel text="Filing Years" />
              <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
                How many tax years do you need to file?
              </h2>
              <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, marginBottom: "1.25rem" }}>
                A count is enough for now, so we can show you a price. You will pick the exact
                years in the portal, where we check them against the date your LLC was formed and
                work out which ones are late.
              </p>
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map((n) => (
                  <OptionButton
                    key={n}
                    label={n === 1 ? "Just one year" : `${n} years`}
                    onClick={() => {
                      setYearCount(n);
                      setStep(4);
                    }}
                  />
                ))}
                <OptionButton
                  label="4 or more years"
                  sublabel="We support tax years back to 2019."
                  onClick={() => {
                    setYearCount(4);
                    setStep(4);
                  }}
                />
              </div>
              <StepNav onBack={() => setStep(2)} onReset={resetAll} />
            </div>
          )}

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
                  onYes={() => {
                    setSub("usIncome", "yes");
                    triggerRefer(REFER_US_SOURCE_INCOME);
                  }}
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
                      onYes={() => {
                        setSub("usPresence", "yes");
                        triggerRefer(REFER_US_PRESENCE);
                      }}
                      onNo={() => setSub("usPresence", "no")}
                    />
                  </div>
                </>
              )}

              <StepNav
                onBack={() => setStep(3)}
                onReset={resetAll}
                showContinue={subAnswers.usIncome === "no" && subAnswers.usPresence === "no"}
                onContinue={() => setOutcome("pass")}
                continueLabel="See what this costs"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
