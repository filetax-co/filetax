// scripts/sanity-push-draft.mjs
//
// Publishes a merged article to Sanity as a DRAFT, from a markdown source in
// scripts/content/. Drafts appear in the Studio for review and are not visible
// on the site until someone clicks Publish.
//
//   SANITY_WRITE_TOKEN=... node scripts/sanity-push-draft.mjs pro-forma-1120-explained
//
// The token is read from the environment and never written to disk or logged.
// Create one at manage.sanity.io -> API -> Tokens with Editor permissions.
//
// Why drafts rather than a direct publish: these merges retire URLs that
// currently rank, so publishing has to happen in one coordinated cutover with
// the 301s in public/_redirects and the unpublishing of the source posts.
// Publishing the merged article on its own would leave two near-duplicate pages
// live, which is worse than the split it is meant to fix.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PROJECT_ID = 'alh0fv7m';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const TOKEN = process.env.SANITY_WRITE_TOKEN;
if (!TOKEN) {
  console.error('SANITY_WRITE_TOKEN is not set. Create an Editor token at');
  console.error('manage.sanity.io -> API -> Tokens, then re-run:');
  console.error('  SANITY_WRITE_TOKEN=<token> node scripts/sanity-push-draft.mjs <slug>');
  process.exit(1);
}

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/sanity-push-draft.mjs <slug>');
  process.exit(1);
}

let keyCounter = 0;
const key = () => `k${(keyCounter++).toString(36)}`;

function span(text, marks = []) {
  return { _type: 'span', _key: key(), text, marks };
}

// Inline markdown: **bold**, [text](href). Deliberately minimal — the source
// files only use what the site's PortableText serializers actually render.
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
  if (listItem) {
    b.listItem = listItem;
    b.level = 1;
  }
  return b;
}

// Markdown -> Portable Text. Front matter is `key: value` lines before a `---`.
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
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('### ')) body.push(block('h3', t.slice(4)));
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

async function sanity(path, init) {
  const res = await fetch(
    `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}${path}`,
    { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`Sanity ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// Reuse the existing document's id, categories and image so the draft is a true
// revision of the live post rather than an unrelated new document.
const existing = await sanity(
  `/data/query/${DATASET}?query=${encodeURIComponent(
    `*[_type=="post" && slug.current=="${slug}"][0]{_id, categories, mainImage, author, relatedPosts, publishedAt}`
  )}`
);

const src = existing.result;
if (!src) throw new Error(`No published post found for slug "${slug}"`);

const draftId = src._id.startsWith('drafts.') ? src._id : `drafts.${src._id}`;

const doc = {
  _id: draftId,
  _type: 'post',
  title: meta.title,
  seoTitle: meta.seoTitle,
  seoDescription: meta.seoDescription,
  excerpt: meta.excerpt,
  slug: { _type: 'slug', current: slug },
  author: src.author,
  publishedAt: src.publishedAt,
  categories: src.categories,
  mainImage: src.mainImage,
  relatedPosts: src.relatedPosts,
  body,
};

const result = await sanity(`/data/mutate/${DATASET}?returnIds=true`, {
  method: 'POST',
  body: JSON.stringify({ mutations: [{ createOrReplace: doc }] }),
});

console.log(`Draft written: ${draftId}`);
console.log(`  title:  ${meta.title}`);
console.log(`  blocks: ${body.length}`);
console.log(`  txn:    ${result.transactionId}`);
console.log('');
console.log('Review it in the Studio. The live post is unchanged until you publish.');
