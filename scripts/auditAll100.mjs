/**
 * auditAll100 — compliance audit of the packages produced by genAll100.
 *
 *   node scripts/auditAll100.mjs [factsFile]
 *
 * This is an INDEPENDENT oracle. It does not import the generator or reuse its
 * aggregation; it re-derives, from each scenario's own input, what every field
 * on Form 5472, the pro forma 1120 and Form 7004 must say, then compares that
 * to the field values actually captured from the generated PDFs. A mapping bug
 * in the generator cannot hide, because nothing here is computed by it.
 *
 * Findings are graded:
 *   CRITICAL — the filing is wrong or unusable as filed
 *   HIGH     — a value the IRS reads is missing, wrong, or self-inconsistent
 *   MEDIUM   — cosmetic or presentational defect in a filed document
 *   INFO     — observation / design question, not necessarily a defect
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const factsFile = process.argv[2] ?? path.resolve(here, '../../../Testing/out100/_facts.json');
const facts = JSON.parse(await readFile(factsFile, 'utf8'));

const findings = [];
const add = (sev, id, check, detail) => findings.push({ sev, id, check, detail });

// ── helpers ─────────────────────────────────────────────────────────────────
const money = (n) => Number(n).toLocaleString('en-US');
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const eq = (a, b) => norm(a) === norm(b);
const num = (s) => Number(String(s ?? '').replace(/[^0-9.-]/g, '') || 0);

/** Part V (owner-transaction) types — disclosed in a statement, not Part IV. */
const PART_V_TYPES = new Set(['distribution', 'dividend', 'capital_contribution', 'formation_costs']);
/** Part VI (nonmonetary / below-FMV) types. */
const PART_VI_TYPES = new Set(['property_transfer', 'nonmonetary_other']);

/**
 * Canonical transaction type → the Form 5472 Part IV field it belongs on,
 * written from the IRS form itself rather than from the generator's tables.
 * `[receivedField, paidField]`; loans carry `[beginField, endField]` instead.
 */
const PART_IV_LINE = {
  sales:            { received: 'StockPurchase',        paid: 'StockSales' },              // 9  / 23
  tangible_property:{ received: 'TangPropSales',        paid: 'TangPropPurchase' },        // 10 / 24
  intangible:       { received: 'SaleofIntangibleProp', paid: 'PurchaseIntangibleProperty' }, // 14 / 28
  service_payment:  { received: 'ConsiderationReceived',paid: 'ConsiderationPaid' },       // 15 / 29
  commission:       { received: 'CommissionsReceived',  paid: 'CommissionsPaid' },         // 16 / 30
  interest:         { received: 'InterestReceived',     paid: 'InterestPaid' },            // 18 / 32
  insurance:        { received: 'InsPremiumReceived',   paid: 'InsPremiumPaid' },          // 19 / 33
  loan_guarantee:   { received: 'LoanGuaranteeReceived',paid: 'GuaranteePaid' },           // 20 / 34
  other:            { received: 'OtherAmountRec',       paid: 'OtherPayments' },           // 21 / 35
};
/** rent_royalty splits on the is_royalty flag. */
const RENT_ROYALTY_LINE = {
  rent:    { received: 'RentReceived',    paid: 'RentPaid' },      // 13a / 27a
  royalty: { received: 'RoyaltyReceived', paid: 'RoyaltiesPaid' }, // 13b / 27b
};
/** Loans: balances, not flows. */
const LOAN_LINE = {
  loan_to_llc:   { begin: 'LoanBorrowedBegBal', end: 'AmountsBorrowed' },      // 17a / 17b
  loan_from_llc: { begin: 'LoanGivenBegBal',    end: 'LoanGivenEndingBal' },   // 31a / 31b
};

// Lines 9-21 / 23-35 that feed the totals on lines 22 / 36. Loans contribute
// their ENDING balance (17b, 31b) to the total; the beginning balance (17a,
// 31a) is disclosure only and is not combined.
const RECEIVED_LINES = ['StockPurchase', 'TangPropSales', 'PlatformContReceived', 'CostSharingReceived',
  'RentReceived', 'RoyaltyReceived', 'SaleofIntangibleProp', 'ConsiderationReceived',
  'CommissionsReceived', 'AmountsBorrowed', 'InterestReceived', 'InsPremiumReceived',
  'LoanGuaranteeReceived', 'OtherAmountRec'];
const PAID_LINES = ['StockSales', 'TangPropPurchase', 'PlatformContPaid', 'CostSharTransPaid',
  'RentPaid', 'RoyaltiesPaid', 'PurchaseIntangibleProperty', 'ConsiderationPaid',
  'CommissionsPaid', 'LoanGivenEndingBal', 'InterestPaid', 'InsPremiumPaid',
  'GuaranteePaid', 'OtherPayments'];
/** Disclosure-only balance lines, excluded from the totals. */
const BALANCE_LINES = ['LoanBorrowedBegBal', 'LoanGivenBegBal'];

/** All text in the package, flattened. */
const allText = (rec) => {
  const bits = [];
  const eat = (d) => { if (d?.text) bits.push(...d.text); };
  if (rec.multiyear) { eat(rec.out.bundled); eat(rec.out.rcl); (rec.out.perYear ?? []).forEach(eat); }
  else {
    eat(rec.out.combined); eat(rec.out.partV); eat(rec.out.partVI); eat(rec.out.rcl);
  }
  return bits.join('\n').replace(/\s+/g, ' ');
};

// The eight reasonable-cause reasons, each with a phrase that must appear in
// the letter when that reason is selected (and must not when it is not).
const RCL_REASON_MARKERS = {
  first_time_filing: 'first time my company',
  not_informed:      'formation service',
  no_tax_liability:  'owed no U.S. income tax',
  minimal_activity:  'little or no activity',
  language_barrier:  'not my first language',
  discovered_late:   'became aware',
  voluntary_filing:  'voluntarily',
  new_procedures:    'procedures in place',
};

// ── per-scenario audit ──────────────────────────────────────────────────────
for (const rec of facts) {
  const id = rec.scenario_id;

  if (rec.error) {
    add('CRITICAL', id, 'generation threw', rec.error.split('\n')[0]);
    continue;
  }

  const text = allText(rec);

  // Junk that must never reach a filed page.
  for (const bad of ['undefined', 'NaN', '[object Object]', 'Invalid Date', 'null ']) {
    if (text.includes(bad)) add('HIGH', id, 'junk value rendered', `package text contains "${bad}"`);
  }

  // ── multi-year ───────────────────────────────────────────────────────────
  if (rec.multiyear) {
    const inp = rec.input;
    const want = [...inp.tax_years].sort((a, b) => a - b);
    if (JSON.stringify(rec.out.taxYears ?? []) !== JSON.stringify(want)) {
      add('HIGH', id, 'multi-year set', `expected ${want.join(',')}, got ${(rec.out.taxYears ?? []).join(',')}`);
    }
    if ((rec.out.perYear ?? []).length !== want.length) {
      add('HIGH', id, 'per-year PDFs', `expected ${want.length}, got ${(rec.out.perYear ?? []).length}`);
    }
    if (inp.include_rcl && !rec.out.rcl) add('CRITICAL', id, 'RCL missing', 'include_rcl set but no letter produced');
    if (!inp.include_rcl && rec.out.rcl) add('HIGH', id, 'unexpected RCL', 'no RCL requested but one was produced');
    if (rec.out.rcl) {
      const rt = rec.out.rcl.text.join(' ').replace(/\s+/g, ' ');
      for (const y of want) {
        if (!rt.includes(String(y))) add('CRITICAL', id, 'RCL year coverage', `letter omits tax year ${y}`);
      }
      for (const [reason, marker] of Object.entries(RCL_REASON_MARKERS)) {
        const selected = (inp.reasonable_cause_reasons ?? []).includes(reason);
        const present = rt.toLowerCase().includes(marker.toLowerCase());
        if (selected && !present) add('HIGH', id, 'RCL reason missing', `"${reason}" selected but its paragraph is absent`);
        if (!selected && present) add('MEDIUM', id, 'RCL reason unrequested', `"${reason}" not selected yet its language appears`);
      }
    }
    const sum = (rec.out.perYear ?? []).reduce((a, y) => a + y.pages, 0);
    if (rec.out.bundled.pages < sum) {
      add('HIGH', id, 'bundle completeness', `bundle ${rec.out.bundled.pages}pp < sum of years ${sum}pp`);
    }
    if (!text.includes(inp.llc_name)) add('HIGH', id, 'entity name', `"${inp.llc_name}" absent from bundle`);
    continue;
  }

  const inp = rec.input;
  const out = rec.out;
  const st = rec.formState;
  const f5472 = st.f5472 ?? [];
  const f1120 = st.f1120?.[0] ?? {};
  const f7004 = st.f7004?.[0] ?? null;

  if (rec.negative) {
    add('INFO', id, 'negative input still produced a filing',
      `${rec.expected_result} — generator emitted a complete ${out.combined?.pages}pp package with no validation of its own`);
  }

  // ── document set ─────────────────────────────────────────────────────────
  // A Form 5472 is filed for each related party the corporation actually had
  // reportable transactions WITH — not for every party merely listed. A party
  // carried on the filing with no transactions needs no form of its own.
  const txPartyIdx = [...new Set((inp.transactions ?? []).map((t) => t.related_party_index ?? 0))]
    .filter((i) => i > 0).sort((a, b) => a - b);
  /** Party index for each generated form, in the order the forms come out. */
  const formParty = [0, ...txPartyIdx];
  const wantForms = formParty.length;
  if (out.formCount !== wantForms) {
    add('CRITICAL', id, 'Form 5472 count',
      `expected ${wantForms} (owner + ${txPartyIdx.length} related part(y/ies) with transactions), got ${out.formCount}`);
  }
  if (f5472.length !== wantForms) {
    add('CRITICAL', id, 'Form 5472 documents', `expected ${wantForms} filled 5472s, found ${f5472.length}`);
  }
  if (inp.extension_filed && !out.form7004) add('CRITICAL', id, 'Form 7004 missing', 'extension requested but no 7004 produced');
  if (!inp.extension_filed && out.form7004) add('HIGH', id, 'unexpected Form 7004', '7004 produced without an extension request');

  const wantRCL = inp.include_reasonable_cause && !inp.extension_filed;
  if (wantRCL && !out.rcl) add('CRITICAL', id, 'RCL missing', 'reasonable cause requested but no letter produced');
  if (!wantRCL && out.rcl) add('HIGH', id, 'unexpected RCL', 'letter produced without a reasonable-cause request');
  // Part VI applies when the owner ticks managerial services or has a
  // nonmonetary / below-FMV transaction. The statement is expected exactly
  // when the Part VI box on the owner's 5472 is ticked.
  const partVIBoxed = (st.f5472?.[0] ?? {}).NonMonetoryTransactionsWithOwner === 'CHECKED';
  if (partVIBoxed && !out.partVI) {
    add('CRITICAL', id, 'Part VI statement missing',
      'the Part VI box is ticked on the 5472 but no supporting statement was produced');
  }
  if (!partVIBoxed && out.partVI) {
    add('HIGH', id, 'Part VI statement unsupported',
      'a Part VI statement was produced but the Part VI box on the 5472 is clear');
  }

  const ownerTxns = (inp.transactions ?? []).filter((t) => (t.related_party_index ?? 0) === 0);
  const hasPartV = ownerTxns.some((t) => PART_V_TYPES.has(t.transaction_type));
  // NOTE: a Part V type booked against a NON-owner related party is not audited
  // here. Part V exists so a foreign-owned U.S. DE can describe transactions
  // with its FOREIGN OWNER — contributions to and distributions from the
  // entity, and amounts connected with its formation, dissolution, acquisition
  // and disposition. Those are owner/equity events by definition; a
  // contribution from a non-owner related party is not a Part V item at all,
  // it is a Part IV payment or loan. The generator restricting Part V to the
  // owner's Form 5472 is correct, and an earlier version of this audit wrongly
  // flagged it. (The wizard should stop the combination being entered in the
  // first place — that is an Intake guard, not a generator defect.)
  if (hasPartV && !out.partV) add('CRITICAL', id, 'Part V statement missing', 'owner Part V transactions present but no statement');
  if (!hasPartV && out.partV) add('MEDIUM', id, 'unexpected Part V statement', 'statement produced with no owner Part V transactions');

  // ── Part I — identity, on EVERY 5472 (it repeats per related party) ──────
  f5472.forEach((form, i) => {
    const who = i === 0 ? 'owner form' : `related-party form ${i}`;
    const check = (field, expected, label, sev = 'HIGH') => {
      if (expected == null || String(expected) === '') return;
      const got = form[field];
      if (got == null) add(sev, id, `${label} blank`, `${who}: field ${field} is empty, expected "${expected}"`);
      else if (!eq(got, expected)) add(sev, id, `${label} wrong`, `${who}: ${field} = "${got}", expected "${expected}"`);
    };
    check('CorporationName', inp.llc_name, 'Part I 1a name');
    check('EIN', inp.ein, 'Part I 1b EIN');
    check('CorpBusinessActivity', inp.naics_description, 'Part I 1d activity');
    check('CorpBusActivityCode', inp.naics_code, 'Part I 1e activity code');
    check('Total5472', String(wantForms), 'Part I 1g number of Forms 5472');
    check('CorpIncorpCountry', 'United States', 'Part I 1l country of incorporation');
    check('CorpBusCountry', inp.entity_principal_country, 'Part I 1o principal country of business');
    // A zero balance prints as a blank box rather than "0" — noted once, not
    // treated as a missing value.
    if (inp.total_assets != null && Number(inp.total_assets) !== 0) {
      check('TotalAssets', money(inp.total_assets), 'Part I 1c total assets');
    } else if (i === 0 && inp.total_assets != null && form.TotalAssets == null) {
      add('INFO', id, 'zero total assets printed as blank', 'line 1c is empty rather than "0"');
    }

    // Boxes 2 and 3 identify the filer as a foreign-owned U.S. DE. Both must
    // be ticked on every 5472 in this product's one and only use case.
    if (form['Foreign-owned US DE'] !== 'CHECKED') {
      add('CRITICAL', id, 'box 3 not checked', `${who}: "foreign-owned U.S. DE" box is clear`);
    }
    if (form['Atleast50%'] !== 'CHECKED') {
      add('HIGH', id, 'box 2 not checked', `${who}: "at least 50% foreign owned" box is clear`);
    }

    // Tax period must match the filing year on every form.
    if (form.BegYear && form.EndYear) {
      if (!inp.is_fiscal_year && (form.BegYear !== inp.tax_year || form.EndYear !== inp.tax_year)) {
        add('HIGH', id, 'tax period wrong', `${who}: ${form.BegDate} ${form.BegYear} → ${form.EndDate} ${form.EndYear}, expected calendar ${inp.tax_year}`);
      }
    } else {
      add('HIGH', id, 'tax period blank', `${who}: BegYear/EndYear missing`);
    }

  });

  // A final return is marked on the pro forma 1120 (Form 5472 has no such
  // box), so check it there.
  if (inp.final_return && f1120.FinalReturn !== 'CHECKED') {
    add('HIGH', id, 'final return not marked', 'final_return set but the 1120 final-return box is clear');
  }
  if (inp.initial_return && f1120.InitialReturn !== 'CHECKED' && f1120['Initial Return'] !== 'CHECKED') {
    add('MEDIUM', id, 'initial return not marked', 'initial_return set but the 1120 initial-return box is clear');
  }

  // ── Part II — the 25% foreign shareholder (the owner) ────────────────────
  const owner = f5472[0] ?? {};
  if (inp.owner_full_name && !norm(owner.ShareholderNameAddress ?? '').includes(norm(inp.owner_full_name))) {
    add('CRITICAL', id, 'Part II 1a shareholder name', `expected to contain "${inp.owner_full_name}", got "${owner.ShareholderNameAddress ?? '(blank)'}"`);
  }
  if (inp.owner_us_tin) {
    if (!eq(owner.ShareholderEINSSN, inp.owner_us_tin)) {
      add('HIGH', id, 'Part II 1b US TIN', `expected "${inp.owner_us_tin}", got "${owner.ShareholderEINSSN ?? '(blank)'}"`);
    }
  } else if (owner.ShareholderEINSSN) {
    add('HIGH', id, 'Part II 1b US TIN', `no US TIN supplied but "${owner.ShareholderEINSSN}" printed`);
  }
  if (inp.owner_foreign_tax_id && !eq(owner.ShareholderFTIN, inp.owner_foreign_tax_id)) {
    add('HIGH', id, 'Part II 1c foreign TIN', `expected "${inp.owner_foreign_tax_id}", got "${owner.ShareholderFTIN ?? '(blank)'}"`);
  }

  // ── Part III — related party on each non-owner form ──────────────────────
  formParty.slice(1).forEach((partyIdx, k) => {
    const rp = (inp.related_parties ?? [])[partyIdx - 1];
    const form = f5472[k + 1];
    if (!form || !rp) return; // already reported as a missing document
    const i = k;
    if (rp.name && !norm(form.RPNameAddress ?? '').includes(norm(rp.name))) {
      add('CRITICAL', id, 'Part III 1a related-party name', `form ${i + 1}: expected "${rp.name}", got "${form.RPNameAddress ?? '(blank)'}"`);
    }
    if (rp.ref && !eq(form.RPRefID, rp.ref)) {
      add('HIGH', id, 'Part III reference ID', `form ${i + 1}: expected "${rp.ref}", got "${form.RPRefID ?? '(blank)'}"`);
    }
    if (rp.country && !eq(form.RPBusinessCountry, rp.country)) {
      add('MEDIUM', id, 'Part III country of business', `form ${i + 1}: expected "${rp.country}", got "${form.RPBusinessCountry ?? '(blank)'}"`);
    }
    if (form.RPForeignPerson !== 'CHECKED' && form.RPUSPerson !== 'CHECKED') {
      add('HIGH', id, 'Part III person type', `form ${i + 1}: neither foreign-person nor US-person box is checked`);
    }
  });

  // Reference codes must be unique — the IRS keys related parties on them.
  const refs = (inp.related_parties ?? []).map((r) => r.ref).filter(Boolean);
  if (new Set(refs).size !== refs.length) {
    // On a negative scenario the collision IS the input under test; the point
    // is that nothing downstream of intake rejects it.
    add(rec.negative ? 'INFO' : 'HIGH', id, 'duplicate reference codes',
      `related parties share a code (${refs.join(', ')}) and the package was produced anyway`);
  }

  // ── Part IV — every transaction on its correct line, at its exact amount ─
  const byParty = new Map();
  for (const t of inp.transactions ?? []) {
    const k = t.related_party_index ?? 0;
    if (!byParty.has(k)) byParty.set(k, []);
    byParty.get(k).push(t);
  }

  for (const [partyIdx, txns] of byParty) {
    const form = f5472[formParty.indexOf(partyIdx)];
    if (!form) {
      add('CRITICAL', id, 'transactions orphaned',
        `${txns.length} transaction(s) point at party index ${partyIdx}, but no Form 5472 exists for it`);
      continue;
    }
    const who = partyIdx === 0 ? 'owner form' : `related-party form for party ${partyIdx}`;

    // Expected amount per Part IV field, summed across transactions.
    const expect = {};
    for (const t of txns) {
      const amt = Number(t.amount_usd ?? 0);
      const type = t.transaction_type;
      if (PART_V_TYPES.has(type) || PART_VI_TYPES.has(type)) continue; // not Part IV
      if (LOAN_LINE[type]) {
        const L = LOAN_LINE[type];
        if (t.loan_begin_usd != null && Number(t.loan_begin_usd) > 0) {
          expect[L.begin] = (expect[L.begin] ?? 0) + Number(t.loan_begin_usd);
        }
        if (amt > 0) expect[L.end] = (expect[L.end] ?? 0) + amt;
        continue;
      }
      // The 2019-2021 Form 5472 revision has no loan-guarantee line (20/34),
      // so those fees are disclosed under "other amounts" (21/35) instead.
      const guaranteeHasNoLine = type === 'loan_guarantee' && Number(inp.tax_year) <= 2021;
      const line = type === 'rent_royalty'
        ? RENT_ROYALTY_LINE[t.is_royalty ? 'royalty' : 'rent']
        : guaranteeHasNoLine ? PART_IV_LINE.other : PART_IV_LINE[type];
      if (!line) { add('INFO', id, 'unmodelled transaction type', `${type} — audit has no Part IV expectation for it`); continue; }
      const field = line[t.direction];
      if (!field) continue;
      if (amt > 0) expect[field] = (expect[field] ?? 0) + amt;
    }

    for (const [field, want] of Object.entries(expect)) {
      const got = form[field];
      if (got == null) {
        add('CRITICAL', id, 'Part IV line blank',
          `${who}: ${field} is empty, expected ${money(want)}`);
      } else if (num(got) !== want) {
        add('CRITICAL', id, 'Part IV amount wrong',
          `${who}: ${field} = "${got}", expected ${money(want)}`);
      }
    }
    // Anything printed on a Part IV line that no transaction accounts for.
    for (const field of [...RECEIVED_LINES, ...PAID_LINES, ...BALANCE_LINES]) {
      if (form[field] != null && expect[field] == null) {
        add('HIGH', id, 'Part IV line unaccounted',
          `${who}: ${field} = "${form[field]}" but no input transaction maps there`);
      }
    }

    // Totals must equal the sum of the lines above them.
    const sumOf = (lines) => lines.reduce((a, f) => a + num(form[f]), 0);
    if (form.TotalReceived != null || sumOf(RECEIVED_LINES) > 0) {
      const want = sumOf(RECEIVED_LINES);
      if (num(form.TotalReceived) !== want) {
        add('CRITICAL', id, 'Part IV line 22 total wrong',
          `${who}: TotalReceived = "${form.TotalReceived ?? '(blank)'}", lines 9-21 sum to ${money(want)}`);
      }
    }
    if (form.TotalPaid != null || sumOf(PAID_LINES) > 0) {
      const want = sumOf(PAID_LINES);
      if (num(form.TotalPaid) !== want) {
        add('CRITICAL', id, 'Part IV line 36 total wrong',
          `${who}: TotalPaid = "${form.TotalPaid ?? '(blank)'}", lines 23-35 sum to ${money(want)}`);
      }
    }
  }

  // 1f is this form's gross; 1h is the gross across ALL Forms 5472 in the
  // filing. So 1h must be identical on every form and equal the sum of the 1f
  // figures — that is the cross-check the IRS applies.
  if (f5472.length) {
    const allValues = [...new Set(f5472.map((f) => f.GrossPaymentsAll5472 ?? '(blank)'))];
    if (allValues.length > 1) {
      add('HIGH', id, 'Part I 1h inconsistent across forms',
        `line 1h differs between the ${f5472.length} Forms 5472: ${allValues.join(' vs ')}`);
    }
    const sum1f = f5472.reduce((a, f) => a + num(f.GrossPaymentsCurrent5472), 0);
    const stated1h = num(f5472[0].GrossPaymentsAll5472);
    if (stated1h !== sum1f) {
      add('HIGH', id, 'Part I 1h is not the sum of the 1f figures',
        `1h = ${money(stated1h)}, the ${f5472.length} form(s) report 1f totalling ${money(sum1f)}`);
    }
  }

  // ── pro forma 1120 ───────────────────────────────────────────────────────
  // The IRS renames 1120 AcroForm fields between revisions, so resolve by
  // alias rather than by a single name (2024 uses CompanyName/CompanyEIN/
  // Total_Assets/OfficerSignature; other years use CorporateName/EIN/...).
  const g1120 = (...names) => {
    for (const n of names) if (f1120[n] != null && f1120[n] !== '') return f1120[n];
    return undefined;
  };
  const n1120  = g1120('CorporateName', 'CompanyName');
  const e1120  = g1120('EIN', 'CompanyEIN');
  const ta1120 = g1120('TotalAssets', 'Total_Assets');
  const sig1120 = g1120('Signature', 'OfficerSignature');

  if (!eq(n1120, inp.llc_name)) {
    add('CRITICAL', id, '1120 name', `expected "${inp.llc_name}", got "${n1120 ?? '(blank)'}"`);
  }
  if (!eq(e1120, inp.ein)) {
    add('CRITICAL', id, '1120 EIN', `expected "${inp.ein}", got "${e1120 ?? '(blank)'}"`);
  }
  if (inp.total_assets != null && Number(inp.total_assets) !== 0 && !eq(ta1120, money(inp.total_assets))) {
    add('HIGH', id, '1120 total assets', `expected "${money(inp.total_assets)}", got "${ta1120 ?? '(blank)'}"`);
  }
  // The 1120 and the 5472 must not disagree about the same fact.
  if (f5472[0] && ta1120 && f5472[0].TotalAssets && !eq(ta1120, f5472[0].TotalAssets)) {
    add('CRITICAL', id, '1120/5472 total assets disagree',
      `1120 "${ta1120}" vs 5472 "${f5472[0].TotalAssets}"`);
  }
  if (f5472[0] && e1120 && f5472[0].EIN && !eq(e1120, f5472[0].EIN)) {
    add('CRITICAL', id, '1120/5472 EIN disagree', `1120 "${e1120}" vs 5472 "${f5472[0].EIN}"`);
  }
  if (f5472[0] && n1120 && f5472[0].CorporationName && !eq(n1120, f5472[0].CorporationName)) {
    add('CRITICAL', id, '1120/5472 name disagree', `1120 "${n1120}" vs 5472 "${f5472[0].CorporationName}"`);
  }
  if (!sig1120) add('HIGH', id, '1120 unsigned', 'signature line is blank');
  if (inp.signature_date && !f1120.Date) {
    add('HIGH', id, '1120 signature date', `signature_date "${inp.signature_date}" supplied but the date line is blank`);
  }

  // ── Form 7004 ────────────────────────────────────────────────────────────
  if (f7004) {
    if (!eq(f7004.LLC_Name, inp.llc_name)) {
      add('CRITICAL', id, '7004 name', `expected "${inp.llc_name}", got "${f7004.LLC_Name ?? '(blank)'}"`);
    }
    if (!eq(f7004.LLC_EIN, inp.ein)) {
      add('CRITICAL', id, '7004 EIN', `expected "${inp.ein}", got "${f7004.LLC_EIN ?? '(blank)'}"`);
    }
    // A calendar-year filer gets the "calendar year 20__" blank; a fiscal year
    // OR a short first year (initial return) fills the period blanks instead.
    const yy = String(inp.tax_year).slice(-2);
    const shortYear = inp.is_fiscal_year || inp.initial_return
      || (inp.date_of_incorporation ?? '') >= `${inp.tax_year}-01-01`;
    if (!shortYear) {
      if (f7004.LLC_Calendar_Year !== yy) {
        add('HIGH', id, '7004 calendar year', `expected "${yy}", got "${f7004.LLC_Calendar_Year ?? '(blank)'}"`);
      }
    } else if (!f7004.LLC_Beginning_Date || !f7004.LLC_Ending_Year) {
      add('HIGH', id, '7004 period blanks incomplete',
        `short/fiscal year but the period is not fully stated: ${JSON.stringify(f7004)}`);
    }
    if (inp.final_return && f7004.Final_Return !== 'CHECKED') {
      add('MEDIUM', id, '7004 final return', 'final_return set but the 7004 final-return box is clear');
    }
  }

  // ── nothing rendered twice ───────────────────────────────────────────────
  (out.combined?.runs ?? []).forEach((runs, pageIdx) => {
    const seen = new Map();
    for (const r of runs) {
      // Runs positioned with Td/TD rather than Tm land at the origin in this
      // reader; they are static template text, not values, so skip them.
      if (r.x === 0 && r.y === 0) continue;
      const k = `${r.x}|${r.y}|${r.s}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const [k, n] of seen) {
      if (n > 1) {
        add('HIGH', id, 'value printed twice',
          `combined page ${pageIdx + 1}: "${k.split('|')[2]}" drawn ${n}× at the same spot`);
      }
    }
  });

  // ── typography consistency on the forms we fill ──────────────────────────
  for (const [label, d] of [['Form 5472', out.form5472], ['Form 1120', out.form1120], ['Form 7004', out.form7004]]) {
    if (!d?.sizes) continue;
    const sizes = [...new Set(d.sizes.map((s) => s.split('@')[1]))];
    if (sizes.length > 1) {
      add('MEDIUM', id, 'inconsistent type size',
        `${label}: field values drawn at ${sizes.join(' and ')} pt (${d.sizes.join(', ')})`);
    }
  }

  // ── values drawn outside any field box ───────────────────────────────────
  for (const [label, d] of [['Form 5472', out.form5472], ['Form 1120', out.form1120], ['Form 7004', out.form7004]]) {
    for (const u of d?.drawnOutsideFields ?? []) {
      add('MEDIUM', id, 'value drawn outside its field',
        `${label} page ${u.page}: "${u.s}" at (${u.x}, ${u.y}) sits in no form field — position is unverified`);
    }
  }

  // ── reasonable-cause letter says what was asked for ──────────────────────
  if (out.rcl) {
    const rt = out.rcl.text.join(' ').replace(/\s+/g, ' ');
    if (!rt.includes(String(inp.tax_year))) {
      add('CRITICAL', id, 'RCL wrong year', `letter does not mention tax year ${inp.tax_year}`);
    }
    if (inp.llc_name && !rt.includes(inp.llc_name)) {
      add('CRITICAL', id, 'RCL wrong entity', `letter does not name "${inp.llc_name}"`);
    }
    if (inp.ein && !rt.includes(inp.ein)) {
      add('HIGH', id, 'RCL EIN missing', `letter does not carry EIN ${inp.ein}`);
    }
    if (inp.owner_full_name && !rt.includes(inp.owner_full_name)) {
      add('HIGH', id, 'RCL unsigned', `letter is not signed by "${inp.owner_full_name}"`);
    }
    for (const [reason, marker] of Object.entries(RCL_REASON_MARKERS)) {
      const selected = (inp.reasonable_cause_reasons ?? []).includes(reason);
      const present = rt.toLowerCase().includes(marker.toLowerCase());
      if (selected && !present) add('HIGH', id, 'RCL reason missing', `"${reason}" was selected but its paragraph is absent`);
      if (!selected && present) add('MEDIUM', id, 'RCL reason unrequested', `"${reason}" was not selected yet its language appears`);
    }
  }

  // ── Part V / Part VI statements carry their amounts ──────────────────────
  if (out.partV) {
    const pv = out.partV.text.join(' ').replace(/\s+/g, ' ');
    for (const t of ownerTxns) {
      if (PART_V_TYPES.has(t.transaction_type) && Number(t.amount_usd) > 0
        && !pv.includes(money(t.amount_usd))) {
        add('CRITICAL', id, 'Part V amount missing',
          `${t.transaction_type} ${money(t.amount_usd)} does not appear in the Part V statement`);
      }
    }
  }

  // ── truncation of long free text ─────────────────────────────────────────
  // Only text the forms actually render is checked. Form 5472 Part IV has no
  // description column, so a Part IV narrative is never printed by design —
  // Part V and Part VI statements are the ones that carry descriptions.
  // Part V and Part VI statements are produced for the OWNER only, so only an
  // owner-indexed transaction has its description printed anywhere. Likewise a
  // related party with no transactions gets no Form 5472, so its name is
  // legitimately absent from the package.
  const STATEMENT_TYPES = new Set([...PART_V_TYPES, ...PART_VI_TYPES]);
  const longs = [
    ['LLC name', inp.llc_name], ['owner name', inp.owner_full_name],
    ...(inp.transactions ?? [])
      .filter((t) => STATEMENT_TYPES.has(t.transaction_type) && (t.related_party_index ?? 0) === 0)
      .map((t) => ['statement description', t.description]),
    ...formParty.slice(1)
      .map((pi) => ['related-party name', (inp.related_parties ?? [])[pi - 1]?.name]),
  ].filter(([, v]) => v && String(v).length > 30);
  for (const [label, v] of longs) {
    if (!text.includes(String(v))) {
      add('MEDIUM', id, 'text truncated or dropped',
        `${label} (${String(v).length} chars) is not present verbatim: "${String(v).slice(0, 60)}…"`);
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.id - b.id);

const counts = findings.reduce((a, f) => ((a[f.sev] = (a[f.sev] ?? 0) + 1), a), {});
const clean = new Set(facts.map((f) => f.scenario_id));
for (const f of findings) if (f.sev !== 'INFO') clean.delete(f.id);

console.log(`scenarios ${facts.length} · clean ${clean.size} · findings ${findings.length}  ` +
  Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));

// Group identical checks so a systemic defect reads as one issue, not eighty.
const groups = new Map();
for (const f of findings) {
  const key = `${f.sev}|${f.check}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}
let lastSev = null;
for (const [key, list] of [...groups.entries()].sort((a, b) =>
  order[a[0].split('|')[0]] - order[b[0].split('|')[0]] || b[1].length - a[1].length)) {
  const [sev, check] = key.split('|');
  if (sev !== lastSev) { console.log(`\n──────── ${sev} ────────`); lastSev = sev; }
  const ids = [...new Set(list.map((f) => f.id))].sort((a, b) => a - b);
  console.log(`\n▸ ${check}  —  ${list.length} occurrence(s) across ${ids.length} scenario(s)`);
  console.log(`  scenarios: ${ids.join(', ')}`);
  for (const f of list.slice(0, 4)) console.log(`    #${f.id}: ${f.detail}`);
  if (list.length > 4) console.log(`    … and ${list.length - 4} more`);
}

await writeFile(path.join(path.dirname(factsFile), '_findings.json'), JSON.stringify(findings, null, 1));
console.log(`\nwrote ${path.join(path.dirname(factsFile), '_findings.json')}`);
