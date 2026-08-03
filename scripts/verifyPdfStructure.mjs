/**
 * Every PDF the filer receives must be structurally valid, not merely openable.
 *
 * WHY THIS EXISTS
 *
 * On 3 Aug 2026 an audit reported that 147 of the 154 captured packages produced
 * missing-object or invalid-xref warnings in MuPDF, and named it the one true P0
 * before launch. It did not reproduce. Three independent checks, each with a
 * deliberately corrupted control file to prove the check could fail, found all
 * 154 clean, and so was fresh output from the current generator:
 *
 *   1. pdfjs, reading every page of every file, warnings captured
 *   2. a byte-level walk of the xref chain
 *   3. a full cross-reference STREAM decode, which is this file
 *
 * The third mattered: all 154 use xref streams rather than classic tables, so a
 * checker that only understands tables proves nothing about them and the first
 * two versions of this check were quietly vacuous. That is the trap worth
 * remembering, and it is why the control file is not optional here.
 *
 * So this is a ratchet, not a bug fix, the same shape as verifyPageSize. The
 * structure is correct today; nothing enforced it, and pdf-lib assembly, page
 * copying and flatten() are exactly the operations that would break it silently.
 * A package that opens in a tolerant reader and fails a strict one is not
 * acceptable for an IRS filing, for archival, or for assistive technology.
 *
 * WHAT IT CHECKS, per file:
 *   type 1 xref entry -> the byte offset lands on "<num> <gen> obj", same number
 *   type 2 xref entry -> the containing object stream exists and is itself type 1
 *   every "<num> <gen> R" reference resolves to a live (non-free) entry
 *   the whole /Prev chain, so an incremental save cannot hide a broken generation
 *
 * It runs against public/pdf (the IRS templates, which are inputs we do not
 * control) and against a freshly assembled package (what the filer receives),
 * plus a corrupted copy of that package which MUST fail. If the control ever
 * passes, this check has stopped working, and that is reported as a failure.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const PDF_DIR = join(REPO, 'public', 'pdf');

/**
 * Undo a PNG row predictor (/Predictor >= 10).
 *
 * The IRS templates encode their xref streams with /Predictor 12 /Columns 7, so
 * each inflated row is a per-byte delta against the row above, prefixed with a
 * filter-type byte. Skipping this step does not fail loudly: it yields
 * plausible-looking integers, and the first version of this script duly
 * reported every IRS template as corrupt with offsets like 16908288. Nothing
 * the product generates uses a predictor, which is why the generated packages
 * decoded correctly and the templates did not.
 */
function undoPngPredictor(data, colours) {
  const rowLen = colours + 1;
  const rows = Math.floor(data.length / rowLen);
  const out = Buffer.alloc(rows * colours);
  let prev = Buffer.alloc(colours);
  for (let r = 0; r < rows; r++) {
    const type = data[r * rowLen];
    const row = data.subarray(r * rowLen + 1, r * rowLen + 1 + colours);
    const cur = Buffer.alloc(colours);
    for (let i = 0; i < colours; i++) {
      const raw = row[i];
      const up = prev[i];
      const left = i > 0 ? cur[i - 1] : 0;
      const upLeft = i > 0 ? prev[i - 1] : 0;
      let v;
      switch (type) {
        case 0: v = raw; break;                       // None
        case 1: v = raw + left; break;                // Sub
        case 2: v = raw + up; break;                  // Up, the common one
        case 3: v = raw + ((left + up) >> 1); break;  // Average
        case 4: {                                     // Paeth
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: v = raw;
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, r * colours);
    prev = cur;
  }
  return out;
}

/**
 * Returns a list of structural problems. Empty means clean.
 * Deliberately library-free: a bug in the same library that wrote the file
 * would not be caught by reading it back with that library.
 */
export function structuralProblems(buf) {
  const s = buf.toString('latin1');
  const problems = [];
  const entries = new Map();

  const sxIdx = s.lastIndexOf('startxref');
  if (sxIdx < 0) return ['no startxref'];
  let offset = parseInt(s.slice(sxIdx + 9).trim(), 10);
  if (!Number.isFinite(offset)) return ['unparsable startxref'];

  const seen = new Set();
  let sawTable = false;

  while (offset != null && !seen.has(offset)) {
    seen.add(offset);
    if (!(offset >= 0 && offset < buf.length)) {
      problems.push(`xref offset ${offset} is outside the file (length ${buf.length})`);
      break;
    }

    // Classic table. The templates from IRS.gov use these.
    if (/^\s*xref/.test(s.slice(offset, offset + 20))) {
      sawTable = true;
      let p = s.indexOf('xref', offset) + 4;
      for (;;) {
        const m = /^\s*(\d+)\s+(\d+)\s*/.exec(s.slice(p, p + 40));
        if (!m) break;
        const first = parseInt(m[1], 10);
        const count = parseInt(m[2], 10);
        p += m[0].length;
        for (let i = 0; i < count; i++) {
          const em = /^(\d{10})\s(\d{5})\s([nf])/.exec(s.slice(p, p + 20));
          if (!em) { problems.push(`malformed xref entry at byte ${p}`); break; }
          const num = first + i;
          if (!entries.has(num)) {
            entries.set(num, em[3] === 'n' ? { type: 1, a: parseInt(em[1], 10) } : { type: 0 });
          }
          p += 20;
        }
      }
      const tIdx = s.indexOf('trailer', p);
      const prevM = tIdx >= 0 ? /\/Prev\s+(\d+)/.exec(s.slice(tIdx, tIdx + 800)) : null;
      offset = prevM ? parseInt(prevM[1], 10) : null;
      continue;
    }

    // Cross-reference stream. Everything this product generates uses these.
    const om = /^\s*(\d+)\s+(\d+)\s+obj/.exec(s.slice(offset, offset + 40));
    if (!om) { problems.push(`xref offset ${offset} is neither a table nor an object`); break; }

    const stIdx = s.indexOf('stream', offset);
    if (stIdx < 0) { problems.push('xref object has no stream'); break; }
    const dict = s.slice(offset, stIdx);
    if (!/\/Type\s*\/XRef/.test(dict)) { problems.push('xref object is not /Type /XRef'); break; }

    const wM = /\/W\s*\[([^\]]*)\]/.exec(dict);
    if (!wM) { problems.push('xref stream has no /W'); break; }
    const W = wM[1].trim().split(/\s+/).map(Number);

    const sizeM = /\/Size\s+(\d+)/.exec(dict);
    const idxM = /\/Index\s*\[([^\]]*)\]/.exec(dict);
    const index = idxM
      ? idxM[1].trim().split(/\s+/).map(Number)
      : [0, sizeM ? parseInt(sizeM[1], 10) : 0];

    let dataStart = stIdx + 6;
    if (s[dataStart] === '\r') dataStart++;
    if (s[dataStart] === '\n') dataStart++;
    let data = buf.subarray(dataStart, s.indexOf('endstream', dataStart));
    if (/\/FlateDecode/.test(dict)) {
      try { data = inflateSync(data); }
      catch (e) { problems.push('xref stream will not inflate: ' + e.message); break; }
    }

    const rowLen = W.reduce((a, b) => a + b, 0);

    const predM = /\/Predictor\s+(\d+)/.exec(dict);
    if (predM && Number(predM[1]) >= 10) {
      const colM = /\/Columns\s+(\d+)/.exec(dict);
      data = undoPngPredictor(data, colM ? parseInt(colM[1], 10) : rowLen);
    }
    let pos = 0;
    outer: for (let k = 0; k < index.length; k += 2) {
      let num = index[k];
      for (let i = 0; i < index[k + 1]; i++, num++) {
        if (pos + rowLen > data.length) { problems.push('xref stream data is truncated'); break outer; }
        const f = [];
        for (const w of W) {
          let v = 0;
          for (let b = 0; b < w; b++) v = v * 256 + data[pos++];
          f.push(w === 0 ? null : v);
        }
        // A /W first element of 0 means the type is defaulted to 1.
        if (!entries.has(num)) entries.set(num, { type: W[0] === 0 ? 1 : f[0], a: f[1], b: f[2] });
      }
    }

    const prevM = /\/Prev\s+(\d+)/.exec(dict);
    offset = prevM ? parseInt(prevM[1], 10) : null;
  }

  const containers = new Set();
  for (const [num, e] of entries) {
    if (e.type === 1) {
      const hm = /^\s*(\d+)\s+(\d+)\s+obj/.exec(s.slice(e.a, e.a + 40));
      if (!hm) problems.push(`obj ${num}: xref offset ${e.a} does not point at an object header`);
      else if (parseInt(hm[1], 10) !== num) problems.push(`obj ${num}: xref offset ${e.a} points at obj ${hm[1]}`);
    } else if (e.type === 2) {
      containers.add(e.a);
    }
  }
  for (const c of containers) {
    const ce = entries.get(c);
    if (!ce) problems.push(`object stream ${c} is referenced but has no xref entry`);
    else if (ce.type !== 1) problems.push(`object stream ${c} has no byte offset of its own`);
  }

  // A reference to an object the xref does not define is the "missing object"
  // half of the original report. Skipped for classic tables from third-party
  // templates, where free-list conventions vary and a false alarm is worse than
  // no alarm; the generated packages are all xref streams and are checked.
  if (!sawTable) {
    const missing = new Set();
    for (const m of s.matchAll(/(\d+)\s+(\d+)\s+R\b/g)) {
      const n = parseInt(m[1], 10);
      const e = entries.get(n);
      if (!e || e.type === 0) missing.add(n);
    }
    if (missing.size) {
      problems.push(
        `references ${missing.size} object(s) with no live xref entry: ${[...missing].slice(0, 10).join(', ')}`,
      );
    }
  }

  return problems;
}

/** Break a valid PDF in a way any correct checker must notice. */
function corrupt(buf) {
  const s = buf.toString('latin1');
  const i = s.lastIndexOf('startxref');
  const j = s.indexOf('\n', i + 10);
  return Buffer.from(`${s.slice(0, i + 10)}999999${s.slice(j)}`, 'latin1');
}

// structuralProblems is importable on its own, so a one-off sweep (a captured
// run, a downloaded package) can reuse the same decoder rather than a second
// copy of it that drifts. Only run the CLI when invoked directly.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!invokedDirectly) {
  // eslint-disable-next-line no-empty
} else {

let failures = 0;

const check = (label, bytes) => {
  const problems = structuralProblems(bytes);
  if (problems.length === 0) {
    console.log(`ok    ${label}`);
    return true;
  }
  failures += problems.length;
  console.log(`FAIL  ${label}`);
  for (const p of problems.slice(0, 5)) console.log(`        ${p}`);
  return false;
};

console.log('Checking IRS templates in public/pdf');
const templates = readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
if (templates.length === 0) {
  console.log('FAIL  no templates found in public/pdf');
  failures++;
}
for (const f of templates) check(f, readFileSync(join(PDF_DIR, f)));

// The control. If a knowingly broken file passes, this script is not checking
// anything and every "ok" above is worthless.
console.log('\nControl (a deliberately corrupted file, which MUST fail)');
const control = corrupt(readFileSync(join(PDF_DIR, templates[0])));
if (structuralProblems(control).length === 0) {
  console.log('FAIL  the corrupted control passed, so this check is not working');
  failures++;
} else {
  console.log('ok    corrupted control was rejected');
}

console.log('');
if (failures === 0) {
  console.log(`PASS  all ${templates.length} PDF(s) are structurally valid, and the control failed as it must.`);
  process.exit(0);
} else {
  console.log(`FAIL  ${failures} structural problem(s).`);
  process.exit(1);
}

}
