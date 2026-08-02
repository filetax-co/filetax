import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { useJsonLd } from "../hooks/useJsonLd";
import {
  PRICE_PER_YEAR,
  PRICE_RCL,
  PRICE_ADDITIONAL_PARTY,
  PRICE_FAX,
} from "../../lib/pricing";

// ---------------------------------------------------------------------
// THE FILING GUIDE. A walkthrough of THIS PRODUCT, not of Form 5472.
//
// The distinction is the whole point and must be preserved. /resources is
// the general tax library and answers "what is Form 5472". This page answers
// "what happens when I click Start", screen by screen, and nothing else. If
// you find yourself explaining tax law here, it belongs in an article; link
// to it instead.
//
// WHY IT EXISTS. The filer is being asked to hand over an EIN and a year of
// transactions to a site they found an hour ago, against a $25,000 penalty.
// Every screenshot below is a minute of that anxiety removed. This page does
// conversion work that no article does, which is why it lives in the primary
// nav and not under /resources.
//
// SCREENSHOTS ARE GENERATED, NOT PASTED. They come from the Test LLC fixture
// in `CNL 5472/5472/scripts/genSamplePreview.mjs`, the same fictional filer
// as the /services sample output, so the guide and the samples always show
// one consistent story. Regenerate them whenever the portal, the intake or
// the dashboard changes. See FILETAX-HANDOFF.md, "Filing guide screenshots".
//
// Two things must never appear in a shot: the DEV-only scenario loader
// (`intake/DevScenarioLoader.tsx`), and any localhost or preview URL. Neither
// reaches production, and a filer who sees either learns about a sandbox that
// is none of their business.
//
// NO DOLLAR LITERALS. Same rule as everywhere else, import from pricing.ts.
// ---------------------------------------------------------------------

// Where the generated screenshots land. Kept as one constant so the capture
// script and the page cannot disagree about the directory.
const SHOTS = "/guide";

interface Stage {
  id: string;
  kicker: string;
  title: string;
  lede: string;
  /** Screenshot basename, without extension. Omit for stages with no screen. */
  shot?: string;
  shotAlt?: string;
  points: { label: string; body: string }[];
  /** Shown in an amber note under the points. */
  note?: string;
}

const STAGES: Stage[] = [
  {
    id: "eligibility",
    kicker: "Step 1",
    title: "The eligibility check",
    lede:
      "Before we take any details, three questions establish whether this filing is one we can " +
      "prepare properly. It takes about a minute, and it is the only part of the process where " +
      "the honest answer might be that you should see a CPA instead.",
    shot: "01-eligibility",
    shotAlt: "The eligibility check, showing the entity type question and a three-step progress bar",
    points: [
      {
        label: "What type of U.S. entity are you filing for?",
        body:
          "Only a single-member LLC continues. A multi-member LLC, a C-Corporation, or an " +
          "honest 'I am not sure' each stop here with an explanation of why a professional " +
          "should look at it first.",
      },
      {
        label: "Has the IRS issued an EIN, is the owner a non-U.S. individual, and is the LLC still taxed as formed?",
        body:
          "Three yes-or-no questions that appear one after another. No EIN means there is " +
          "nothing to file against yet. A U.S. citizen, Green Card holder, or anyone meeting " +
          "the Substantial Presence Test falls under different rules. And a Form 8832 or " +
          "Form 2553 already on file means the LLC is no longer a disregarded entity, which " +
          "changes the return entirely.",
      },
      {
        label: "How many tax years do you need to file?",
        body:
          "A count, not the specific years, which is enough to price the job. You choose the " +
          "actual years later, once we know your incorporation date and can rule out years " +
          "the LLC did not exist. We support tax years back to 2019.",
      },
    ],
    note:
      "Your answers here are never stored and never carried into the portal. That is why the " +
      "intake asks for your LLC details again rather than pre-filling them, and it is a " +
      "deliberate trade: nothing to leak from a screen you may have only been browsing.",
  },
  {
    id: "account",
    kicker: "Step 2",
    title: "Creating your account",
    lede:
      "Free, and no payment is taken at this point. You choose an email address and a password, " +
      "confirm the email, and sign in.",
    shot: "02-portal",
    shotAlt: "The portal sign-up form showing the live password requirement checklist",
    points: [
      {
        label: "The password requirements are shown as you type",
        body:
          "At least 8 characters, with a lowercase letter, an uppercase letter, a number and a " +
          "symbol. The checklist under the field ticks off in real time, so you are not guessing " +
          "at what is missing and then being told after you submit.",
      },
      {
        label: "We check the password is not a known-breached one",
        body:
          "Beyond the character rules, the password is scored for strength and checked against " +
          "the HaveIBeenPwned breach database. That check uses k-anonymity: only a partial hash " +
          "prefix leaves your browser, never the password itself. A password that has appeared " +
          "in a public breach is rejected, because it is the first thing an attacker tries.",
      },
      {
        label: "Confirm your email, then sign in",
        body:
          "We email you a confirmation link. Clicking it confirms the address and returns you to " +
          "the portal, where you sign in with the password you just chose. If you ever forget " +
          "it, the reset link on the sign-in form emails you a link to set a new one.",
      },
      {
        label: "What to have ready",
        body:
          "Your EIN, the tax year, your state of formation and incorporation date, your own " +
          "legal name, country of residence and foreign tax ID, and the transactions between " +
          "you and the LLC for the year. Nothing here needs a bank login, and we never ask " +
          "you to upload statements.",
      },
    ],
  },
  {
    id: "dashboard",
    kicker: "Step 3",
    title: "Your dashboard",
    lede:
      "Every filing you start appears here and stays here once it is finished, so you can come " +
      "back and download the package again later. It opens with a row of counts so you can see " +
      "what needs you without reading the list.",
    shot: "03-dashboard",
    shotAlt: "The dashboard showing filing counts, the next deadline, and a filing with its status",
    points: [
      {
        label: "Where each filing has got to",
        body:
          "A filing is a Draft while you are still entering details, In progress once it is " +
          "under way, Ready to download once paid, and Downloaded after you have taken the " +
          "package. Payment failed appears if a card is declined, so a half-finished purchase " +
          "is never silently abandoned.",
      },
      {
        label: "The deadline is worked out for you",
        body:
          "Each filing shows its own IRS position for that tax year: the original due date " +
          "while there is still time, the extended date once the first has passed, and 'Past " +
          "due, file ASAP' after that. The summary row shows your nearest deadline across every " +
          "unfinished filing.",
      },
      {
        label: "Start one year, or catch up several",
        body:
          "A single tax year goes straight into the intake. Missed several years and the " +
          "catch-up flow sets them up as one job, grouped together on the dashboard so the " +
          "years stay a single piece of work rather than scattered rows.",
      },
      {
        label: "Nothing is lost if you stop",
        body:
          "The intake saves as you go. You can close the tab partway through and pick it up " +
          "from the dashboard days later on a different machine. A catch-up resumes at the " +
          "earliest year still needing work, so the years get filed in order.",
      },
      {
        label: "You can delete a filing you have not paid for",
        body:
          "Unpaid drafts can be removed, including a whole catch-up job at once. Once a year " +
          "has been paid for it stays, because a half-deleted catch-up is worse than none.",
      },
    ],
  },
  {
    id: "intake",
    kicker: "Step 4",
    title: "The intake, section by section",
    lede:
      "This is the part that takes real time, about ten minutes for a straightforward year. " +
      "It is six sections, and one of them only appears if your filing is late.",
    shot: "04-intake-llc",
    shotAlt: "The intake wizard on the LLC Details section, with its progress indicator",
    points: [
      {
        label: "LLC Details",
        body:
          "Legal name, EIN, tax year, state of formation, date of incorporation, your business " +
          "activity, and total assets at year end. The business activity picks the NAICS code " +
          "for you rather than making you look one up.",
      },
      {
        label: "Filing Status, only when the year is late",
        body:
          "This section appears only if the due date for that year has passed. It asks why the " +
          "filing is late, and those answers become the reasonable cause letter. If you are " +
          "filing on time you will never see this screen.",
      },
      {
        label: "Owner Details",
        body:
          "Your legal name, address, country of residence and citizenship, and your foreign tax " +
          "ID. The tax ID field knows the format for your country and warns you if what you " +
          "have entered does not match it.",
      },
      {
        label: "Related Parties",
        body:
          "Most single-member LLCs have exactly one related party, you, and this section stays " +
          "empty. Add a party here only if the LLC transacted with a foreign parent or another " +
          "entity you control. Each additional party is its own Form 5472, every year.",
      },
      {
        label: "Transactions",
        body:
          "The money and non-money movements between you and the LLC during the year: capital " +
          "contributions, distributions, loans, services, reimbursements. You enter them " +
          "manually. These populate Part IV, Part V and Part VI of Form 5472.",
      },
      {
        label: "Review",
        body:
          "A plain-language summary of everything you entered, before anything is generated. " +
          "Read it properly. This is the last point at which a typo is free to fix.",
      },
    ],
    note:
      "Each section validates before it lets you continue. If something is missing or does not " +
      "look right, you are told on that screen rather than after payment.",
  },
  {
    id: "generate",
    kicker: "Step 5",
    title: "Generating and paying",
    lede:
      "Your package is built from the details you entered, on the IRS form revision in force " +
      "for that tax year, not on the current year's form for every year.",
    shot: "05-generate",
    shotAlt: "The generate step showing the filing summary and the list of included documents",
    points: [
      {
        label: "What is in the package",
        body:
          "Always the pro forma Form 1120 and Form 5472, and a Part VI statement. A Part V " +
          "statement is added if you had monetary transactions, a Form 7004 if an extension " +
          "applies to your year, and the reasonable cause letter if the filing is late. The " +
          "screen lists exactly what yours contains before you pay.",
      },
      {
        label: "You sign it here, at the end and not before",
        body:
          "Draw your signature, or leave the pad blank and it falls back to your typed name, " +
          "which the IRS accepts just as readily. Signing sits immediately before generating on " +
          "purpose, so you are signing the filing as it is about to be rendered rather than a " +
          "version you edited three screens ago. On a catch-up, one signature covers every year.",
      },
      {
        label: "Then you pay and download",
        body:
          `$${PRICE_PER_YEAR} per tax year, one $${PRICE_RCL} reasonable cause letter covering ` +
          `every late year in the job, and $${PRICE_ADDITIONAL_PARTY} for each additional ` +
          "related party per year. The download is a print-ready PDF.",
      },
    ],
  },
  {
    id: "sending",
    kicker: "Step 6",
    title: "Sending it to the IRS",
    lede:
      "The package is complete and signed when you download it. What it still needs is to reach " +
      "the IRS, and that step is yours unless you add fax delivery.",
    points: [
      {
        label: "By mail or by fax",
        body:
          "Form 5472 with a pro forma 1120 goes to the IRS by mail or by fax. The filing " +
          "instructions included with your package give the current address and fax number for " +
          "your filing, so you are not hunting for them.",
      },
      {
        label: "Or we send it",
        body:
          `Fax delivery is an opt-in $${PRICE_FAX} for the whole job, however many years it ` +
          "covers. You get the transmission confirmation.",
      },
      {
        label: "Keep the confirmation",
        body:
          "Whichever way it goes, keep proof of when it was sent. If the IRS later questions " +
          "the date, that proof is the answer.",
      },
    ],
  },
];

// What the product deliberately does not do. Sits at the end of the guide for
// the same reason /compare carries its own version: a walkthrough that never
// names a limit is a brochure.
const LIMITS: { label: string; body: string }[] = [
  {
    label: "We do not prepare your personal return",
    body:
      "If you have U.S.-source income, staff, or premises, your own return is in question. " +
      "This flow does not prepare Form 1040-NR, and the intake asks about U.S. activity per " +
      "tax year so you are told rather than left to find out.",
  },
  {
    label: "We do not respond to IRS notices",
    body:
      "A voluntary catch-up and a reply to a penalty notice are different positions. If the " +
      "IRS has already written to you, take the letter to a CPA.",
  },
  {
    label: "We do not decide what your LLC did",
    body:
      "The transactions you enter are the ones we report. If you are not sure what moved " +
      "between you and the LLC in a given year, that has to be resolved before any form can " +
      "be filled in honestly.",
  },
  {
    label: "We do not offer judgement on a complicated position",
    body:
      "If your situation turns on facts a form cannot capture, you want a person. The " +
      "eligibility check screens for most of these and will refer you out rather than take " +
      "your money.",
  },
];

const headingStyle: React.CSSProperties = {
  fontSize: "clamp(1.25rem, 3vw, 1.75rem)",
  marginBottom: "0.5rem",
  lineHeight: 1.25,
};

/**
 * A generated screenshot. Renders nothing at all if the file is missing, so
 * the guide reads correctly before `npm run gen:guideshots` has ever been run
 * and does not show a broken image if a capture fails.
 */
function Shot({ name, alt }: { name: string; alt: string }) {
  return (
    <figure
      style={{
        margin: "1.5rem 0 0",
        border: "1px solid var(--tf-border)",
        borderRadius: "0.75rem",
        overflow: "hidden",
        background: "var(--tf-bg)",
      }}
    >
      <img
        src={`${SHOTS}/${name}.webp`}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={{ display: "block", width: "100%", height: "auto" }}
        onError={(e) => {
          const fig = (e.currentTarget as HTMLImageElement).closest("figure");
          if (fig) (fig as HTMLElement).style.display = "none";
        }}
      />
    </figure>
  );
}

export function Guide() {
  usePageMeta({
    title: "How Filing Works, Step by Step | FileTax.co",
    description:
      "A walkthrough of filing Form 5472 and the pro forma 1120 through FileTax, screen by screen: the eligibility check, the six intake sections, generating and signing your package, and sending it to the IRS.",
    canonical: "https://filetax.co/guide",
  });

  useJsonLd("guide-howto", {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to file Form 5472 and a pro forma 1120 through FileTax",
    description:
      "The steps a foreign owner of a U.S. single-member LLC goes through to prepare and send Form 5472 with a pro forma 1120 using FileTax.",
    step: STAGES.map((stage, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: stage.title,
      text: stage.lede,
      url: `https://filetax.co/guide#${stage.id}`,
    })),
  });

  return (
    <>
      <section style={{ background: "var(--tf-bg)", padding: "3.5rem 1rem 2rem" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2.25rem)", marginBottom: "0.75rem", lineHeight: 1.2 }}>
            What filing through FileTax actually looks like
          </h1>
          <p style={{ color: "var(--tf-text)", fontSize: "1.0625rem", fontWeight: 500, lineHeight: 1.6, marginBottom: "0.75rem" }}>
            Every screen, in the order you will meet it, with the real thing shown
            rather than described. If you want to know what you are handing over
            before you hand it over, this is the page.
          </p>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6 }}>
            About ten minutes for a straightforward year. The screenshots use a
            fictional filer, Test LLC, so nothing here belongs to a real customer.
            Looking for what Form 5472 is and why you owe it?{" "}
            <Link to="/resources" style={{ color: "var(--tf-accent)", fontWeight: 600 }}>
              Start with the guides
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Jump list. Six stages is enough that a reader arriving from the portal
          mid-filing needs to land on their screen, not scroll to it. */}
      <section style={{ background: "var(--tf-bg)", padding: "0 1rem 2.5rem" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <nav
            aria-label="Filing steps"
            style={{
              border: "1px solid var(--tf-border)",
              borderRadius: "0.75rem",
              background: "var(--tf-surface)",
              padding: "1rem 1.25rem",
            }}
          >
            <ol style={{ margin: 0, paddingLeft: "1.25rem", display: "grid", gap: "0.375rem" }}>
              {STAGES.map((stage) => (
                <li key={stage.id} style={{ fontSize: "0.9375rem", lineHeight: 1.5 }}>
                  <a href={`#${stage.id}`} style={{ color: "var(--tf-accent)", fontWeight: 600, textDecoration: "none" }}>
                    {stage.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </section>

      {STAGES.map((stage, i) => (
        <section
          key={stage.id}
          id={stage.id}
          aria-labelledby={`${stage.id}-heading`}
          style={{
            background: i % 2 === 0 ? "var(--tf-surface)" : "var(--tf-bg)",
            padding: "3rem 1rem",
            scrollMarginTop: "5rem",
          }}
        >
          <div style={{ maxWidth: "820px", margin: "0 auto" }}>
            <p
              style={{
                color: "var(--tf-muted)",
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "0.5rem",
              }}
            >
              {stage.kicker}
            </p>
            <h2 id={`${stage.id}-heading`} style={headingStyle}>
              {stage.title}
            </h2>
            <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
              {stage.lede}
            </p>

            {stage.shot && <Shot name={stage.shot} alt={stage.shotAlt ?? stage.title} />}

            <dl style={{ margin: stage.shot ? "1.75rem 0 0" : 0 }}>
              {stage.points.map((point) => (
                <div
                  key={point.label}
                  style={{
                    paddingBottom: "1.125rem",
                    marginBottom: "1.125rem",
                    borderBottom: "1px solid var(--tf-border)",
                  }}
                >
                  <dt style={{ fontWeight: 600, color: "var(--tf-text)", fontSize: "0.9375rem", marginBottom: "0.3rem", lineHeight: 1.45 }}>
                    {point.label}
                  </dt>
                  <dd style={{ margin: 0, color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.65 }}>
                    {point.body}
                  </dd>
                </div>
              ))}
            </dl>

            {stage.note && (
              <p
                style={{
                  color: "var(--tf-text)",
                  fontSize: "0.875rem",
                  fontWeight: 400,
                  lineHeight: 1.65,
                  background: "var(--tf-bg)",
                  border: "1px solid var(--tf-border)",
                  borderLeft: "3px solid var(--tf-accent)",
                  borderRadius: "0.5rem",
                  padding: "0.875rem 1rem",
                  margin: 0,
                }}
              >
                {stage.note}
              </p>
            )}
          </div>
        </section>
      ))}

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="catchup-heading">
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <h2 id="catchup-heading" style={headingStyle}>
            If you are catching up several years
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            The flow above describes one tax year. Several missed years work the
            same way, with two differences worth knowing before you start.
          </p>
          <ul style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, paddingLeft: "1.25rem", margin: 0 }}>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ fontWeight: 600 }}>You enter the shared details once.</strong>{" "}
              Your LLC and owner details carry across every year in the job. What
              changes year to year is the transactions and the total assets.
            </li>
            <li style={{ marginBottom: "0.5rem" }}>
              <strong style={{ fontWeight: 600 }}>One reasonable cause letter covers all of them.</strong>{" "}
              It is written once, names every late year, and is charged once at $
              {PRICE_RCL} no matter how many years the job covers.
            </li>
            <li>
              <strong style={{ fontWeight: 600 }}>Each year gets its own correct form revision.</strong>{" "}
              A 2021 filing is rendered on the 2021 Form 1120, not on this year's.
            </li>
          </ul>
        </div>
      </section>

      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="limits-heading">
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <h2 id="limits-heading" style={headingStyle}>
            What this flow does not do
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            Worth reading before you start rather than after.
          </p>
          <dl style={{ margin: 0 }}>
            {LIMITS.map((item) => (
              <div
                key={item.label}
                style={{
                  paddingBottom: "1.125rem",
                  marginBottom: "1.125rem",
                  borderBottom: "1px solid var(--tf-border)",
                }}
              >
                <dt style={{ fontWeight: 600, color: "var(--tf-text)", fontSize: "0.9375rem", marginBottom: "0.3rem", lineHeight: 1.45 }}>
                  {item.label}
                </dt>
                <dd style={{ margin: 0, color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.65 }}>
                  {item.body}
                </dd>
              </div>
            ))}
          </dl>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, margin: 0 }}>
            Weighing this against an accountant?{" "}
            <Link to="/compare" style={{ color: "var(--tf-accent)", fontWeight: 600 }}>
              See how we compare to a CPA
            </Link>
            .
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem 4rem" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", marginBottom: "0.75rem" }}>
            Ready to see where you stand?
          </h2>
          <p style={{ color: "var(--tf-muted)", fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.6, marginBottom: "1.5rem" }}>
            Start with the eligibility check. It takes about a minute, stores
            nothing, and tells you honestly whether we can help.
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
