// scripts/generate-sitemap.mjs
// Generates public/sitemap.xml at build time from Sanity + static routes.
// Runs automatically via the "prebuild" npm hook, before `vite build`.
// Node 20+ (uses global fetch). No token required — the `production`
// dataset is public-read, same as the front-end client in src/lib/sanity.ts.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://filetax.co';
const PROJECT_ID = 'alh0fv7m';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

// Static routes that always exist. Private/blocked routes (/auth, /dashboard,
// /portal) are intentionally excluded to stay consistent with robots.txt.
const STATIC_ROUTES = [
  { path: '/',             changefreq: 'weekly',  priority: '1.0' },
  { path: '/pricing',      changefreq: 'monthly', priority: '0.9' },
  { path: '/services',     changefreq: 'monthly', priority: '0.9' },
  { path: '/past-filings', changefreq: 'monthly', priority: '0.9' },
  { path: '/check',        changefreq: 'monthly', priority: '0.8' },
  { path: '/resources',    changefreq: 'weekly',  priority: '0.8' },
  { path: '/faq',          changefreq: 'monthly', priority: '0.7' },
  { path: '/waitlist',     changefreq: 'monthly', priority: '0.6' },
  { path: '/terms',        changefreq: 'yearly',  priority: '0.3' },
  { path: '/privacy',      changefreq: 'yearly',  priority: '0.3' },
];

const GROQ =
  '*[_type == "post" && defined(publishedAt) && defined(slug.current)]' +
  '{"slug": slug.current, _updatedAt}';

const today = new Date().toISOString().slice(0, 10);

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ].filter(Boolean).join('\n');
}

async function fetchPosts() {
  const url =
    `https://${PROJECT_ID}.apicdn.sanity.io/v${API_VERSION}` +
    `/data/query/${DATASET}?query=${encodeURIComponent(GROQ)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sanity query failed: ${res.status} ${res.statusText}`);
  }
  const { result } = await res.json();
  if (!Array.isArray(result)) {
    throw new Error('Unexpected Sanity response shape');
  }
  return result;
}

async function main() {
  const posts = await fetchPosts();

  const staticEntries = STATIC_ROUTES.map((r) =>
    urlEntry({
      loc: `${SITE}${r.path}`,
      lastmod: today,
      changefreq: r.changefreq,
      priority: r.priority,
    })
  );

  const postEntries = posts.map((p) =>
    urlEntry({
      loc: `${SITE}/resources/${p.slug}`,
      lastmod: (p._updatedAt || '').slice(0, 10) || today,
      changefreq: 'monthly',
      priority: '0.7',
    })
  );

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticEntries,
    ...postEntries,
    '</urlset>',
    '',
  ].join('\n');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(__dirname, '..', 'public', 'sitemap.xml');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, xml, 'utf8');

  console.log(
    `sitemap.xml: ${STATIC_ROUTES.length} static + ${posts.length} posts ` +
    `= ${STATIC_ROUTES.length + posts.length} URLs`
  );
}

main().catch((err) => {
  console.error('Failed to generate sitemap:', err);
  process.exit(1);
});
