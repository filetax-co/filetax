// scripts/postbuild.mjs
// Runs automatically after `vite build` (see the "build" script in package.json).
//
// This exists because the live site is not built by .github/workflows/deploy.yml —
// the host runs a plain `npm run build`, which meant scripts/prerender.mjs never
// ran and every URL served the empty `<div id="root">` shell. Hanging the
// prerender off `build` guarantees it runs no matter which pipeline builds us.
//
// Prerendering is deliberately BEST-EFFORT: if Chromium can't be installed or
// launched in the build sandbox, we log loudly and exit 0 so the deploy still
// ships. Worst case we fall back to the old client-rendered behaviour; we never
// take the site down over a prerender failure.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

// Always invoke through `node <script>` rather than npx. npx resolves to a .cmd
// shim on Windows, which Node refuses to spawn without shell:true (EINVAL), and
// shell:true concatenates arguments unescaped (DEP0190). Calling the JS entry
// points directly sidesteps both and behaves identically on Linux CI.
function runNode(scriptPath, args = []) {
  execFileSync(process.execPath, [scriptPath, ...args], { cwd: ROOT, stdio: 'inherit' });
}

// 1. The SPA fallback must be the *unrendered* shell, captured before
//    prerender.mjs overwrites dist/index.html with the rendered homepage.
//    Otherwise every unmatched URL would serve homepage content.
const shell = resolve(DIST, 'index.html');
if (!existsSync(shell)) {
  console.error('postbuild: dist/index.html missing — did vite build run?');
  process.exit(1);
}
copyFileSync(shell, resolve(DIST, '404.html'));
console.log('postbuild: dist/404.html written from the unrendered shell');

// 2. Prerender. Best-effort from here down.
try {
  console.log('postbuild: installing Chromium for prerender...');
  runNode(resolve(ROOT, 'node_modules', 'playwright', 'cli.js'), ['install', 'chromium']);

  console.log('postbuild: prerendering routes...');
  runNode(resolve(ROOT, 'scripts', 'prerender.mjs'));

  console.log('postbuild: prerender complete.');
} catch (err) {
  console.warn('');
  console.warn('='.repeat(72));
  console.warn('postbuild: PRERENDER FAILED — shipping the client-rendered shell.');
  console.warn('The site will still work, but crawlers get an empty <div id="root">');
  console.warn('on first fetch. Fix this before relying on organic search.');
  console.warn(`Reason: ${err?.message ?? err}`);
  console.warn('='.repeat(72));
  console.warn('');
}
