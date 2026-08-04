# Form 5472 filing - failure scenarios to test manually

Written 2 August 2026, from a read of the code at `5e095ed` plus the uncommitted typed-signature
work. Nothing here was executed; every item is a hypothesis derived from reading, with the file and
line that produced it, so each one can be confirmed or killed in one pass through the wizard.

Ordered by how badly it fails, not by how likely it is. **A** = wrong data reaches the IRS silently.
**B** = filer is blocked and cannot file. **C** = cosmetic or recoverable.

Already known and covered elsewhere: the four defects in `E2E-100-HANDOFF.md` §4. Three were fixed in
`5e095ed`; #5 (scenario 17 silent submit) is still open and is not repeated here.

---

## STATUS: five of these are now fixed - re-test them, do not re-find them

Fixed after this document was written. Each still needs the manual pass described below, but now to
CONFIRM the fix rather than to discover the bug. Everything not listed here is untouched and stands
exactly as written.

| Item | What changed |
|---|---|
| **B1** countries | 41 territories added (Cayman, BVI, Bermuda, Anguilla, Turks and Caicos, Jersey, Guernsey, Isle of Man, Gibraltar, Côte d'Ivoire, …), list re-sorted, and an **"Other, not listed" free-text escape** added so a gap can never block a filer again. `NO_POSTAL_CODE_COUNTRIES` re-keyed to the dropdown's own names and matched diacritic-insensitively, which fixes both Congos. **US territories were deliberately EXCLUDED** - a Puerto Rico / Guam / USVI / CNMI / American Samoa resident is a US person under §7701(a)(30), so the LLC is not foreign-owned and no 5472 is due on that basis; offering them would invite a return that should not exist |
| **A1** 1f/1h | `grossPaymentsForLines1f1h` now takes `isOwner` and excludes Part V / Part VI amounts from a non-owner's line 1f and from 1h. Intake additionally **refuses** to attach an owner-only transaction type to an additional related party, so the amount is reassigned rather than dropped |
| **A2** multi-year encoding | Both download paths now call one shared `refuseUnsupportedText()`. The multi-year builder sets the sink it never set, so it can actually report. Bundle order also corrected to **oldest year first**, matching `taxYears` and the filename |
| **A3 / A4** due dates | `FILING_DUE_DATES` replaced by `filingDueDates(periodEndISO)`: 15th day of the 4th month after the period ends, +6 months with a 7004. `getFilingTimingStatus` now takes the period end, so a fiscal filer is measured against their own deadline. No year can fall off the end and be declared on time for ever |
| **C1** typed signature | Committed at `a0f40e7`, with `scripts/verifyTypedSignature.mjs`. The table in §C1 is still the right test list |

Regression coverage added: `npm run verify:logic` asserts the due dates (all seven calendar years
reproduce the old table exactly, plus three fiscal cases), and `npm run verify:pdf` asserts the
owner-only 1f/1h gate. `npm test` is green.

Weekends and federal holidays are deliberately NOT modelled in the due dates - see the comment on
`filingDueDates`. It errs a day or two early in calling a return late, which is the safe direction.

---

## A. Silently wrong output

### A1. Non-owner related party with a Part V or Part VI transaction - amount vanishes
**Severity: A. Highest confidence item in this document.**

`pdfGenerator.ts:2219-2222` builds the Part V and Part VI statements for `party.is_owner` only, and
`fill5472` (`:1610`, `:1637`) gates both checkboxes the same way. But `aggregateTransactions`
(`:497-521`) buckets `distribution`, `dividend`, `capital_contribution`, `formation_costs`,
`property_transfer` and `nonmonetary_other` into `distributions_paid` / `contributions_received` /
`formation_costs_paid` / `part_vi_amount` - none of which are Part IV lines.

So for a **non-owner** party carrying one of those six types:
- it appears on no Part IV line (9–36),
- it gets no Part V/VI checkbox,
- it gets no statement,
- but `grossPaymentsForLines1f1h` (`:570`) **does** add it to that party's line 1f and to line 1h.

Result: a 5472 whose line 1f is larger than line 22 + line 36 with nothing on the form accounting
for the difference. That is exactly the shape an IRS reviewer questions.

**Repro.** Two related parties. Add a `distribution` (or `property_transfer`) of $50,000 and assign
it to related party #2, not the owner. Generate.
**Check.** Party #2's 5472: is line 1f $50,000 while Part IV is blank and Part V/VI unticked?
**Also worth deciding:** should intake refuse to attach these six types to a non-owner at all? That
may be the real fix rather than printing them.

### A2. Multi-year download never checks `unsupportedText`
**Severity: A.**

`FilingWizard.tsx:130` hard-refuses a single-year package containing characters WinAnsi cannot
encode. `handleGenerateJob` (`:183-242`), the multi-year path, has **no equivalent check** - it goes
straight from `generateMultiYearPackage` to `triggerDownload`.

So the exact filer the single-year path protects (Cyrillic, CJK, Greek, Arabic, Devanagari legal
name) gets a catch-up package with characters silently stripped out of their legal name on every
year's return. `toFormText` drops them and moves on (`pdfGenerator.ts:147`).

**Repro.** Owner name `Иван Петров`. Start a multi-year catch-up job. Complete year one.
`Download all-in-one PDF`.
**Check.** Does it download instead of erroring? Open it - is the name blank or partial on the 5472
Part II box?
**Contrast.** Do the same on a single-year filing: it should refuse with the "Latin characters only"
message. If the single-year refuses and the multi-year downloads, confirmed.

### A3. Fiscal-year filers are judged against the calendar due date
**Severity: A (drives whether the reasonable cause letter is offered at all).**

`FILING_DUE_DATES` (`constants.ts:18`) is keyed on tax year alone and hardcodes April 15 / October
15. `getFilingTimingStatus` (`Intake.tsx:258`) looks up that table with the tax year only, ignoring
`fiscalEndMonth` entirely. But a fiscal-year filer's return is due the 15th day of the fourth month
after the period ends.

Tax year 2025 with a March year-end runs 2025-04-01 → 2026-03-31 and is due 2026-07-15. Today
(2 Aug 2026) that is **late**. The app compares against 2026-04-15/2026-10-15 and reports
`within_extension`, so **step 1b never appears** and no reasonable cause letter is offered to a filer
who needs one.

The mirror case is worse in the other direction: tax year 2025 with a June year-end runs to
2026-06-30, due 2026-10-15 - genuinely on time - and the app agrees, but only by coincidence.

**Repro.** Tax year 2025, tick "My tax year is not the calendar year", year-end month = March.
**Check.** Does step 1b (Filing Status / reasonable cause) appear? It should. Repeat with December
and compare.

### A4. `getFilingTimingStatus` returns `on_time` for any year not in the table
**Severity: A, latent.**

`Intake.tsx:264`: `if (!dates) return { status: 'on_time', ... }`. The table stops at 2025. The
moment 2026 is added to `TAX_YEARS` without a matching `FILING_DUE_DATES` row, every 2026 filing is
declared on time forever - no lateness warning, no 1b, no RCL. There is no fallback rule and nothing
fails loudly.

**Repro.** Add `2026` to `TAX_YEARS` in `constants.ts` only, reload, pick 2026.
**Check.** Does it claim on-time?
**Suggested fix regardless of test result:** derive the dates (April 15 of Y+1 / October 15 of Y+1,
adjusted for weekends) rather than tabulating them, or throw when a year is missing.

### A5. `setText` swallows every missing field - the 2019–2021 revision has no positive coverage
**Severity: A.**

`pdfGenerator.ts:162-187` catches and ignores "field not present in this revision". That is
deliberate and correct for genuinely absent fields, but it means **any** field-name drift between
`form5472Fields.ts` and a template writes nothing and says nothing.

The 2019–2021 template (`Form-5472-2019-2021.pdf`) is the one where the loan-guarantee-fee defect
already lived, and per the E2E handoff §4 it currently has **zero passing scenarios** - 8, 9 and 10
were all blocked on bad scenario data and never re-run. Same exposure, to a lesser degree, on the
2022 and 2023 templates.

**Repro.** One full filing per tax year 2019, 2020, 2021, 2022, 2023, 2024, 2025 with identical data
(every Part IV line non-zero, both loan types with beginning balances, a loan guarantee fee both
directions).
**Check.** Lay the seven 5472s side by side. Every line that is populated on the 2024 form must be
populated on all of them, except line 20/34 on 2019–2021 which should instead be folded into 21/35
(`:1568-1575`). Any other blank is a silently dropped field.

### A6. Fixed 8pt in AcroForm boxes - long values clip with no warning
**Severity: A.**

`setText` forces `FORM_FIELD_FONT_SIZE = 8` on every field (`:170`), overriding the template's
auto-size. `buildNameAndAddress` (`:271`) then packs name **and** the full address into one field:
`"Name - Street, City, ST  ZIP, Country"`. AcroForm text fields clip at the box edge; nothing
measures the string, and nothing reports an overflow the way `unsupportedText` reports encoding loss.

**Repro.** Owner legal name at realistic maximum (~70 chars), street ~60 chars, long city, long
country - e.g. `Muhammad Abdul Rahman bin Abdullah Al-Sabah Trading Holdings Limited` at
`Unit 4512, Tower B, International Business Financial Centre, Sheikh Zayed Road`,
`Dubai`, `United Arab Emirates`. Do the same for the LLC name and the related-party name.
**Check.** Part II and Part III boxes on the generated 5472 - is the country (the last element) still
visible? Where does it cut off?
**Note.** The fax path makes this worse: a clipped address on a faxed return cannot be corrected by
the reviewer.

### A7. Transaction direction defaults inconsistently
**Severity: A, low likelihood, cheap to test.**

`aggregateTransactions` (`:457-508`) tests direction two different ways:
- `sales`, `tangible_property`, `intangible`, `service_payment`, `commission`, `rent`, `royalty`:
  `dir === 'received' ? received : paid` → an absent/garbage direction lands in **paid**.
- `interest`, `insurance`, `loan_guarantee`, `other`: `dir === 'paid' ? paid : received` → an
  absent/garbage direction lands in **received**.

If `direction` can ever be null (an older row, a partially-saved draft, a scenario loader), the same
missing value pushes some amounts to Part IV received and others to Part IV paid.

**Repro.** Via `window.__supabase` in dev, null out `direction` on two saved rows - one `sales`, one
`interest` - then regenerate.
**Check.** Does sales land on line 23 (paid) and interest on line 18 (received)?

### A8. Transaction orphaned to a deleted party silently becomes the owner's
**Severity: A.**

`pdfGenerator.ts:2191`: `const idx = tx.related_party_index ?? 0;` - and index 0 is the owner. Intake
validates this at `Intake.tsx:1649` ("attached to a related party that no longer exists"), so the
supported path is guarded. But anything that reaches the generator without passing that validation -
a resumed draft, a multi-year sibling year, direct generation from the wizard - reassigns the
transaction to the owner's 5472 without a word.

**Repro.** Add a related party, add a $100,000 transaction against them, save, then delete the
related party. Try to continue (should be blocked). Then navigate straight to `/filing/<id>` and
click Generate, bypassing intake validation.
**Check.** Does the $100,000 appear on the owner's 5472?

### A9. `initial_return = false` on an entity formed in-period prints a period predating the entity
**Severity: A, edge.**

`resolvePeriod` (`:320`): `const isInitial = filing.initial_return ?? incorpInPeriod;` - a stored
`false` beats the derived truth. `beginISO` (`:325`) then stays at January 1, so an LLC formed
2025-07-01 prints a period beginning 2025-01-01 on the 5472 header, the 1120 header and the 7004.

**Repro.** Formation date inside the tax year, then get `initial_return` written as `false` (check
whether unticking any related control does this - worth finding out how it can be set at all).
**Check.** The period on all three forms.

### A10. `isInitialReturn` ignores the fiscal-year toggle
**Severity: B/C.**

`Intake.tsx:153` branches on `fiscalEndMonth` alone: `if (fiscalEndMonth && fiscalEndMonth !== 12)`.
`taxPeriodWindow` (`:230`) branches on `isFiscalYear && fiscalEndMonth !== ''`. If the filer ticks
"not the calendar year", picks March, then **unticks** it, and `fiscalEndMonth` is not reset to `''`,
the two functions disagree: validation and the initial-return checkbox use the fiscal window while
the period uses the calendar year.

**Repro.** Exactly that sequence, with a formation date that falls inside one window but not the
other (e.g. formed 2025-02-15, tax year 2025, year-end March).
**Check.** Whether the "initial return" box on the generated 5472 matches the printed period.

---

## B. Filer is blocked

### B1. Hong Kong, Cayman Islands and the BVI are not in the country list at all
**Severity: B. Confirmed by reading, no test needed to establish the fact - only to see what it does.**

`CountrySelect.tsx:19-59` has 195 entries and none of these:

> **Hong Kong**, **Macau**, **Cayman Islands**, **British Virgin Islands**, **Bermuda**, Gibraltar,
> Isle of Man, Jersey, Guernsey, Curaçao, Aruba, Puerto Rico, Greenland, Anguilla, Turks and Caicos,
> Côte d'Ivoire

Two of those are among the largest sources of non-US SMLLC owners, and Cayman and the BVI are the
single most common jurisdictions for an *additional related party*. There is no free-text fallback -
`CountrySelect` renders a `<select>` over the fixed array. These filers cannot enter a true answer
anywhere on the form.

The postal-code exemption set (`Intake.tsx:304`) already lists `'hong kong'`, `'macau'`, `'macao'`
and `"cote d'ivoire"`, so the code was written expecting countries the dropdown cannot produce. That
is also why E2E scenario 30's "Hong Kong address" could never have been entered by a real filer.

**Also broken in the same pair of lists:** the dropdown says `Congo (Democratic Republic)` and
`Congo (Republic)`; the exemption set says `'congo'` and `'democratic republic of the congo'`.
Neither matches, so both Congos are still asked for a postal code they do not have.

**Repro.** Try to file as a Hong Kong owner. Then add a Cayman Islands related party.
**Check.** What does the filer do? Confirm there is no free-text escape.

### B2. A related party with no foreign tax ID is still blocked
**Severity: B. This is the fix from `5e095ed` applied to the owner but not to related parties.**

`validateRelatedPartyDraft` (`Intake.tsx:1680`) requires `draft.foreign_tax_id`. The owner's
equivalent (`:1520`) was reworded to accept a passport number; the related-party one was not touched.
A Cayman or UAE related party - the common case - cannot be added.

And the asymmetry runs the other way too: `validateRelatedParties` (`:1559-1568`), which checks the
**saved** list, does **not** check `foreign_tax_id` at all. So a party that reaches the list by any
route other than the draft form (prefill, multi-year copy, a resumed draft) passes with a blank TIN
and prints blank on that party's 5472 Part III. This is the same "nothing validated a saved party"
class recorded at `FILETAX-HANDOFF.md:670`.

**Repro (a).** Add a related party, leave the foreign tax ID blank. Blocked?
**Repro (b).** Save a related party with a TIN, then clear the field on the saved row (if the UI
allows editing in place) or via `window.__supabase`, and try to continue. Does it pass?

### B3. No 2026 tax year - a final return for an LLC dissolved in 2026 cannot be filed
**Severity: B.**

`TAX_YEARS = [2025 … 2019]` (`constants.ts:7`). An LLC dissolved in March 2026 has a short final year
in 2026 and a real reason to file now rather than wait. There is no way to select it, and
`Intake.tsx:1440` rejects it explicitly.

This is arguably correct-for-now (the 2026 forms do not exist yet), but the message should say so
rather than "not a tax year you can file here". Worth a decision, not just a test.

### B4. Per-year download fires N downloads in a loop
**Severity: B/C.**

`FilingWizard.tsx:230-235` calls `triggerDownload` once for the RCL and once per year, back to back
in a synchronous loop. Chrome blocks multiple automatic downloads from one gesture after the first
and shows a permission bar; if the filer misses or dismisses it, they get one file and believe they
got the set. Nothing in the UI lists what should have arrived.

**Repro.** A 6-year catch-up job. `Download each year + RCL`.
**Check.** Count the files that actually land. Repeat in Safari and Firefox.

---

## C. New / unproven code

### C1. Typed script signature (uncommitted)
The `typedSignature.ts` + `@pdf-lib/fontkit` work is **not committed and not covered by any
scenario**. It is on the path of every filer who leaves the pad blank - 44 of the 100 E2E scenarios,
so likely a large share of real filers.

Worth testing specifically:

| Case | Why | Expected |
|---|---|---|
| Plain ASCII name, pad blank | The happy path | Script name on the 1120 signature line and on the RCL |
| Name with `é`, `ü`, `ñ`, `ø` | Dancing Script is Latin-1; `canRenderTypedSignature` (`:108`) should pass these | Renders in script |
| Name with `Ł`, `ő`, `č` (Latin Extended-A) | **Outside Latin-1.** Coverage check should fail → plain Helvetica name stands | Signature line still has the name, not blank, not boxes |
| Cyrillic / CJK name | Guard should fail | Single-year path refuses the whole package anyway (A2 above) |
| Very long name (~60 chars) | `drawTypedSignatureInBox` (`:151`) shrinks to `MIN_SIZE = 7` then stops | Does it overhang the ruled line? |
| Two-character name | `maxSize` cap (`:148`, `:217`) exists to prevent a monogram | Reasonable size |
| Font fetch fails (block `/fonts/signature-script.woff` in devtools) | `embedSignatureFont` returns null (`:94`) | Package still generates, Helvetica name stands, **no error shown** |
| Multi-year package | One fetch should serve every year (`:62`) | Check the network tab: one request, not six |

**Layout risk on the RCL specifically.** The diff replaced `cursor.y -= 24` with
`cursor.y -= SIG_BOX_H + 2` … `cursor.y -= 12`. If `SIG_BOX_H` is materially larger than 10 the
letter's signature block grew, which can push the printed name, title and date onto a second page or
below `MIN_Y`. Generate an RCL with the maximum number of reasonable-cause reasons selected and check
the last page.

**Also unverified:** `drawTypedSignatureOverField` clears the field with `field.setText('')` at
`:223`, then the doc is flattened by `mergeInto`. Confirm the script text survives the flatten in the
combined package and not only in the standalone 1120.

### C2. Multi-year is genuinely untested end to end
Per `E2E-100-HANDOFF.md` §2, scenarios 94–100 only ever ran year one through the single-year
`/intake` path. Nothing has exercised the year picker, the shared reasonable cause letter, the
fan-out to one filing per year, or `Finish & generate all years`.

Additionally, `handleGenerateJob` (`FilingWizard.tsx:191`) queries the job's filings with **no
`.order('tax_year')`**. Row order from Postgres is not guaranteed, so the bundle's year order - and
the `pkg.taxYears[0]`–`pkg.taxYears[n-1]` range in the **filename** - depends on physical row order.

**Repro.** Create a 2019–2023 catch-up job, then edit the 2021 year last (an UPDATE can move a row).
Download the bundle.
**Check.** Are the years in ascending order inside the PDF? Does the filename say `2019-2023`?

---

## D. Smaller things, worth a look while you are in there

| # | Where | What |
|---|---|---|
| D1 | `Intake.tsx:116` `amountProblem` | **No upper bound.** `999999999999999999999` passes, loses precision past 2^53, and prints a number far wider than the box. Try `99999999999999999999` in Total assets and in a transaction |
| D2 | `pdfGenerator.ts:53` `fmt` | Zero prints **blank**. A loan repaid in full during the year prints an empty 17b rather than `0`, which reads as "not answered" rather than "nil" |
| D3 | `resolvePeriod:343` | `closureISO > beginISO` is strict - an LLC formed and dissolved on the same day gets a full-year period |
| D4 | `Intake.tsx:304` | `'qatar'` is listed twice; `'niue'`, `'tokelau'`, `'ivory coast'`, `'east timor'`, `'hong kong'`, `'macau'` are dead entries the dropdown can never produce (see B1) |
| D5 | `pdfGenerator.ts:2352` | A literal `\x00` is used as a join separator in source. Harmless at runtime but it makes `grep` treat `pdfGenerator.ts` as a binary file, which will cost someone an afternoon |
| D6 | `FilingWizard.tsx:247` | `hasPartV` in the wizard's preview text does not gate on ownership, while the generator does (`:2219`). The preview will promise a Part V statement for a non-owner-only distribution that never gets built. Same root cause as A1 |
| D7 | `pdfGenerator.ts:2287` | `taxYear` falls back to `new Date().getFullYear() - 1` when `tax_year` is null. In 2026 that silently means 2025 |
| D8 | E2E handoff §4.4 | Confirm `console.log('INSERT PAYLOAD:', …)` at `Intake.tsx:1371` was removed. It dumps EIN, legal name, foreign TIN and both addresses to the console on every insert, ungated by `DEV` |

---

## Suggested order

If you only have one session, this is the order that finds the most per hour:

1. **B1** - one minute to confirm, and it decides whether Hong Kong and Cayman filers can use the
   product at all.
2. **A1** - one filing, two parties, one distribution. Clearest wrong-output case.
3. **A2** - one Cyrillic name through both paths. Binary answer.
4. **A3** - one fiscal-year filing. Decides whether late filers get their RCL.
5. **C1** - the whole typed-signature table; it is unproven code on a majority path.
6. **A5** - seven filings, tedious but it is the only way to prove the older templates.
7. **A6** - two long names.
8. Everything else.
