import { Link } from "react-router";
import { usePageMeta } from "../hooks/usePageMeta";
import { useJsonLd } from "../hooks/useJsonLd";
import {
  PRICE_PER_YEAR,
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
// conversion work that no article does, which is why it is linked sitewide
// from the footer as "How Filing Works" rather than buried under /resources.
// It is deliberately NOT in the primary nav: that is already six items and a
// seventh crowds mobile. See handoff item 32, which settled the same question
// for /compare.
//
// THE REASONABLE CAUSE LETTER IS NOT ON THIS PAGE. Removed entirely on
// 3 Aug 2026 on the owner's instruction, and this is the rule, not a trim:
// the guide walks the filer to the pay screen, and the letter is the $199
// line item they decide on there. Explaining it here, pricing it here, or
// showing a sample of it here all argue with that decision at the worst
// possible moment, and the three reasonable cause ARTICLES that used to be
// linked from step 5 argued hardest of all, because they are a competent set
// of instructions for writing the letter yourself. Our own blog was the best
// case against our own product. /past-filings and /services sell the letter,
// /resources explains it, and the pay screen offers it. This page does none
// of the three. Do not reintroduce it here in any form.
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
  // A `sample` field used to live here, carrying the obscured reasonable cause
  // letter image onto step 5. It was removed with the rest of the letter on
  // 3 Aug 2026, on the owner's instruction. See the note above `STAGES`.
  /**
   * Articles for the filer who wants the tax detail behind this screen.
   *
   * THIS IS HOW THE GUIDE STAYS ABOUT THE PRODUCT. The rule at the top of this
   * file is that /guide answers "what happens when I click Start" and never
   * explains tax law. That rule only holds if there is somewhere to send the
   * person whose real question is "yes, but what counts as a reportable
   * transaction". Without these links the pressure to answer it here is
   * constant, and the guide slowly turns into a worse copy of /resources.
   *
   * So: when a stage tempts you into a paragraph of tax explanation, add a link
   * instead. Slugs must exist in the Sanity corpus, they are not rewritten if a
   * post is renamed, and a dead one gives the filer a 404 at the exact moment
   * they were told to go and read something.
   */
  reading?: { slug: string; label: string }[];
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
    reading: [
      { slug: "form-5472-vs-form-5471", label: "Form 5472 vs Form 5471, which one you actually file" },
      { slug: "form-5472-filing-checklist", label: "What you need before you start" },
    ],
    note:
      "Your answers here are never stored and never carried into the portal, so there is " +
      "nothing to leak from a screen you may have only been browsing. Your first intake asks " +
      "for your LLC details from scratch. After that we pre-fill them from your last filing " +
      "for you to review.",
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
      "what needs you without reading the list, and the filings themselves are grouped by " +
      "company rather than listed as one long run of years.",
    shot: "03-dashboard",
    shotAlt: "The dashboard showing filing counts, the next deadline, and a filing with its status",
    points: [
      {
        label: "One badge per filing, saying what it is right now",
        body:
          "A filing is a Draft while you are still entering details, In progress once it is " +
          "under way, Ready to download once paid, and Downloaded after you have taken the " +
          "package. Payment failed appears if a card is declined, so a half-finished purchase " +
          "is never silently abandoned. There is deliberately only ever one badge: it tells you " +
          "the single most important thing about that filing rather than making you read three " +
          "labels and work out which one wins.",
      },
      {
        label: "If you bought fax delivery, the badge is about the fax instead",
        body:
          "Fax pending while the transmission is still owed or still in flight, and Faxed to " +
          "the IRS once the provider confirms it landed. That outranks Downloaded, because it " +
          "is the thing you are actually waiting on. Nothing is at the IRS until the provider " +
          "confirms it, and the wording never claims otherwise.",
      },
      {
        label: "The deadline is worked out for you, and retired when it stops applying",
        body:
          "Each filing shows its own IRS position for that tax year: the original due date " +
          "while there is still time, the extended date once the first has passed, and 'Past " +
          "due, file ASAP' after that. The summary row shows your nearest deadline across every " +
          "unfinished filing. Once a filing has been faxed the deadline disappears from that " +
          "card, rather than warning you about a return you have just sent.",
      },
      {
        label: "Your companies are remembered between years",
        body:
          "Each company you have filed for gets its own group, showing the year you last filed " +
          "for it. Starting the next year from there carries the LLC and owner details forward " +
          "for you to review, instead of asking for an EIN you already gave us.",
      },
      {
        label: "Start one year, or catch up several",
        body:
          "A single tax year goes straight into the intake. Missed several years and the " +
          "catch-up flow sets them up as one job, grouped together so the years stay a single " +
          "piece of work rather than scattered rows. Where we have no filing on record for a " +
          "year, the company's card offers to start it. That is a statement about what you " +
          "filed through us, never a claim about what you did or did not file elsewhere.",
      },
      {
        label: "Nothing is lost if you stop",
        body:
          "The intake saves as you go. You can close the tab partway through and pick it up " +
          "from the dashboard days later on a different machine, and the link returns you to " +
          "the section you left rather than to the beginning. A catch-up resumes at the " +
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
      "It is six sections, one of which only appears if your filing is late. They open one at " +
      "a time, in order, and a completed section stays open to be reread and corrected.",
    shot: "04-intake-llc",
    shotAlt: "The intake wizard on the LLC Details section, with its progress indicator",
    points: [
      {
        label: "LLC Details",
        body:
          "Legal name, EIN, tax year, state of formation, date of incorporation, your business " +
          "activity, and total assets at year end. The business activity picks the NAICS code " +
          "for you rather than making you look one up. A year you have already filed and paid " +
          "for under that EIN is shown as already filed and cannot be picked twice.",
      },
      {
        label: "Filing Status, only when the year is late",
        body:
          "This section appears only if the due date for that year has passed. It asks why the " +
          "filing is late, in a few structured questions rather than a blank box. If you are " +
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
          "manually, each against the related party it belongs to, and each one is saved as " +
          "you add it rather than only when you leave the section. A running total sits under " +
          "the list. These populate Part IV, Part V and Part VI of Form 5472.",
      },
      {
        label: "Review",
        body:
          "A plain-language summary of everything you entered, before anything is generated. " +
          "Read it properly. This is the last point at which a typo is free to fix.",
      },
      {
        label: "You can see the forms before you pay",
        body:
          "Review offers a preview of your filled Form 5472 and pro forma 1120, built from " +
          "your own answers on the form revision for your year, watermarked DRAFT and with the " +
          "detail obscured. It is there so you can check your name, your EIN and your figures " +
          "landed in the right boxes before you decide to buy anything.",
      },
    ],
    reading: [
      { slug: "reportable-transactions-form-5472", label: "Reportable transactions: contributions, loans and distributions explained" },
      { slug: "form-5472-field-by-field", label: "Form 5472 field by field, every line explained" },
      { slug: "pro-forma-1120-explained", label: "The pro forma 1120, and every field you complete" },
      { slug: "top-mistakes-form-5472", label: "The mistakes foreign LLC owners make most often" },
    ],
    note:
      "Each section validates before it lets you continue. If something is missing or does not " +
      "look right, you are told on that screen rather than after payment.",
  },
  {
    id: "generate",
    kicker: "Step 5",
    title: "Paying, signing and downloading",
    lede:
      "Leaving Review takes you to a page headed Review and Payment. Once payment clears, the " +
      "same page becomes Generate Filing Package. Your package is built from the details you " +
      "entered, on the IRS form revision in force for that tax year, not on the current " +
      "year's form for every year.",
    shot: "05-generate",
    shotAlt: "The generate step showing the filing summary and the list of included documents",
    points: [
      {
        label: "What you are charged, itemised",
        body:
          `$${PRICE_PER_YEAR} per tax year, and $${PRICE_ADDITIONAL_PARTY} for each additional ` +
          "related party per year. Anything else you chose is a separate line on the same " +
          "screen, and you see that total before you are asked to pay. Prices exclude tax: any " +
          "tax due, and the currency you are billed in, are calculated at checkout from your " +
          "billing country.",
      },
      {
        label: "The card details are never ours to hold",
        body:
          "Paying hands you to our payment provider's own checkout page and back again. There " +
          "is no card field anywhere on FileTax, so there is nothing here for a card number to " +
          "be typed into or stored in.",
      },
      {
        label: "What is in the package",
        body:
          "Always the pro forma Form 1120 and Form 5472, one Form 5472 per related party, and " +
          "a Part VI statement. A Part V statement is added if you had monetary transactions, " +
          "and a Form 7004 if one applies to your year. Filing instructions for your year, with " +
          "the address and fax number to use, sit at the front. The screen lists exactly what " +
          "yours contains.",
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
        label: "The drawn signature is never stored",
        body:
          "The pad is blank every time you come back, deliberately: we keep your typed name, " +
          "not an image of your hand. Redrawing it changes only the next file you generate. A " +
          "PDF you have already downloaded is fixed as it was.",
      },
    ],
    // NO `reading` LIST ON THIS STAGE, DELIBERATELY, AND DO NOT RESTORE IT.
    // It held the three reasonable cause articles: what a letter must contain,
    // reasonable cause versus DIIRSP versus first-time abatement, and the
    // penalty exposure piece. This is the one screen where the filer is
    // deciding whether to pay for the letter, and those three links are a set
    // of instructions for writing it themselves. Our own blog would have been
    // the best argument against our own $199 product, at the exact moment it
    // mattered. They stay published, they stay linked from /resources and from
    // /past-filings, and they earn their traffic there. They do not belong on
    // the pay screen's guide. Owner's instruction, 3 Aug 2026.
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
        label: "By mail or by fax, yourself",
        body:
          "Form 5472 with a pro forma 1120 goes to the IRS by mail or by fax. The filing " +
          "instructions at the front of your package give the address and fax number for your " +
          "filing, so you are not hunting for them.",
      },
      {
        label: `Or we fax it for you, for $${PRICE_FAX}`,
        body:
          "One charge for the whole job, however many years it covers. You add it while you " +
          "are filing, it is a line on the same bill as everything else, and it is fixed once " +
          "paid. If you decide you want it after paying, you can add it from the filing itself.",
      },
      {
        label: "You press send, and you can see what happened",
        body:
          "Fax delivery does not fire on its own. Your filing page carries a Send to the IRS " +
          "by fax button, so the moment your pages leave is a moment you chose. The page then " +
          "shows the transmission's state, and if it fails it says why and lets you try again.",
      },
      {
        label: "Once it lands, you can download what we sent",
        body:
          "A confirmation from the fax provider, with the pages that were transmitted, the " +
          "number they went to, and the time they were accepted. Keep it. If the IRS ever " +
          "questions when you filed, that record is what answers it.",
      },
      {
        label: "A faxed filing becomes read-only",
        body:
          "Once your pages are with the IRS, that filing stops being editable, because changing " +
          "it here would no longer change what they hold. You keep full access to read it, " +
          "download it again, and see exactly what was sent. A correction after that point is a " +
          "conversation with a person, not a form field.",
      },
    ],
  },
];

// What paying does and does not lock. This section exists because "can I still
// fix it afterwards" is the question the pay screen raises and the guide never
// answered, and the honest answer is a selling point: corrections are
// unlimited. Keep it accurate against the database triggers rather than
// against memory. The frozen list is exactly the six identity fields in
// `filings_freeze_when_paid`, and it is frozen because those six are what the
// purchase was FOR: a different EIN, owner or year is a different filing.
const AFTER_PAYMENT: { label: string; body: string }[] = [
  {
    label: "You can correct it as many times as you need",
    body:
      "There is no cap on corrections and no charge for them. Fix a figure, add a " +
      "transaction, change an address, and regenerate the package as often as you like. A " +
      "filing you spot an error in three days later is not a filing you have to buy again.",
  },
  {
    label: "Six fields lock, and they are the ones that define what you bought",
    body:
      "The EIN, the LLC name, the tax year, your legal name, your foreign tax ID and the " +
      "incorporation date. A change to any of those is not a correction to this filing, it is " +
      "a different filing, and it needs to be started as one. Everything else stays open.",
  },
  {
    label: "Your package stays downloadable",
    body:
      "Sign in and take it again whenever you need it, for as long as the account exists. " +
      "Nothing expires and there is no second charge for a second download.",
  },
  {
    label: "A related party added later costs only that party",
    body:
      `If you realise afterwards that another party belongs on the return, you can add them ` +
      `and pay $${PRICE_ADDITIONAL_PARTY} for that party. The filing itself is never charged ` +
      "for twice. The updated forms unlock once that payment clears.",
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
      "A walkthrough of filing Form 5472 and the pro forma 1120 through FileTax, screen by screen: the eligibility check, the six intake sections, what you are charged, signing and downloading your package, sending it to the IRS by mail or fax, and what you can still change after you have paid.",
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

            {stage.reading && (
              <div style={{ margin: "0 0 1.5rem" }}>
                <p
                  style={{
                    color: "var(--tf-muted)",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 0.5rem",
                  }}
                >
                  If you want the detail
                </p>
                <ul style={{ margin: 0, paddingLeft: "1.125rem", display: "grid", gap: "0.3rem" }}>
                  {stage.reading.map((r) => (
                    <li key={r.slug} style={{ fontSize: "0.875rem", lineHeight: 1.55 }}>
                      <Link
                        to={`/resources/${r.slug}`}
                        style={{ color: "var(--tf-accent)", fontWeight: 600, textDecoration: "none" }}
                      >
                        {r.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

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

      {/* Stages end on --tf-bg (six of them, alternating from surface), so this
          opens on surface and the run continues: catch-up bg, limits surface,
          CTA bg. Inserting a section here without moving the two below it is
          what puts two identical backgrounds against each other. */}
      <section style={{ background: "var(--tf-surface)", padding: "3rem 1rem" }} aria-labelledby="after-payment-heading">
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <h2 id="after-payment-heading" style={headingStyle}>
            What paying does, and does not, lock
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            The most common worry at the pay screen is whether a mistake spotted
            afterwards is an expensive one. It is not.
          </p>
          <dl style={{ margin: 0 }}>
            {AFTER_PAYMENT.map((item) => (
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
          <p style={{ color: "var(--tf-muted)", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.65, margin: 0 }}>
            The one exception is a filing we have already faxed to the IRS, which
            becomes read-only. See{" "}
            <a href="#sending" style={{ color: "var(--tf-accent)", fontWeight: 600 }}>
              Sending it to the IRS
            </a>
            .
          </p>
        </div>
      </section>

      <section style={{ background: "var(--tf-bg)", padding: "3rem 1rem" }} aria-labelledby="catchup-heading">
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <h2 id="catchup-heading" style={headingStyle}>
            If you are catching up several years
          </h2>
          <p style={{ color: "var(--tf-text)", fontSize: "0.9375rem", lineHeight: 1.7, marginBottom: "1rem" }}>
            The flow above describes one tax year. Several missed years work the
            same way, with two differences worth knowing before you start.
          </p>
          {/* Same marker treatment as the homepage's "What you receive" list:
              listStyle none, a green tick in its own flex column, and a rule
              under each row. The bullets used to be browser discs, which is
              the only list on the site that looked like that.

              The reasonable cause letter bullet was removed on 3 Aug 2026 with
              the rest of the letter, and the intro above says "two differences"
              again as a result. It had said two while showing three since the
              page was built. If you add a third difference, fix the count. */}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {[
              {
                label: "You enter the shared details once.",
                body:
                  "Your LLC and owner details carry across every year in the job. What changes " +
                  "year to year is the transactions and the total assets.",
              },
              {
                label: "Each year gets its own correct form revision.",
                body: "A 2021 filing is rendered on the 2021 Form 1120, not on this year's.",
              },
            ].map((item) => (
              <li
                key={item.label}
                style={{
                  padding: "0.625rem 0",
                  borderBottom: "1px solid var(--tf-border)",
                  color: "var(--tf-text)",
                  fontSize: "0.9375rem",
                  lineHeight: 1.7,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                }}
              >
                <span style={{ color: "var(--tf-success)", fontWeight: 700, fontSize: "1.125rem", flexShrink: 0, lineHeight: 1.4 }}>&#10003;</span>
                <span>
                  <strong style={{ fontWeight: 600 }}>{item.label}</strong> {item.body}
                </span>
              </li>
            ))}
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
