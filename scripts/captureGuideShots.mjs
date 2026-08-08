/**
 * captureGuideShots - photograph the product for the /guide walkthrough on the
 * marketing site.
 *
 *   npm run seed:guide      once, to put Test LLC in the database
 *   npm run shots:guide     build, serve, capture, convert
 *
 * Output: ../../FileTax/filetax/public/guide/{01-eligibility … 05-generate}.webp
 * The names are referenced by STAGES in the marketing repo's Guide.tsx. Do not
 * rename one without renaming it there.
 *
 * THE STANDING RULE: whenever Portal.tsx, Intake.tsx, Dashboard.tsx or
 * FilingWizard.tsx changes in a way a filer would see, rerun this in the SAME
 * commit. A walkthrough showing a screen the product no longer has is worse
 * than no walkthrough, because it is the page a nervous filer trusts most.
 * Treat a stale shot as a broken build, not as cosmetic debt.
 *
 * WHY A PRODUCTION BUILD AND NOT THE DEV SERVER
 *
 * Three DEV-only affordances would otherwise be photographable: the scenario
 * loader (Intake.tsx:4235), DEV_SKIP_AUTH (RequireAuth.tsx:9) and the
 * DEV_USER_ID fallback (Dashboard.tsx:181). All three are behind
 * import.meta.env.DEV, so `vite build` compiles them out and they cannot appear
 * in a screenshot because they do not exist in the artefact being photographed.
 * That removes the class of problem rather than relying on the script hiding an
 * element, which is the kind of guard that rots silently. Do not "speed this up"
 * by pointing it at the dev server.
 *
 * WHY THE CLOCK IS PINNED
 *
 * The dashboard derives "Next deadline" and "Past due, file ASAP" from
 * new Date(), and IRSClock is a live countdown. Unpinned, every regeneration
 * differs and the shots eventually contradict each other and the sample PDFs.
 * PINNED_AT matches the signature date on the /services samples and keeps the
 * Test LLC 2025 filing comfortably before the 15 April 2026 deadline, so the
 * dashboard reads as on time rather than late.
 *
 * NO EMAIL ADDRESS MAY APPEAR. AppNav.tsx:25 and Dashboard.tsx:330 fall back to
 * the local part of the signed-in address when full_name is empty, so
 * seedGuideFixture sets full_name to "Test Owner" first. This script verifies
 * that held rather than trusting it, and refuses to write a shot if it did not.
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.resolve(root, '../../FileTax/filetax/public/guide');
const tmpDir = path.join(root, 'tmp-verify/shots');

const PORT = 4173;

/* ── WHERE THE SHOTS COME FROM ───────────────────────────────────────────────
 *
 *   npm run shots:guide -- --live            every shot, against filetax.co
 *   npm run shots:guide -- --live --only=01-eligibility,02-portal
 *   npm run shots:guide                      the local production build
 *
 * --live is the owner's instruction of 8 August 2026: the guide should show the
 * site as it actually is, not as a build on this machine renders it.
 *
 * That inverts the note above about building rather than using the dev server,
 * so read this before assuming the protection is gone. The reason for the local
 * BUILD was that three DEV-only affordances exist in the dev server and would be
 * photographable. Against filetax.co they cannot appear at all: production is
 * what is deployed there, and import.meta.env.DEV is false in it. The guarantee
 * is stronger under --live, not weaker. What is lost is the ability to
 * photograph an unmerged change, which is the point.
 *
 * --only takes shot names and skips the rest. It exists so the two shots that
 * need no account can be captured without credentials being anywhere near this
 * machine; see the note on AUTH_SHOTS.
 */
const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null;
const want = (name) => !ONLY || ONLY.has(name);

// `base` in vite.config.ts is '/5472/' whenever NODE_ENV is production, which
// `vite build` sets, so the local preview server serves the app under that
// prefix and a bare http://localhost:4173/check is a 404. filetax.co serves it
// at the root, so the prefix must not be applied there.
const BASE = LIVE ? 'https://filetax.co' : `http://localhost:${PORT}/5472`;

/**
 * The shots that require a signed-in session. Everything else is a public page.
 *
 * This split is what lets `--only=01-eligibility,02-portal` run on a machine
 * with no `.env.local` at all. Credentials are demanded only when a shot in the
 * requested set actually needs them, rather than at startup on principle.
 */
const AUTH_SHOTS = ['03-dashboard', '04-intake-llc', '05-generate', '06-fax', '07-catchup'];
const NEEDS_AUTH = AUTH_SHOTS.some(want);

const PINNED_AT = new Date('2026-03-12T14:30:00Z');

// Retina. These are read at roughly 820px wide on the guide, so 2x keeps the
// form text legible without shipping a 4x file.
// 1000 tall rather than a laptop-ish 860: at 860 the sign-up shot cut off the
// password checklist before the one UNMET rule, which is the whole point of
// that shot, and the intake shot stopped above the section progress dots.
const VIEWPORT = { width: 1280, height: 1000 };

/**
 * Per-shot height overrides, in CSS pixels.
 *
 * THE VIEWPORT IS THE CROP. There is no cropping step: the shot is exactly what
 * fits, so a viewport taller than the screen's content pads the image with dead
 * space and then, if it is tall enough, the FOOTER. A guide screenshot that ends
 * in a footer looks like a page someone photographed by accident, and the reader
 * is being shown the product, not the site chrome under it.
 *
 * The eligibility check is one short card and needs far less room than the
 * dashboard or the intake. When a screen's content changes height, re-measure
 * rather than assuming the old number still ends in the right place: check the
 * new shot for dead space at the bottom, and for a footer.
 */
const HEIGHTS = { '01-eligibility': 840 };
const SCALE = 2;

// ── env ─────────────────────────────────────────────────────────────────────
const envPath = path.join(root, '.env.local');
if (NEEDS_AUTH && !existsSync(envPath)) {
  console.error('.env.local not found, and the requested shots need a signed-in session.');
  process.exit(2);
}
const env = existsSync(envPath)
  ? Object.fromEntries(
      readFileSync(envPath, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    )
  : {};
if (NEEDS_AUTH) {
  for (const k of ['E2E_EMAIL', 'E2E_PASSWORD']) {
    if (!env[k]) {
      console.error(`Missing ${k} from .env.local. Run npm run seed:guide first.`);
      process.exit(2);
    }
  }
}

/*
 * The address that must never reach a pixel. Checked as a whole and as its
 * local part, because that is the form the nav falls back to.
 *
 * THE LOCAL PART IS CHECKED AS A SUBSTRING OF THE WHOLE PAGE, so a short or
 * ordinary-word local part makes this guard fire on innocent copy and no shot
 * is ever written. `cpa@` is the live example: the portal and the guide both
 * say "CPA" repeatedly, so every capture would abort. That is the guard working
 * as designed, not a bug in it. The fix is a fixture address whose local part
 * is not a word that appears on screen, something like `e2e+guide@`. Do NOT
 * narrow this check to get a run to pass: it is the only thing between a real
 * address and seven published images. Noted 8 August 2026.
 *
 * Empty when no credentials are loaded, because then no session exists and no
 * address can render. There is nothing to look for rather than nothing to do.
 */
const FORBIDDEN = env.E2E_EMAIL ? [env.E2E_EMAIL, env.E2E_EMAIL.split('@')[0]] : [];

// ── helpers ─────────────────────────────────────────────────────────────────
const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, shell: true, stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

const waitForServer = async (url, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`preview server did not come up at ${url}`);
};

/**
 * Convert a PNG buffer to WebP. Playwright emits PNG or JPEG only, and full
 * page rasters as PNG run ~600 KB each: five of them would put 3 MB on /guide
 * and undo the image-optimisation pass that took the favicon from 125 KB to
 * 0.8 KB. Same reasoning, and same q82, as rasterSamplePreview.mjs.
 */
const toWebp = async (png, outPath) => {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const buf = canvas.toBuffer('image/webp', 82);
  await writeFile(outPath, buf);
  const kb = Math.round(buf.length / 1024);
  console.log(`  wrote ${path.basename(outPath)}  ${img.width}x${img.height}  ${kb} KB`);
};

/** Screenshot, but refuse if the test account's address is on the screen. */
const shot = async (page, name) => {
  await page.setViewportSize({
    width: VIEWPORT.width,
    height: HEIGHTS[name] ?? VIEWPORT.height,
  });
  // A resize relays out the page, and on the shorter shots the card can still be
  // settling when the shutter fires.
  await page.waitForTimeout(400);

  /*
   * THE SHOTS MUST ALL BE LIGHT. Five of the seven are captured signed out,
   * where the app follows the context's colorScheme, and the rest are captured
   * signed in, where it does NOT: the portal has its own theme toggle in the
   * nav, so the theme is application state and a Playwright colorScheme cannot
   * override it. Found 8 August 2026 by signing into the live portal and
   * finding it dark, which would have put dark dashboard, intake, generate and
   * fax shots on a page whose other three are light.
   *
   * This is exactly the failure the footer of this script warns about: a dark
   * capture is a perfectly good image of the wrong thing, and nothing else
   * would catch it until someone looked at /guide. So it throws.
   *
   * If this fires, set the FIXTURE ACCOUNT's theme to light in the portal and
   * rerun. Do not delete the check.
   */
  const dark = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/\d+(\.\d+)?/g);
    if (!m) return false;
    const [r, g, b] = m.map(Number);
    // Rec. 601 luma. The light theme's body is near-white, the dark one near-black.
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  });
  if (dark) {
    throw new Error(
      `${name}: the app is rendering in DARK theme and every guide shot is light. ` +
        "Set the fixture account's theme to light in the portal nav, then rerun.",
    );
  }

  const text = await page.evaluate(() => document.body.innerText);
  const leak = FORBIDDEN.find((f) => text.toLowerCase().includes(f.toLowerCase()));
  if (leak) {
    throw new Error(
      `${name}: the test account's email is visible on this screen. ` +
        'Run npm run seed:guide to set full_name, and check AppNav and Dashboard.',
    );
  }
  const png = await page.screenshot({ type: 'png' });
  await toWebp(png, path.join(outDir, `${name}.webp`));
};

// ── build and serve ─────────────────────────────────────────────────────────
await mkdir(outDir, { recursive: true });
await rm(tmpDir, { recursive: true, force: true });

let server = null;
if (LIVE) {
  console.log(`capturing against ${BASE} (live)`);
} else {
  console.log('building (production, so the DEV scenario loader is compiled out)…');
  await run('npx', ['vite', 'build']);

  console.log('serving…');
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
    cwd: root,
    shell: true,
    stdio: 'ignore',
  });
}

let browser;
try {
  await waitForServer(`${BASE}/`);

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: 'light',
    // The penalty marquee is a running animation, so an unpinned capture catches
    // it mid-scroll and the strip reads as a cut-off word at the top of the
    // frame. reduce parks it, and stops any other transition landing halfway.
    reducedMotion: 'reduce',
    // A real filer's locale, so dates and currency read the way the shots claim.
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // setFixedTime rather than a full clock install: it pins Date.now() without
  // freezing timers, so the countdown shows a stable value while React, the
  // router and Supabase all still run normally. Installing and pausing the
  // clock stalls the app's own async work and the dashboard never finishes
  // loading.
  await context.clock.setFixedTime(PINNED_AT);

  const page = await context.newPage();

  // 01 ── the eligibility check. No auth, no data.
  if (want('01-eligibility')) {
    console.log('01-eligibility');
    await page.goto(`${BASE}/check`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await shot(page, '01-eligibility');
  }

  // 02 ── the sign-up form, with the password checklist part-satisfied.
  //
  // Everything typed here is fictional and NOTHING IS SUBMITTED. The password
  // is deliberately one rule short (no symbol) so the checklist shows both a
  // met and an unmet rule, which is the point of the shot. It is not, and must
  // never be, the real test password: this image is published.
  if (want('02-portal')) {
  console.log('02-portal');
  await page.goto(`${BASE}/portal`, { waitUntil: 'networkidle' });
  // The two tabs are labelled "Create Account" and "Log In" (Portal.tsx:309),
  // NOT "Sign up" and "Sign in". The submit button is the one that says
  // "Sign In", which is why it is addressed by type rather than by name below:
  // matching on the word alone catches the wrong control.
  const signup = page.getByRole('button', { name: /^create account$/i }).first();
  if (await signup.isVisible().catch(() => false)) await signup.click();
  await page.fill('#portal-name', 'Test Owner');
  await page.fill('#portal-email', 'test.owner@example.com');
  await page.fill('#portal-password', 'Filing2026');
  await page.waitForTimeout(500);
  await shot(page, '02-portal');
  }

  if (!NEEDS_AUTH) {
    console.log(`\ndone (public shots only). ${outDir}`);
  } else {

  // ── sign in for the rest ──────────────────────────────────────────────────
  console.log('signing in…');
  await page.goto(`${BASE}/portal`, { waitUntil: 'networkidle' });
  const login = page.getByRole('button', { name: /^log in$/i }).first();
  if (await login.isVisible().catch(() => false)) await login.click();
  // Switching tabs re-renders the form and swaps the submit button's label from
  // "Create Free Account" to "Sign In". Filling or submitting before that lands
  // is a race, and it lost once: the run timed out waiting for a submit button
  // that React was in the middle of replacing.
  await page.waitForTimeout(500);
  await page.fill('#portal-email', env.E2E_EMAIL);
  await page.fill('#portal-password', env.E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Wait for /dashboard specifically. Matching /portal too would pass instantly
  // on the page we are already on, and every later step would then run against
  // a signed-out app and quietly photograph the wrong thing.
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await page.waitForTimeout(1500);

  // 03 ── the dashboard.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  if (want('03-dashboard')) {
    console.log('03-dashboard');
    await shot(page, '03-dashboard');
  }

  // Find the seeded filing from the dashboard rather than hardcoding an id, so
  // a reseed does not silently photograph nothing.
  const filingIds = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/filing/"], a[href*="filing_id="]')]
      .map((el) => el.getAttribute('href') ?? '')
      .map((h) => (h.match(/\/filing\/([0-9a-f-]{36})/) ?? h.match(/filing_id=([0-9a-f-]{36})/))?.[1])
      .filter(Boolean),
  );
  const filingId = filingIds[0];
  if (!filingId) throw new Error('No Test LLC filing on the dashboard. Run npm run seed:guide.');

  /*
   * The filing to photograph for 06-fax, which is a DIFFERENT one from the
   * draft used by 04 and 05. The draft is deliberately unpaid, because 05 is
   * the screen where a filer decides to pay; a faxed filing is the far end of
   * the same flow. Picked by its card saying so rather than by position, so
   * reseeding in a different order cannot silently photograph the draft.
   *
   * Null when nothing is faxed yet, which is the normal state until the paid
   * fixture exists. 06-fax then fails with its own message rather than
   * quietly photographing a filing that has no fax panel on it.
   */
  const faxFilingId = await page.evaluate(() => {
    const card = [...document.querySelectorAll('a[href*="/filing/"]')].find((el) =>
      /faxed to the irs|fax pending/i.test(el.closest('li, article, div')?.textContent ?? ''),
    );
    return card?.getAttribute('href')?.match(/\/filing\/([0-9a-f-]{36})/)?.[1] ?? null;
  });

  // 04 ── the intake, on LLC Details (step 1). ONE intake shot, not six: the
  // owner settled that on 8 August 2026. Do not add 04b, 04c and so on.
  if (want('04-intake-llc')) {
    console.log('04-intake-llc');
    await page.goto(`${BASE}/intake?filing_id=${filingId}&step=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, '04-intake-llc');
  }

  // 05 ── the generate step: the summary and What's Included, BEFORE payment.
  // The fixture is a draft at current_step 5, so this is the screen where a
  // filer decides to pay. The reasonable cause letter is named here because the
  // fixture sets include_rcl, and FilingWizard renders that row from the same
  // field. The post-payment download screen is deliberately not photographed.
  if (want('05-generate')) {
  console.log('05-generate');
  await page.goto(`${BASE}/filing/${filingId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '05-generate');
  }

  // 06 ── the IRS fax panel on a filing that has been PAID and DELIVERED.
  //
  // This one cannot be produced from the ordinary fixture and that is a
  // database rule, not an oversight: `filings_block_payment_writes` rejects a
  // client writing `paid_at`, so a paid filing has to come from seedScenarios
  // with SUPABASE_SERVICE_ROLE_KEY. The panel additionally hides the download
  // until the transmission is `delivered` (FaxPanel.tsx, "Copy of what was
  // transmitted"), so a merely PAID filing photographs the offer, not the
  // receipt, and the receipt is the whole point of the shot.
  //
  // It is scrolled to rather than captured from the top of the page: the panel
  // sits well below the fold on a finished filing.
  if (want('06-fax')) {
    console.log('06-fax');
    await page.goto(`${BASE}/filing/${faxFilingId ?? filingId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const panel = page.getByRole('heading', { name: /^IRS fax delivery$/i }).first();
    if (!(await panel.isVisible().catch(() => false))) {
      throw new Error(
        '06-fax: no IRS fax delivery panel on this filing. It needs one that is PAID and ' +
          'DELIVERED; see the note above and seed it with seedScenarios.',
      );
    }
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shot(page, '06-fax');
  }

  // 07 ── the first screen of a catch-up, so the guide can show that several
  // missed years arrive as ONE job rather than one purchase per year. That is
  // the fear the catch-up section answers, and it had nothing shown.
  if (want('07-catchup')) {
    console.log('07-catchup');
    await page.goto(`${BASE}/catch-up`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, '07-catchup');
  }

  console.log(`\ndone. ${outDir}`);
  }
  console.log('Look at every shot before committing. This pipeline degrades quietly:');
  console.log('a missing font or an unloaded panel still produces a plausible image.');
} finally {
  await browser?.close();
  server?.kill();
}
