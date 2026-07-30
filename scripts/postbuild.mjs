// scripts/postbuild.mjs
// Runs automatically after `vite build` (see the "build" script in package.json).
//
// This exists because the live site is not built by .github/workflows/deploy.yml —
// Cloudflare runs a plain `npm run build`, which meant scripts/prerender.mjs
// never ran and every URL served the empty `<div id="root">` shell. Hanging the
// prerender off `build` guarantees it runs no matter which pipeline builds us.
//
// Prerendering is deliberately BEST-EFFORT: if Chromium can't be installed or
// launched in the build sandbox, we log loudly, restore the old SPA-fallback
// behaviour and exit 0 so the deploy still ships. We never take the site down
// over a prerender failure.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

// Routes that must return 200 but must NOT be prerendered: they are private app
// surfaces, excluded from the sitemap and disallowed in robots.txt. They get a
// copy of the unrendered shell so the SPA boots and the router takes over,
// exactly as it did before prerendering existed. Without these, adding 404.html
// makes Cloudflare answer them with a 404 status.
const PRIVATE_ROUTES = ['portal', 'auth', 'dashboard'];

// Always invoke through `node <script>` rather than npx. npx resolves to a .cmd
// shim on Windows, which Node refuses to spawn without shell:true (EINVAL), and
// shell:true concatenates arguments unescaped (DEP0190). Calling the JS entry
// points directly sidesteps both and behaves identically on Linux CI.
function runNode(scriptPath, args = []) {
  execFileSync(process.execPath, [scriptPath, ...args], { cwd: ROOT, stdio: 'inherit' });
}

const shellPath = resolve(DIST, 'index.html');
if (!existsSync(shellPath)) {
  console.error('postbuild: dist/index.html missing — did vite build run?');
  process.exit(1);
}

// Captured before prerender.mjs overwrites dist/index.html with the rendered
// homepage. Everything below reuses this unrendered copy.
const shellHtml = readFileSync(shellPath, 'utf8');

try {
  console.log('postbuild: installing Chromium for prerender...');
  runNode(resolve(ROOT, 'node_modules', 'playwright', 'cli.js'), ['install', 'chromium']);

  console.log('postbuild: prerendering routes...');
  runNode(resolve(ROOT, 'scripts', 'prerender.mjs'));

  // Real files now exist for every public route, so an unmatched path is a
  // genuine 404. Shipping 404.html makes Cloudflare answer with a 404 status
  // instead of serving index.html at 200 for any URL, which had made every
  // typo and probe look like a valid page to crawlers.
  writeFileSync(resolve(DIST, '404.html'), shellHtml, 'utf8');
  console.log('postbuild: dist/404.html written from the unrendered shell');

  for (const route of PRIVATE_ROUTES) {
    writeFileSync(resolve(DIST, `${route}.html`), shellHtml, 'utf8');
    console.log(`postbuild: dist/${route}.html written (unrendered shell, 200)`);
  }

  console.log('postbuild: prerender complete.');
} catch (err) {
  // No prerendered files means no per-route HTML, so a 404.html would turn every
  // deep link into a 404. Remove it and let Cloudflare fall back to serving
  // index.html at 200 for all paths, which is the pre-prerender behaviour.
  rmSync(resolve(DIST, '404.html'), { force: true });

  console.warn('');
  console.warn('='.repeat(72));
  console.warn('postbuild: PRERENDER FAILED — shipping the client-rendered shell.');
  console.warn('The site still works, but crawlers get an empty <div id="root">');
  console.warn('on first fetch. Fix this before relying on organic search.');
  console.warn(`Reason: ${err?.message ?? err}`);
  console.warn('='.repeat(72));
  console.warn('');
}
