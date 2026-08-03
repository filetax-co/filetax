#!/usr/bin/env node
/**
 * scripts/audit-pdf-fields.mjs
 *
 * For every PDF in public/pdf/, infer the tax year from the filename, resolve
 * the per-year field map the code uses, and diff against the actual AcroForm
 * field names in the PDF. Reports missing (code expects, PDF lacks) and extra
 * (PDF has, code never touches) fields per file.
 *
 *   node scripts/audit-pdf-fields.mjs
 *
 * Exits non-zero if any field declared in a per-year map is missing from the
 * corresponding PDF - that means a year override is out of sync.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PDF_DIR = resolve(ROOT, 'public/pdf');

// ── Map parsing ─────────────────────────────────────────────────────────────

// Pull every `KEY: 'value'` pair from a TS file. Empty strings are skipped on
// purpose - they mean "this field is intentionally absent in this revision."
// Parse a `KEY: 'value'` block. Empty values are preserved (an explicit ''
// override means "this revision lacks the field" - when overlaid on a base
// map, that REMOVES the field from the expected set).
function parseConst(src) {
  const out = new Map();
  for (const m of src.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*'([^']*)',?\s*(?:\/\/.*)?$/gm)) {
    const [, key, value] = m;
    out.set(key, value);
  }
  return out;
}

// Overlay overrides onto a base map. An override of '' clears the entry.
function overlay(base, overrides) {
  const out = new Map(base);
  for (const [k, v] of overrides) {
    if (v === '') out.delete(k);
    else out.set(k, v);
  }
  return out;
}

function valuesAsSet(map) {
  return new Set([...map.values()].filter(Boolean));
}

const f5472Src = await readFile(resolve(ROOT, 'src/lib/form5472Fields.ts'), 'utf8');
const f1120Src = await readFile(resolve(ROOT, 'src/lib/form1120Fields.ts'), 'utf8');

// Extract the canonical "latest" map and each override block from the source.
function extractBlock(src, marker) {
  // Match `const NAME = { ... } as const;` OR `const NAME: ... = { ... };`
  const re = new RegExp(`const\\s+${marker}\\s*[^=]*=\\s*{([\\s\\S]*?)}\\s*(?:as\\s+const\\s*)?;`);
  const m = src.match(re);
  return m ? m[1] : '';
}

const F5472_LATEST    = parseConst(extractBlock(f5472Src, 'F5472_LATEST'));
const F5472_2022_2023 = overlay(F5472_LATEST, parseConst(extractBlock(f5472Src, 'OVERRIDES_2022_2023')));
const F5472_2019_2021 = overlay(F5472_LATEST, parseConst(extractBlock(f5472Src, 'OVERRIDES_2019_2021')));

const F1120_2019_2022 = parseConst(extractBlock(f1120Src, 'F1120_2019_2022'));
const F1120_2023      = overlay(F1120_2019_2022, parseConst(extractBlock(f1120Src, 'F1120_2023')));
const F1120_2024      = parseConst(extractBlock(f1120Src, 'F1120_2024'));
const F1120_FALLBACK  = parseConst(extractBlock(f1120Src, 'F1120_FALLBACK'));

// Map filename -> expected field-name set.
function expectedFor(filename) {
  switch (filename) {
    case 'Form-5472.pdf':           return valuesAsSet(F5472_LATEST);
    case 'Form-5472-2023.pdf':      return valuesAsSet(F5472_2022_2023);
    case 'Form-5472-2022.pdf':      return valuesAsSet(F5472_2022_2023);
    case 'Form-5472-2019-2021.pdf': return valuesAsSet(F5472_2019_2021);
    case 'Form-1120-2024.pdf':      return valuesAsSet(F1120_2024);
    case 'Form-1120-2023.pdf':      return valuesAsSet(F1120_2023);
    case 'Form-1120-2022.pdf':      return valuesAsSet(F1120_2019_2022);
    case 'Form-1120-2021.pdf':      return valuesAsSet(F1120_2019_2022);
    case 'Form-1120-2020.pdf':      return valuesAsSet(F1120_2019_2022);
    case 'Form-1120-2019.pdf':      return valuesAsSet(F1120_2019_2022);
    case 'Form-1120-2025.pdf':      return valuesAsSet(F1120_FALLBACK);
    case 'Form-1120-Page-1.pdf':    return valuesAsSet(F1120_FALLBACK);
    default: return null;
  }
}

// ── PDF dumping ─────────────────────────────────────────────────────────────

async function dumpPdf(path) {
  const bytes = await readFile(path);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getForm().getFields().map(f => f.getName());
}

function diff(actualNames, expected) {
  const actualSet = new Set(actualNames);
  const missing = [...expected].filter(n => !actualSet.has(n));
  const extra = actualNames.filter(n => !expected.has(n));
  return { missing, extra };
}

const files = (await readdir(PDF_DIR)).filter(f => f.endsWith('.pdf')).sort();
let totalMissing = 0;

for (const f of files) {
  const path = resolve(PDF_DIR, f);
  let names;
  try { names = await dumpPdf(path); }
  catch (err) {
    console.log(`\n=== ${f} ===\n  ERROR loading PDF: ${err.message}`);
    continue;
  }

  const expected = expectedFor(f);

  console.log(`\n=== ${f} ===`);
  console.log(`  Total AcroForm fields: ${names.length}`);

  if (!expected) {
    console.log(`  (no expected-map registered for this filename; skipping diff)`);
    continue;
  }

  const { missing, extra } = diff(names, expected);
  console.log(`  Missing from PDF (code expects this year's map to find): ${missing.length}`);
  for (const m of missing) console.log(`     - ${m}`);
  console.log(`  Extra in PDF (not referenced by code):                   ${extra.length}`);
  for (const x of extra.slice(0, 12)) console.log(`     + ${x}`);
  if (extra.length > 12) console.log(`     ... (+${extra.length - 12} more)`);
  totalMissing += missing.length;
}

console.log(`\nSummary: ${totalMissing} total missing field(s) across all PDFs.`);
if (totalMissing > 0) {
  console.log('A "missing" finding means the year override in form5472Fields.ts / form1120Fields.ts');
  console.log('points to a field name that does not exist in the corresponding PDF. Fix the override.');
}
process.exit(totalMissing === 0 ? 0 : 1);
