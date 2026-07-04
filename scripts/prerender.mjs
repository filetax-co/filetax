// scripts/prerender.mjs
// Prerenders every public route to static HTML after `vite build` has run
// and after dist/404.html has already been copied from the original
// (empty-shell) dist/index.html. This script then overwrites dist/index.html
// and creates nested index.html files for every other route, so crawlers
// get fully-rendered content on first fetch instead of an empty <div>.
//
// Must run AFTER "cp dist/index.html dist/404.html" in the workflow.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

const PROJECT_ID = 'alh0fv7m';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const STATIC_ROUTES = [
  '/',
  '/pricing',
  '/services',
  '/past-filings',
  '/check',
  '/resources',
  '/faq',
  '/waitlist',
  '/terms',
  '/privacy',
];

const GROQ =
  '*[_type == "post" && defined(publishedAt) && defined(slug.current)]' +
  '{"slug": slug.current}';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

async function fetchArticleSlugs() {
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
  return result.map((p) => `/resources/${p.slug}`);
}

function startStaticServer() {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = join(DIST_DIR, urlPath);

        if (!extname(filePath)) {
          filePath = join(filePath, 'index.html');
        }

        if (!existsSync(filePath)) {
          filePath = join(DIST_DIR, 'index.html');
        }

        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const content = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch (err) {
        res.writeHead(500);
        res.end('Server error');
      }
    });

    server.listen(PORT, () => resolvePromise(server));
  });
}

function routeToOutputPath(route) {
  if (route === '/') {
    return join(DIST_DIR, 'index.html');
  }
  return join(DIST_DIR, route, 'index.html');
}

async function prerenderRoute(page, route) {
  const url = `${BASE_URL}${route}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  const isArticle = route.startsWith('/resources/') && route !== '/resources';

  if (isArticle) {
    // Wait for the breadcrumb nav, which only renders once the Sanity
    // fetch has resolved and `post` is populated (not during loading
    // or not-found states). This avoids baking "Loading article..." or
    // "This article could not be found" into the static HTML.
    try {
      await page.waitForSelector('nav[aria-label="Breadcrumb"]', { timeout: 15000 });
    } catch {
      console.warn(`WARNING: ${route} never reached loaded state (still "Loading..." or "not found") after 15s`);
    }
  } else {
    await page.waitForTimeout(500);
  }

  const html = await page.content();
  const outPath = routeToOutputPath(route);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  console.log(`Prerendered: ${route} -> ${outPath.replace(DIST_DIR, 'dist')}`);
}

async function main() {
  const articleRoutes = await fetchArticleSlugs();
  const allRoutes = [...STATIC_ROUTES, ...articleRoutes];

  console.log(`Prerendering ${allRoutes.length} routes...`);

  const server = await startStaticServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    for (const route of allRoutes) {
      await prerenderRoute(page, route);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`Done. ${allRoutes.length} routes prerendered.`);
}

main().catch((err) => {
  console.error('Prerender failed:', err);
  process.exit(1);
});
