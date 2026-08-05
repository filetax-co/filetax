// scripts/applyBlogRewrite.mjs
//
// Applies handoff items 14 and 15 to the published corpus, from the drafted
// copy in Desktop/FileTax/blog-headings-and-faq-rewrite.md. That file is the
// source of truth for every word written here; this script parses it rather
// than restating it, so the two cannot drift.
//
//   node scripts/applyBlogRewrite.mjs headings          # dry run, prints a diff
//   node scripts/applyBlogRewrite.mjs headings --write
//
// Item 14 is the whole of what this pass does: the two fixed H2s that appear on
// 29 and 30 posts respectively become a heading unique to each post. The body
// text under them does not move. Only the heading block's text changes, and it
// is patched in place by _key, so every other block, key, mark and markDef in
// the document is left exactly as it was.
//
// Why patch rather than createOrReplace: these are LIVE posts, not drafts. A
// replace would rewrite the whole document from a locally assembled copy, and
// anything in it this script does not model (tables, image blocks, markDefs)
// would be silently reshaped. A keyed patch cannot do that.

import { readFileSync, existsSync } from 'node:fs';
import { query } from './sanity-read.mjs';

const PROJECT_ID = 'alh0fv7m';
const DATASET = 'production';
const API_VERSION = '2024-01-01';
const SOURCE = 'C:/Users/chira/OneDrive/Desktop/FileTax/blog-headings-and-faq-rewrite.md';

const WRITE = process.argv.includes('--write');
const pass = process.argv[2];

function loadToken() {
  if (process.env.SANITY_WRITE_TOKEN) return process.env.SANITY_WRITE_TOKEN.trim();
  const file = process.env.SANITY_TOKEN_FILE || 'C:/Users/chira/OneDrive/Desktop/Sanity Token - Filetax.txt';
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8').trim();
  const m = raw.match(/(sk[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function mutate(mutations) {
  const token = loadToken();
  if (!token) throw new Error('No Sanity write token available.');
  const res = await fetch(
    `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/mutate/${DATASET}?returnIds=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Sanity ${res.status}: ${text.replace(/sk[A-Za-z0-9]+/g, '<redacted>')}`);
  return JSON.parse(text);
}

/* ── Parsing the drafted copy ─────────────────────────────────────────────
 *
 * Sections 2 and 3 are each a two-column markdown table, slug then new H2.
 * One row is a parenthetical note rather than a heading (pro-forma-1120 has no
 * "What You Need to Know First" to rename) and is skipped by the leading-paren
 * test rather than by hardcoding the slug.
 */
function parseHeadingTable(md, sectionHeading, oldHeading, endMarker) {
  const start = md.indexOf(sectionHeading);
  if (start === -1) throw new Error(`section not found: ${sectionHeading}`);
  const rest = md.slice(start + sectionHeading.length);
  // Section 7 carries two tables under one heading, so callers there pass an
  // explicit end marker. Elsewhere the horizontal rule ends the section.
  const end = endMarker ? rest.indexOf(endMarker) : rest.indexOf('\n---');
  const body = rest.slice(0, end === -1 ? undefined : end);
  const rows = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\|\s*([a-z0-9-]+)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    const [, slug, heading] = m;
    if (/^-+$/.test(slug)) continue; // the table's own separator row
    if (heading.startsWith('(')) continue; // a note, not a replacement
    rows.push({ slug, oldHeading, newHeading: heading });
  }
  return rows;
}

const md = readFileSync(SOURCE, 'utf8');

const PASSES = ['headings', 'faq', 'arithmetic', 'exposure', 'drafts', 'dashes'];
if (!PASSES.includes(pass)) {
  console.error(`Usage: node scripts/applyBlogRewrite.mjs <${PASSES.join('|')}> [--write]`);
  process.exit(1);
}

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const textOf = (b) => (b.children ?? []).map((c) => c.text ?? '').join('');

/* ── The FAQ pass ─────────────────────────────────────────────────────────
 *
 * Section 4 of the drafted copy is one subsection per post. The grammar is
 * regular enough to parse and too varied to hardcode:
 *
 *   ### 4.N <slug>, 6 to 11
 *   H2: "New heading".  |  H2 stays "Frequently Asked Questions".
 *   ... Drop "<question>" and "<question>" ...
 *   ... Replace the exposure question (see §5.2) ...
 *   **New question?**
 *   Answer paragraph.
 *
 * Everything the reader will see is lifted verbatim from that file. The only
 * judgment this script makes is WHICH existing question a drop refers to, and
 * it refuses rather than guesses: a drop that does not match exactly one
 * existing question is reported and skipped, never approximated.
 */
function parseFaqSections(source) {
  const out = [];
  const parts = source.split(/\n### 4\.\d+ /).slice(1);
  for (const part of parts) {
    const slug = part.split(/[,\n]/)[0].trim();
    const body = part.slice(part.indexOf('\n'));
    // Instruction prose is everything before the first drafted question.
    const firstQ = body.search(/^\*\*.+\?\*\*$/m);
    const prose = firstQ === -1 ? body : body.slice(0, firstQ);

    const h2m = prose.match(/H2:\s*"([^"]+)"/);
    const newH2 = h2m ? h2m[1] : null;
    const replaceExposure = /Replace the exposure question/i.test(prose);
    // Drops are named verbatim in quotes, in a sentence that starts with Drop.
    const drops = [];
    const dropSentence = prose.match(/Drop[\s\S]*?(?:\n\n|$)/);
    if (dropSentence) {
      for (const m of dropSentence[0].matchAll(/"([^"]+\?)"/g)) drops.push(m[1].replace(/\s+/g, ' '));
    }
    // A named replacement can also appear mid-subsection, as "Also replace
    // "<question>" with:". The Pakistan post uses this to retire the "Can I
    // file the form myself?" duplicate that is kept on the Nigeria post.
    for (const m of body.matchAll(/^(?:Also )?[Rr]eplace "([^"]+\?)"/gm)) {
      drops.push(m[1].replace(/\s+/g, ' '));
    }

    const adds = [];
    const re = /^\*\*(.+\?)\*\*$/gm;
    let m;
    while ((m = re.exec(body))) {
      const start = re.lastIndex;
      const rest = body.slice(start);
      // The answer runs to the next drafted question, the next instruction
      // line, or the end of the subsection.
      const stop = rest.search(/\n\*\*.+\?\*\*\n|\nH2:|\n---/);
      const answer = (stop === -1 ? rest : rest.slice(0, stop)).trim();
      adds.push({ q: m[1].replace(/\s+/g, ' '), a: answer.replace(/\s*\n\s*/g, ' ').trim() });
    }
    out.push({ slug, newH2, replaceExposure, drops, adds });
  }
  return out;
}

let keyN = 0;
const newKey = () => `r${Date.now().toString(36)}${(keyN++).toString(36)}`;
const makeBlock = (style, text) => ({
  _type: 'block',
  _key: newKey(),
  style,
  markDefs: [],
  children: [{ _type: 'span', _key: newKey(), text, marks: [] }],
});

/* ── Item 15, the worked arithmetic ───────────────────────────────────────
 *
 * Section 5.3 is eight drafted blocks, each one an H3 and two or three
 * paragraphs, each addressed to a named H2 in a named post:
 *
 *   **(a) <slug>**, into "<existing H2>":
 *   > ### <new H3>
 *   >
 *   > paragraph
 *
 * The block goes at the END of that section, immediately before the next H2,
 * so the section's own argument is made first and the numbers close it.
 */
function parseArithmetic(source) {
  const start = source.indexOf('### 5.3 ');
  if (start === -1) throw new Error('section 5.3 not found');
  const region = source.slice(start);
  const out = [];
  const re = /^\*\*\([a-z]\) ([a-z0-9-]+)\*\*, into "([^"]+)":\s*$/gm;
  let m;
  while ((m = re.exec(region))) {
    const [, slug, section] = m;
    const rest = region.slice(re.lastIndex);
    const stopAt = rest.search(/^\*\*\([a-z]\) |^## /m);
    const quoted = (stopAt === -1 ? rest : rest.slice(0, stopAt))
      .split('\n')
      .filter((l) => l.startsWith('>'))
      .map((l) => l.replace(/^>\s?/, ''));
    // Rebuild paragraphs: blank lines separate them, "### " opens the H3.
    const blocks = [];
    let buf = [];
    const flush = () => {
      const text = buf.join(' ').replace(/\s+/g, ' ').trim();
      buf = [];
      if (!text) return;
      if (text.startsWith('### ')) blocks.push({ style: 'h3', text: text.slice(4) });
      else blocks.push({ style: 'normal', text });
    };
    for (const line of quoted) {
      if (line.trim() === '') flush();
      else if (line.startsWith('### ')) {
        flush();
        buf.push(line);
        flush();
      } else buf.push(line);
    }
    flush();
    out.push({ slug, section, blocks });
  }
  return out;
}

/* ── The six unpublished drafts, section 7 ────────────────────────────────
 *
 * Sections 1 to 6 only ever saw the 30 published posts, because that is all
 * the unauthenticated API returned. Six more exist, unpublished, and every one
 * carries both fixed headings: publishing any of them would put the template
 * straight back. Section 7 gives them the same treatment before they go live.
 *
 * `headings` above cannot do this job. It matches one heading block per post
 * and refuses anything else, and one of these six has its opening heading
 * split into TWO H2 blocks with a paragraph between them, which that pass
 * correctly declines to touch.
 */
if (pass === 'drafts') {
  const top = parseHeadingTable(
    md,
    '## 7. The six unpublished drafts',
    'What You Need to Know First',
    'New H2 for "What this means for your filing"',
  );
  const close = parseHeadingTable(md, 'New H2 for "What this means for your filing"', 'What this means for your filing');
  const wanted = new Map();
  for (const r of [...top, ...close]) {
    if (!wanted.has(r.slug)) wanted.set(r.slug, []);
    wanted.get(r.slug).push(r);
  }
  console.log(`Parsed heading pairs for ${wanted.size} unpublished drafts.\n`);

  const posts = await query(
    `*[_type=="post" && slug.current in ${JSON.stringify([...wanted.keys()])}]{_id, "slug": slug.current, body}`,
  );
  const mutations = [];
  const problems = [];

  for (const post of posts) {
    const body = [...(post.body ?? [])];
    let touched = 0;
    for (const { oldHeading, newHeading } of wanted.get(post.slug) ?? []) {
      // The split-heading case: "What You Need to Know" and " First" as two
      // separate H2s. Take the first half, delete the orphan.
      const exact = body.findIndex(
        (b) => b._type === 'block' && b.style === 'h2' && norm(textOf(b)) === norm(oldHeading),
      );
      if (exact !== -1) {
        body[exact] = makeBlock('h2', newHeading);
        touched++;
        continue;
      }
      const head = body.findIndex(
        (b) => b._type === 'block' && b.style === 'h2' && norm(oldHeading).startsWith(norm(textOf(b))) && norm(textOf(b)).length > 6,
      );
      const tail = body.findIndex(
        (b, i) => i > head && b._type === 'block' && b.style === 'h2' && norm(oldHeading).endsWith(norm(textOf(b))),
      );
      if (head !== -1 && tail !== -1) {
        console.log(`${post.slug}: heading was split across two H2 blocks, joining and deleting the orphan " ${textOf(body[tail]).trim()}"`);
        body[head] = makeBlock('h2', newHeading);
        body.splice(tail, 1);
        touched++;
        continue;
      }
      problems.push(`${post.slug}: no H2 "${oldHeading}"`);
    }
    if (!touched) continue;
    console.log(`${post.slug}: ${touched} headings replaced`);
    mutations.push({ patch: { id: post._id, set: { body } } });
  }

  console.log(`\n${mutations.length} drafts to patch.`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);
  if (!WRITE) {
    console.log('\nDry run. Nothing was written. Re-run with --write to apply.');
    process.exit(0);
  }
  const result = await mutate(mutations);
  console.log(`\nWritten. Transaction ${result.transactionId}, ${result.results.length} documents.`);
  console.log('These are drafts: nothing is live until someone publishes them.');
  process.exit(0);
}

/* ── Em dashes ────────────────────────────────────────────────────────────
 *
 * The house style has no em dashes anywhere, including SEO fields. Two exist
 * in the dataset and both are the same construction: another article's title
 * quoted in running prose with an em dash, where the article's real title uses
 * a hyphen. So a hyphen is not a substitution, it is the correction.
 *
 * This walks every field and every span rather than the two known cases, so it
 * stays useful as a check after any future write.
 */
if (pass === 'dashes') {
  const DASH = /[—–]/g;
  const posts = await query('*[_type=="post"]{_id, "slug": slug.current, title, excerpt, seoTitle, seoDescription, body}');
  const mutations = [];
  let found = 0;

  for (const post of posts) {
    const set = {};
    for (const field of ['title', 'excerpt', 'seoTitle', 'seoDescription']) {
      if (typeof post[field] === 'string' && DASH.test(post[field])) {
        set[field] = post[field].replace(DASH, '-');
        console.log(`${post.slug} ${field}: ${set[field]}`);
        found++;
      }
    }
    for (const block of post.body ?? []) {
      if (block._type !== 'block') continue;
      for (const span of block.children ?? []) {
        if (typeof span.text !== 'string' || !DASH.test(span.text)) continue;
        const next = span.text.replace(DASH, '-');
        set[`body[_key=="${block._key}"].children[_key=="${span._key}"].text`] = next;
        console.log(`${post.slug} body: ${next.trim().slice(0, 160)}`);
        found++;
      }
    }
    if (Object.keys(set).length) mutations.push({ patch: { id: post._id, set } });
  }

  console.log(`\n${found} dashes in ${mutations.length} posts.`);
  if (!WRITE) {
    console.log('\nDry run. Nothing was written. Re-run with --write to apply.');
    process.exit(0);
  }
  if (!mutations.length) process.exit(0);
  const result = await mutate(mutations);
  console.log(`\nWritten. Transaction ${result.transactionId}, ${result.results.length} documents.`);
  process.exit(0);
}

/* ── Item 15, section 5.2 ─────────────────────────────────────────────────
 *
 * Ten country and platform posts asserted a bare total in an FAQ answer with
 * no arithmetic. The FAQ pass replaced that question, and 5.2 says the
 * arithmetic then moves into the body's penalty paragraph. The sentence is the
 * drafted pattern with the post's own year count substituted; the counts come
 * from 5.2's own list, never from a guess.
 *
 * Two posts named there, firstbase and stripe-atlas, are deliberately NOT
 * handled: 5.2 gives them no year count, and picking one would be inventing
 * the reader's situation. They are reported instead.
 */
const WORD = { 2: 'Two', 3: 'Three', 4: 'Four' };

function parseExposureTargets(source) {
  const start = source.indexOf('### 5.2 ');
  const region = source.slice(start, source.indexOf('### 5.3 '));
  const out = [];
  for (const m of region.matchAll(/([a-z0-9-]{8,})\s*\(\$([\d,]+),\s*(two|three|four)\s*\n?\s*years?\)/g)) {
    const years = { two: 2, three: 3, four: 4 }[m[3]];
    out.push({ slug: m[1], total: m[2], years });
  }
  return out;
}

function exposureParagraph({ total, years }) {
  const dbl = Number(total.replace(/,/g, '')) * 2;
  const fmt = (n) => n.toLocaleString('en-US');
  return (
    `${WORD[years]} unfiled years is $${total}. The penalty under IRC §6038A(d)(1) is $25,000 per ` +
    `Form 5472, per year, with no cap on the total: ${years} years x 1 form x $25,000 = $${total}. ` +
    `If a second foreign related party also transacted with the LLC, each year needs two forms and ` +
    `the figure doubles to $${fmt(dbl)}.`
  );
}

if (pass === 'exposure') {
  const targets = parseExposureTargets(md);
  console.log(`Parsed ${targets.length} posts needing the worked total in the body.\n`);

  const posts = await query('*[_type=="post" && defined(slug.current)]{_id, "slug": slug.current, body}');
  const bySlug = new Map(posts.map((p) => [p.slug, p]));

  const mutations = [];
  const problems = [];

  for (const t of targets) {
    const post = bySlug.get(t.slug);
    if (!post) {
      problems.push(`${t.slug}: no such post`);
      continue;
    }
    const body = post.body ?? [];
    const text = exposureParagraph(t);
    if (body.some((b) => b._type === 'block' && textOf(b).startsWith(`${WORD[t.years]} unfiled years is $${t.total}.`))) {
      console.log(`${t.slug}: already carries the worked total, skipped`);
      continue;
    }
    // Anchor: the first paragraph inside the BODY that names the penalty,
    // where the body starts at the first H2. Every one of these posts also
    // names $25,000 in its opening summary paragraph, and that is the wrong
    // place: the summary answers the question, the arithmetic belongs in the
    // section that argues it.
    const firstH2 = body.findIndex((b) => b._type === 'block' && b.style === 'h2');
    const anchor = body.findIndex(
      (b, i) => i > firstH2 && b._type === 'block' && b.style === 'normal' && /\$25,000/.test(textOf(b)),
    );
    if (anchor === -1) {
      problems.push(`${t.slug}: no paragraph naming $25,000 to anchor to`);
      continue;
    }
    const nextBody = [...body.slice(0, anchor + 1), makeBlock('normal', text), ...body.slice(anchor + 1)];
    console.log(`${t.slug}: after "${textOf(body[anchor]).slice(0, 70)}..."`);
    if (process.argv.includes('--show')) console.log(`    ${text}\n`);
    mutations.push({ patch: { id: post._id, set: { body: nextBody } } });
  }

  console.log(`\n${mutations.length} posts to patch.`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);
  console.log(
    'Not handled by design: firstbase-llc-form-5472-boi-update and\n' +
      'stripe-atlas-llc-tax-filing-deadline. Section 5.2 names them but gives no\n' +
      'year count, and choosing one would invent the reader\'s situation.',
  );

  if (!WRITE) {
    console.log('\nDry run. Nothing was written. Re-run with --write to apply.');
    process.exit(0);
  }
  const result = await mutate(mutations);
  console.log(`\nWritten. Transaction ${result.transactionId}, ${result.results.length} documents.`);
  process.exit(0);
}

if (pass === 'arithmetic') {
  const specs = parseArithmetic(md);
  console.log(`Parsed ${specs.length} worked-arithmetic blocks from the drafted copy.\n`);

  const posts = await query('*[_type=="post" && defined(slug.current)]{_id, "slug": slug.current, body}');
  const bySlug = new Map(posts.map((p) => [p.slug, p]));

  const mutations = [];
  const problems = [];

  for (const spec of specs) {
    const post = bySlug.get(spec.slug);
    if (!post) {
      problems.push(`${spec.slug}: no such post`);
      continue;
    }
    const body = post.body ?? [];
    const idx = body.findIndex(
      (b) => b._type === 'block' && b.style === 'h2' && norm(textOf(b)) === norm(spec.section),
    );
    if (idx === -1) {
      problems.push(`${spec.slug}: no H2 "${spec.section}"`);
      continue;
    }
    // Already applied? The H3 is unique enough to be its own idempotency key.
    const h3 = spec.blocks.find((b) => b.style === 'h3');
    if (body.some((b) => b._type === 'block' && norm(textOf(b)) === norm(h3.text))) {
      console.log(`${spec.slug}: already carries "${h3.text}", skipped`);
      continue;
    }
    let end = body.findIndex((b, i) => i > idx && b._type === 'block' && b.style === 'h2');
    if (end === -1) end = body.length;
    const inserted = spec.blocks.map((b) => makeBlock(b.style, b.text));
    const nextBody = [...body.slice(0, end), ...inserted, ...body.slice(end)];

    console.log(`${spec.slug}: ${inserted.length} blocks into "${spec.section}"`);
    if (process.argv.includes('--show')) {
      for (const b of spec.blocks) console.log(`    [${b.style}] ${b.text}`);
    }
    mutations.push({ patch: { id: post._id, set: { body: nextBody } } });
  }

  console.log(`\n${mutations.length} posts to patch.`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);

  if (!WRITE) {
    console.log('\nDry run. Nothing was written. Re-run with --write to apply.');
    process.exit(0);
  }
  const result = await mutate(mutations);
  console.log(`\nWritten. Transaction ${result.transactionId}, ${result.results.length} documents.`);
  process.exit(0);
}

if (pass === 'faq') {
  const sections = parseFaqSections(md);
  console.log(`Parsed ${sections.length} FAQ subsections from the drafted copy.\n`);

  const posts = await query('*[_type=="post" && defined(slug.current)]{_id, "slug": slug.current, body}');
  const bySlug = new Map(posts.map((p) => [p.slug, p]));

  const mutations = [];
  const problems = [];

  for (const sec of sections) {
    const post = bySlug.get(sec.slug);
    if (!post) {
      problems.push(`${sec.slug}: no such post`);
      continue;
    }
    const body = post.body ?? [];
    // The FAQ block is the last h2 that is followed by an h3.
    let faqIdx = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i]._type === 'block' && body[i].style === 'h2') {
        const next = body[i + 1];
        if (next && next._type === 'block' && next.style === 'h3') faqIdx = i;
      }
    }
    if (faqIdx === -1) {
      problems.push(`${sec.slug}: no FAQ block found`);
      continue;
    }

    const head = body.slice(0, faqIdx);
    const faqH2 = body[faqIdx];
    const items = [];
    for (let i = faqIdx + 1; i < body.length; i++) {
      const b = body[i];
      if (b._type === 'block' && b.style === 'h3') items.push({ q: b, rest: [] });
      else if (items.length) items[items.length - 1].rest.push(b);
      else problems.push(`${sec.slug}: content between the FAQ heading and its first question`);
    }

    const before = items.length;
    let kept = items;

    if (sec.replaceExposure) {
      // The repeated "I formed my LLC N years ago ... What is my exposure?"
      // question. Matched on the tail alone: the year count differs per post,
      // and so does the middle clause, which is "and never filed" on some posts
      // and "through Incfile" on others.
      const isExposure = (it) => /what is (my|the) exposure\?\s*$/i.test(textOf(it.q));
      const hits = kept.filter(isExposure);
      if (hits.length !== 1) {
        problems.push(`${sec.slug}: expected 1 exposure question, found ${hits.length}, left alone`);
      } else {
        kept = kept.filter((it) => !isExposure(it));
      }
    }

    for (const d of sec.drops) {
      const hits = kept.filter((it) => norm(textOf(it.q)) === norm(d));
      if (hits.length !== 1) {
        problems.push(`${sec.slug}: drop target not matched exactly once (${hits.length}): "${d}"`);
        continue;
      }
      kept = kept.filter((it) => !hits.includes(it));
    }

    const additions = [];
    if (process.argv.includes('--show')) {
      for (const { q, a } of sec.adds) console.log(`\n  Q ${q}\n  A ${a}`);
    }
    for (const { q, a } of sec.adds) {
      if (kept.some((it) => norm(textOf(it.q)) === norm(q))) {
        problems.push(`${sec.slug}: skipped an addition already present: "${q}"`);
        continue;
      }
      additions.push(makeBlock('h3', q), makeBlock('normal', a));
    }

    const h2Block = sec.newH2
      ? { ...faqH2, children: [{ ...(faqH2.children?.[0] ?? { _type: 'span', _key: newKey(), marks: [] }), text: sec.newH2 }] }
      : faqH2;

    const nextBody = [...head, h2Block, ...kept.flatMap((it) => [it.q, ...it.rest]), ...additions];
    const after = kept.length + sec.adds.length;

    console.log(
      `${sec.slug}: ${before} -> ${after} questions` +
        (sec.newH2 ? `, H2 "${textOf(faqH2)}" -> "${sec.newH2}"` : '') +
        (sec.replaceExposure ? ', exposure question replaced' : '') +
        (sec.drops.length ? `, ${sec.drops.length} dropped` : ''),
    );

    if (nextBody.length === body.length && !sec.newH2) continue; // nothing to do
    mutations.push({ patch: { id: post._id, set: { body: nextBody } } });
  }

  console.log(`\n${mutations.length} posts to patch.`);
  if (problems.length) {
    console.log('Not applied, needing a human:');
    for (const p of problems) console.log(`  ${p}`);
  }

  if (!WRITE) {
    console.log('\nDry run. Nothing was written. Re-run with --write to apply.');
    process.exit(0);
  }
  const result = await mutate(mutations);
  console.log(`\nWritten. Transaction ${result.transactionId}, ${result.results.length} documents.`);
  console.log('The FAQPage JSON-LD is generated from these H3s, so check one rendered post.');
  process.exit(0);
}

const replacements = [
  ...parseHeadingTable(md, '## 2. Replacement for', 'What You Need to Know First'),
  ...parseHeadingTable(md, '## 3. Replacement for', 'What this means for your filing'),
];

console.log(`Parsed ${replacements.length} heading replacements from the drafted copy.\n`);

// Pull every post whole. pt::text is not enough here: the patch has to address
// the exact block by _key and keep its span keys.
const posts = await query(
  '*[_type=="post" && defined(slug.current)]{_id, "slug": slug.current, title, body}',
);
const bySlug = new Map(posts.map((p) => [p.slug, p]));

const mutations = [];
const misses = [];
let changed = 0;

for (const { slug, oldHeading, newHeading } of replacements) {
  const post = bySlug.get(slug);
  if (!post) {
    misses.push(`${slug}: no such post`);
    continue;
  }
  // Match on the rendered text of the heading block, case-insensitively and
  // ignoring surrounding space. The corpus was assembled by one generator so
  // the wording is uniform, but a stray capital must not silently skip a post.
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const hits = (post.body ?? []).filter(
    (b) => b._type === 'block' && b.style === 'h2' && norm((b.children ?? []).map((c) => c.text).join('')) === norm(oldHeading),
  );
  if (hits.length === 0) {
    misses.push(`${slug}: no h2 "${oldHeading}"`);
    continue;
  }
  if (hits.length > 1) {
    misses.push(`${slug}: ${hits.length} blocks match "${oldHeading}", skipped as ambiguous`);
    continue;
  }
  const block = hits[0];
  const spans = block.children ?? [];
  // Collapse to the first span, keeping its key and marks. These headings are
  // plain text in every post; anything else would be a formatting change this
  // pass has no business making, so it is refused rather than flattened.
  if (spans.length !== 1 || (spans[0].marks ?? []).length > 0) {
    misses.push(`${slug}: heading is not a single plain span, skipped`);
    continue;
  }
  console.log(`${slug}`);
  console.log(`   - ${oldHeading}`);
  console.log(`   + ${newHeading}`);
  mutations.push({
    patch: {
      id: post._id,
      set: { [`body[_key=="${block._key}"].children[_key=="${spans[0]._key}"].text`]: newHeading },
    },
  });
  changed++;
}

console.log(`\n${changed} headings to change, ${misses.length} not applied.`);
for (const m of misses) console.log(`  SKIP ${m}`);

if (!WRITE) {
  console.log('\nDry run. Nothing was written. Re-run with --write to apply.');
  process.exit(0);
}

// One transaction, so the corpus cannot end up half renamed.
const result = await mutate(mutations);
console.log(`\nWritten. Transaction ${result.transactionId}, ${result.results.length} documents.`);
console.log('These are published documents: the change is live on the next prerender.');
