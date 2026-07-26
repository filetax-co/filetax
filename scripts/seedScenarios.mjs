/**
 * seedScenarios — load a scenarios JSON into Supabase so the filings appear in
 * the app and can be opened, reviewed and downloaded like real ones.
 *
 * There is no JSON-upload screen in the product; this script is the loader.
 *
 * Run through the npm script so it gets bundled (it imports TypeScript):
 *
 *   npm run seed -- --file ../Testing/filetax_test_scenarios_v2.json --user-id <uuid> --dry-run
 *   npm run seed -- --file ../Testing/filetax_test_scenarios_v2.json --user-id <uuid>
 *   npm run seed -- --file ../Testing/filetax_test_scenarios_v2.json --user-id <uuid> --only 52,53
 *   npm run seed -- --file ../Testing/filetax_test_scenarios_v2.json --user-id <uuid> --range 31-40
 *   npm run seed -- --file ../Testing/filetax_test_scenarios_v2.json --user-id <uuid> --cleanup
 *
 * Credentials — set these in .env.local yourself; the script only reads them
 * from the environment and never prints them:
 *
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key>
 *
 * The service-role key is required because row-level security ties every
 * filing to auth.uid(), and a script has no browser session. It bypasses RLS
 * entirely, so treat it as a password: keep it in .env.local (gitignored) and
 * never commit or paste it anywhere.
 *
 * --user-id is the auth.users id that should OWN the seeded rows. Find it in
 * Supabase → Authentication → Users, or run `select id, email from auth.users`.
 *
 * WHAT IT WRITES: one `filings` row per scenario (plus a `filing_jobs` row for
 * multi-year scenarios), and one `reportable_transactions` row per transaction.
 * Nothing else is touched. --cleanup removes exactly the rows whose llc_name
 * appears in the file AND which belong to --user-id.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { mapTransactionForPersist } from '../src/lib/filingMapping';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const file = flag('file');
const userId = flag('user-id');
const dryRun = has('dry-run');
const cleanup = has('cleanup');
const only = flag('only')?.split(',').map((s) => Number(s.trim()));
const range = flag('range')?.split('-').map(Number);

if (!file || !userId) {
  console.error('Usage: npm run seed -- --file <scenarios.json> --user-id <uuid> [--dry-run] [--only 31,32] [--range 31-40] [--cleanup]');
  process.exit(2);
}

// ── env ─────────────────────────────────────────────────────────────────────
// Read .env.local by hand; this runs in Node, not Vite.
const envPath = path.resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// A dry run only prints a plan, so it must work before any credential exists —
// that is the whole point of being able to preview first.
if (!dryRun && (!url || !serviceKey)) {
  console.error(`Missing ${!url ? 'VITE_SUPABASE_URL' : 'SUPABASE_SERVICE_ROLE_KEY'}.`);
  console.error('Add it to .env.local (Supabase -> Settings -> API -> service_role), or re-run with --dry-run.');
  process.exit(2);
}
const db = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

// ── load ────────────────────────────────────────────────────────────────────
const doc = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
let scenarios = doc.scenarios ?? doc;
if (only) scenarios = scenarios.filter((s) => only.includes(s.scenario_id));
if (range) scenarios = scenarios.filter((s) => s.scenario_id >= range[0] && s.scenario_id <= range[1]);
if (scenarios.length === 0) {
  console.error('No scenarios matched the filter.');
  process.exit(1);
}

const nameOf = (s) => s.filing?.llc_name ?? s.shared_filing_fields?.llc_name;
const allNames = [...new Set(scenarios.map(nameOf).filter(Boolean))];

// ── cleanup ─────────────────────────────────────────────────────────────────
if (cleanup) {
  console.log(`Deleting filings owned by ${userId} whose llc_name is one of ${allNames.length} names in this file.`);
  if (dryRun) { console.log('(dry run — nothing deleted)'); process.exit(0); }
  const { data: doomed, error: selErr } = await db
    .from('filings').select('id, job_id, llc_name').eq('user_id', userId).in('llc_name', allNames);
  if (selErr) { console.error(selErr.message); process.exit(1); }
  const ids = (doomed ?? []).map((f) => f.id);
  const jobIds = [...new Set((doomed ?? []).map((f) => f.job_id).filter(Boolean))];
  if (ids.length) {
    // Transactions cascade on filing delete, but remove them explicitly so the
    // count reported below is accurate even if the FK is ever changed.
    await db.from('reportable_transactions').delete().in('filing_id', ids);
    const { error } = await db.from('filings').delete().in('id', ids);
    if (error) { console.error(error.message); process.exit(1); }
  }
  if (jobIds.length) await db.from('filing_jobs').delete().in('id', jobIds);
  console.log(`Deleted ${ids.length} filing(s) and ${jobIds.length} job(s).`);
  process.exit(0);
}

// ── helpers ─────────────────────────────────────────────────────────────────
/**
 * Build a filings row. `status: 'draft'` is set explicitly because the column
 * default is 'pending', which filings_status_check rejects — an insert that
 * omits status fails outright.
 */
const filingRow = (f, o, extra = {}) => ({
  user_id: userId,
  status: 'draft',
  service_type: 'current_year',
  current_step: 5,
  related_parties: extra.related_parties ?? [],
  no_transactions_confirmed: extra.no_transactions_confirmed ?? false,
  part_vi_managerial: extra.part_vi_managerial ?? true,
  ...f,
  ...o,
  ...(extra.job_id ? { job_id: extra.job_id } : {}),
});

const txRows = (filingId, list) =>
  (list ?? []).map((t) => {
    const m = mapTransactionForPersist({
      transaction_type: t.transaction_type,
      direction: t.direction,
      amount_usd: t.amount_usd === '' ? null : Number(t.amount_usd),
      loan_begin_usd: t.loan_begin_usd === '' ? null : Number(t.loan_begin_usd),
      description: t.description,
      transaction_date: t.transaction_date || null,
    });
    return { filing_id: filingId, related_party_index: t.related_party_index ?? 0, ...m };
  });

// ── seed ────────────────────────────────────────────────────────────────────
let filings = 0, txns = 0, jobs = 0;
const created = [];

for (const s of scenarios) {
  const isJob = !!s.year_specific_filings;
  if (dryRun) {
    const n = isJob ? s.year_specific_filings.length : 1;
    const t = isJob
      ? s.year_specific_filings.reduce((a, y) => a + (y.transactions?.length ?? 0), 0)
      : (s.transactions?.length ?? 0);
    console.log(`[dry] ${String(s.scenario_id).padStart(2)} ${isJob ? `JOB ${n} years` : 'filing'} · ${t} txn · ${s.title}`);
    filings += n; txns += t; if (isJob) jobs++;
    continue;
  }

  try {
    if (isJob) {
      const { data: job, error: jobErr } = await db.from('filing_jobs').insert({
        user_id: userId,
        tax_years: s.year_specific_filings.map((y) => Number(y.tax_year)),
        include_rcl: s.include_rcl ?? false,
        reasonable_cause_reasons: s.reasonable_cause_reasons ?? [],
        status: 'draft',
      }).select('id').single();
      if (jobErr) throw jobErr;
      jobs++;

      for (const y of s.year_specific_filings) {
        const row = filingRow(
          { ...s.shared_filing_fields, tax_year: y.tax_year, total_assets: y.total_assets ?? null,
            include_rcl: s.include_rcl ?? false, include_reasonable_cause: s.include_rcl ?? false,
            reasonable_cause_reasons: s.reasonable_cause_reasons ?? [] },
          s.shared_owner_fields,
          { job_id: job.id, no_transactions_confirmed: y.no_transactions_confirmed ?? false },
        );
        const { data: fl, error } = await db.from('filings').insert(row).select('id').single();
        if (error) throw error;
        filings++;
        created.push({ id: fl.id, label: `${s.scenario_id} ${s.shared_filing_fields.llc_name} ${y.tax_year}` });
        const rows = txRows(fl.id, y.transactions);
        if (rows.length) {
          const { error: te } = await db.from('reportable_transactions').insert(rows);
          if (te) throw te;
          txns += rows.length;
        }
      }
    } else {
      const row = filingRow(s.filing, s.owner, {
        related_parties: s.related_parties,
        no_transactions_confirmed: s.no_transactions_confirmed,
        part_vi_managerial: s.part_vi_managerial,
      });
      const { data: fl, error } = await db.from('filings').insert(row).select('id').single();
      if (error) throw error;
      filings++;
      created.push({ id: fl.id, label: `${s.scenario_id} ${s.filing.llc_name}` });
      const rows = txRows(fl.id, s.transactions);
      if (rows.length) {
        const { error: te } = await db.from('reportable_transactions').insert(rows);
        if (te) throw te;
        txns += rows.length;
      }
    }
    console.log(`ok   ${String(s.scenario_id).padStart(2)}  ${s.title}`);
  } catch (e) {
    console.error(`FAIL ${String(s.scenario_id).padStart(2)}  ${s.title}\n       ${e.message ?? e}`);
  }
}

console.log(`\n${dryRun ? '[dry run] would create' : 'created'}: ${filings} filing(s), ${txns} transaction(s), ${jobs} job(s)`);
if (!dryRun && created.length) {
  console.log('\nOpen in the app:');
  for (const c of created.slice(0, 10)) console.log(`  http://localhost:5174/intake?filing_id=${c.id}   ${c.label}`);
  if (created.length > 10) console.log(`  ... and ${created.length - 10} more (see your dashboard)`);
}
