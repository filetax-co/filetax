/**
 * __driver.js - TEMPORARY end-to-end test driver. Dev only; delete after the run.
 *
 * Drives the real intake wizard exactly as a user does: fills a scenario via
 * the dev scenario loader, clicks through all six steps, submits, generates,
 * and downloads. It keeps its queue and results in localStorage so it survives
 * the full page load between scenarios - the wizard is a react-router SPA and
 * there is no client-side route back to a fresh /intake, so each scenario
 * genuinely starts from a cold page the way a real filing session would.
 *
 * Downloads are intercepted at HTMLAnchorElement.click, read back from the
 * blob URL and POSTed to scripts/pdfReceiver.mjs, so the bytes recorded are
 * the exact bytes the browser handed the user.
 */
(() => {
  const Q = '__q', R = '__r', S = '__running';
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
  const steps = () => [...document.querySelectorAll('button')]
    .map((b) => b.textContent.trim()).filter((t) => /^\W*\d\.\s/.test(t));

  async function runOne(scenario) {
    const id = String(scenario.scenario_id).padStart(3, '0');
    window.__tag = id;
    captured = [];
    const res = { id: scenario.scenario_id, title: scenario.title, negative: !!scenario.expected_result, stage: 'start' };

    const open = await waitFor(() => btn((t) => t.includes('Load scenario')), 15000);
    if (!open) { res.stage = 'no-loader'; return res; }
    open.click();
    const ta = await waitFor(() => document.querySelector('textarea[placeholder*="Paste one scenario"]'), 5000);
    if (!ta) { res.stage = 'no-textarea'; return res; }
    setNative(ta, JSON.stringify(scenario));
    await sleep(150);
    const fill = btn((t) => t === 'Fill the form');
    if (!fill) { res.stage = 'no-fill-button'; return res; }
    fill.click();
    await sleep(700);
    const close = btn((t) => t === '×');
    if (close) close.click();
    await sleep(300);

    for (const step of ['Filing Status', 'Owner Details', 'Related Parties', 'Transactions', 'Review']) {
      const b = btn((t) => t.startsWith('Save & continue to ' + step));
      if (b) { b.click(); await sleep(700); }
      const e = readErrors();
      if (e) { res.stage = 'blocked'; res.blockedAt = step; res.errors = e; res.steps = steps(); return res; }
    }
    res.steps = steps();

    const submit = btn((t) => t.startsWith('Submit & generate my forms'));
    if (!submit) { res.stage = 'no-submit-button'; return res; }
    submit.click();

    const onFiling = await waitFor(() => location.pathname.startsWith('/filing/'), 20000);
    if (!onFiling) { res.stage = 'submit-blocked'; res.errors = readErrors(); return res; }
    res.filingId = location.pathname.split('/').pop();

    const gen = await waitFor(() => btn((t) => t === 'Generate & preview'), 15000);
    if (!gen) { res.stage = 'no-generate-button'; return res; }
    errors.length = 0;
    gen.click();

    const dl = await waitFor(() => btn((t) => t === 'Download PDF'), 60000);
    if (!dl) {
      res.stage = 'generate-failed';
      res.pageError = errors.slice(0, 3).join(' | ') || null;
      res.visible = document.body.innerText.slice(0, 300);
      return res;
    }
    dl.click();
    await waitFor(() => captured.length > 0, 15000);
    await sleep(1200);
    res.stage = 'downloaded';
    res.files = captured.slice();
    if (errors.length) res.pageError = errors.slice(0, 3).join(' | ');
    return res;
  }

  let ticked = false;
  async function tick() {
    if (ticked) return;            // one run per page load, never two in flight
    ticked = true;
    if (localStorage.getItem(S) !== '1') return;
    const q = getQ();
    if (!q.length) { localStorage.setItem(S, '0'); return; }
    if (!location.pathname.startsWith('/intake')) { location.href = '/intake'; return; }

    // Vite dev + the Supabase session check mean the wizard can take several
    // seconds to paint. Wait for it to actually exist before touching it,
    // otherwise every query races an empty DOM and the scenario looks blocked.
    const ready = await waitFor(
      () => btn((t) => t.startsWith('Save & continue to Filing Status')) && btn((t) => t.includes('Load scenario')),
      45000,
    );
    if (!ready) {
      pushR({ id: q[0], stage: 'wizard-never-rendered', url: location.pathname });
      setQ(q.slice(1));
      await sleep(500);
      location.href = '/intake';
      return;
    }

    const scenarios = window.__scenarios;
    if (!scenarios) {
      const doc = await (await fetch('/__scenarios.json')).json();
      window.__scenarios = doc.scenarios ?? doc;
      window.__byId = Object.fromEntries(window.__scenarios.map((s) => [s.scenario_id, s]));
    }
    const nextId = q[0];
    const scenario = window.__byId[nextId];
    setQ(q.slice(1));
    let res;
    try { res = await runOne(scenario); }
    catch (e) { res = { id: nextId, stage: 'threw', pageError: String(e?.message ?? e) }; }
    pushR(res);
    await sleep(600);
    location.href = '/intake';
  }

  // Only ever touch this driver's own three keys. localStorage also holds the
  // Supabase session, so a blanket clear() signs the tester out mid-run.
  window.__reset = () => { [Q, R, S].forEach((k) => localStorage.removeItem(k)); };
  window.__start = (ids) => { setQ(ids); localStorage.setItem(R, '[]'); localStorage.setItem(S, '1'); location.href = '/intake'; };
  window.__stop = () => localStorage.setItem(S, '0');
  window.__results = () => getR();
  window.__progress = () => ({ remaining: getQ().length, done: getR().length, running: localStorage.getItem(S) === '1' });

  // Give the SPA a moment to paint before touching it.
  setTimeout(tick, 3000);
})();
