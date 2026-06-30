# Premium feature roadmap — to make FileTax the most premium 5472 filer

Competitive read of 5472direct.com (the premium benchmark) and Filabl, mapped
to what we already have and what would move us ahead. **Report only — nothing
here is built yet; pick what you want and I'll implement.**

Where we already lead: per-party 5472s, correct IRS totals (1f/1h), multi-year
catch-up with one shared RCL, fiscal/final year, payment-integrity lock,
two-tier plain-English transaction entry + reconciling buckets, dark mode,
deadline-aware dashboard, and now Form 7004. Three gaps separate us from
"premium". In priority order:

---

## 1. IRS Direct Delivery (fax submission + timestamped receipt)  ← highest impact

**What they do:** 5472direct sells "IRS Direct Delivery" for $49 — they fax the
completed package to the IRS and return a timestamped transmission receipt as
proof of filing. It's their main paid add-on and a big trust/convenience lever
(the customer never has to print + mail).

**Where we are:** we generate a print-ready package and tell the user to mail it.
The schema already has `include_irs_fax` and `filing_jobs.delivery = 'fax'`; the
end-to-end logic doc fully specifies the fax flow (Ogden PIN unit cover sheet,
transmission ID/timestamp storage, retry, status). Nothing is wired.

**To build:** a pay-per-use fax API (Telnyx/Phaxio/Documo — no monthly minimum),
an edge function that builds the fax cover sheet + dispatches the package,
stores transmission ID + timestamp, and shows the receipt on the confirmation
screen. Price it as a $39–49 add-on.

**Effort:** medium-high (external API + edge function + a delivery/status UI).
**Why premium:** proof-of-submission is the single most reassuring thing for a
late filer staring at a $25k penalty.

---

## 2. Bank-statement / CSV transaction import  ← biggest UX differentiator

**What they do:** 5472direct uses Plaid (bank link) + CSV upload to auto-map
transactions; Filabl uploads a bank statement and auto-classifies. Removes the
hardest manual step. 5472direct markets it as "rules-based, no black-box AI".

**Where we are:** manual entry only (now nicely simplified to the two-tier
step). The schema reserves `ingestion_source = manual | bank_statement`.

**To build (phased):**
- Phase 1 (cheap): **CSV upload** → map columns → pre-fill the transaction list
  for the user to confirm. No third party.
- Phase 2: **Plaid link** (or statement-parse) → auto-classify into our existing
  canonical types via deterministic rules (amount sign + counterparty), shown
  for review. Keep it rules-based and transparent — match their "no black-box"
  trust message.

**Effort:** CSV = medium; Plaid = high (vendor, OAuth, security review).
**Why premium:** turns a 20-minute data-entry chore into a review.

---

## 3. Pre-payment screener + watermarked form preview  ← conversion + trust, low cost

**What they do:** 5472direct's "intelligent screener" stops complex/unsupported
cases *before* payment; both competitors show the prepared output before pay.

**Where we are:** we have the eligibility checker (refers out multi-member /
no-EIN / fiscal etc.) and tier-3 "CPA recommended" flags — most of the screener
already exists. We do NOT show a form preview before payment, though the
generator can already render the filled forms; the logic doc explicitly calls
for a **watermarked preview before payment**.

**To build:**
- **Watermarked preview:** render the real filled 5472 + 1120 with a "PREVIEW —
  full forms after payment" watermark on the review step. The generator is done;
  this is ~a watermark overlay + a preview view. Low effort, high conversion lever.
- **Screener polish:** surface a single "here's what we'll prepare / here's what
  needs a CPA" summary before checkout, reusing eligibility + tier-3 data.

**Effort:** low-medium. **Why premium:** "see exactly what you're buying" closes
hesitant late filers; costs little since the data is already assembled.

---

## Trust layer (cheap wins, any time)
Not asked to detail, but noted from 5472direct for when you want them:
Trustpilot/social proof placement, an explicit accuracy/"prepared per IRS
Instructions for Form 5472 (Rev. 12-2024)" statement, security/encryption note,
1-business-day support promise, founder/origin story. All copy + placement, no
engineering.

## Suggested sequence
1. **Watermarked preview** (fast, conversion) →
2. **CSV import** (UX leap, no vendor) →
3. **IRS Direct Delivery / fax** (premium add-on, revenue) →
4. **Plaid** (only if CSV demand proves it out).
