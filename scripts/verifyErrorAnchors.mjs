// scripts/verifyErrorAnchors.mjs
//
// Every anchored validation message in Intake.tsx must have a field to jump to.
//
//   npm run verify:anchors
//
// An error message built with at(section, field, msg) renders as a button that
// takes the filer to [data-anchor="<field>"]. If that anchor does not exist the
// jump finds nothing, and it fails SILENTLY by design (see jumpToField): the
// message stays readable and nothing moves. That is the right behaviour at
// runtime and the wrong thing to discover in production, because the failure
// looks exactly like a click that did not register.
//
// So the pairing is checked here instead. The likely way to break it is to add
// a validator rule with a new field name and no matching anchor in the markup,
// which is a one-line change in a 5,000 line file and reviews cleanly.
//
// Same family as verifyPageSize and verifyPdfStructure: a ratchet, not a fix.
// It asserts against a deliberately broken control first, so it cannot quietly
// stop checking.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'src/app/pages/Intake.tsx');

/** Field names passed to at(). Template literals are returned raw, e.g. `rp-${i}`. */
function targets(src) {
  const out = new Set();
  for (const m of src.matchAll(/\bat\(\s*'[^']*'\s*,\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bat\(\s*'[^']*'\s*,\s*`([^`]+)`/g)) out.add(m[1]);
  return out;
}

/** Anchors present in the markup, from both the prop and the raw attribute. */
function anchors(src) {
  const out = new Set();
  for (const m of src.matchAll(/\banchor="([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bdata-anchor="([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bdata-anchor=\{`([^`]+)`\}/g)) out.add(m[1]);
  return out;
}

/**
 * A dynamic target like `rp-${dupIndex}` is satisfied by the anchor `rp-${i}`:
 * the same list rendered it, and only the loop variable's name differs. Compare
 * on the literal prefix before the first interpolation.
 */
const prefix = (s) => s.split('${')[0];

function unmatched(src) {
  const have = anchors(src);
  const havePrefixes = new Set([...have].map(prefix));
  const missing = [];
  for (const t of targets(src)) {
    if (have.has(t)) continue;
    if (t.includes('${') && havePrefixes.has(prefix(t))) continue;
    // A fixed index into a dynamic list ('tx-0' against `tx-${i}`) is fine.
    if (/-\d+$/.test(t) && havePrefixes.has(t.replace(/\d+$/, ''))) continue;
    missing.push(t);
  }
  return missing;
}

const src = readFileSync(FILE, 'utf8');

// The control: a message anchored to a field that is not in the markup. If this
// passes, the check has stopped working and everything below it is vacuous.
const control = `${src}\n// errs.push(at('1', 'thisFieldDoesNotExist', 'control'));`
  .replace("// errs.push(at('1', 'thisFieldDoesNotExist'", "errs.push(at('1', 'thisFieldDoesNotExist'");
if (!unmatched(control).includes('thisFieldDoesNotExist')) {
  console.error('verify:anchors is not working: the broken control passed.');
  process.exit(1);
}

const missing = unmatched(src);
if (missing.length) {
  console.error('Validation messages anchored to fields that do not exist in the markup:');
  for (const m of missing) console.error(`  ${m}`);
  console.error('\nAdd anchor="<name>" to the Field (or data-anchor to the container) it should jump to.');
  process.exit(1);
}

console.log(`verify:anchors OK: ${targets(src).size} anchored messages, every target present.`);
