/**
 * pdfGrep - decompress a PDF's content streams and assert on literal strings.
 *
 *   node scripts/pdfGrep.mjs <file.pdf> "expected" "!not-expected" ...
 *
 * A leading "!" asserts the string is ABSENT. Exits non-zero on any failure.
 * Used to prove that generated packages actually print the values we think
 * they do, rather than trusting the source that assembles them.
 */
import { readFile } from 'node:fs/promises';
import zlib from 'node:zlib';

const [, , file, ...needles] = process.argv;
const buf = await readFile(file);

let text = '';
const marker = Buffer.from('stream');
const endMarker = Buffer.from('endstream');
for (let i = 0; (i = buf.indexOf(marker, i)) !== -1; ) {
  let s = i + marker.length;
  if (buf[s] === 0x0d) s++;
  if (buf[s] === 0x0a) s++;
  const end = buf.indexOf(endMarker, s);
  if (end === -1) break;
  try {
    text += zlib.inflateSync(buf.subarray(s, end)).toString('latin1') + '\n';
  } catch {
    // Not a Flate stream (image, font, already plain) - skip it.
  }
  i = end + endMarker.length;
}

// pdf-lib writes its text as HEX strings (<48656C6C6F> Tj), not parenthesised
// literals, so decode those; keep the parenthesised form too for PDFs that use
// it. Both are also joined without separators, so a phrase split across
// positioning operators still matches.
const hexLiterals = [...text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)].map((m) =>
  Buffer.from(m[1].replace(/\s+/g, ''), 'hex').toString('latin1'),
);
const parenLiterals = [...text.matchAll(/\(([^()]*)\)\s*Tj/g)].map((m) => m[1]);
const literals = [...hexLiterals, ...parenLiterals];
const hay = literals.join('\n') + '\n' + literals.join('');

let bad = 0;
for (const n of needles) {
  const wantPresent = !n.startsWith('!');
  const s = wantPresent ? n : n.slice(1);
  const found = hay.includes(s);
  const ok = found === wantPresent;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${wantPresent ? 'contains' : 'omits'} "${s}"`);
}
process.exit(bad ? 1 : 0);
