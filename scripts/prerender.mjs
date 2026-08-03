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
  '/compare',
  // Was missing until 3 Aug 2026. The route existed in routes.tsx and the
  // footer linked to it, but with no entry here there was no /guide.html, so
  // the page existed only for someone already inside the SPA. Item 32 wired
  // /compare into all four places; /guide got two of them.
  //
  // Note the name collision: public/guide/ holds the generated screenshots and
  // ships as dist/guide/. Pages resolves the extensionless /guide to
  // guide.html before it considers the directory, so both work, but do not
  // rename either half without checking the other.
  '/guide',
  '/check',
  '/resources',
  '/faq',
  '/waitlist',
  '/terms',
  '/privacy',
  '/refunds',
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

// Flat "<route>.html" files, NOT "<route>/index.html".
//
// Cloudflare Pages resolves an extensionless request against a flat file first
// and serves it at that exact URL. If only the directory form exists it instead
// issues a 308 to the trailing-slash variant - which would redirect every
// already-indexed URL (/pricing, /resources/<slug>) to a new one, while the
// canonical tag and sitemap still point at the non-slash form. Flat files keep
// the live URLs byte-identical to what Google has indexed.
function routeToOutputPath(route) {
  if (route === '/') {
    return join(DIST_DIR, 'index.html');
  }
  return join(DIST_DIR, `${route}.html`);
}

// Below this many characters inside #root, the SPA did not mount and what we
// captured is the empty shell. 200 is comfortably under the smallest real page
// and far above an empty div plus whitespace.
const MIN_ROOT_CHARS = 200;

async function prerenderRoute(page, route) {
  const url = `${BASE_URL}${route}`;

  // Collected so a mount failure names its own cause. The failure this exists
  // for, missing VITE_SUPABASE_* vars, is a throw at module load, and without
  // this the build only ever said "empty shell" and left you guessing.
  const pageErrors = [];
  const onPageError = (err) => pageErrors.push(err.message);
  page.on('pageerror', onPageError);

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

  // THE RATCHET. Without this the prerender happily wrote an unmounted page and
  // reported success, so PRERENDER_STRICT=1 could not fail the build and the
  // only thing that ever noticed was one grep in the CI workflow, one step too
  // late. A build with no Supabase vars shipped a shell homepage and said it
  // was fine. Same family as verifyPageSize and verifyPdfStructure: a check
  // that reports no problems has probably not run.
  const rootChars = await page.evaluate(
    () => document.getElementById('root')?.innerHTML.trim().length ?? 0,
  );
  page.off('pageerror', onPageError);

  if (rootChars < MIN_ROOT_CHARS) {
    const cause = pageErrors.length
      ? `\n  The page threw: ${pageErrors.join(' | ')}`
      : '\n  No page error was raised, so suspect a router or render failure rather than a module-load throw.';
    throw new Error(
      `${route} did not mount: #root holds ${rootChars} characters, expected at least ${MIN_ROOT_CHARS}.` +
        cause +
        '\n  If it names a missing VITE_SUPABASE_ var, the build environment is short an env var;' +
        '\n  src/lib/supabase.ts throws at module load and React never mounts.',
    );
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
