# Browser test run of the 5472 portal — handoff

Written 1 August 2026. **Self-contained**: a new session can continue from this file alone.

This is NOT `Desktop\FileTax\FILETAX-HANDOFF.md`. That one is the project handoff for FileTax as a
whole. This one covers only the 100-scenario **browser** run of the product app, its harness, and
what it found. Findings that belong in the project handoff are marked **[promote]**.

---

## 1. What this is

100 scenarios driven through the **real wizard in a real browser** — the scenario loader fills the
same React state a filer's typing fills, and every Save & continue, every validation message, the
real generator, the real signature pad and the real download are exercised. Nothing is written to
Supabase by the harness; the rows that appear are the ones the product itself wrote.

Deliberately distinct from the older `testing/__driver.js` harness, which stops before the signature
and never touches multi-year. Both can coexist.

### Where everything lives

All paths relative to `Desktop\CNL 5472\5472`.

| Path | What |
|---|---|
| `scripts/genScenarios100.mjs` | Authors the scenarios. Edit here, never edit the JSON by hand |
| `testing/__scenarios100.json` | The 100 scenarios, generated |
| `testing/__driver100.js` | The browser driver. Runs one scenario per page load |
| `scripts/pdfReceiver.mjs` | Catches the bytes the browser hands the user |
| `scripts/e2eReport.mjs` + `.py` | Builds the workbook |
| `scripts/checkSignatures.mjs` | Proves drawn vs typed **from the PDF bytes** |
| `testing/run-2026-08-01/pdfs/` | Captured PDFs, `NNN__<browser filename>.pdf` |
| `testing/run-2026-08-01/results.json` | One record per scenario attempt |
| `testing/run-2026-08-01/results.xlsx` | The report, 5 sheets |
| `testing/run-2026-08-01/aborted-runs/` | PDFs from the false starts, kept for comparison |

### How to run it

    npm run dev:e2e                                        # serves the driver; port 5174
    node scripts/pdfReceiver.mjs "<abs path>/testing/run-2026-08-01/pdfs" 5199

Sign in **manually** in the browser, then in the console:

    window.__start100([...Array(100)].map((_, i) => i + 1))   // all 100
    window.__resume100([8, 9, 10])                            // named scenarios, appends
    window.__progress100()                                     // {remaining, done, running}
    window.__stop100()                                         // finishes the current one, then stops

Then, at any point including mid-run:

    npm run report:e2e

`dev:e2e` is wired through `npm_lifecycle_event` in `vite.config.ts`, because the documented
`E2E_DRIVER=1 npm run dev` is not valid shell on Windows. `E2E_DRIVER=1` still selects the OLD
driver; `E2E_DRIVER=2` or `npm run dev:e2e` selects this one.

---

## 2. State as of this handoff

**Scenarios 1–50 were run** (the owner capped the run at 50; 51–100 are authored and unrun).

| | |
|---|---|
| Run | 49 scenarios (1–50; #51 onward untouched) |
| Passed | 40 |
| Not passed | 9, itemised in §4 |
| PDFs captured | 41 |
| Field mismatches | **0** across every field of every passing scenario |
| Signature checks | **40 of 40 matched** the mode the scenario asked for |

The nine that did not pass, all analysed in §4:

    #8  #9  #10  incorporation date postdated the tax year — scenario data, since fixed
    #17          submit blocked with no message — UNRESOLVED, re-run it
    #30          Hong Kong address rejected: postal code required for every country
    #34 #35      blank foreign tax ID rejected
    #36 #37      Cyrillic and CJK owner names — package correctly refused

**51–100 remain unrun.** They are authored and valid. They cover Parts V and VI, loans and loan
guarantee fees, digital assets, the 30-transaction volume case, the 12 negatives and all 7
multi-year jobs. Resume with `window.__resume100([...])`.

### Known gap: multi-year is not actually driven

Scenarios 94–100 carry `year_specific_filings`, but the driver enters every scenario through the
single-year `/intake` flow. `applyScenario` loads **year one only** and says so in its own summary
line. So those seven currently test the first year of a catch-up job and **not** the job itself —
not the year picker, not the shared reasonable cause letter, not the fan-out to one filing per year,
not `Finish & generate all years`.

Driving it properly means entering through `MultiYearStart` (`Choose years` on the dashboard),
selecting the years, taking the RCL once, then completing each year's intake in turn. The driver has
the download handling for it already (`Download each year + RCL` and `Download all-in-one PDF` are
both clicked when present); what is missing is the entry path.

---

## 3. Things that will waste your time if you do not know them

Every one of these cost real time during this run.

1. **Enter through the Dashboard's `Start filing` button, never bare `/intake`.** `/intake` resumes
   the most recent draft, so scenario N silently edits scenario N-1's filing, arriving at a later
   step with the LLC Details section collapsed. This looks exactly like a validation bug.
2. **`Start filing` navigates client-side.** There is no page load, so a driver that returns and
   waits to be re-armed by a reload hangs forever. Fall through and run the scenario in the same
   tick.
3. **Do not forward the download click.** The bytes are already going to the receiver; letting the
   real `<a download>` proceed opens the browser's native Save-as dialog, which is modal.
4. **The driver is served with `Cache-Control: no-store`** for a reason. Without it the browser
   re-runs a cached copy and your edits appear to do nothing. `window.__driverVersion` exists so a
   run can prove which build it is executing.
5. **Match UI copy loosely.** The eligibility attestation was reworded mid-run
   ("All three still describe my LLC" → "For this tax year my LLC still has one owner"). A driver
   matching the old string ticks nothing and every scenario blocks at step 1 with a message that
   looks like a product bug.
6. **Transactions live in `reportable_transactions`**, not `transactions`. Querying the wrong table
   returns `[]` and reads as "the product dropped every transaction".
7. **As of August 2026 no tax year is on time** except 2025 held open by a valid 7004. Everything
   else is late, and the wizard **pre-selects the reasonable cause letter after the scenario is
   applied**, overriding `include_reasonable_cause: false`. Declining the letter is a click, not an
   assumption.
8. **Incorporation date must precede the earliest tax year**, or the filing is correctly rejected.
   The base date is `2018-06-01` for this reason.

---

## 4. What the run found

### Product defects

**[promote] 1. Neither step-1 attestation is ever persisted.** `patchAll()` omits
`eligibility_confirmed` and `has_us_activity`. Every "Save & continue" saves through it
(`continueFromSection` → `saveAll` → `patchAll`), so both columns are **null on every filing in the
database, including submitted ones that generated PDFs**. Consequences: resuming a draft silently
discards the filer's confirmation and they must re-tick both to pass step 1; and nothing records
that the filer ever attested, though the prompt is phrased as a per-tax-year confirmation. The
fields exist in `patchFromCurrentStep()` (`Intake.tsx:1103`), whose only caller (`:1417`) does not
run in this flow. The driver has to re-tick and re-submit on every scenario to get past this, and
records it as `attestationsLost`.

**[promote] 2. A foreign tax ID is mandatory.** `Intake.tsx:1360` rejects a blank
`owner_foreign_tax_id`. Form 5472 asks for a foreign TIN *if any*, and owners in the UAE, Cayman,
the Bahamas and elsewhere genuinely have none. Those filers cannot get past step 2.
Scenarios 34 and 35.

**[promote] 3. A postal code is required for every country.** `isAddressComplete`
(`Intake.tsx:213`) requires `postal_code` unconditionally. The function two lines above
*deliberately* exempts `region` for city-states, so the case was considered — but Hong Kong, the
UAE, Panama and much of Ireland have no postal code. Scenario 30, a Hong Kong entity address, is
rejected as incomplete.

**4. ~~`console.log('INSERT PAYLOAD:', …)` dumped the whole filing to the browser console.~~**
**DONE 3 August 2026.** The diagnostic now runs only when `import.meta.env.DEV` is true, so EIN,
owner legal name, foreign TIN and addresses are not logged by the production build.

**5. Scenario 17 blocked at submit with no message.** Submit did not reach `/filing/` and the wizard
displayed nothing to explain why. Either a slow save exceeding the driver's 25s wait, or a genuine
silent failure — a filer would see the button do nothing. **Unresolved; re-run 17 to find out.**

### Confirmed limitation, working as designed

**Non-Latin and CJK owner names produce no package** (scenarios 36, 37 — Cyrillic and Chinese).
This is not a crash. `toFormText()` drops characters WinAnsi cannot encode, reports them as
`unsupportedText`, and `FilingWizard.tsx:130` refuses to deliver a package containing any. **The
guard works** — it will not hand the IRS a mangled legal name. But the consequence is that those
owners cannot file at all, and they are precisely this product's audience. The real fix is already
recorded in the project handoff: a Unicode font via `@pdf-lib/fontkit`.

### Validation confirmed working (deliberate negative coverage)

Scenarios 8, 9, 10 were blocked because their incorporation date (2022) postdated their tax years
(2021/2020/2019). The portal rejected them with a specific, accurate message. The scenario data has
since been corrected to `2018-06-01`; the blocked results are **retained in `results.json` as
evidence**, and the report shows the latest attempt while counting earlier ones in an `Attempts`
column. Re-running them also gains positive coverage of the 2019–2021 form revisions, which is where
the loan-guarantee-fee defect lived and which currently has **no positive coverage**.

---

## 5. The report

`testing/run-2026-08-01/results.xlsx`, rebuilt by `npm run report:e2e`.

| Sheet | Contents |
|---|---|
| Summary | Counts |
| Results | One row per scenario, 35 columns: outcome, stage reached, **the exact error text shown**, console errors, filing id, PDF names and bytes, attempts, signature checked, mismatch count, plus 15 `entered:` summary columns |
| Field check | Every field paired entered-vs-saved, green match / red mismatch |
| Inputs (all fields) | ~5,900 rows. Every value each scenario put in, flattened with its path (`mailing_address.city`, `transactions[3].amount_usd`) |
| PDFs | Every captured file and its size |

Outcome cells are colour-coded; all sheets have filters and frozen headers.

### How a verdict is decided

- A **negative** scenario passes when it is rejected and nothing is saved.
- A **positive** passes when it produced a PDF and the field check found no mismatch.
- The **last** attempt is the verdict; earlier attempts are counted in `Attempts` and summarised in
  `Earlier attempt`, so a scenario that only passed on a retry cannot look like a clean first pass.

### Signatures

`node scripts/checkSignatures.mjs` reads the captured bytes and reports, per scenario, what the
scenario asked for against what the file actually contains. A drawn signature embeds an image
XObject; the typed fallback is text in a font. This does not ask the generator what it did — it
inspects the artefact. Every PDF so far matches its scenario's `signature_mode`.

Note the split: 56 scenarios draw, 44 leave the pad blank. Leaving it blank is not "no signature" —
it is the typed-name fallback, which is a real product path (`FilingWizard.tsx:477`).

---

## 6. Changes made to the app for this run

Small, dev-only, and none of it reaches a build.

| File | Change | Why |
|---|---|---|
| `src/lib/supabase.ts` | `window.__supabase` under `import.meta.env.DEV` | The run must read back saved rows to compare against what was typed. Same anon key, same RLS |
| `vite.config.ts` | `dev:e2e` script detection; serves `__driver100.js` and `__scenarios100.json`; `Cache-Control: no-store` | See §3 items 4 and the Windows note in §1 |
| `package.json` | `dev:e2e`, `report:e2e`, `gen:scenarios100b` | — |

**No product logic was changed.** Every defect in §4 is still present and unfixed — they are reported,
not repaired, because fixing them was not the task.

---

## 7. What to do next

1. **Re-run 17** to settle whether the silent submit failure is real. `window.__resume100([17])`.
2. **Re-run 8, 9, 10** for positive coverage of the 2019–2021 revisions.
3. **Run 51–100.** Authored and waiting.
4. **Build the multi-year entry path** in the driver (§2), then re-run 94–100. Until then, multi-year
   is effectively untested end to end.
5. Decide on the four product defects in §4.

### Environment notes

- Runs against **live Supabase**; there is no staging. Everything here was run under
  `cpa@taxclaim.co` with the owner's agreement, and the rows were kept. Expect ~50 filings named
  `S001 …` through `S050 …` on that account.
- Every scenario has a **unique** entity name, EIN and owner. Identical data hides any bug that only
  appears when two filings differ — which is exactly the class of bug that resume-the-wrong-draft
  turned out to be. The scenario number is stamped into the entity name so a dashboard row, a saved
  record and a PDF all trace back to one scenario.
- Scenario 90 deliberately has a **blank** LLC name and is exempt from that stamping.
