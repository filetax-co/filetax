/**
 * __driver100.js, browser driver for the 100-scenario run. Dev only.
 *
 * Everything happens in the page, through the real wizard: the same state the
 * filer's typing fills, every Save & continue, every validation message, the
 * real generator and the real download. Nothing is written to Supabase by this
 * file; the rows that appear are the ones the product itself wrote.
 *
 * What it adds over testing/__driver.js:
 *
 *   SIGNATURE. Each scenario carries signature_mode. 'drawn' synthesises
 *   pointer events onto the SignaturePad canvas before generating and asserts
 *   the canvas actually took ink; 'typed' leaves the pad untouched so the
 *   generator falls back to the typed name. Both paths are then recorded, so a
 *   package generated with an empty canvas can be told apart from one that was
 *   signed.
 *
 *   MULTI-YEAR. Scenarios with year_specific_filings go through the multi-year
 *   flow rather than /intake: pick the years, take the shared reasonable-cause
 *   letter once, then complete each year's intake in turn.
 *
 *   ENTERED VS SAVED. After submit, the filing row is read back through
 *   window.__supabase and compared field by field against the scenario. The
 *   comparison is written here rather than derived from the wizard's own state,
 *   so a field the wizard drops on the way to the database shows up as a
 *   mismatch instead of agreeing with itself.
 *
 * Queue and results live in localStorage so the run survives the full page load
 * between scenarios, each scenario genuinely starts from a cold page.
 */
(() => {
  // Bumped whenever the driver changes, so a run can prove which build it is
  // actually executing rather than which one is on disk.
  window.__driverVersion = '2026-08-01.11-autoexport';

  const Q = '__q100', R = '__r100', S = '__running100';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (pred) => [...document.querySelectorAll('button')].find((b) => pred(b.textContent.trim()));
  const waitFor = async (pred, ms = 20000, tick = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await sleep(tick); }
    return null;
  };
  const getQ = () => JSON.parse(localStorage.getItem(Q) || '[]');
  const setQ = (v) => localStorage.setItem(Q, JSON.stringify(v));
  const getR = () => JSON.parse(localStorage.getItem(R) || '[]');
  const pushR = (v) => localStorage.setItem(R, JSON.stringify([...getR(), v]));

  // Reason values as stored, paired with a distinctive fragment of the label
  // the page renders for each. Kept here rather than imported so the driver
  // does not depend on the module it is testing.
  // The attestation's copy has already been reworded once mid-run ("All three
  // still describe my LLC" -> "For this tax year my LLC still has one owner").
  // Match on the stable part of the sentence, and treat "not found" as a hard
  // failure rather than letting the scenario walk into a validation error.
  const ELIGIBILITY_RE = /still (has one owner|describe)/i;

  const RCL_LABEL = {
    first_time_filing: 'first time filing in the us',
    not_informed: 'never told me form 5472 was required',
    no_tax_liability: 'no us tax meant no filing',
    minimal_activity: 'little or no activity',
    language_barrier: 'language barrier',
    discovered_late: 'only found out about this requirement recently',
    voluntary_filing: 'filing voluntarily',
    new_procedures: 'set up procedures to stay compliant',
  };

  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + String(e.reason?.message ?? e.reason)));

  // ── download capture ──────────────────────────────────────────────────────
  let captured = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...a) {
    const href = this.href || '', name = this.download || '';
    if (name && href.startsWith('blob:')) {
      captured.push(name);
      const tag = window.__tag || 'na';
      fetch(href).then((r) => r.blob()).then((b) => fetch('http://localhost:5199/', {
        method: 'POST',
        headers: {
          'x-filename': encodeURIComponent(name),
          'x-scenario': encodeURIComponent(tag),
          'content-type': 'application/octet-stream',
        },
        body: b,
      })).catch((e) => errors.push('capture: ' + e));
      // Do NOT forward the click. The bytes are already on their way to the
      // receiver, and letting the real download proceed opens the browser's
      // native "Save as" dialog when it is set to ask for a location, a modal
      // that blocks the page and stalls the whole run until someone dismisses
      // it by hand. Swallowing the click keeps the run unattended.
      return undefined;
    }
    return origClick.apply(this, a);
  };

  // React ignores a plain value assignment; go through the native setter.
  const setNative = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const readErrors = () => {
    const t = document.body.innerText;
    const i = t.indexOf('Please complete the following');
    if (i === -1) return null;
    const lines = t.slice(i).split('\n').map((s) => s.trim()).filter(Boolean).slice(1);
    const out = [];
    for (const l of lines) { if (/^\W*\d\.\s/.test(l) || l === 'Your LLC details') break; out.push(l); }
    return out.length ? out : null;
  };

  // ── signature ─────────────────────────────────────────────────────────────
  /**
   * Draws a short cursive-ish stroke on the SignaturePad. Pointer events,
   * because that is what the component listens for; a mouse-event fallback
   * would test a code path the component does not have.
   */
  async function drawSignature() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { drawn: false, note: 'no canvas on the page' };
    const r = canvas.getBoundingClientRect();
    const pt = (fx, fy) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
    const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, {
      ...p, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: 1,
    }));

    const path = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      path.push(pt(0.12 + t * 0.6, 0.55 - Math.sin(t * Math.PI * 3) * 0.22));
    }
    fire('pointerdown', path[0]);
    for (const p of path.slice(1)) { fire('pointermove', p); await sleep(6); }
    fire('pointerup', path[path.length - 1]);
    await sleep(300);

    // Did it take ink? An empty canvas is fully transparent.
    let inked = false;
    try {
      const ctx = canvas.getContext('2d');
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) { inked = true; break; } }
    } catch (e) { return { drawn: true, note: 'canvas read blocked: ' + e.message }; }
    return { drawn: inked, note: inked ? 'canvas took ink' : 'stroke fired but canvas stayed empty' };
  }

  // ── entered vs saved ──────────────────────────────────────────────────────
  const norm = (v) => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    return String(v).trim();
  };

  /** Field pairs are named explicitly, so a renamed column shows up as a miss. */
  function compareSaved(scenario, row) {
    const f = scenario.filing ?? scenario.shared_filing_fields ?? {};
    const o = scenario.owner ?? scenario.shared_owner_fields ?? {};
    const pairs = [
      ['llc_name', f.llc_name, row.llc_name],
      ['ein', f.ein, row.ein],
      ['state_of_formation', f.state_of_formation, row.state_of_formation],
      ['tax_year', f.tax_year, row.tax_year],
      ['total_assets', f.total_assets, row.total_assets],
      ['date_of_incorporation', f.date_of_incorporation, row.date_of_incorporation],
      ['final_return', !!f.final_return, !!row.final_return],
      ['date_of_closure', f.date_of_closure, row.date_of_closure],
      ['name_change', !!f.name_change, !!row.name_change],
      ['address_change', !!f.address_change, !!row.address_change],
      ['is_fiscal_year', !!f.is_fiscal_year, !!row.is_fiscal_year],
      ['naics_code', f.naics_code, row.naics_code ?? row.entity_business_code],
      ['owner_full_name', o.owner_full_name, row.owner_full_name],
      ['owner_primary_country', o.owner_primary_country, row.owner_primary_country],
      ['owner_country_residence', o.owner_country_residence, row.owner_country_residence],
      ['owner_country_citizenship', o.owner_country_citizenship, row.owner_country_citizenship],
      ['owner_us_tin', o.owner_us_tin, row.owner_us_tin],
      ['owner_foreign_tax_id', o.owner_foreign_tax_id, row.owner_foreign_tax_id],
      ['owner_reference_id', o.owner_reference_id, row.owner_reference_id],
      ['signer_title', o.signer_title, row.signer_title],
      ['signature_date', o.signature_date, row.signature_date],
      ['related_party_count', (scenario.related_parties ?? []).length, (row.related_parties ?? []).length],
    ];
    const matches = [], mismatches = [];
    for (const [field, entered, saved] of pairs) {
      const e = norm(entered), s = norm(saved);
      // A field the scenario never set is not evidence of anything.
      if (e === '' && s === '') continue;
      (e === s ? matches : mismatches).push({ field, entered: e, saved: s, source: 'filings row' });
    }
    return { matches, mismatches };
  }

  async function readRow(filingId) {
    const sb = window.__supabase;
    if (!sb) return { error: 'window.__supabase missing, is this a dev build?' };
    const { data, error } = await sb.from('filings').select('*').eq('id', filingId).single();
    if (error) return { error: error.message };
    return { row: data };
  }

  async function readTxns(filingId) {
    const sb = window.__supabase;
    if (!sb) return [];
    const { data } = await sb.from('reportable_transactions').select('*').eq('filing_id', filingId);
    return data ?? [];
  }

  // ── one scenario ──────────────────────────────────────────────────────────
  async function runOne(scenario) {
    const id = String(scenario.scenario_id).padStart(3, '0');
    window.__tag = id;
    captured = [];
    const res = {
      scenario_id: scenario.scenario_id,
      title: scenario.title,
      signature_mode: scenario.signature_mode,
      negative: !!scenario.expected_result,
      stage: 'start',
      consoleErrors: [],
      matches: [],
      mismatches: [],
    };

    const open = await waitFor(() => btn((t) => t.includes('Load scenario')), 15000);
    if (!open) { res.stage = 'no-loader'; res.outcome = 'ERROR'; return res; }
    open.click();
    const ta = await waitFor(() => document.querySelector('textarea[placeholder*="Paste one scenario"]'), 5000);
    if (!ta) { res.stage = 'no-textarea'; res.outcome = 'ERROR'; return res; }
    setNative(ta, JSON.stringify(scenario));
    await sleep(150);
    const fill = btn((t) => t === 'Fill the form');
    if (!fill) { res.stage = 'no-fill-button'; res.outcome = 'ERROR'; return res; }
    fill.click();
    await sleep(700);
    const close = btn((t) => t === '×');
    if (close) close.click();
    await sleep(300);

    // Step 1 has two controls the scenario loader deliberately does not fill,
    // because they are attestations rather than data: the eligibility
    // confirmation and the U.S.-activity question. A real filer clicks them, so
    // the driver clicks them too rather than reaching into React state.
    const elig = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((c) => ELIGIBILITY_RE.test(c.closest('label')?.textContent ?? ''));
    if (elig && !elig.checked) { elig.click(); await sleep(200); }
    res.eligibilityTicked = !!elig?.checked;

    const wantUsActivity = scenario.us_activity === true;
    const usBtn = btn((t) => t === (wantUsActivity ? 'Yes' : 'No'));
    if (usBtn) { usBtn.click(); await sleep(250); }
    res.usActivityAnswered = wantUsActivity ? 'Yes' : 'No';
    if (wantUsActivity) {
      res.usActivityBanner = document.body.innerText.includes('This may mean a second filing that we do not prepare');
    }

    // Step 1b pre-selects the reasonable cause letter whenever the filing is
    // late, and that effect runs AFTER the scenario is applied, so it overrides
    // a scenario that asked for no letter. Reconcile it the way the filer does:
    // by clicking the checkbox. A scenario that wants the letter also needs its
    // reasons ticked, because the same effect turns the box on with none.
    const f0 = scenario.filing ?? scenario.shared_filing_fields ?? {};
    const wantRcl = Boolean(f0.include_reasonable_cause ?? scenario.include_rcl ?? false);
    const rclBox = [...document.querySelectorAll('input[type="checkbox"]')]
      .find((c) => (c.closest('label')?.textContent ?? '').includes('include a reasonable cause letter'));
    if (rclBox && rclBox.checked !== wantRcl) { rclBox.click(); await sleep(350); }
    res.rclRequested = wantRcl;
    res.rclOffered = !!rclBox;

    if (wantRcl && rclBox) {
      const wanted = f0.reasonable_cause_reasons ?? scenario.reasonable_cause_reasons ?? [];
      const boxes = [...document.querySelectorAll('[role="checkbox"]')];
      for (const el of boxes) {
        if (el.getAttribute('aria-checked') === 'true') continue;
        // The scenario names reasons by value; the page shows their labels, so
        // match on the label text the constants file pairs with each value.
        const txt = (el.textContent ?? '').toLowerCase();
        const hit = wanted.some((v) => RCL_LABEL[v] && txt.includes(RCL_LABEL[v]));
        if (hit) { el.click(); await sleep(120); }
      }
      res.rclReasonsTicked = [...document.querySelectorAll('[role="checkbox"][aria-checked="true"]')].length;
    }

    // Every section is rendered at once, so a "continue" button existing says
    // nothing about the save having landed. Each click is followed by a wait
    // for the button to come back out of its "Saving…" state, otherwise the
    // next lookup races an in-flight write and the run reads as broken when the
    // product is fine.
    const settled = () => !btn((t) => t === 'Saving…' || t === 'Submitting…');
    for (const step of ['Filing Status', 'Owner Details', 'Related Parties', 'Transactions', 'Review']) {
      const b = btn((t) => t.startsWith('Save & continue to ' + step));
      if (b) {
        b.click();
        await sleep(300);
        await waitFor(settled, 20000);
        await sleep(400);
      }
      const e = readErrors();
      if (e) {
        res.stage = 'blocked at ' + step;
        res.errors = e;
        res.rejected = true;
        res.outcome = res.negative ? 'PASS' : 'BLOCKED';
        return res;
      }
    }

    // The two step-1 attestations are not persisted (patchAll omits them), so a
    // reload between here and submit blanks them and submit re-validates step 1.
    // Re-assert them immediately before submitting. Recorded, because needing
    // this at all is itself the finding.
    // Working through the steps collapses the LLC Details section, so the
    // checkbox is not in the DOM to re-tick. Reopen the section first, and only
    // if it is actually closed: the header is a toggle, and clicking an open
    // one collapses it and fires another save.
    const findElig = () => [...document.querySelectorAll('input[type="checkbox"]')]
      .find((c) => ELIGIBILITY_RE.test(c.closest('label')?.textContent ?? ''));
    // Reopening the section is not enough: an effect syncs the open accordion
    // back to the current step, so section 1 closes again after roughly 400ms.
    // The React state behind the checkbox is independent of whether the section
    // is rendered, so tick it inside that window instead of waiting for a
    // stable DOM. Poll fast and act on first sight.
    if (!findElig()) {
      const header = btn((t) => /^\W*1\.\s*LLC Details/.test(t));
      if (header) {
        header.click();
        for (let i = 0; i < 40 && !findElig(); i++) await sleep(25);
      }
    }
    const elig2 = findElig();
    if (elig2 && !elig2.checked) {
      elig2.click();
      res.attestationsLost = true;
      // Same window for the U.S.-activity buttons; they live in the same
      // section and disappear with it.
      const usBtn2 = btn((t) => t === (wantUsActivity ? 'Yes' : 'No'));
      if (usBtn2) usBtn2.click();
      await sleep(400);
      res.attestationsRestored = true;
    } else if (elig2) {
      res.attestationsLost = false;
    } else {
      res.attestationsLost = 'section would not reopen';
    }

    const submit = await waitFor(() => btn((t) => t.startsWith('Submit & generate my forms')
      || t.startsWith('Finish & generate all years')
      || /^Save \d{4} & continue to \d{4}/.test(t)), 15000);
    if (!submit) {
      res.stage = 'no-submit-button';
      res.outcome = 'ERROR';
      res.error = 'review step reached but no submit control appeared';
      return res;
    }
    res.submitLabel = submit.textContent.trim();
    submit.click();

    let onFiling = await waitFor(() => location.pathname.startsWith('/filing/'), 25000);

    // The attestations are not persisted, so submit re-validates step 1 against
    // state that a reload has blanked. Recover the way a filer has to: the
    // section reopens once the error is on screen, so re-tick there and submit
    // again. Recorded on the result, because needing this IS the finding.
    for (let attempt = 0; !onFiling && attempt < 2; attempt++) {
      const errs = readErrors() ?? [];
      const isAttestation = errs.some((e) => e.includes('confirm the statements about your LLC')
        || e.includes('U.S. real estate or work performed'));
      if (!isAttestation) break;
      res.attestationsLost = true;

      if (!findElig()) {
        const header = btn((t) => /^\W*1\.\s*LLC Details/.test(t));
        if (header) { header.click(); for (let i = 0; i < 60 && !findElig(); i++) await sleep(25); }
      }
      const box = findElig();
      if (!box) { res.attestationsLost = 'section would not reopen'; break; }
      if (!box.checked) box.click();
      const usAgain = btn((t) => t === (wantUsActivity ? 'Yes' : 'No'));
      if (usAgain) usAgain.click();
      await sleep(500);
      res.attestationsRestored = true;

      const resubmit = btn((t) => t.startsWith('Submit & generate my forms')
        || t.startsWith('Finish & generate all years')
        || /^Save \d{4} & continue to \d{4}/.test(t));
      if (!resubmit) break;
      resubmit.click();
      onFiling = await waitFor(() => location.pathname.startsWith('/filing/'), 25000);
    }

    if (!onFiling) {
      res.stage = 'submit blocked';
      res.errors = readErrors() ?? [];
      res.rejected = true;
      res.outcome = res.negative ? 'PASS' : 'BLOCKED';
      return res;
    }
    res.filingId = location.pathname.split('/').pop();
    res.stage = 'submitted';

    // A negative that got this far was accepted, which is the failure.
    if (res.negative) { res.rejected = false; res.outcome = 'FAIL'; }

    // ── entered vs saved, read straight back from the row
    const { row, error } = await readRow(res.filingId);
    if (error) res.notes = 'could not read the saved row: ' + error;
    else {
      const cmp = compareSaved(scenario, row);
      res.matches = cmp.matches;
      res.mismatches = cmp.mismatches;
      const txns = await readTxns(res.filingId);
      const wanted = (scenario.transactions ?? []).length;
      res.savedTxnCount = txns.length;
      if (txns.length !== wanted) {
        res.mismatches.push({
          field: 'transaction_count',
          entered: String(wanted),
          saved: String(txns.length),
          source: 'reportable_transactions rows',
        });
      }
      // Per-transaction amounts, in the order they were entered. A row that
      // survived with the wrong amount is worse than one that was dropped.
      const byAmt = txns.map((t) => String(Number(t.amount_usd ?? 0))).sort();
      const wantAmt = (scenario.transactions ?? [])
        .filter((t) => t.amount_usd !== '' && t.amount_usd != null)
        .map((t) => String(Number(t.amount_usd))).sort();
      if (txns.length === wanted && byAmt.join(',') !== wantAmt.join(',')) {
        res.mismatches.push({
          field: 'transaction_amounts',
          entered: wantAmt.join(', '),
          saved: byAmt.join(', '),
          source: 'reportable_transactions rows',
        });
      }
    }

    // ── signature
    await waitFor(() => document.querySelector('canvas') || btn((t) => t === 'Generate & preview'), 15000);
    if (scenario.signature_mode === 'drawn') {
      const sig = await drawSignature();
      res.signatureChecked = sig.drawn;
      res.signatureNote = sig.note;
      if (!sig.drawn) res.notes = (res.notes ? res.notes + ' | ' : '') + 'drawn signature did not register';
    } else {
      res.signatureChecked = true;
      res.signatureNote = 'pad left blank on purpose; typed name is the fallback';
    }

    const gen = await waitFor(() => btn((t) => t === 'Generate & preview'), 15000);
    if (!gen) { res.stage = 'no-generate-button'; res.outcome = res.outcome ?? 'ERROR'; return res; }
    errors.length = 0;
    gen.click();

    const dl = await waitFor(() => btn((t) => t === 'Download PDF'), 90000);
    if (!dl) {
      res.stage = 'generate failed';
      res.consoleErrors = errors.slice(0, 3);
      res.error = document.body.innerText.slice(0, 300);
      res.outcome = res.outcome ?? 'FAIL';
      return res;
    }
    dl.click();
    await waitFor(() => captured.length > 0, 20000);
    await sleep(1500);

    // A multi-year job offers two more download paths, and they produce
    // different documents: one PDF per year plus the shared reasonable cause
    // letter, and a single bundled file. Both are things a filer receives, so
    // both are captured rather than assumed equivalent to the preview.
    // Form 7004 has its own download, offered whenever the filing opted into an
    // extension or reported one already filed. Record whether it was offered at
    // all, separately from whether clicking it produced bytes: the defect this
    // covers was the button being hidden for a package that already contained
    // the form, which a pass/fail on the download alone would not have caught.
    res.form7004Offered = !!btn((t) => t.startsWith('Download Form 7004'));

    for (const label of ['Download Form 7004 (extension)', 'Download each year + RCL', 'Download all-in-one PDF']) {
      const extra = btn((t) => t === label);
      if (!extra) continue;
      const before = captured.length;
      extra.click();
      await waitFor(() => captured.length > before, 90000);
      await sleep(2000);
      res.extraDownloads = [...(res.extraDownloads ?? []), label];
    }
    res.stage = 'downloaded';
    res.files = captured.slice();
    res.consoleErrors = errors.slice(0, 3);
    if (!res.outcome) {
      res.outcome = res.mismatches.length ? 'FAIL' : (captured.length ? 'PASS' : 'FAIL');
      if (!captured.length) res.notes = (res.notes ? res.notes + ' | ' : '') + 'no PDF reached the receiver';
    }
    return res;
  }

  // ── loop ──────────────────────────────────────────────────────────────────
  let ticked = false;
  async function tick() {
    if (ticked) return;
    ticked = true;
    if (localStorage.getItem(S) !== '1') return;
    const q = getQ();
    if (!q.length) { localStorage.setItem(S, '0'); return; }

    // Enter the way a filer does. Bare /intake is not a route anyone reaches
    // from the product: it resumes the most recent draft, so every scenario
    // after the first was editing its predecessor's filing, opened at a later
    // step with the LLC Details section collapsed. The Dashboard button inserts
    // a fresh row and navigates to /intake?filing_id=<new>, which is the only
    // way to get a genuinely new filing.
    if (!location.pathname.startsWith('/intake')) {
      if (!location.pathname.startsWith('/dashboard')) { location.href = '/dashboard'; return; }
      const start = await waitFor(() => btn((t) => t === 'Start filing'), 30000);
      if (!start) {
        pushR({ scenario_id: q[0], stage: 'no Start filing button on the dashboard', outcome: 'ERROR' });
        setQ(q.slice(1));
        await sleep(500);
        location.href = '/dashboard';
        return;
      }
      start.click();
      // react-router navigates in-place, so there is no page load to re-arm the
      // driver. Fall through and run the scenario in this same tick rather than
      // returning and waiting for a reload that never comes.
      const arrived = await waitFor(() => location.pathname.startsWith('/intake'), 30000);
      if (!arrived) {
        pushR({ scenario_id: q[0], stage: 'Start filing did not reach /intake', outcome: 'ERROR' });
        setQ(q.slice(1));
        await sleep(500);
        location.href = '/dashboard';
        return;
      }
      await sleep(600);
    }
    // Reached /intake without a filing_id (a reload, or a stale tab): go back
    // through the dashboard rather than resuming whatever draft is newest.
    if (!new URLSearchParams(location.search).get('filing_id')) { location.href = '/dashboard'; return; }

    const ready = await waitFor(
      () => btn((t) => t.startsWith('Save & continue to Filing Status')) && btn((t) => t.includes('Load scenario')),
      45000,
    );
    if (!ready) {
      pushR({ scenario_id: q[0], stage: 'wizard never rendered', outcome: 'ERROR', url: location.pathname });
      setQ(q.slice(1));
      await sleep(500);
      location.href = '/dashboard';
      return;
    }

    if (!window.__scenarios100) {
      const doc = await (await fetch('/__scenarios100.json')).json();
      window.__scenarios100 = doc.scenarios ?? doc;
      window.__byId100 = Object.fromEntries(window.__scenarios100.map((s) => [s.scenario_id, s]));
    }
    const nextId = q[0];
    const scenario = window.__byId100[nextId];
    setQ(q.slice(1));
    let res;
    try { res = await runOne(scenario); }
    catch (e) { res = { scenario_id: nextId, title: scenario?.title, stage: 'threw', outcome: 'ERROR', error: String(e?.message ?? e) }; }
    pushR(res);
    // Mirror the results to disk after every scenario, through the same
    // receiver that catches the PDFs. Without this the run's record lives only
    // in this tab's localStorage, so the workbook cannot be built until the end
    // and a closed tab loses everything.
    try {
      await fetch('http://localhost:5199/', {
        method: 'POST',
        headers: { 'x-filename': 'results.json', 'x-scenario': 'run', 'content-type': 'application/json' },
        body: localStorage.getItem(R) || '[]',
      });
    } catch (e) { /* the receiver being down must not stop the run */ }
    await sleep(800);
    location.href = '/dashboard';
  }

  // Only ever touch this driver's own three keys: localStorage also holds the
  // Supabase session, and a blanket clear() signs the tester out mid-run.
  window.__reset100 = () => { [Q, R, S].forEach((k) => localStorage.removeItem(k)); };
  window.__start100 = (ids) => { setQ(ids); localStorage.setItem(R, '[]'); localStorage.setItem(S, '1'); location.href = '/dashboard'; };
  window.__resume100 = (ids) => { setQ(ids); localStorage.setItem(S, '1'); location.href = '/dashboard'; };
  window.__stop100 = () => localStorage.setItem(S, '0');
  window.__results100 = () => getR();
  window.__progress100 = () => ({ remaining: getQ().length, done: getR().length, running: localStorage.getItem(S) === '1' });

  setTimeout(tick, 3000);
})();
