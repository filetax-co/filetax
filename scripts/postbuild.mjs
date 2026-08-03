// scripts/postbuild.mjs
// Runs automatically after `vite build` (see the "build" script in package.json).
//
// This exists because prerendering used to be a separate npm script that only
// the (now removed) GitHub Pages workflow invoked. Cloudflare, which actually
// hosts the site, runs a plain `npm run build`, so scripts/prerender.mjs never
// ran and every URL served the empty `<div id="root">` shell. Hanging the
// prerender off `build` guarantees it runs no matter which pipeline builds us.
//
// Prerendering is deliberately BEST-EFFORT on the hosting build: if Chromium
// can't be installed or launched in the build sandbox, we log loudly, restore
// the old SPA-fallback behaviour and exit 0 so the deploy still ships. We never
// take the site down over a prerender failure.
//
// Set PRERENDER_STRICT=1 to turn a prerender failure into a hard error instead.
// CI uses this so a broken prerender is caught on push rather than shipping a
// silently degraded site. It is deliberately NOT keyed off `CI`, which
// Cloudflare Pages also sets, strict mode there would break production
// deploys, which is exactly what best-effort is protecting against.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STRICT = process.env.PRERENDER_STRICT === '1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

// Routes that must return 200 but must NOT be prerendered: they are private app
// surfaces, excluded from the sitemap and disallowed in robots.txt. They get a
// copy of the unrendered shell so the SPA boots and the router takes over,
// exactly as it did before prerendering existed. Without these, adding 404.html
// makes Cloudflare answer them with a 404 status.
const PRIVATE_ROUTES = [
  'portal',
  'auth',
  'auth/confirm',
  'reset-password',
  'dashboard',
  'intake',
  'catch-up',
];

// Always invoke through `node <script>` rather than npx. npx resolves to a .cmd
// shim on Windows, which Node refuses to spawn without shell:true (EINVAL), and
// shell:true concatenates arguments unescaped (DEP0190). Calling the JS entry
// points directly sidesteps both and behaves identically on Linux CI.
function runNode(scriptPath, args = []) {
  execFileSync(process.execPath, [scriptPath, ...args], { cwd: ROOT, stdio: 'inherit' });
}

const shellPath = resolve(DIST, 'index.html');
if (!existsSync(shellPath)) {
  console.error('postbuild: dist/index.html missing, did vite build run?');
  process.exit(1);
}

// Captured before prerender.mjs overwrites dist/index.html with the rendered
// homepage. Everything below reuses this unrendered copy.
const shellHtml = readFileSync(shellPath, 'utf8');

/**
 * Turn the generic shell into a not-found shell: noindex, its own title and
 * description, and no canonical pointing at a page that does not exist.
 * Kept string-level deliberately, since the shell is Vite's output and parsing
 * it would couple this script to whatever that output looks like next.
 */
function asNotFoundShell(html) {
  const TITLE = 'Page not found | FileTax.co';
  const DESC =
    'This page does not exist. Find Form 5472 filing, pricing and guidance on FileTax.co.';
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${TITLE}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${DESC}" />`)
    .replace(/<link\s+rel="canonical"[^>]*>/i, '')
    .replace(/<meta\s+property="og:(title|description|url)"[^>]*>/gi, '')
    .replace(/<\/head>/i, '  <meta name="robots" content="noindex, nofollow" />\n  </head>');
}

// Same treatment as the 404 shell, and for the same reason. These files were
// written as a VERBATIM copy of index.html, so /portal, /auth, /dashboard,
// /intake, /catch-up and /reset-password each answered 200 carrying the
// HOMEPAGE's title, description, canonical and og tags, with no noindex. That
// is precisely the defect the 404 shell was patched to fix, left in place on
// seven more URLs.
//
// robots.txt was not covering it either: it disallows /auth, /dashboard and
// /portal only, so /intake, /catch-up and /reset-password were freely
// crawlable duplicates of the homepage. Note that robots.txt and noindex do
// not stack, a disallowed URL is never fetched, so the noindex on those three
// is never read. The static tag is what actually works, which is why it goes
// on all seven rather than growing the Disallow list.
//
// Title stays generic rather than per-route: usePageMeta sets the real one at
// runtime, and the point here is only that seven URLs must not all claim to be
// the homepage.
function asPrivateShell(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>FileTax.co</title>')
    .replace(/<link\s+rel="canonical"[^>]*>/i, '')
    .replace(/<meta\s+property="og:(title|description|url)"[^>]*>/gi, '')
    .replace(/<\/head>/i, '  <meta name="robots" content="noindex, nofollow" />\n  </head>');
}

try {
  console.log('postbuild: installing Chromium for prerender...');
  runNode(resolve(ROOT, 'node_modules', 'playwright', 'cli.js'), ['install', 'chromium']);

  console.log('postbuild: prerendering routes...');
  runNode(resolve(ROOT, 'scripts', 'prerender.mjs'));

  // Real files now exist for every public route, so an unmatched path is a
  // genuine 404. Shipping 404.html makes Cloudflare answer with a 404 status
  // instead of serving index.html at 200 for any URL, which had made every
  // typo and probe look like a valid page to crawlers.
  // The shell carries the HOMEPAGE title, description and canonical, because
  // that is what index.html ships. Served as 404.html unchanged, every unknown
  // URL answered with the homepage's metadata and no noindex, so a crawler that
  // does not run JS saw an endless supply of distinct "pages". NotFound sets
  // the right meta at runtime, which fixes a browser but not a plain fetch.
  // Patch the static head so the signal does not depend on JS at all.
  writeFileSync(resolve(DIST, '404.html'), asNotFoundShell(shellHtml), 'utf8');
  console.log('postbuild: dist/404.html written from the unrendered shell, noindex');

  for (const route of PRIVATE_ROUTES) {
    const output = resolve(DIST, `${route}.html`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, asPrivateShell(shellHtml), 'utf8');
    console.log(`postbuild: dist/${route}.html written (unrendered shell, 200, noindex)`);
  }

  console.log('postbuild: prerender complete.');
} catch (err) {
  // No prerendered files means no per-route HTML, so a 404.html would turn every
  // deep link into a 404. Remove it and let Cloudflare fall back to serving
  // index.html at 200 for all paths, which is the pre-prerender behaviour.
  rmSync(resolve(DIST, '404.html'), { force: true });

  console.warn('');
  console.warn('='.repeat(72));
  console.warn('postbuild: PRERENDER FAILED, shipping the client-rendered shell.');
  console.warn('The site still works, but crawlers get an empty <div id="root">');
  console.warn('on first fetch. Fix this before relying on organic search.');
  console.warn('='.repeat(72));
  // Full stack, not just the message: the message alone ("Command failed")
  // is rarely enough to tell a missing binary from a launch failure.
  console.warn(err?.stack ?? String(err));
  console.warn('');

  if (STRICT) {
    console.error('postbuild: PRERENDER_STRICT=1, failing the build.');
    process.exit(1);
  }
}
