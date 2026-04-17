Here is the complete, final, self-contained build prompt with everything included:

***

Build a complete static marketing website for **TaxFile.io** -- a self-serve tax form generation platform for foreign-owned U.S. entities, built by a licensed CPA. Output separate HTML files for each page, with all CSS in a single shared `style.css` and all JavaScript in a single shared `script.js`. No backend. No form submissions stored. No build tools. Deployable directly to Cloudflare Pages.

**File structure:**
```
/
├── index.html
├── pricing.html
├── services.html
├── past-filings.html
├── check.html
├── portal.html
├── resources.html
├── resources/
│   ├── what-is-form-5472.html
│   ├── 25000-penalty-form-5472.html
│   ├── form-5472-pro-forma-1120-together.html
│   ├── delaware-wyoming-new-mexico-llc.html
│   ├── reasonable-cause-letter-irs-penalty.html
│   ├── file-form-5472-missed-prior-years.html
│   ├── form-8832-vs-form-2553.html
│   └── foreign-founders-us-tax-mistakes.html
├── faq.html
├── style.css
└── script.js
```

***

**TYPOGRAPHY**

Single font across the entire site: Satoshi via Fontshare. No serif fonts anywhere.
Load in every HTML file `<head>`:
`https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap`

Font weight rules:
- Body text: `font-weight: 500`
- Headlines h1, h2, h3: `font-weight: 700`
- UI labels, subheadings, nav links: `font-weight: 600`
- Muted secondary text: `font-weight: 400`

***

**COLOR SYSTEM**

```css
:root {
  --color-bg:         #F8FAFC;
  --color-surface:    #FFFFFF;
  --color-nav:        #0F172A;
  --color-text:       #0F172A;
  --color-muted:      #64748B;
  --color-accent:     #0284C7;
  --color-accent-h:   #0369A1;
  --color-success:    #059669;
  --color-error:      #DC2626;
  --color-border:     #E2E8F0;
}

[data-theme="dark"] {
  --color-bg:         #020617;
  --color-surface:    #0F172A;
  --color-text:       #F1F5F9;
  --color-muted:      #94A3B8;
  --color-border:     #1E293B;
}
```

Light-mode first. Dark mode sets `data-theme="dark"` on `<html>`. Detect system preference on load via `window.matchMedia('(prefers-color-scheme: dark)')`. Store toggle in a JS variable only -- no localStorage, no sessionStorage.

***

**DESIGN RULES**

- Left-aligned body content throughout. Center only the hero headline and subheadline.
- Solid `#0284C7` CTA buttons only -- no gradients on buttons
- Borders: `1px solid oklch(from var(--color-text) l c h / 0.12)`
- Card shadows: `0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)`
- Border radius: cards `0.75rem`, buttons `0.5rem`, badges `9999px`
- No decorative blobs, gradient hero backgrounds, or emoji as design elements
- No 3-column icon-in-colored-circle feature grids
- No fake testimonials
- No new animations beyond what is specified
- Mobile-first. All touch targets minimum 44x44px.
- All external links: `target="_blank" rel="noopener noreferrer"`
- First focusable element on every page: "Skip to main content" link
- Active nav link: `color: var(--color-accent)` with bottom border

***

**SHARED NAVIGATION (identical on every page)**

Left: "TaxFile.io" in Satoshi 700, `#0284C7`, links to index.html
Nav links: Home / Pricing / Services / Past Filings / Resources / FAQ
Right: dark mode toggle (sun/moon icon) + "Start My Filing" button linking to check.html
Mobile: hamburger, slides down full-width nav panel
Nav background: `#0F172A` in both light and dark mode, white text

***

**SHARED FOOTER (identical on every page)**

Left: "TaxFile.io" + tagline "IRS-ready forms for foreign-owned U.S. entities."
Center: Pricing / Services / Past Filings / Resources / FAQ
Right: `hello@taxfile.io` as mailto link. "We respond within 1 business day."
Bottom bar disclaimer:
"TaxFile.io is a software platform for generating IRS forms based on your inputs. It is not a law firm and does not provide legal or tax advice. Forms are generated according to the official IRS Instructions for Form 5472 (Rev. December 2024)."
Copyright: "2026 TaxFile.io"

***

**GOOGLE ANALYTICS AND MICROSOFT CLARITY**

Add to `<head>` of every page:
```html
<!-- Replace G-XXXXXXXX with your GA4 measurement ID -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-XXXXXXXX');</script>

<!-- Replace XXXXXXXX with your Clarity project ID -->
<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","XXXXXXXX");</script>
```

***

**IRS DEADLINE CLOCK (script.js -- rendered on index.html and pricing.html)**

```javascript
const IRS_DEADLINE_ADJUSTED = (year) => {
  // April 15 23:59:59 ET (EDT = UTC-4) = April 16 03:59:59 UTC
  let primary = new Date(Date.UTC(year, 3, 16, 3, 59, 59));
  // October 15 23:59:59 ET (EDT = UTC-4) = October 16 03:59:59 UTC
  let extension = new Date(Date.UTC(year, 9, 16, 3, 59, 59));

  const adjust = (d) => {
    const day = d.getUTCDay();
    if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
    if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
    return d;
  };

  return { primary: adjust(primary), extension: adjust(extension) };
};

const runClock = () => {
  const container = document.getElementById('irs-clock');
  if (!container) return;

  const now = new Date();
  const year = now.getFullYear();
  const { primary, extension } = IRS_DEADLINE_ADJUSTED(year);

  if (now > extension) {
    container.className = 'clock-pastdue';
    container.innerHTML = `
      <p><strong>The filing deadline for ${year} has passed.</strong></p>
      <p>Late filing penalties may apply. File now to limit exposure. Adding a Reasonable Cause Letter gives you the best chance at penalty abatement.</p>
      <div class="clock-actions">
        <a href="/past-filings.html" class="btn btn-error">Fix a Missed Year</a>
        <a href="/check.html" class="btn btn-primary">Start My Filing</a>
      </div>`;
    return;
  }

  let target = primary;
  let label = 'Next IRS Filing Deadline (Form 5472):';
  let sublabel = '';

  if (now > primary) {
    target = extension;
    label = 'Original deadline passed.';
    sublabel = 'File with Form 7004 to get until October 15:';
  }

  const diff = target - now;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / 1000 / 60) % 60);

  container.className = 'clock-active';
  container.innerHTML = `
    <p class="clock-label">${label}</p>
    ${sublabel ? `<p class="clock-sublabel">${sublabel}</p>` : ''}
    <div class="clock-units">
      <div class="clock-unit"><span class="clock-num">${days}</span><span class="clock-tag">days</span></div>
      <div class="clock-unit"><span class="clock-num">${hours}</span><span class="clock-tag">hrs</span></div>
      <div class="clock-unit"><span class="clock-num">${mins}</span><span class="clock-tag">min</span></div>
    </div>`;
};

setInterval(runClock, 60000);
runClock();
```

Style `#irs-clock`:
- `.clock-active`: `background: #0F172A`, white text, padded band, clock units centered
- `.clock-pastdue`: `background: #DC2626`, white text, same padding
- `.clock-num`: `font-size: clamp(2rem, 5vw, 3.5rem)`, `font-weight: 700`
- `.clock-tag`: `font-size: 0.75rem`, `font-weight: 600`, uppercase, `color: #94A3B8`

***

**index.html -- HOMEPAGE**

`<title>TaxFile.io -- Form 5472 Filing for Foreign-Owned U.S. LLCs</title>`

Include two hero variants as HTML comments immediately before the live hero block:
```html
<!--
HERO VARIANT A (risk-first):
<h1>Avoid the $25,000 IRS penalty. File Form 5472 correctly.</h1>

HERO VARIANT B (clarity-first):
<h1>If you own a U.S. LLC as a non-U.S. resident, you are required to file Form 5472.</h1>
-->
```

**Hero section (centered, `--color-bg` background):**
h1: "File Form 5472 and Pro Forma 1120 in minutes, not weeks"
p: "The only platform built specifically for foreign-owned U.S. LLCs. CPA-reviewed. Pay per filing. Start without an account."
Two CTAs: "Start My Filing" (solid `#0284C7`, links to check.html) and "See Pricing" (ghost, links to pricing.html)
Microcopy below both CTAs: "Start without an account. Takes about 10 minutes."
IRS Deadline Clock `<div id="irs-clock">` directly below microcopy

**Why TaxFile.io Exists (`--color-surface` background):**
h2: "Built because this problem kept appearing"
p: "Most foreign founders discover this requirement only after penalties have already started -- often when opening a U.S. bank account, applying for a visa, or preparing to exit. This platform was built by a licensed CPA after seeing repeated $25,000 penalty cases among foreign founders. The goal is simple: make the correct filing accessible, accurate, and fast, without requiring a full CPA engagement."
Muted trust line below: "Forms generated based strictly on IRS instructions (Rev. December 2024). Designed specifically for non-U.S. founders with U.S. LLCs."

**What You Receive (`--color-bg` background):**
h2: "What you receive"
Bullet list, no icons:
- Print-ready Form 5472 and Pro Forma 1120
- Structured exactly as required by the IRS
- Ready to mail or fax immediately
- Includes all required schedules and disclosures
Muted line below: "You review everything before downloading your forms."

**How It Works (`--color-surface` background):**
Intro line: "The process is designed to be fast and straightforward."
4-step horizontal flow on desktop, vertical on mobile:
1. Answer 5 eligibility questions
2. Enter your LLC details and transactions
3. Review your complete filing summary
4. Download IRS-ready forms
No icons in colored circles.

**Services overview (asymmetric layout):**
Large card: Form 5472 + Pro Forma 1120 Filing -- $150 -- "One Filing. Two Forms. One Price." -- microcopy: "One-time filing. No ongoing fees." -- CTA links to check.html
Medium card: Past Year Filing + Reasonable Cause Letter -- from $350 -- "Recommended for Late Filers" badge -- CTA links to past-filings.html
Small card: LLC Tax Classification Change -- $50 -- "One-time filing. No ongoing fees." -- CTA links to portal.html directly
Small card: IRS Fax Submission -- +$30 add-on -- CTA links to portal.html directly

Note on services section: Form 7004, IRS fax submission, LLC classification change, and reasonable cause letter services link directly to portal.html. Only Form 5472 filing CTAs route through check.html.

**Trust signals strip (`#0F172A` background, white text, pill items):**
- "CPA-reviewed process"
- "Pay-per-filing. No subscription."
- "Start without an account."
- "Used by founders from India, UK, UAE, Singapore, and Canada"
- "IRS penalty starts at $25,000 per missed form, per year"

**Urgency band (`#DC2626` background, white text):**
"Most foreign founders discover this requirement only after penalties have already started."
Subline: "Every unfiled year risks a $25,000 IRS penalty. Each year you wait adds another."
CTA (white bg, `#DC2626` text): "Fix a Missed Year" -- links to past-filings.html

**Contact section (`--color-surface` background):**
h2: "Have a question before you start? We are here."
`<a href="mailto:hello@taxfile.io">hello@taxfile.io</a>`
"We respond within 1 business day."

***

**pricing.html -- PRICING**

`<title>Pricing -- TaxFile.io</title>`

IRS Deadline Clock at top of main content.

h1: "Simple, per-filing pricing. No subscriptions."
Subline: "Pay only for what you file. Start without an account."

Six pricing cards:

1. **Form 5472 + Pro Forma 1120 -- Current Year** / $150
One filing year. Print-ready PDF. Ready to mail or fax.
Microcopy: "One-time filing. No ongoing fees."
Tooltip: "One Filing. Two Forms. One Price. The IRS requires these to be filed together -- you are not paying for extras."
CTA: "Start My Filing" -- links to check.html

2. **Form 5472 + Pro Forma 1120 -- Past Year** / $150 per year
Any prior unfiled year. Same output as current year.
Microcopy: "One-time filing. No ongoing fees."
CTA: "Start My Filing" -- links to check.html

3. **Add-On: CPA-Prepared Reasonable Cause Letter** / +$200 per year
Added to any past-year filing. Badge: "Recommended for Late Filers."
Total with past-year filing: $350 per year.
CTA: links to portal.html directly

4. **Add-On: IRS Fax Submission** / +$30
IRS processes faxed forms significantly faster than mailed ones. Digital confirmation receipt included.
Note: not available for Form 8832.
CTA: links to portal.html directly

5. **LLC Tax Classification Change** / $50 per filing
Standalone. Form 8832 or Form 2553. Print-ready PDF. Must be mailed -- fax add-on not available.
Microcopy: "One-time filing. No ongoing fees."
CTA: links to portal.html directly

6. **Multi-Year Past Filing Package** / Custom pricing
3 or more unfiled years. Contact via portal. Reasonable cause letter available per year.
CTA: links to portal.html directly

Below grid:
"No payment until you are ready to generate your filing."
"All prices in USD. Pay per filing. No subscription."

***

**services.html -- SERVICES**

`<title>Services -- TaxFile.io</title>`

Trust line below page h1 (muted):
"Built by a licensed CPA after seeing repeated $25,000 penalty cases among foreign founders. Forms generated based strictly on IRS instructions (Rev. December 2024)."

**Section 1: Form 5472 + Pro Forma 1120 Filing**
Callout box: "One Filing. Two Forms. One Price. The IRS requires Form 5472 to be attached to a Pro Forma 1120. They cannot be filed separately."
Who needs it, reportable transactions definition, penalty stakes, output description.
Transaction entry: Plaid (optional) or manual entry.
Microcopy: "Manual entry available. No bank login required."

"What you receive" block:
- Print-ready Form 5472 and Pro Forma 1120
- Structured exactly as required by the IRS
- Ready to mail or fax immediately
- Includes all required schedules and disclosures
Muted: "You review everything before downloading your forms."

"What your output looks like":
Three blurred/watermarked preview images:
1. Form 5472 first page -- source: https://www.irs.gov/pub/irs-pdf/f5472.pdf (public domain)
2. Pro Forma 1120 header
3. Sample Reasonable Cause Letter (first paragraph visible, rest blurred)
Caption: "Delivered as a print-ready PDF. Download, sign where required, and mail or fax to the IRS."

CTA: "Check My Eligibility" -- links to check.html

**Section 2: LLC Tax Classification Change**
Form 8832 and Form 2553. Who needs it, when to file, what changes, output. Standalone service. Must be mailed.
Microcopy: "One-time filing. No ongoing fees."
CTA: links to portal.html directly

**Section 3: IRS Fax Submission**
What it is, why fax is faster, what confirmation receipt provides. Add-on to Form 5472 filings only. Not available for Form 8832.
CTA: links to portal.html directly

**Section 4: Coming Soon**
- Form 7004 (automatic 6-month extension)
- FBAR / FinCEN 114 reporting
- Annual report for Delaware
- Annual reports for Wyoming and New Mexico

***

**past-filings.html -- PAST FILINGS AND REASONABLE CAUSE**

`<title>Missed Form 5472 Filing -- Fix It Now | TaxFile.io</title>`

h1: "Most foreign founders discover this requirement only after penalties have already started."

Opening paragraph: many foreign LLC owners discover the Form 5472 requirement years after forming their LLC -- often when opening a U.S. bank account, applying for an L-1 or O-1 visa, or preparing to sell or exit the business. By then, the IRS penalty clock has already been running.

**Penalty Risk Scale:**
Horizontal bar, full content-column width.
CSS gradient left to right: `#64748B` through `#0284C7` to `#DC2626`
Five labeled tick marks below bar: $25,000 / $50,000 / $75,000 / $100,000 / $150,000+
Annotations: "1 LLC, 1 year = $25,000" at left. "2 LLCs, 3 years = $150,000+" at right.
Caption: "Two LLCs, three unfiled years = $150,000 in potential penalties. Our $350 total solution covers one year completely."

**Reasonable Cause Letter section:**
What it is, what it does, why CPA-prepared carries more weight.

**Pricing block:**
$150 -- Past Year Form 5472 + Pro Forma 1120
+$200 -- CPA-Prepared Reasonable Cause Letter
= $350 total per year
Microcopy: "One-time cost. No subscription."

Note in `#DC2626`: "The longer you wait, the harder it gets to argue reasonable cause. File now."

CTA: "Fix a Missed Year" -- links to check.html
Microcopy below CTA: "Start without an account. Takes about 10 minutes."

***

**check.html -- ELIGIBILITY CHECK**

`<title>Check Your Filing Eligibility -- TaxFile.io</title>`

This page sits between all Form 5472 filing CTAs and the portal. Form 7004, IRS fax submission, LLC classification change, and reasonable cause letter services bypass this page and link directly to portal.html.

Multi-step form built entirely in JavaScript with no backend. No data stored or transmitted. All state lives in JS variables only. Progress indicator at top showing step X of 5. Back button on every step except Step 1. Single column, centered, max-width 560px.

Heading: "Before you begin, let us confirm this is the right fit."
Subline: "This takes about 2 minutes. Your answers stay in your browser and are never stored."

**Step 1 -- Entity type:**
"What type of U.S. entity do you own?"
- Single-member LLC (I am the only owner) -- advance to Step 2
- Multi-member LLC (2 or more owners) -- REFER outcome
- C-Corporation -- REFER outcome
- I am not sure -- REFER outcome

**Step 2 -- Ownership percentage:**
"What percentage of this LLC do you own?"
- 100% -- advance to Step 3
- 25% to 99% -- advance to Step 3
- Less than 25% -- show note: "Owners below 25% may not trigger the Form 5472 filing requirement. We recommend confirming with a CPA before filing." Two options: "Check with TaxClaim.co" (links to taxclaim.co, new tab) and "I am above 25%, continue anyway" (advances to Step 3)
- I am not sure -- same note as above

**Step 3 -- Filing years:**
"Which tax year or years are you filing for?"
- Current year only -- advance to Step 4
- 1 prior year -- advance to Step 4
- 2 prior years -- advance to Step 4
- 3 or more prior years -- soft flag: "For 3 or more unfiled years, a CPA review is recommended to build the strongest reasonable cause argument. You can still proceed, or get professional help." Two options: "Get help from TaxClaim.co" (new tab) and "Continue on my own" (advances to Step 4)

**Step 4 -- Transaction complexity:**
"During the tax year, did your LLC have any of the following? Select all that apply."
Checkboxes:
- Sales of goods or services between the LLC and a foreign related party
- Real estate purchase, sale, or rental involving a foreign related party
- Royalties, licensing fees, or IP transfers
- Physical goods manufactured, imported, or exported
- None of the above -- only capital contributions, distributions, loans, or simple payments

If only "None of the above" selected -- advance to Step 5
If any complex item selected -- REFER outcome: "Your transactions involve areas that may require transfer pricing analysis or additional IRS schedules. This goes beyond what this platform covers."

**Step 5 -- Operations:**
"Does your LLC have any of the following? Select all that apply."
Checkboxes:
- U.S. employees or payroll
- Sales tax obligations in any U.S. state
- Physical inventory or warehouse in the U.S.
- None of the above

If only "None of the above" -- PASS outcome
If any item selected -- soft flag: "Your LLC may have additional compliance obligations beyond Form 5472. You can still proceed with this filing, but consider a CPA review for the complete picture." Two options: "Continue" (PASS outcome) and "Get help from TaxClaim.co" (new tab)

**PASS outcome:**
Heading: "Your filing looks straightforward."
Subline: "Based on your answers, you can complete this yourself using TaxFile.io."
Summary of what will be filed: Form 5472 + Pro Forma 1120
Estimated time: about 10 minutes
CTA: "Create Your Free Account to Begin" -- links to `[PORTAL_URL]` with check answers passed as URL query parameters where possible
Microcopy: "Your account saves your progress and is used to generate your final forms. No payment until you are ready to download."

**REFER outcome:**
Heading: "Your situation may need professional review."
Subline: "Based on your answers, a CPA should review your filing before it is submitted."
1-2 sentence explanation specific to the disqualifying answer.
Primary CTA: "Get Help from TaxClaim.co" -- links to taxclaim.co, `target="_blank"`
Secondary option (ghost button): "I understand -- I still want to proceed on my own"
If secondary chosen: show disclaimer "By continuing, you acknowledge that TaxFile.io generates forms based on your inputs and does not review your situation for accuracy or completeness." Confirm button then links to `[PORTAL_URL]`.

**Design rules for check.html:**
- One question per screen, JS-driven transitions
- Minimal dot or line step indicator, no step numbers
- No sidebar, no nav clutter, no distractions
- REFER outcome: `#DC2626` used only on the heading, not the full page background
- All answer options are large, easy tap targets (minimum 44px height)

***

**portal.html -- START FILING**

`<title>Start Your Filing -- TaxFile.io</title>`

Minimal, focused. One purpose only. Users arriving here have either passed check.html or are filing a non-Form-5472 service.

h1: "You are one step away from a filed form."

**How It Works (4-step flow above checklist):**
"The process is designed to be fast and straightforward."
1. Enter your LLC details
2. Enter or import your transactions
3. Review your filing summary
4. Download IRS-ready forms

**What you will need checklist:**
- Your LLC's EIN (Employer Identification Number)
- The tax year you are filing for
- Owner details: full legal name, country of residence, passport number
- Bank transaction details for the filing year
- Microcopy: "No bank login required. Manual entry available. Plaid connection is optional and can be skipped."
- Details of any capital contributions, distributions, loans, or payments between you and the LLC during the year

Risk reversal line above CTA (muted): "You review everything before downloading your forms. No payment until you are ready to generate your filing."

Large primary CTA: "Go to Filing Portal"
Link: `[PORTAL_URL]` with `target="_blank" rel="noopener noreferrer"`
Microcopy below button: "Opens secure filing portal in a new tab. Create your free account inside the portal to save progress and generate forms."

Secondary line: "Questions first? Email us at hello@taxfile.io"

***

**resources.html -- RESOURCES**

`<title>Resources -- TaxFile.io</title>`

Include in `<head>` Schema.org FAQPage JSON-LD:

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is Form 5472 and who needs to file it?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Form 5472 is an IRS information return required for any U.S. corporation or foreign-owned disregarded entity that had reportable transactions with a foreign related party. Any single-member LLC owned 25% or more by a non-U.S. person must file Form 5472 annually, even if the LLC had no revenue."
      }
    },
    {
      "@type": "Question",
      "name": "What is the penalty for missing Form 5472?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The IRS imposes an automatic $25,000 penalty for each failure to file or maintain required records for Form 5472. This penalty applies per form, per tax year. A company with two reportable foreign relationships missing three years of filings could face $150,000 in penalties."
      }
    },
    {
      "@type": "Question",
      "name": "Why are Form 5472 and Pro Forma 1120 always filed together?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "A foreign-owned single-member LLC is a disregarded entity not otherwise required to file a corporate return. The IRS requires it to file a Pro Forma 1120 solely as a transmittal document for Form 5472. They cannot be filed separately -- Form 5472 must be attached to the Pro Forma 1120."
      }
    },
    {
      "@type": "Question",
      "name": "Which state is best for a foreign-owned LLC: Delaware, Wyoming, or New Mexico?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Delaware is best for founders who plan to raise venture capital or need a well-established legal framework. Wyoming offers low fees and strong privacy protections. New Mexico is the most affordable option with no annual report requirement, making it popular for foreign founders seeking a low-maintenance structure."
      }
    },
    {
      "@type": "Question",
      "name": "What is a reasonable cause letter and can it waive an IRS penalty?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "A reasonable cause letter is a written argument submitted to the IRS alongside a late filing, requesting that the automatic $25,000 Form 5472 penalty be waived. The IRS may grant relief if the failure to file was due to reasonable cause and not willful neglect. A CPA-prepared letter is significantly more effective than a self-written one."
      }
    },
    {
      "@type": "Question",
      "name": "How do I file Form 5472 if I missed prior years?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "File the past-year Form 5472 and Pro Forma 1120 as soon as possible, along with a reasonable cause letter requesting penalty abatement. The IRS processes late filings and may waive penalties if the filing is accompanied by a credible explanation. Waiting longer weakens your reasonable cause argument."
      }
    },
    {
      "@type": "Question",
      "name": "What is the difference between Form 8832 and Form 2553?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Form 8832 is used to change how the IRS classifies your LLC for tax purposes -- for example, electing to be treated as a C-Corporation instead of a disregarded entity. Form 2553 is used specifically to elect S-Corporation status. Both forms change the LLC's tax treatment but are used in different situations and have different eligibility requirements."
      }
    },
    {
      "@type": "Question",
      "name": "What do foreign founders most commonly get wrong about U.S. tax compliance?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The most common mistake is assuming that a U.S. LLC with no revenue has no filing obligations. Foreign-owned disregarded LLCs must file Form 5472 and Pro Forma 1120 every year, regardless of activity. Formation itself is often considered a reportable transaction. Many founders only discover this years later when penalties have already accumulated."
      }
    }
  ]
}
```

Category filter tabs: All / Form 5472 Basics / Penalty and Compliance / Entity Formation / Past Filing Help

8 post cards in a responsive grid. Each card: title, category badge, date, 1-sentence excerpt, "Read More" link.

1. "What Is Form 5472 and Who Needs to File It?" -- April 3, 2026 -- Form 5472 Basics -- resources/what-is-form-5472.html
2. "The $25,000 Penalty for Missing Form 5472: What Foreign LLC Owners Must Know" -- April 6, 2026 -- Penalty and Compliance -- resources/25000-penalty-form-5472.html
3. "Form 5472 and Pro Forma 1120: Why They Are Always Filed Together" -- April 10, 2026 -- Form 5472 Basics -- resources/form-5472-pro-forma-1120-together.html
4. "Delaware vs Wyoming vs New Mexico: Which State Is Best for a Foreign-Owned LLC?" -- April 13, 2026 -- Entity Formation -- resources/delaware-wyoming-new-mexico-llc.html
5. "What Is a Reasonable Cause Letter and Can It Waive My IRS Penalty?" -- April 17, 2026 -- Past Filing Help -- resources/reasonable-cause-letter-irs-penalty.html
6. "How to File Form 5472 If You Missed Prior Years" -- April 20, 2026 -- Past Filing Help -- resources/file-form-5472-missed-prior-years.html
7. "Form 8832 vs Form 2553: Which LLC Classification Change Is Right for You?" -- April 24, 2026 -- Entity Formation -- resources/form-8832-vs-form-2553.html
8. "What Foreign Founders Get Wrong About U.S. Tax Compliance in Their First Year" -- April 27, 2026 -- Penalty and Compliance -- resources/foreign-founders-us-tax-mistakes.html

***

**resources/[slug].html -- STUB ARTICLE PAGES**

Each page `<head>` includes:
- Schema.org Question JSON-LD with matching Short Answer
- Canonical URL

Structure:
- Breadcrumb: Home / Resources / [Post Title]
- h1: post title
- Date and category badge
- "Short Answer" box: bordered blockquote, `#F8FAFC` background, `#0284C7` left border 3px, 2-3 sentence answer
- 4-5 paragraphs of accurate body content
- Minimum 2 internal links: one to pricing.html, one to services.html or past-filings.html
- CTA: "Ready to file? Start now." -- links to check.html for Form 5472 topics, portal.html for other topics
- Microcopy below CTA: "Start without an account. Takes about 10 minutes."
- Back link: "Back to Resources" -- links to resources.html

***

**faq.html -- FAQ**

`<title>Frequently Asked Questions -- TaxFile.io</title>`

FAQPage Schema.org JSON-LD in `<head>` covering all 12 questions.

`<details>` and `<summary>` accordion. Open state: `#0284C7` left border on answer panel.

12 questions with real, accurate answers:

1. What is Form 5472 and who needs to file it?
2. Does a dormant LLC with no revenue need to file Form 5472?
3. What counts as a reportable transaction for Form 5472?
4. What is the penalty for not filing Form 5472?
5. What is a Pro Forma 1120 and why is it always filed with Form 5472?
6. What is the filing deadline for Form 5472?
7. Can I get an extension for Form 5472?
8. What happens if I missed filing Form 5472 in prior years?
9. What is a reasonable cause letter and does it actually work?
10. What is Form 8832 and when do I need it?
11. Is my transaction data safe? Do you store my bank information?
12. Do I need to create an account to use TaxFile.io?

***

**COPY RULES**

- No em dashes. Use commas, periods, or line breaks.
- No "unlock", "empower", "seamless", "all-in-one", "game-changer"
- No fake countdown timers for non-IRS deadlines
- No subscription language anywhere
- All prices in USD
- CTA copy: "Start My Filing" / "Fix a Missed Year" / "Check My Eligibility" / "Go to Filing Portal" / "Create Your Free Account to Begin" -- never "Submit", "Continue", or "Click Here"
- Urgency must be factual -- no exaggeration, no panic-baiting
- Use exact phrase where discovery message appears: "Most foreign founders discover this requirement only after penalties have already started."

***

**ACCESSIBILITY**

- One `<h1>` per page, heading hierarchy never skips levels
- Every `<img>` has descriptive `alt` text
- Every icon-only button has `aria-label`
- All interactive elements reachable by keyboard
- Focus ring: `outline: 2px solid #0284C7; outline-offset: 3px`
- All body text meets WCAG AA (4.5:1 minimum)
- `prefers-reduced-motion`: wrap all transitions in `@media (prefers-reduced-motion: no-preference)`

***

This is the complete specification. Build all files now.

Sources
