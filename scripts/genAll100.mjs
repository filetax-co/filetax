/**
 * genAll100 - generate the filing package for every scenario in the 100-case
 * file, write the PDFs to disk, and dump a machine-readable "facts" file
 * describing what actually came out (page counts, which documents were
 * produced, every AcroForm field value on the 5472/1120, and the text drawn
 * onto the generated statement/letter/instruction pages).
 *
 * Runs the real generator, unmodified: same normalizeFiling, same
 * mapTransactionForPersist, same fill/assemble path as the app.
 *
 *   npm run gen:all100
 *
 * Output:
 *   ../../Testing/out100/<id>. <LLC> - <year>.pdf     combined package
 *   ../../Testing/out100/_facts.json                  facts for the audit pass
 */
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Serve public/pdf to the generator's fetch() calls (it loads blank IRS forms
// over HTTP in the browser).
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const s = String(url);
  const m = s.match(/pdf\/([^/?#]+)$/);
  if (m) {
    const p = path.join(root, 'public', 'pdf', m[1]);
    if (!existsSync(p)) return new Response('missing', { status: 404 });
    return new Response(await readFile(p), { status: 200, headers: { 'content-type': 'application/pdf' } });
  }
  return realFetch(url, init);
};

const { generateFilingPackage, generateMultiYearPackage, get5472PdfUrl, get1120PdfUrl, get7004PdfUrl, narrativeFromReasonCodes } = await import('../src/lib/pdfGenerator.ts');
const { mapTransactionForPersist } = await import('../src/lib/filingMapping.ts');
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFForm } = await import('pdf-lib');

const scenariosFile = process.argv[2]
  ?? path.resolve(root, '../../Testing/filetax_test_scenarios_all100.json');
const outDir = process.argv[3] ?? path.resolve(root, '../../Testing/out100');

const doc = JSON.parse(await readFile(scenariosFile, 'utf8'));
const scenarios = doc.scenarios ?? doc;

// Clear the previous run's files rather than the directory itself - OneDrive
// keeps a handle on synced folders and rmdir intermittently fails with EBUSY.
await mkdir(outDir, { recursive: true });
for (const f of await readdir(outDir)) {
  await rm(path.join(outDir, f), { force: true }).catch(() => {});
}

// ── text extraction ─────────────────────────────────────────────────────────
/**
 * Pull the drawn text out of a PDF's content streams. The generated pages
 * (instructions, Part V/VI statements, RCL) are drawn with drawText, so their
 * content is in plain Tj/TJ operators - no font-encoding gymnastics needed.
 */
/** Inflate a stream object to its decoded bytes. */
const streamBytes = (st) => {
  if (!st?.getContents) return Buffer.alloc(0);
  const bytes = Buffer.from(st.getContents());
  try { return zlib.inflateSync(bytes); } catch { return bytes; }
};

/**
 * Concatenate a page's content with the content of every Form XObject it
 * references, recursively. Flattened AcroForm values and merged (embedded)
 * pages both live in XObjects, so a page-content-only read finds nothing on
 * the IRS forms.
 */
/**
 * Parse a /ToUnicode CMap into code → string. Both `beginbfchar` (one code at
 * a time) and `beginbfrange` (contiguous runs) forms appear in these files.
 */
const parseToUnicode = (cmapText) => {
  const map = new Map();
  const uni = (hex) => {
    let s = '';
    for (let i = 0; i + 3 < hex.length + 1; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };
  for (const blk of cmapText.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      map.set(parseInt(m[1], 16), uni(m[2]));
    }
  }
  for (const blk of cmapText.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    // <lo> <hi> <dstStart>   and   <lo> <hi> [ <d1> <d2> ... ]
    for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[3] != null) {
        const base = parseInt(m[3], 16);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + (c - lo)));
      } else {
        const dsts = [...m[4].matchAll(/<([0-9A-Fa-f]*)>/g)].map((d) => uni(d[1]));
        dsts.forEach((d, i) => map.set(lo + i, d));
      }
    }
  }
  return map;
};

/** Resource-name → { twoByte, map } for every font in a Resources dict. */
const fontTable = (pdfDoc, res) => {
  const table = {};
  const fonts = res ? pdfDoc.context.lookup(res.get?.(PDFName.of('Font'))) : null;
  if (!fonts?.entries) return table;
  for (const [name, ref] of fonts.entries()) {
    const fd = pdfDoc.context.lookup(ref);
    if (!fd?.get) continue;
    const subtype = String(fd.get(PDFName.of('Subtype')) ?? '');
    const tuRef = fd.get(PDFName.of('ToUnicode'));
    const tu = tuRef ? pdfDoc.context.lookup(tuRef) : null;
    table[String(name).replace(/^\//, '')] = {
      // Type0 fonts address glyphs with two-byte codes.
      twoByte: subtype === '/Type0',
      map: tu?.getContents ? parseToUnicode(streamBytes(tu).toString('latin1')) : null,
    };
  }
  return table;
};

/** WinAnsiEncoding's 0x80-0x9F block, which differs from Latin-1. */
const WINANSI_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š',
  0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '-',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ',
  0x9E: 'ž', 0x9F: 'Ÿ',
};

/** Multiply two PDF matrices given as [a b c d e f]. */
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/**
 * Walk a content stream, tracking the graphics state well enough to report
 * every text run in PAGE coordinates: `{x, y, font, size, s}`.
 *
 * Flattened AcroForm values live in Form XObjects that are placed with a `cm`
 * translation, so a reader that ignores the CTM reports every field at its
 * offset within its own little box - useless for saying which form line a
 * value landed on. This tracks q/Q, cm, and Do so the coordinates are real.
 */
const runStream = (pdfDoc, raw, res, ctm, out, seen, depth) => {
  if (depth > 8) return;
  const fonts = fontTable(pdfDoc, res);
  const xo = res ? pdfDoc.context.lookup(res.get?.(PDFName.of('XObject'))) : null;

  let cur = ctm;
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let resName = '', font = '', size = 0;

  const decode = (operand, isHex) => {
    const f = fonts[resName];
    let codes;
    if (isHex) {
      const hex = operand.replace(/\s/g, '');
      const step = f?.twoByte ? 4 : 2;
      codes = [];
      for (let i = 0; i < hex.length; i += step) {
        codes.push(parseInt(hex.slice(i, i + step).padEnd(step, '0'), 16));
      }
    } else {
      const lit = operand.replace(/\\([()\\])/g, '$1');
      codes = [...lit].map((c) => c.charCodeAt(0));
    }
    if (f?.map) return codes.map((c) => f.map.get(c) ?? '').join('');
    // No ToUnicode: the string is WinAnsi. Bytes 0x80-0x9F are NOT Latin-1 -
    // that range holds the typographic punctuation (en/em dashes, curly
    // quotes), so a naive fromCharCode turns a real em dash into an invisible
    // control character and makes correct output look like dropped text.
    return codes.map((c) => WINANSI_HIGH[c] ?? String.fromCharCode(c)).join('');
  };

  const emit = (s) => {
    if (!s.trim()) return;
    const m = mul(tm, cur);
    out.push({
      x: Math.round(m[4] * 10) / 10,
      y: Math.round(m[5] * 10) / 10,
      font, size: Math.round(size * Math.abs(tm[3] || 1) * 100) / 100, s,
    });
  };

  const tok = new RegExp([
    /(q|Q)(?![A-Za-z])/,                                                    // 1 save/restore
    /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+(cm|Tm)/, // 2-8
    /\/([^\s/[\]<>]+)\s+([-\d.]+)\s+Tf/,                                    // 9-10 font
    /\/([^\s/[\]<>]+)\s+Do/,                                                // 11 xobject
    /<([0-9A-Fa-f\s]*)>\s*Tj/,                                              // 12 hex
    /\(((?:\\.|[^()\\])*)\)\s*Tj/,                                          // 13 literal
    /\[((?:[^\][]|\\.)*)\]\s*TJ/,                                           // 14 array
  ].map((r) => r.source).join('|'), 'g');

  let m;
  while ((m = tok.exec(raw)) !== null) {
    if (m[1]) {
      if (m[1] === 'q') stack.push(cur);
      else cur = stack.pop() ?? cur;
      continue;
    }
    if (m[8]) {
      const mat = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7])];
      if (m[8] === 'cm') cur = mul(mat, cur);
      else tm = mat;
      continue;
    }
    if (m[9] != null) {
      resName = m[9];
      font = m[9].replace(/-\d+$/, '');
      size = Number(m[10]);
      continue;
    }
    if (m[11] != null) {
      const ref = xo?.get?.(PDFName.of(m[11]));
      const sub = ref ? pdfDoc.context.lookup(ref) : null;
      if (sub?.getContents && String(sub.dict?.get(PDFName.of('Subtype'))) === '/Form') {
        // Guard against cycles only - an XObject legitimately drawn twice at
        // two positions must be reported twice, or a genuine double-print
        // would be silently deduplicated away.
        const key = String(ref);
        if (!seen.has(key)) {
          seen.add(key);
          // A Form XObject may carry its own /Matrix, applied before the CTM.
          const mx = pdfDoc.context.lookup(sub.dict.get(PDFName.of('Matrix')));
          const own = mx?.asArray ? mx.asArray().map((v) => Number(v.toString())) : [1, 0, 0, 1, 0, 0];
          const subRes = pdfDoc.context.lookup(sub.dict.get(PDFName.of('Resources'))) ?? res;
          runStream(pdfDoc, streamBytes(sub).toString('latin1'), subRes, mul(own, cur), out, seen, depth + 1);
          seen.delete(key);
        }
      }
      continue;
    }
    if (m[12] != null) emit(decode(m[12], true));
    else if (m[13] != null) emit(decode(m[13], false));
    else if (m[14] != null) {
      emit([...m[14].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^()\\])*)\)/g)]
        .map((p) => decode(p[1] != null ? p[1] : p[2], p[1] != null)).join(''));
    }
  }
};

const pageItems = (pdfDoc, page) => {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((r) => pdfDoc.context.lookup(r))
    : [contents];
  const raw = streams.map((st) => streamBytes(st).toString('latin1')).join('\n');
  const out = [];
  runStream(pdfDoc, raw, page.node.Resources(), [1, 0, 0, 1, 0, 0], out, new Set(), 0);
  return out;
};

/** Human-readable page text, one visual line per row. */
const itemsToText = (items) => {
  const byY = new Map();
  for (const it of items) {
    const k = Math.round(it.y);
    if (!byY.has(k)) byY.set(k, []);
    byY.get(k).push(it);
  }
  return [...byY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, arr]) => arr.sort((a, b) => a.x - b.x).map((i) => i.s).join('  '))
    .join('\n');
};

const pageText = (pdfDoc) => pdfDoc.getPages().map((p) => itemsToText(pageItems(pdfDoc, p)));
const pageRuns = (pdfDoc) => pdfDoc.getPages().map((p) => pageItems(pdfDoc, p));

/**
 * Flattening destroys checkbox state - a cleared box and a checked box both
 * become "no text" once the appearance is baked in, so the finished PDF cannot
 * tell us whether box 3 ("foreign-owned U.S. DE") was ticked. The generator
 * flattens internally, so intercept PDFForm.flatten and snapshot every field
 * on its way through. Nothing about the output changes; we just read first.
 */
const flattenSnapshots = [];
const origFlatten = PDFForm.prototype.flatten;
PDFForm.prototype.flatten = function patchedFlatten(...args) {
  const snap = {};
  try {
    for (const f of this.getFields()) {
      const name = f.getName();
      if (typeof f.isChecked === 'function') snap[name] = f.isChecked() ? 'CHECKED' : '';
      else if (typeof f.getText === 'function') snap[name] = f.getText() ?? '';
      else if (typeof f.getSelected === 'function') snap[name] = (f.getSelected() ?? []).join(',');
    }
  } catch { /* a malformed field must not break generation */ }
  flattenSnapshots.push(snap);
  return origFlatten.apply(this, args);
};

/** Every AcroForm field name → value, for an unflattened form. */
const formFields = (pdfDoc) => {
  const map = {};
  let form;
  try { form = pdfDoc.getForm(); } catch { return map; }
  for (const f of form.getFields()) {
    const name = f.getName();
    try {
      if (typeof f.getText === 'function') map[name] = f.getText() ?? '';
      else if (typeof f.isChecked === 'function') map[name] = f.isChecked() ? 'X' : '';
      else if (typeof f.getSelected === 'function') map[name] = (f.getSelected() ?? []).join(',');
    } catch { map[name] = '<unreadable>'; }
  }
  // Only the fields that carry a value - the blanks are noise.
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v !== '' && v != null));
};

/**
 * Widget geometry of a blank template: `[{ name, page, x, y, w, h }]`.
 * Cached - the same handful of templates is reused across all 100 scenarios.
 */
const rectCache = new Map();
const templateRects = async (file) => {
  if (rectCache.has(file)) return rectCache.get(file);
  const d = await PDFDocument.load(await readFile(path.join(root, 'public', 'pdf', file)));

  // These templates omit the widget's /P back-reference, so the owning page has
  // to be found the other way round - by scanning each page's /Annots.
  const pageOfAnnot = new Map();
  d.getPages().forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (const ref of annots.asArray()) pageOfAnnot.set(String(ref), i);
  });

  const rects = [];
  for (const field of d.getForm().getFields()) {
    const name = field.getName();
    for (const w of field.acroField.getWidgets()) {
      const r = w.getRectangle();
      const ref = d.context.getObjectRef(w.dict) ?? w.dict;
      rects.push({
        name, page: pageOfAnnot.get(String(ref)) ?? -1,
        x: r.x, y: r.y, w: r.width, h: r.height,
      });
    }
  }
  rectCache.set(file, rects);
  return rects;
};

/**
 * Attribute each printed run to the form field whose widget box contains it.
 * This is what turns "the string 42,000 appears somewhere" into "line 1c
 * Total assets says 42,000" - the only way to prove the data landed on the
 * right line rather than merely somewhere on the page.
 */
const mapRunsToFields = (runs, rects) => {
  const byField = {};
  const unplaced = [];
  runs.forEach((pageRuns, pageIdx) => {
    for (const r of pageRuns) {
      // A flattened value sits on the field's baseline, a little above the
      // box bottom; allow a small margin on every side.
      const hit = rects.find((q) => q.page === pageIdx
        && r.x >= q.x - 2 && r.x <= q.x + q.w + 2
        && r.y >= q.y - 3 && r.y <= q.y + q.h + 3);
      if (hit) (byField[hit.name] ??= []).push(r.s);
      // Anything the generator drew itself (rather than through a field) shows
      // up outside every widget box. The IRS template's own static text does
      // too, so keep only runs in a font pdf-lib embedded - those are ours.
      else if (/^Helvetica|^Times|^Courier/.test(r.font)) {
        unplaced.push({ page: pageIdx + 1, x: r.x, y: r.y, s: r.s });
      }
    }
  });
  return { byField, unplaced };
};

const describe = async (bytes, withRuns = false) => {
  if (!bytes || bytes.length === 0) return null;
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return {
    pages: d.getPageCount(), bytes: bytes.length,
    text: pageText(d),
    ...(withRuns ? { runs: pageRuns(d) } : {}),
  };
};

// ── scenario → rows (mirrors seedScenarios, which mirrors the wizard) ────────
/**
 * The wizard derives tax_period_begin/end from the fiscal end month before it
 * writes the row (Intake.tsx deriveFiscalPeriod); the generator reads only the
 * derived dates. Mirror that here so a fiscal scenario is exercised the way
 * production produces it - otherwise every fiscal filer silently falls back to
 * a calendar year and the fiscal cases prove nothing.
 */
const deriveFiscalPeriod = (taxYear, endMonth) => {
  const y = Number(taxYear);
  const pad = (n) => String(n).padStart(2, '0');
  if (endMonth === 12) return { begin: `${y}-01-01`, end: `${y}-12-31` };
  const lastDay = new Date(y + 1, endMonth, 0).getDate();
  return { begin: `${y}-${pad(endMonth + 1)}-01`, end: `${y + 1}-${pad(endMonth)}-${pad(lastDay)}` };
};

const filingRow = (f, o, extra = {}) => {
  const row = {
    id: 'test', status: 'completed', service_type: 'current_year', current_step: 5,
    related_parties: extra.related_parties ?? [],
    no_transactions_confirmed: extra.no_transactions_confirmed ?? false,
    part_vi_managerial: extra.part_vi_managerial ?? true,
    ...f, ...o,
  };
  if (row.is_fiscal_year && row.fiscal_end_month && !row.tax_period_begin) {
    const p = deriveFiscalPeriod(row.tax_year, Number(row.fiscal_end_month));
    row.tax_period_begin = p.begin;
    row.tax_period_end = p.end;
  }
  return row;
};

const txRows = (list) => (list ?? []).map((t) => ({
  related_party_index: t.related_party_index ?? 0,
  ...mapTransactionForPersist({
    transaction_type: t.transaction_type,
    direction: t.direction,
    amount_usd: t.amount_usd === '' || t.amount_usd == null ? null : Number(t.amount_usd),
    loan_begin_usd: t.loan_begin_usd === '' || t.loan_begin_usd == null ? null : Number(t.loan_begin_usd),
    description: t.description,
    transaction_date: t.transaction_date || null,
  }),
}));

const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '-').trim();

// ── run ─────────────────────────────────────────────────────────────────────
const facts = [];
let ok = 0, failed = 0;

for (const s of scenarios) {
  const id = s.scenario_id;
  const rec = {
    scenario_id: id,
    title: s.title,
    tests: s.tests ?? null,
    expected_result: s.expected_result ?? null,
    manual_step: s.manual_step ?? null,
    negative: !!s.expected_result,
    multiyear: !!s.year_specific_filings,
  };

  try {
    if (s.year_specific_filings) {
      const years = s.year_specific_filings.map((y) => ({
        filing: filingRow(
          { ...s.shared_filing_fields, tax_year: y.tax_year, total_assets: y.total_assets ?? null,
            include_rcl: s.include_rcl ?? false, include_reasonable_cause: s.include_rcl ?? false,
            reasonable_cause_reasons: s.reasonable_cause_reasons ?? [] },
          s.shared_owner_fields,
          { no_transactions_confirmed: y.no_transactions_confirmed ?? false },
        ),
        transactions: txRows(y.transactions),
        taxYear: Number(y.tax_year),
      }));
      rec.input = {
        tax_years: years.map((y) => y.taxYear),
        include_rcl: !!s.include_rcl,
        reasonable_cause_reasons: s.reasonable_cause_reasons ?? [],
        llc_name: s.shared_filing_fields.llc_name,
      };
      // FilingWizard builds the narrative from the job's reason codes before
      // calling in; passing null here would silently test the generic fallback
      // letter instead of the one a customer actually receives.
      const pkg = await generateMultiYearPackage(years, {
        includeRCL: !!s.include_rcl,
        rclNarrative: narrativeFromReasonCodes(s.reasonable_cause_reasons ?? [], years.length),
      });
      const name = `${id}. ${safe(s.shared_filing_fields.llc_name)} - multiyear.pdf`;
      await writeFile(path.join(outDir, name), pkg.bundled);
      rec.file = name;
      rec.out = {
        bundled: await describe(pkg.bundled, true),
        rcl: await describe(pkg.reasonableCauseLetter, true),
        taxYears: pkg.taxYears,
        perYear: await Promise.all(pkg.perYear.map(async (y) => ({
          taxYear: y.taxYear, formCount: y.formCount, ...(await describe(y.pdf)),
        }))),
      };
    } else {
      const filing = filingRow(s.filing, s.owner, {
        related_parties: s.related_parties,
        no_transactions_confirmed: s.no_transactions_confirmed,
        part_vi_managerial: s.part_vi_managerial,
      });
      const txns = txRows(s.transactions);
      rec.input = {
        llc_name: s.filing.llc_name, ein: s.filing.ein, tax_year: s.filing.tax_year,
        total_assets: s.filing.total_assets,
        date_of_incorporation: s.filing.date_of_incorporation,
        entity_principal_country: s.filing.entity_principal_country,
        state_of_formation: s.filing.state_of_formation,
        naics_code: s.filing.naics_code, naics_description: s.filing.naics_description,
        final_return: !!s.filing.final_return, initial_return: !!s.filing.initial_return,
        is_fiscal_year: !!s.filing.is_fiscal_year,
        fiscal_year_end: s.filing.fiscal_year_end ?? s.filing.fiscal_year_end_month ?? null,
        extension_filed: !!s.filing.extension_filed,
        include_reasonable_cause: !!(s.filing.include_reasonable_cause || s.filing.include_rcl),
        reasonable_cause_reasons: s.filing.reasonable_cause_reasons ?? [],
        owner_full_name: s.owner?.owner_full_name,
        owner_us_tin: s.owner?.owner_us_tin ?? '',
        owner_foreign_tax_id: s.owner?.owner_foreign_tax_id ?? '',
        signature_date: s.owner?.signature_date ?? null,
        related_parties: (s.related_parties ?? []).map((r) => ({ name: r.name, ref: r.ref_number, country: r.country })),
        transactions: txns,
        no_transactions_confirmed: !!s.no_transactions_confirmed,
        part_vi_managerial: !!s.part_vi_managerial,
      };

      flattenSnapshots.length = 0;
      const pkg = await generateFilingPackage(filing, txns, Number(s.filing.tax_year));
      // Classify each snapshot by the fields it contains - the order the
      // generator flattens in is an implementation detail, the field names
      // are not.
      const kindOf = (snap) => (
        'CorporationName' in snap ? 'f5472'
          : 'LLC_Calendar_Year' in snap ? 'f7004'
            : Object.keys(snap).length ? 'f1120' : 'other');
      rec.formState = { f5472: [], f1120: [], f7004: [], other: [] };
      for (const snap of flattenSnapshots) {
        // Keep only fields that carry a value; a blank form is all noise.
        const set = Object.fromEntries(Object.entries(snap).filter(([, v]) => v !== '' && v != null));
        rec.formState[kindOf(snap)].push(set);
      }
      const name = `${id}. ${safe(s.filing.llc_name)} - ${s.filing.tax_year}.pdf`;
      await writeFile(path.join(outDir, name), pkg.combined);
      rec.file = name;

      const year = Number(s.filing.tax_year);
      const tmplOf = (u) => String(u).split('/').pop();

      /** Load a generated form and attribute every value to its IRS field. */
      const mapped = async (bytes, templateFile) => {
        if (!bytes || bytes.length === 0) return null;
        const d = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const runs = pageRuns(d);
        const { byField, unplaced } = mapRunsToFields(runs, await templateRects(templateFile));
        return {
          pages: d.getPageCount(), bytes: bytes.length,
          text: runs.map(itemsToText),
          fields: byField,
          drawnOutsideFields: unplaced,
          // Every distinct type size used by generator-drawn values, so a
          // stray size stands out.
          sizes: [...new Set(runs.flat()
            .filter((r) => /^Helvetica|^Times|^Courier/.test(r.font))
            .map((r) => `${r.font}@${r.size}`))].sort(),
        };
      };

      rec.out = {
        formCount: pkg.formCount,
        combined: await describe(pkg.combined, true),
        form5472: await mapped(pkg.form5472, tmplOf(get5472PdfUrl(year))),
        form1120: await mapped(pkg.form1120, tmplOf(get1120PdfUrl(year))),
        partV: await describe(pkg.statement_partV, true),
        partVI: await describe(pkg.statement_partVI, true),
        form7004: pkg.form7004 ? await mapped(pkg.form7004, tmplOf(get7004PdfUrl(year))) : null,
        rcl: await describe(pkg.reasonableCauseLetter, true),
      };
    }
    ok++;
    console.log(`ok   ${String(id).padStart(3)}  ${rec.file}`);
  } catch (e) {
    failed++;
    rec.error = String(e?.stack ?? e).split('\n').slice(0, 6).join('\n');
    console.log(`FAIL ${String(id).padStart(3)}  ${s.title}\n       ${String(e?.message ?? e)}`);
  }
  facts.push(rec);
}

await writeFile(path.join(outDir, '_facts.json'), JSON.stringify(facts, null, 1));
console.log(`\ngenerated ${ok}, failed ${failed}  →  ${outDir}`);
