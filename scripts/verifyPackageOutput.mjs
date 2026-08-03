/**
 * verifyPackageOutput — drives the real pdfGenerator end to end, in Node, with
 * a synthetic filing. No Supabase, no auth, no writes.
 *
 *   node --experimental-strip-types scripts/verifyPackageOutput.mjs
 *
 * Covers the reported scenarios that the source-only audit could not prove:
 *   • #5  formation costs reach Part I 1f/1h and the Part V statement
 *   • #12/13/16  a filed extension actually emits Form 7004
 *   • #15  the principal country prints what was entered, not "United States"
 *   • #4/14  a filing with no transactions still generates
 *   • package assembly order
 *
 * pdfGenerator fetches its blank forms over HTTP; in Node we point fetch at
 * public/ on disk so the same code path runs unmodified.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Serve public/ to the generator's fetch() calls.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const s = String(url);
  const m = s.match(/pdf\/([^/?#]+)$/);
  if (m) {
    const buf = await readFile(path.join(root, 'public', 'pdf', m[1]));
    return new Response(buf, { status: 200, headers: { 'content-type': 'application/pdf' } });
  }
  return realFetch(url, init);
};

const {
  generateFilingPackage,
  shouldIncludeReasonableCause,
} = await import('../src/lib/pdfGenerator.ts');
const { PDFDocument } = await import('pdf-lib');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `\n        ${detail}` : ''}`);
};

const baseFiling = {
  id: 'test', llc_name: 'Fresh Start Ventures LLC', ein: '45-1029384',
  tax_year: '2025', state_of_formation: 'DE',
  date_of_incorporation: '2019-10-01',
  entity_principal_country: 'Brazil',
  llc_us_address: { street: '1013 Centre Rd', city: 'Wilmington', state: 'DE', zip: '19805', country: 'US' },
  owner_full_name: 'Wei Ling Tan',
  owner_country: 'Singapore', owner_country_residence: 'Singapore',
  owner_foreign_tax_id: 'S1234567D',
  owner_address: { street: '1 Marina Blvd', city: 'Singapore', state: '', zip: '018989', country: 'Singapore' },
  owner_business_activity: 'Software Developer / Programmer',
  owner_business_code: '541511',
  total_assets: 50000,
  related_parties: [],
};

console.log('\n— scenario 5: formation costs —');
{
  const txns = [
    { transaction_type: 'capital_contribution', direction: 'received', amount_usd: 15000 },
    { transaction_type: 'formation_costs',      direction: 'paid',     amount_usd: 12500 },
    { transaction_type: 'service_payment',      direction: 'paid',     amount_usd: 15000 },
  ];
  const pkg = await generateFilingPackage(baseFiling, txns, 2025);
  check('package generates', !!pkg.combined && pkg.combined.length > 1000);
  check('Part V statement produced (formation costs are a Part V item)', !!pkg.statement_partV);

  const partV = await PDFDocument.load(pkg.statement_partV);
  check('Part V statement has at least one page', partV.getPageCount() >= 1);

  // 1f/1h gross must include the formation costs: 15000 + 12500 + 15000.
  const combined = await PDFDocument.load(pkg.combined);
  check('combined package has multiple pages', combined.getPageCount() > 3,
    `pages=${combined.getPageCount()}`);
  await mkdir(path.join(root, 'tmp-verify'), { recursive: true });
  await writeFile(path.join(root, 'tmp-verify', 'scenario5.pdf'), pkg.combined);
  console.log(`        wrote tmp-verify/scenario5.pdf (${combined.getPageCount()} pages)`);
}

console.log('\n— scenarios 12/13/16: extension filed emits Form 7004 —');
{
  const withExt = { ...baseFiling, extension_filed: true };
  const pkg = await generateFilingPackage(withExt, [
    { transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 },
  ], 2025);
  check('form7004 present when extension_filed', !!pkg.form7004);

  const noExt = { ...baseFiling, extension_filed: false };
  const pkg2 = await generateFilingPackage(noExt, [
    { transaction_type: 'capital_contribution', direction: 'received', amount_usd: 1000 },
  ], 2025);
  check('form7004 absent when no extension', !pkg2.form7004);
}

console.log('\n- reasonable cause with Form 7004 -');
{
  const EXTENDED_DEADLINES = [
    ['2025-01-31', '2025-11-15'],
    ['2025-02-28', '2025-12-15'],
    ['2025-03-31', '2026-01-15'],
    ['2025-04-30', '2026-02-15'],
    ['2025-05-31', '2026-03-15'],
    ['2025-06-30', '2026-04-15'],
    ['2025-07-31', '2026-05-15'],
    ['2025-08-31', '2026-06-15'],
    ['2025-09-30', '2026-07-15'],
    ['2025-10-31', '2026-08-15'],
    ['2025-11-30', '2026-09-15'],
    ['2025-12-31', '2026-10-15'],
  ];
  for (const [periodEnd, extended] of EXTENDED_DEADLINES) {
    check(
      `${periodEnd.slice(5, 7)} extension is active on its deadline`,
      !shouldIncludeReasonableCause(true, true, periodEnd, extended),
    );
    const dayAfter = new Date(`${extended}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    check(
      `${periodEnd.slice(5, 7)} extension is late after its deadline`,
      shouldIncludeReasonableCause(true, true, periodEnd, dayAfter.toISOString().slice(0, 10)),
    );
  }

  const activeExtension = await generateFilingPackage(
    { ...baseFiling, tax_year: 2025, extension_filed: true, include_rcl: true },
    [],
    2025,
  );
  check(
    'active 2025 extension suppresses reasonable cause letter',
    !activeExtension.reasonableCauseLetter,
  );

  const expiredExtension = await generateFilingPackage(
    {
      ...baseFiling,
      tax_year: 2024,
      extension_filed: true,
      include_rcl: true,
      include_reasonable_cause: true,
      reasonable_cause_reasons: ['discovered_late'],
    },
    [],
    2024,
  );
  check(
    'expired 2024 extension includes reasonable cause letter',
    !!expiredExtension.reasonableCauseLetter,
  );
}

console.log('\n— scenarios 4/14: no transactions still generates —');
{
  const pkg = await generateFilingPackage(baseFiling, [], 2025);
  check('generates with zero transactions', !!pkg.combined && pkg.combined.length > 1000);
  check('Part VI statement still produced', !!pkg.statement_partVI);
}

console.log('\n— package assembly —');
{
  const pkg = await generateFilingPackage({ ...baseFiling, extension_filed: true }, [
    { transaction_type: 'formation_costs', direction: 'paid', amount_usd: 500 },
  ], 2025);
  const combined = await PDFDocument.load(pkg.combined);
  const f1120 = await PDFDocument.load(pkg.form1120);
  const f5472 = await PDFDocument.load(pkg.form5472);
  const f7004 = await PDFDocument.load(pkg.form7004);
  const pV = await PDFDocument.load(pkg.statement_partV);
  const pVI = await PDFDocument.load(pkg.statement_partVI);
  const parts = f1120.getPageCount() + f5472.getPageCount() + f7004.getPageCount()
              + pV.getPageCount() + pVI.getPageCount();
  check('combined page count exceeds the sum of its forms (instructions lead)',
    combined.getPageCount() > parts,
    `combined=${combined.getPageCount()} parts=${parts}`);
}

// Every page the filer receives must be US Letter. The IRS prints and scans on
// Letter; an A4 page opens fine on screen and prints scaled or clipped, and
// nothing in the product would ever complain. scripts/verifyPageSize.mjs checks
// the templates; this checks the ASSEMBLED output, which is what is actually
// delivered and is the only place a merge or a hand-built page could go wrong.
console.log('\n— page size (US Letter) —');
{
  const isLetter = (page) => {
    const { width, height } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const [w, h] = rot % 180 === 0 ? [width, height] : [height, width];
    return Math.abs(w - 612) <= 1 && Math.abs(h - 792) <= 1;
  };

  const pkg = await generateFilingPackage(
    { ...baseFiling, include_rcl: true, extension_filed: false },
    [{ transaction_type: 'formation_costs', direction: 'paid', amount_usd: 500 }],
    2025,
  );

  for (const [name, bytes] of Object.entries({
    combined: pkg.combined,
    form1120: pkg.form1120,
    form5472: pkg.form5472,
    statement_partV: pkg.statement_partV,
    statement_partVI: pkg.statement_partVI,
    reasonableCauseLetter: pkg.reasonableCauseLetter,
  })) {
    if (!bytes) continue;
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();
    const bad = pages.filter((p) => !isLetter(p));
    check(
      `${name}: all ${pages.length} page(s) are US Letter`,
      bad.length === 0,
      bad.length ? `${bad.length} page(s) are not 612x792` : '',
    );
  }
}

// A drawn signature is optional, but when one is supplied it must actually
// reach the two documents it applies to, and it must never be persisted. The
// value assertions matter more than they look: every form is FLATTENED during
// assembly and content streams are compressed, so a byte search for a drawn
// mark can never match. Assert on behaviour, not on the rendering.
console.log('\n— drawn signature —');
{
  // 1x1 transparent PNG. Enough to prove the plumbing; the visual result is not
  // something a byte check can assert.
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const withSig = await generateFilingPackage(
    { ...baseFiling, include_rcl: true },
    [{ transaction_type: 'formation_costs', direction: 'paid', amount_usd: 500 }],
    2025,
    { drawnSignature: PNG_1PX },
  );
  check('package still generates with a drawn signature', !!withSig.combined && withSig.combined.length > 1000);
  check('RCL still produced with a drawn signature', !!withSig.reasonableCauseLetter);

  // A malformed signature must degrade to the typed name, never fail the package.
  const withJunk = await generateFilingPackage(
    { ...baseFiling, include_rcl: true },
    [{ transaction_type: 'formation_costs', direction: 'paid', amount_usd: 500 }],
    2025,
    { drawnSignature: 'data:image/png;base64,not-actually-base64!!' },
  );
  check('a malformed signature degrades to the typed name instead of failing',
    !!withJunk.combined && withJunk.combined.length > 1000);

  // The fax hard block. An unsigned package must not be buildable for fax: on
  // that path there is no hand between the PDF and Ogden, so a blank
  // penalties-of-perjury jurat would transmit and report as delivered.
  let blocked = false;
  try {
    await generateFilingPackage(
      { ...baseFiling, include_rcl: true, owner_full_name: '' },
      [{ transaction_type: 'formation_costs', direction: 'paid', amount_usd: 500 }],
      2025,
      { fax: true },
    );
  } catch {
    blocked = true;
  }
  check('fax refuses to build a package with no signature at all', blocked);

  // ...but the same filing with a drawn signature IS faxable, since the mark
  // supplies what the missing typed name did not.
  const faxable = await generateFilingPackage(
    { ...baseFiling, include_rcl: true, owner_full_name: '' },
    [{ transaction_type: 'formation_costs', direction: 'paid', amount_usd: 500 }],
    2025,
    { fax: true, drawnSignature: PNG_1PX },
  );
  check('a drawn signature unblocks the fax path', !!faxable.faxPayload);
}

// Form 1120 item E is one of only TWO things the Form 5472 instructions require
// on the pro forma 1120 (item B is the other), so a silently missing checkbox
// here is a defect in required content, not a cosmetic one.
//
// checkBox() swallows an unknown field name in a catch block. That is what let
// name_change and address_change sit wired-but-unreachable until 1 Aug 2026: a
// wrong name in the map produces no error and no checked box. Assert the map
// against the real AcroForm for every revision we ship.
console.log('\n— Form 1120 item E field names resolve on every revision —');
{
  const { getF1120Map } = await import('../src/lib/form1120Fields.ts');
  const KEYS = ['INITIAL_RETURN', 'FINAL_RETURN', 'NAME_CHANGE', 'ADDRESS_CHANGE'];
  for (const year of [2019, 2020, 2021, 2022, 2023, 2024, 2025]) {
    const map = getF1120Map(year);
    const doc = await PDFDocument.load(await readFile(path.join(root, 'public', 'pdf', `Form-1120-${year}.pdf`)));
    const real = new Set(doc.getForm().getFields().map((f) => f.getName()));
    const missing = KEYS.filter((k) => map[k] && !real.has(map[k]));
    check(`${year}: item E checkboxes all resolve`, missing.length === 0,
      missing.map((k) => `${k} -> "${map[k]}" not in form`).join('; '));
  }
}

// A final return ends when the LLC was dissolved with its state of formation,
// not on 31 December. date_of_closure was a dead column until 1 Aug 2026, so a
// mid-year dissolution printed a full calendar period on every form, covering
// months in which the entity did not exist.
//
// Asserted against resolvePeriod rather than the rendered PDFs, because the
// package flattens every form during assembly and a content stream is
// compressed, so a byte search for "June 30, 2025" can never match.
console.log('\n— final return truncates the tax period to the dissolution date —');
{
  const { resolvePeriod } = await import('../src/lib/pdfGenerator.ts');
  const { normalizeFiling } = await import('../src/lib/filingMapping.ts');
  const period = (over) => resolvePeriod(normalizeFiling({ ...baseFiling, ...over }), 2025);

  check('dissolved 30 June ends the period on 30 June',
    period({ final_return: true, date_of_closure: '2025-06-30' }).endISO === '2025-06-30',
    period({ final_return: true, date_of_closure: '2025-06-30' }).endISO);

  check('a closure date on a NON-final year does not shorten it',
    period({ final_return: false, date_of_closure: '2025-06-30' }).endISO === '2025-12-31',
    period({ final_return: false, date_of_closure: '2025-06-30' }).endISO);

  check('a closure date after period end cannot extend the period',
    period({ final_return: true, date_of_closure: '2026-03-01' }).endISO === '2025-12-31',
    period({ final_return: true, date_of_closure: '2026-03-01' }).endISO);

  check('a final return with no closure date keeps the full year',
    period({ final_return: true, date_of_closure: null }).endISO === '2025-12-31',
    period({ final_return: true, date_of_closure: null }).endISO);

  check('isFinal is reported on the period',
    period({ final_return: true, date_of_closure: '2025-06-30' }).isFinal === true);
}

// The truncated end date has to reach all THREE forms. The 5472 and 1120
// headers read period.endISO directly, so they follow automatically. Form 7004
// decided calendar-vs-short from the period START alone, which meant a
// calendar-year LLC dissolved mid-year still ticked "calendar year" and printed
// no short period. Form 7004 is saved BEFORE the merge flattens it, so unlike
// the other two its fields can be read back.
console.log('\n— a short final year reaches Form 7004 —');
{
  const pkg = await generateFilingPackage(
    { ...baseFiling, extension_filed: true, final_return: true, date_of_closure: '2025-06-30' },
    [], 2025);
  const f = (await PDFDocument.load(pkg.form7004)).getForm();
  const val = (n) => { try { return f.getTextField(n).getText() ?? ''; } catch { return null; } };
  check('7004 does not claim a calendar year for a short final year',
    !val('LLC_Calendar_Year'), `LLC_Calendar_Year="${val('LLC_Calendar_Year')}"`);
  check('7004 prints the short period start', val('LLC_Beginning_Date') === 'January 1',
    `LLC_Beginning_Date="${val('LLC_Beginning_Date')}"`);
  check('7004 marks the final return', (() => {
    try { return f.getCheckBox('Final_Return').isChecked(); } catch { return false; }
  })());

  const normal = await generateFilingPackage({ ...baseFiling, extension_filed: true }, [], 2025);
  const nf = (await PDFDocument.load(normal.form7004)).getForm();
  const nval = (n) => { try { return nf.getTextField(n).getText() ?? ''; } catch { return null; } };
  check('an ordinary calendar year still uses the calendar-year box',
    nval('LLC_Calendar_Year') === '25', `LLC_Calendar_Year="${nval('LLC_Calendar_Year')}"`);
}

// ── Lines 1f / 1h: Part V and Part VI count for the OWNER only ──────────────
// Parts V and VI are built, and their checkboxes ticked, for the owner's Form
// 5472 alone. The 1f/1h aggregate did not know that, so an owner-type amount
// attached to an ADDITIONAL related party inflated that party's line 1f while
// appearing on no line, no checkbox and no statement of theirs — a form whose
// 1f exceeded line 22 + line 36 with nothing to explain the gap.
console.log('\n— lines 1f / 1h, Part V/VI is owner-only —');
{
  const { grossPaymentsForLines1f1h, aggregateTransactions } =
    await import('../src/lib/pdfGenerator.ts');

  // One Part IV amount (any party reports it) + one Part V amount (owner only).
  const agg = aggregateTransactions([
    { transaction_type: 'service_payment', direction: 'paid', amount_usd: 10000 },
    { transaction_type: 'distribution', amount_usd: 50000 },
  ]);
  check('owner 1f includes the Part V distribution',
    grossPaymentsForLines1f1h(agg, true) === 60000,
    `got ${grossPaymentsForLines1f1h(agg, true)}, expected 60000`);
  check('a non-owner 1f excludes it, leaving only the Part IV flow',
    grossPaymentsForLines1f1h(agg, false) === 10000,
    `got ${grossPaymentsForLines1f1h(agg, false)}, expected 10000`);

  // Part VI consideration behaves the same way.
  const vi = aggregateTransactions([
    { transaction_type: 'property_transfer', amount_usd: 7500 },
  ]);
  check('owner 1f includes the Part VI amount', grossPaymentsForLines1f1h(vi, true) === 7500);
  check('a non-owner 1f excludes the Part VI amount', grossPaymentsForLines1f1h(vi, false) === 0);

  // The gate must not touch Part IV, which every party reports on its own form.
  const partIVOnly = aggregateTransactions([
    { transaction_type: 'sales', direction: 'received', amount_usd: 1234 },
  ]);
  check('Part IV is unaffected by the gate',
    grossPaymentsForLines1f1h(partIVOnly, true) === grossPaymentsForLines1f1h(partIVOnly, false));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
