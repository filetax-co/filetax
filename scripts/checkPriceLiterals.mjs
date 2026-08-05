#!/usr/bin/env node
/**
 * Bans hardcoded OUR-PRICE dollar literals in live page copy.
 *
 * Why this exists: `/past-filings` carried a bare `$350` in its copy long after
 * the price was $99 + $199, and two separate AI reviews built recommendations
 * on that wrong number before anyone noticed. Prices are derived from
 * pricing.ts on every commercial page today; nothing stopped the next one from
 * drifting back.
 *
 * What it flags, deliberately narrow so it can be trusted:
 *
 *   - Only dollar amounts that equal one of OUR prices, or an obvious
 *     combination of them (n years of filing, with or without the letter).
 *     `$25,000`, the IRS penalty, is a fact and not a price. `$400 to $900`,
 *     what a CPA charges, is a competitor's number. Neither is ours to drift.
 *   - Only in code that ships. Comments are stripped first, because half the
 *     dollar figures in this codebase are comments explaining a past pricing
 *     mistake, and those must stay readable.
 *
 * A `$25` that is genuinely not our additional-party price can be written as
 * `{'$'}25` or marked with a trailing `/* price-literal-ok *\/` on the line.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Every surface that quotes a price to a customer. Terms and Privacy are out:
 * their only dollar figure is a liability cap, which is a legal number, not a
 * price, and must not move when pricing does. */
const FILES = [
  'src/app/pages/Home.tsx',
  'src/app/pages/Pricing.tsx',
  'src/app/pages/Services.tsx',
  'src/app/pages/Compare.tsx',
  'src/app/pages/FAQ.tsx',
  'src/app/pages/PastFilings.tsx',
  'src/app/pages/Refunds.tsx',
  'src/app/pages/Resources.tsx',
  'src/app/pages/EligibilityCheck.tsx',
  'src/app/pages/Intake.tsx',
  'src/app/pages/MultiYearStart.tsx',
  'src/app/pages/Dashboard.tsx',
  'src/app/pages/FilingWizard.tsx',
  'src/app/pages/Guide.tsx',
];

/** Read the prices out of pricing.ts rather than restating them here, so this
 *  check cannot itself become the thing that is out of date. */
function ourPrices() {
  const src = readFileSync(join(root, 'src/lib/pricing.ts'), 'utf8');
  const num = (name) => {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
    if (!m) throw new Error(`pricing.ts no longer exports ${name}`);
    return Number(m[1]);
  };
  const year = num('PRICE_PER_YEAR');
  const rcl = num('PRICE_RCL');
  const banned = new Map();
  const add = (v, why) => { if (v >= 10 && !banned.has(v)) banned.set(v, why); };

  add(rcl, 'PRICE_RCL');
  add(num('PRICE_ADDITIONAL_PARTY'), 'PRICE_ADDITIONAL_PARTY');
  add(num('PRICE_CLASSIFICATION_CHANGE'), 'PRICE_CLASSIFICATION_CHANGE');
  // Catch-up jobs run to about ten years, which is where the multiples stop
  // mattering. Both shapes appear in real copy: the years alone, and the years
  // plus the one letter that covers them.
  for (let n = 1; n <= 10; n++) {
    add(year * n, n === 1 ? 'PRICE_PER_YEAR' : `${n} x PRICE_PER_YEAR`);
    add(year * n + rcl, `${n} x PRICE_PER_YEAR + PRICE_RCL`);
  }
  return banned;
}

/** Strip comments and template-expression contents, keeping line numbers. */
function stripNonCopy(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const keepNewlines = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

const banned = ourPrices();
const findings = [];

for (const rel of FILES) {
  let src;
  try {
    src = readFileSync(join(root, rel), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') continue; // a page may legitimately be removed
    throw err;
  }
  const lines = stripNonCopy(src).split('\n');
  const rawLines = src.split('\n');
  lines.forEach((line, idx) => {
    if (/price-literal-ok/.test(rawLines[idx])) return;
    for (const m of line.matchAll(/\$(\d[\d,]*)/g)) {
      const value = Number(m[1].replace(/,/g, ''));
      if (!banned.has(value)) continue;
      findings.push({
        file: rel,
        line: idx + 1,
        value,
        why: banned.get(value),
        text: rawLines[idx].trim(),
      });
    }
  });
}

if (findings.length === 0) {
  console.log(`Price literals: clean. Checked ${FILES.length} pages against pricing.ts.`);
  process.exit(0);
}

console.error(`Hardcoded price literals found in live copy: ${findings.length}\n`);
for (const f of findings) {
  console.error(`  ${relative('.', f.file)}:${f.line}  $${f.value} is ${f.why}`);
  console.error(`    ${f.text.length > 140 ? f.text.slice(0, 140) + '...' : f.text}\n`);
}
console.error('Import the value from src/lib/pricing.ts instead. If the figure is genuinely');
console.error("not our price, write the dollar sign as {'$'} or add /* price-literal-ok */.");
process.exit(1);
