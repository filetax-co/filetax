/**
 * seedGuideFixture - put the Test LLC filing into Supabase so the /guide
 * screenshots have something real to photograph.
 *
 *   npm run seed:guide            insert (replaces any previous run)
 *   npm run seed:guide -- --clean remove it and stop
 *
 * WHY THIS EXISTS RATHER THAN seedScenarios
 *
 * seedScenarios needs SUPABASE_SERVICE_ROLE_KEY, because it seeds paid-like
 * filings and `filings_block_payment_writes` rejects a client writing paid_at
 * or payment_amount_cents, returning early only for auth.role() =
 * 'service_role'. This script needs none of that: the guide photographs the
 * screen BEFORE payment, so the filing is a plain draft. It therefore signs in
 * as the test user with the ANON key and writes as that user, under exactly the
 * RLS every real filer is subject to. Nothing here bypasses a check.
 *
 * Keep it that way. If a future shot needs a paid filing, use seedScenarios and
 * its service-role key rather than loosening this one.
 *
 * Credentials come from .env.local, which is gitignored:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD
 *
 * It also sets the user's `full_name` metadata to "Test Owner". That is not
 * cosmetic. AppNav.tsx:25 and Dashboard.tsx:330 both fall back to the LOCAL
 * PART OF THE EMAIL ADDRESS when full_name is empty, so without this the test
 * account's real address leaks into the nav and the dashboard greeting of a
 * published marketing screenshot.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { mapTransactionForPersist } from '../src/lib/filingMapping';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// ── env ─────────────────────────────────────────────────────────────────────
// Read .env.local directly. Vite loads it for the app, but this is plain node.
const envPath = path.join(root, '.env.local');
if (!existsSync(envPath)) {
  console.error('.env.local not found. It holds the Supabase URL, anon key and test credentials.');
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const need = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'E2E_EMAIL', 'E2E_PASSWORD'];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing from .env.local: ${missing.join(', ')}`);
  process.exit(2);
}

const clean = process.argv.includes('--clean');

// ── sign in ─────────────────────────────────────────────────────────────────
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const { data: auth, error: authErr } = await db.auth.signInWithPassword({
  email: env.E2E_EMAIL,
  password: env.E2E_PASSWORD,
});
if (authErr) {
  // Never print the address or the password, only that the attempt failed.
  console.error(`Sign-in failed: ${authErr.message}`);
  console.error('Confirm the test user exists and its email is confirmed.');
  process.exit(1);
}
const userId = auth.user.id;
console.log('signed in as the test user');

// ── the display name, so no email reaches a screenshot ───────────────────────
const { error: metaErr } = await db.auth.updateUser({ data: { full_name: 'Test Owner' } });
if (metaErr) {
  console.error(`Could not set full_name: ${metaErr.message}`);
  console.error('STOP. Without it the nav and the dashboard greeting show the email local part.');
  process.exit(1);
}
console.log('full_name set to "Test Owner"');

// ── load the fixture ────────────────────────────────────────────────────────
const fixture = JSON.parse(readFileSync(path.join(root, 'testing/__guideFixture.json'), 'utf8'));
const s = fixture.scenarios[0];

// ── remove any previous run, so this is repeatable ──────────────────────────
// Scoped to this user AND this llc_name. RLS already confines it to the signed
// in user; the name filter is the second belt, so a stray real filing on this
// account could not be caught by a --clean.
const { data: old } = await db
  .from('filings')
  .select('id')
  .eq('user_id', userId)
  .eq('llc_name', s.filing.llc_name);

if (old?.length) {
  const ids = old.map((r) => r.id);
  await db.from('reportable_transactions').delete().in('filing_id', ids);
  const { error } = await db.from('filings').delete().in('id', ids);
  if (error) {
    console.error(`Could not remove the previous fixture: ${error.message}`);
    process.exit(1);
  }
  console.log(`removed ${ids.length} previous ${s.filing.llc_name} filing(s)`);
}

if (clean) {
  console.log('--clean: nothing inserted.');
  process.exit(0);
}

// ── insert ──────────────────────────────────────────────────────────────────
// status 'draft' and current_step 5 puts the wizard on the generate step, which
// is shot 05, without any payment having happened. Explicit status because the
// column default is 'pending' and filings_status_check rejects it.
// Backdated to sit just BEFORE the clock captureGuideShots pins. The dashboard
// prints "Updated <date>" from this column, and it is real wall-clock time, not
// the pinned clock, so an unset value gives a filing last updated months after
// the "today" the rest of the screen is drawn against. Keep the two in step: if
// PINNED_AT moves, move this.
const UPDATED_AT = '2026-03-10T16:20:00Z';

const row = {
  user_id: userId,
  status: 'draft',
  created_at: UPDATED_AT,
  updated_at: UPDATED_AT,
  service_type: 'current_year',
  current_step: 5,
  related_parties: s.related_parties ?? [],
  no_transactions_confirmed: s.no_transactions_confirmed ?? false,
  part_vi_managerial: s.part_vi_managerial ?? true,
  ...s.filing,
  ...s.owner,
};

const { data: filing, error: insErr } = await db.from('filings').insert(row).select('id').single();
if (insErr) {
  console.error(`Insert failed: ${insErr.message}`);
  process.exit(1);
}

const txRows = (s.transactions ?? []).map((t) => ({
  filing_id: filing.id,
  related_party_index: t.related_party_index ?? 0,
  ...mapTransactionForPersist({
    transaction_type: t.transaction_type,
    direction: t.direction,
    amount_usd: t.amount_usd === '' ? null : Number(t.amount_usd),
    loan_begin_usd: t.loan_begin_usd === '' ? null : Number(t.loan_begin_usd),
    description: t.description,
    transaction_date: t.transaction_date || null,
  }),
}));

if (txRows.length) {
  const { error: txErr } = await db.from('reportable_transactions').insert(txRows);
  if (txErr) {
    console.error(`Transaction insert failed: ${txErr.message}`);
    process.exit(1);
  }
}

console.log(`created ${s.filing.llc_name} ${s.filing.tax_year}, ${txRows.length} transaction(s)`);
console.log(`filing id: ${filing.id}`);
