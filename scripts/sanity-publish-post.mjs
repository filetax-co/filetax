// scripts/sanity-publish-post.mjs
//
// Publishes a NEW article to Sanity, live, from a markdown source in
// scripts/content/.
//
//   node scripts/sanity-publish-post.mjs <slug>            # dry run, prints the doc
//   node scripts/sanity-publish-post.mjs <slug> --write    # publishes
//
// This is the sibling of sanity-push-draft.mjs and the difference is deliberate.
// That script REVISES an existing post, so it writes a draft: the merges it was
// built for retire URLs that already rank, and publishing one on its own would
// leave two near-duplicate pages live. A brand new post retires nothing and
// competes with nothing, so there is no cutover to coordinate and no reason to
// park it in the Studio.
//
// It refuses to touch a slug that already exists, published or draft. Creating a
// second document on a live slug is the one mistake here that is expensive:
// the site queries by slug and would start serving whichever the API returned
// first, which is not a stable answer.
//
// The token comes from the environment or from the token file, via sanity-read.

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './sanity-read.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'alh0fv7m';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const slug = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!slug) {
  console.error('Usage: node scripts/sanity-publish-post.mjs <slug> [--write]');
  process.exit(1);
}

function loadToken() {
  if (process.env.SANITY_WRITE_TOKEN) return process.env.SANITY_WRITE_TOKEN.trim();
  const file = process.env.SANITY_TOKEN_FILE || 'C:/Users/chira/OneDrive/Desktop/Sanity Token - Filetax.txt';
  if (!existsSync(file)) return null;
  const m = readFileSync(file, 'utf8').match(/(sk[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

let keyCounter = 0;
const key = () => `k${(keyCounter++).toString(36)}`;
const span = (text, marks = []) => ({ _type: 'span', _key: key(), text, marks });

// Inline markdown: **bold** and [text](href). Deliberately minimal, matching
// sanity-push-draft: the source files only use what the site's PortableText
// serializers actually render.
function inline(text) {
  const children = [];
  const markDefs = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) children.push(span(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      children.push(span(m[1], ['strong']));
    } else {
      const linkKey = key();
      markDefs.push({ _type: 'link', _key: linkKey, href: m[3] });
      children.push(span(m[2], [linkKey]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) children.push(span(text.slice(last)));
  if (!children.length) children.push(span(text));
  return { children, markDefs };
}

function block(style, text, listItem) {
  const { children, markDefs } = inline(text);
  const b = { _type: 'block', _key: key(), style, children, markDefs };
  if (listItem) { b.listItem = listItem; b.level = 1; }
  return b;
}

// A run of consecutive |a|b|c| lines becomes one table block, first row the
// header, in the shape the renderer and @sanity/table expect. Cells are plain
// text: the renderer does not mark up inside them, so anything load-bearing has
// to exist in prose as well.
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function parse(md) {
  const lines = md.split(/\r?\n/);
  const meta = {};
  let i = 0;
  if (lines[0].trim() === '---') {
    i = 1;
    for (; i < lines.length && lines[i].trim() !== '---'; i++) {
      const idx = lines[i].indexOf(':');
      if (idx > 0) meta[lines[i].slice(0, idx).trim()] = lines[i].slice(idx + 1).trim();
    }
    i++;
  }

  const body = [];
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push({ _type: 'row', _key: key(), cells: cells(lines[i]) });
        i += 1;
      }
      i -= 1;
      body.push({ _type: 'table', _key: key(), rows });
    }
    else if (t.startsWith('### ')) body.push(block('h3', t.slice(4)));
    else if (t.startsWith('## ')) body.push(block('h2', t.slice(3)));
    else if (t.startsWith('> ')) body.push(block('blockquote', t.slice(2)));
    else if (/^[-*] /.test(t)) body.push(block('normal', t.slice(2), 'bullet'));
    else if (/^\d+\. /.test(t)) body.push(block('normal', t.replace(/^\d+\.\s*/, ''), 'number'));
    else body.push(block('normal', t));
  }
  return { meta, body };
}

const md = readFileSync(resolve(ROOT, 'scripts', 'content', `${slug}.md`), 'utf8');
const { meta, body } = parse(md);

if (meta.slug && meta.slug !== slug) {
  throw new Error(`Front matter slug "${meta.slug}" does not match the filename "${slug}".`);
}

// Em dashes are banned sitewide, and the SEO fields are where they survive a
// read-through. Check the source rather than trusting the writing.
const dashHit = md.match(/[\u2014\u2013]/);
if (dashHit) throw new Error(`Source contains an em or en dash at index ${dashHit.index}. Remove it.`);

const existing = await query(`*[_type=="post" && slug.current=="${slug}"]{_id}`);
if (existing.length) {
  console.error(`A post with slug "${slug}" already exists (${existing.map((d) => d._id).join(', ')}).`);
  console.error('This script only creates new posts. Use sanity-push-draft.mjs to revise one.');
  process.exit(1);
}

// Categories are references, so the titles in the front matter have to resolve
// to documents that exist. A typo here would publish a post filed under nothing.
const allCats = await query('*[_type=="category"]{_id, title}');
const catNames = (meta.categories ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const categories = catNames.map((name) => {
  const hit = allCats.find((c) => c.title.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`No category named "${name}". Have: ${allCats.map((c) => c.title).join(', ')}`);
  return { _type: 'reference', _key: key(), _ref: hit._id };
});

// relatedPosts must point at PUBLISHED documents. A reference to a draft-only
// post renders as a card linking to a URL the site does not serve.
const relSlugs = (meta.relatedPosts ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const relDocs = await query(`*[_type=="post" && slug.current in [${relSlugs.map((s) => `"${s}"`).join(',')}]]{_id, "s": slug.current}`);
const relatedPosts = relSlugs.map((s) => {
  const hit = relDocs.find((d) => d.s === s && !d._id.startsWith('drafts.'));
  if (!hit) throw new Error(`relatedPosts: "${s}" has no published document.`);
  return { _type: 'reference', _key: key(), _ref: hit._id };
});

// Every internal link has to point at a slug that exists and is published, for
// the same reason. This is the check the original corpus never had, which is
// why 36 posts shipped with their cross-references as plain text.
const linked = [...md.matchAll(/\]\((\/resources\/[a-z0-9-]+)\)/g)].map((m) => m[1].split('/').pop());
const linkDocs = linked.length
  ? await query(`*[_type=="post" && slug.current in [${[...new Set(linked)].map((s) => `"${s}"`).join(',')}]]{_id, "s": slug.current}`)
  : [];
for (const s of new Set(linked)) {
  if (!linkDocs.some((d) => d.s === s && !d._id.startsWith('drafts.'))) {
    throw new Error(`Internal link /resources/${s} has no published post behind it.`);
  }
}

const doc = {
  _id: randomUUID(),
  _type: 'post',
  title: meta.title,
  seoTitle: meta.seoTitle,
  seoDescription: meta.seoDescription,
  excerpt: meta.excerpt,
  slug: { _type: 'slug', current: slug },
  author: 'FileTax',
  publishedAt: meta.publishedAt || new Date().toISOString(),
  featured: false,
  mainImage: { _type: 'image', alt: meta.mainImageAlt },
  categories,
  relatedPosts,
  body,
};

const counts = body.reduce((acc, b) => {
  const k = b._type === 'table' ? 'table' : (b.style ?? 'normal');
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});

console.log(`slug:        ${slug}`);
console.log(`title:       ${doc.title}`);
console.log(`seoTitle:    ${doc.seoTitle} (${(doc.seoTitle ?? '').length} chars)`);
console.log(`seoDesc:     ${(doc.seoDescription ?? '').length} chars`);
console.log(`excerpt:     ${(doc.excerpt ?? '').length} chars`);
console.log(`categories:  ${catNames.join(', ')}`);
console.log(`related:     ${relSlugs.join(', ')}`);
console.log(`links:       ${[...new Set(linked)].join(', ')}`);
console.log(`blocks:      ${JSON.stringify(counts)}`);
console.log(`words:       ${md.split(/\s+/).length}`);

if (!WRITE) {
  console.log('\nDry run. Nothing was written. Re-run with --write to publish.');
  process.exit(0);
}

const TOKEN = loadToken();
if (!TOKEN) throw new Error('No Sanity token available.');

const res = await fetch(`https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/mutate/${DATASET}?returnIds=true`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ mutations: [{ create: doc }] }),
});
const json = await res.json();
if (!res.ok) throw new Error(`Sanity ${res.status}: ${JSON.stringify(json).replace(/sk[A-Za-z0-9]+/g, '<redacted>')}`);

console.log(`\nPublished. _id ${doc._id}, txn ${json.transactionId}`);
console.log(`Live at /resources/${slug} after the next site build.`);
