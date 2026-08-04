import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase, type Filing, type ServiceType } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { FILING_DUE_DATES } from './intake/constants';
import { PRICE_PER_YEAR, PRICE_RCL, unavailableServices, serviceWithPrice } from '../../lib/pricing';

const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

// ── Status buckets, group filings into a small, human set on the dashboard ──
type Bucket = 'action' | 'in_progress' | 'ready' | 'done';

const BUCKET_OF: Record<Filing['status'], Bucket> = {
  payment_failed: 'action',
  draft: 'in_progress',
  in_progress: 'in_progress',
  paid: 'ready',
  completed: 'done',
  submitted: 'done',
};

const BUCKET_TITLE: Record<Bucket, string> = {
  action: 'Needs your attention',
  in_progress: 'In progress',
  ready: 'Ready to download',
  done: 'Filed & downloaded',
};

const BUCKET_ORDER: Bucket[] = ['action', 'ready', 'in_progress', 'done'];

/** "December 1, 2025", the one human date format used across the product. */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${MONTHS[m]} ${d}, ${y}`;
}

type DueState = { label: string; tone: 'ok' | 'warn' | 'late'; due: string } | null;

/** Compute the deadline state, using the extension date only for a filed 7004. */
function dueState(
  taxYear: string | null | undefined,
  extensionFiled: boolean,
): DueState {
  if (!taxYear) return null;
  const dates = FILING_DUE_DATES[Number(taxYear)];
  if (!dates) return null;
  const today = new Date();
  const original = new Date(dates.original);
  const extended = new Date(dates.extended);
  if (today <= original) return { label: `Due ${humanDate(dates.original)}`, tone: 'ok', due: dates.original };
  if (extensionFiled && today <= extended) {
    return { label: `Extension due ${humanDate(dates.extended)}`, tone: 'warn', due: dates.extended };
  }
  return {
    label: 'Past due, file ASAP',
    tone: 'late',
    due: extensionFiled ? dates.extended : dates.original,
  };
}

const SERVICE_LABEL: Record<ServiceType, string> = {
  current_year: 'Form 5472 + Pro Forma 1120',
  past_year: 'Past Year Filing + Reasonable Cause Letter',
  tax_classification: 'LLC Tax Classification Change',
};

const STATUS_LABEL: Record<Filing['status'], string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  payment_failed: 'Payment failed',
  paid: 'Ready to download',
  completed: 'Downloaded',
  submitted: 'Submitted',
};

// Status badge colors via design tokens so they adapt to dark mode.
const STATUS_COLOR: Record<Filing['status'], { bg: string; fg: string }> = {
  draft:          { bg: 'var(--tf-offset)',           fg: 'var(--tf-text)' },
  in_progress:    { bg: 'var(--tf-banner-amber-bg)',  fg: 'var(--tf-banner-amber-text)' },
  payment_failed: { bg: 'var(--tf-banner-red-bg)',    fg: 'var(--tf-banner-red-text)' },
  paid:           { bg: 'rgba(var(--tf-accent-rgb), 0.12)', fg: 'var(--tf-accent)' },
  completed:      { bg: 'var(--tf-banner-green-bg)',  fg: 'var(--tf-banner-green-text)' },
  submitted:      { bg: 'rgba(var(--tf-accent-rgb), 0.12)', fg: 'var(--tf-accent)' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The one pill used across the dashboard.
 *
 * There were five hand-rolled versions with four different font sizes (0.7,
 * 0.72, 0.75) and three different paddings, so pills that sat next to each
 * other were not the same height: the status and due-date pills on a filing
 * card measured 22px and 21.3px. Half a pixel of mismatch is not something
 * anyone can name, but a row of almost-matching pills reads as sloppy.
 *
 * Two things fix the cramped look, and neither is more padding on its own:
 *
 *   - `line-height: 1` with `inline-flex` + `align-items: center`. Previously
 *     the inherited 1.5 line-height meant the GLYPHS sat off-centre inside a
 *     symmetric 2px/2px padding box, measured at 2.8px above and 4.1px below.
 *     Adding padding to that would have made a bigger lopsided pill.
 *   - a fixed `minHeight`, so every pill is exactly the same height regardless
 *     of its text, rather than being sized by its own font.
 */
function Pill({
  children,
  bg,
  fg,
  uppercase = false,
}: {
  children: React.ReactNode;
  bg: string;
  fg: string;
  uppercase?: boolean;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: '22px',
        padding: uppercase ? '0 0.7rem' : '0 0.625rem',
        background: bg,
        color: fg,
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: uppercase ? '0.04em' : '0.01em',
        textTransform: uppercase ? 'uppercase' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** Background and foreground for the due-date pill, by urgency. */
const DUE_TONE: Record<'ok' | 'warn' | 'late', { bg: string; fg: string }> = {
  ok:   { bg: 'var(--tf-offset)',          fg: 'var(--tf-muted)' },
  warn: { bg: 'var(--tf-banner-amber-bg)', fg: 'var(--tf-banner-amber-text)' },
  late: { bg: 'var(--tf-banner-red-bg)',   fg: 'var(--tf-banner-red-text)' },
};

/**
 * Seed tax year for a brand-new filing. Never returns null, the filings table
 * requires tax_year, and the wizard lets the user change it in step 1 anyway.
 * The "3-plus" / unknown catch-up case defaults to the most recent filable year.
 */
function deriveTaxYear(years: string | null | undefined): string {
  const now = new Date().getUTCFullYear();
  const mostRecentFilable = now - 1;
  if (!years || years === 'current') return String(mostRecentFilable);
  if (years === '1-prior') return String(now - 2);
  if (years === '2-prior') return String(now - 3);
  return String(mostRecentFilable);
}

function actionLabel(status: Filing['status']): string {
  if (status === 'draft' || status === 'in_progress') return 'Continue';
  if (status === 'payment_failed') return 'Retry payment';
  if (status === 'paid' || status === 'completed') return 'Download forms';
  return 'View';
}

/** Route draft/in_progress → Intake wizard (?filing_id=); paid/completed → FilingWizard */
function filingPath(f: Filing): string {
  if (f.status === 'paid' || f.status === 'completed') return `/filing/${f.id}`;
  return `/intake?filing_id=${f.id}`;
}

export function Dashboard() {
  usePageMeta({
    title: 'Dashboard | FileTax.co',
    description: 'Your filings dashboard.',
  });

  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const effectiveUserId = user?.id ?? (import.meta.env.DEV ? DEV_USER_ID : null);

  const [filings, setFilings] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!effectiveUserId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);

      const filingsRes = await supabase
        .from('filings')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('updated_at', { ascending: false });

      if (cancelled) return;

      if (filingsRes.error) {
        setError(filingsRes.error.message);
      } else {
        setFilings((filingsRes.data ?? []) as Filing[]);
      }

      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [effectiveUserId, authLoading]);

  async function startFiling(serviceType: ServiceType) {
    if (!effectiveUserId || busy) return;
    setBusy(serviceType);
    setError('');
    const { data, error } = await supabase
      .from('filings')
      .insert({
        user_id: effectiveUserId,
        service_type: serviceType,
        status: 'draft',
        current_step: 1,
        // tax_year is required (NOT NULL); seed the most recent filable year.
        // The user confirms/changes it in step 1 of the wizard.
        tax_year: deriveTaxYear(serviceType === 'current_year' ? 'current' : null),
        include_rcl: serviceType === 'past_year',
      })
      .select('id')
      .single();
    setBusy(null);
    if (error || !data) {
      setError(error?.message ?? 'Could not create filing.');
      return;
    }
    navigate(`/intake?filing_id=${data.id}`);
  }

  // Delete an unpaid (draft / in-progress) filing. Paid or completed filings are
  // never deletable, a payment must remain auditable. Its transactions cascade
  // (FK on delete), and if it was the last year of a multi-year job we also
  // remove the now-empty job row.
  async function deleteFiling(f: Filing) {
    if (f.status === 'paid' || f.status === 'completed' || f.status === 'submitted') return;
    if (!window.confirm(`Delete the ${f.tax_year ?? ''} filing for ${f.llc_name?.trim() || 'this LLC'}? This can't be undone.`)) return;
    setBusy(`del-${f.id}`);
    setError('');
    const { error } = await supabase.from('filings').delete().eq('id', f.id);
    if (error) {
      setBusy(null);
      setError(error.message);
      return;
    }
    // If this belonged to a multi-year job and no siblings remain, drop the job.
    if (f.job_id) {
      const { data: siblings } = await supabase
        .from('filings').select('id').eq('job_id', f.job_id);
      if (!siblings || siblings.length === 0) {
        await supabase.from('filing_jobs').delete().eq('id', f.job_id);
      }
    }
    setFilings((prev) => prev.filter((x) => x.id !== f.id));
    setBusy(null);
  }

  // Delete a whole multi-year catch-up job.
  //
  // A catch-up is created as one decision ("I have four missed years"), so
  // abandoning it should be one decision too. Before this there was no way to
  // remove one at all: "Add or remove years" can take years out one at a time
  // but always leaves at least one behind, so a job started by mistake stayed
  // on the dashboard permanently.
  //
  // Refuses outright if ANY year has been paid, rather than deleting the unpaid
  // years and leaving a partial job. A payment must remain auditable, and a
  // half-deleted catch-up is worse than none: the remaining years would still
  // reference a reasonable cause letter that was scoped to all of them.
  async function deleteJob(jobFilings: Filing[]) {
    const jobId = jobFilings[0]?.job_id;
    if (!jobId) return;

    const paid = jobFilings.filter(
      (f) => f.status === 'paid' || f.status === 'completed' || f.status === 'submitted',
    );
    if (paid.length > 0) {
      setError(
        `This catch-up cannot be deleted because ${paid.length === 1 ? 'one year has' : `${paid.length} years have`} already been paid for. ` +
        'Contact support@filetax.co if you need it removed.',
      );
      return;
    }

    const years = jobFilings.map((f) => f.tax_year).filter(Boolean).sort();
    const llc = jobFilings.find((f) => f.llc_name)?.llc_name?.trim() || 'this LLC';
    if (!window.confirm(
      `Delete the whole catch-up for ${llc}? This removes all ${jobFilings.length} years ` +
      `(${years.join(', ')}) and everything entered against them. This can't be undone.`,
    )) return;

    setBusy(`del-job-${jobId}`);
    setError('');
    // Delete by job_id rather than looping the ids: one statement, so it cannot
    // half-succeed and leave the job in the partial state described above.
    const { error } = await supabase.from('filings').delete().eq('job_id', jobId);
    if (error) {
      setBusy(null);
      setError(error.message);
      return;
    }
    await supabase.from('filing_jobs').delete().eq('id', jobId);
    setFilings((prev) => prev.filter((x) => x.job_id !== jobId));
    setBusy(null);
  }

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const displayName = (() => {
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = typeof meta.full_name === 'string' ? meta.full_name : '';
    return fullName || (user?.email ? user.email.split('@')[0] : 'there');
  })();

  return (
    <>
      <section style={{ background: 'var(--tf-bg)', padding: '3rem 1rem 2rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ marginBottom: '0.875rem' }}>
              <Pill bg="var(--tf-success)" fg="var(--tf-on-accent)" uppercase>Dashboard</Pill>
            </div>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', marginBottom: '0.5rem', lineHeight: 1.2 }}>
              Welcome back, {displayName}.
            </h1>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>
              Manage your filings and start new ones below.
            </p>
          </div>
          <button onClick={handleSignOut} style={{ background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '44px' }}>
            Sign out
          </button>
        </div>
      </section>

      {/* ── Summary strip ───────────────────────────────────────────────── */}
      {!loading && filings.length > 0 && (
        <section style={{ background: 'var(--tf-bg)', padding: '0.5rem 1rem 1.5rem' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }} className="dash-summary">
            {(() => {
              const counts = { action: 0, in_progress: 0, ready: 0, done: 0 } as Record<Bucket, number>;
              for (const f of filings) counts[BUCKET_OF[f.status]]++;
              // A past-due filing's dueState carries the extended date of that
              // old year, so sorting every non-done filing by date ascending and
              // taking the first always returned the OLDEST overdue year and
              // printed it under the label "Next deadline". In August 2026 that
              // read "Next deadline: October 15, 2020". It was never a stale
              // constant, it was a mislabelled minimum.
              //
              // The two facts are different questions and now get a tile each:
              // the earliest deadline still ahead of today, and the oldest one
              // already missed. Same shape as getNextDeadline(now) on the
              // marketing clock, which had this bug in its own form.
              const pending = filings
                .filter((f) => BUCKET_OF[f.status] !== 'done')
                .map((f) => dueState(f.tax_year, f.extension_filed === true))
                .filter((d): d is NonNullable<DueState> => !!d)
                .sort((a, b) => a.due.localeCompare(b.due));
              const overdue = pending.filter((d) => d.tone === 'late')[0];
              const upcoming = pending.filter((d) => d.tone !== 'late')[0];
              const stat = (label: string, value: string, tone?: 'late' | 'warn') => (
                <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem', padding: '0.875rem 1rem' }}>
                  <div style={{ fontSize: '1.375rem', fontWeight: 700, color: tone === 'late' ? 'var(--tf-banner-red-text)' : tone === 'warn' ? 'var(--tf-banner-amber-text)' : 'var(--tf-text)' }}>{value}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.15rem' }}>{label}</div>
                </div>
              );
              return (
                <>
                  {counts.action > 0 && stat('Need attention', String(counts.action), 'late')}
                  {counts.ready > 0 && stat('Ready to download', String(counts.ready))}
                  {counts.in_progress > 0 && stat('In progress', String(counts.in_progress))}
                  {stat('Total filings', String(filings.length))}
                  {overdue && stat('Oldest missed deadline', humanDate(overdue.due), 'late')}
                  {upcoming && stat('Next deadline', humanDate(upcoming.due), upcoming.tone === 'warn' ? 'warn' : undefined)}
                </>
              );
            })()}
          </div>
        </section>
      )}

      {/* ── Filings, grouped by status bucket ───────────────────────────── */}
      <section style={{ background: 'var(--tf-bg)', padding: '0.5rem 1rem 2rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Your filings</h2>
          {error && <p style={{ color: 'var(--tf-error-text)', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>}
          {loading ? (
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 500 }}>Loading…</p>
          ) : filings.length === 0 ? (
            <div style={{ background: 'var(--tf-surface)', border: '1px dashed var(--tf-border)', borderRadius: '0.75rem', padding: '2.5rem 2rem', textAlign: 'center' }}>
              <p style={{ fontWeight: 700, fontSize: '1.0625rem', marginBottom: '0.4rem' }}>No filings yet</p>
              <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.25rem' }}>Start your Form 5472 below. It takes about 10 minutes.</p>
              <button onClick={() => startFiling('current_year')} disabled={busy !== null} style={primaryBtn(busy === 'current_year')}>
                {busy === 'current_year' ? 'Creating…' : 'Start my filing'}
              </button>
            </div>
          ) : (
            (() => {
              // Group standalone filings vs multi-year job filings.
              const jobs = new Map<string, Filing[]>();
              const standalone: Filing[] = [];
              for (const f of filings) {
                if (f.job_id) {
                  const arr = jobs.get(f.job_id) ?? [];
                  arr.push(f); jobs.set(f.job_id, arr);
                } else standalone.push(f);
              }
              // Bucket standalone filings.
              const byBucket = new Map<Bucket, Filing[]>();
              for (const f of standalone) {
                const b = BUCKET_OF[f.status];
                const arr = byBucket.get(b) ?? [];
                arr.push(f); byBucket.set(b, arr);
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                  {/* Multi-year job cards first (most actionable) */}
                  {[...jobs.entries()].map(([jobId, yearFilings]) => (
                    <JobCard
                      key={jobId}
                      filings={yearFilings}
                      onDeleteJob={deleteJob}
                      onDeleteYear={deleteFiling}
                      busy={busy}
                    />
                  ))}

                  {BUCKET_ORDER.filter((b) => (byBucket.get(b)?.length ?? 0) > 0).map((b) => (
                    <div key={b}>
                      <h3 style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tf-muted)', marginBottom: '0.75rem' }}>
                        {BUCKET_TITLE[b]}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {byBucket.get(b)!.map((f) => (
                          <FilingCard
                            key={f.id}
                            f={f}
                            onDelete={deleteFiling}
                            deleting={busy === `del-${f.id}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </section>

      {/* ── Start a new filing ──────────────────────────────────────────── */}
      <section style={{ background: 'var(--tf-surface)', padding: '3rem 1rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Start a new filing</h2>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>
            One year, or several at once.
          </p>
          {/*
            The split is ONE YEAR vs MORE THAN ONE YEAR, not current year vs past
            years, which is how these two cards used to read.
            That framing was wrong in both directions. The left card said "the
            current tax year", but `startFiling` only seeds the most recent
            filable year and intake step 1 lets the filer change it, so a single
            PAST year always worked here and the copy hid it. The right card said
            "one or more missed years", claiming the single-year case as well, so
            a filer with exactly one late year saw two cards that both fit and no
            way to tell which was meant for them.
            Count is also the question the eligibility checker already asks, and
            it is the only one that actually changes what gets built: more than
            one year is a job with a single reasonable cause letter across it.
          */}
          <div className="dash-services" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div style={cardStyle}>
              <p style={tagStyle}>Most popular</p>
              <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>One year</h3>
              <p style={priceStyle}>${PRICE_PER_YEAR}</p>
              <p style={mutedStyle}>
                Form 5472 + pro forma 1120 for a single tax year, this year or an earlier one.
                One-time, no subscription. If the year you pick is already late, you can add the
                reasonable-cause letter as you go.
              </p>
              <button onClick={() => startFiling('current_year')} disabled={busy !== null} style={primaryBtn(busy === 'current_year')}>
                {busy === 'current_year' ? 'Creating…' : 'Start filing'}
              </button>
            </div>
            <div style={cardStyle}>
              <p style={tagStyle}>For late filers</p>
              <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>More than one year</h3>
              <p style={priceStyle}>${PRICE_PER_YEAR}<span style={{ fontSize: '0.8125rem', fontWeight: 400, color: 'var(--tf-muted)' }}> / year + one ${PRICE_RCL} letter</span></p>
              <p style={mutedStyle}>Two or more missed years. A single reasonable-cause letter covers all of them, however many you file.</p>
              <button onClick={() => navigate('/catch-up')} disabled={busy !== null} style={primaryBtn(false)}>
                Choose years
              </button>
            </div>
          </div>

          {/* Secondary / additional services */}
          <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem 1.25rem', flexWrap: 'wrap', padding: '1rem 1.25rem', background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem' }}>
            {/* This line used to be written out by hand and listed IRS fax and
                Form 7004 as coming soon. Fax has been live for weeks and the
                7004 ships inside the package, so the portal was telling a
                paying filer that two things they already have are unavailable.
                It is now derived from SERVICES, so it cannot say that again:
                flipping a service's `available` changes this line and every
                other surface in one edit. */}
            <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', fontWeight: 600 }}>Coming soon:</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)' }}>
              {unavailableServices().map(serviceWithPrice).join(' · ')}
            </span>
            <button onClick={() => navigate('/waitlist')} style={linkBtnStyle}>
              Join the waitlist →
            </button>
          </div>
        </div>
        <style>{`@media (max-width: 800px) { .dash-services { grid-template-columns: 1fr !important; } }`}</style>
      </section>

      <section style={{ background: 'var(--tf-bg)', padding: '2rem 1rem 4rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>
            Need help? Email us at{' '}
            <a href="mailto:hello@filetax.co" style={{ color: 'var(--tf-accent)', fontWeight: 600, textDecoration: 'none' }}>hello@filetax.co</a>. We respond within 1 business day.
          </p>
        </div>
      </section>
    </>
  );
}

// ── Filing card ──────────────────────────────────────────────────────────────
/** Trash glyph, shared by the card corner control and the per-year row. */
function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4h11M6 4V2.75A.75.75 0 0 1 6.75 2h2.5a.75.75 0 0 1 .75.75V4M12.5 4l-.5 9a1 1 0 0 1-1 .95h-6a1 1 0 0 1-1-.95L3.5 4M6.5 7v4M9.5 7v4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Small red delete, pinned to the card's true top-right corner.
 *
 * Two earlier versions were wrong and are worth not repeating. It first sat
 * beside Continue, sharing a row and a visual weight with the primary action
 * about a thumb's width away. It was then stacked above Continue, which stopped
 * the overlap but left a wide labelled button floating over the primary one,
 * pushing it down and reading as a second call to action.
 *
 * Icon only, so it takes almost no room and cannot compete with Continue.
 * Red, because a destructive control should look destructive rather than be
 * discovered by hovering. It is `absolute`, and the CARD adds top padding when
 * this is present, so the action column starts below it. That padding is what
 * makes the corner safe; without it an absolute control lands on Continue.
 *
 * 32px rather than the 44px tap target used elsewhere: deliberately below
 * thumb-size for a destructive action, and every path is confirmed anyway.
 */
function DeleteCardButton({
  onClick,
  busy,
  title,
}: {
  onClick: () => void;
  busy?: boolean;
  title: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      aria-label={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
        background: hover && !busy ? 'rgba(var(--tf-error-rgb), 0.12)' : 'transparent',
        border: 'none',
        borderRadius: '0.5rem',
        color: 'var(--tf-error-text)',
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.4 : 1,
        padding: 0,
        transition: 'background 0.15s ease',
      }}
    >
      <TrashIcon size={15} />
    </button>
  );
}

function FilingCard({ f, onDelete, deleting }: { f: Filing; onDelete?: (f: Filing) => void; deleting?: boolean }) {
  const c = STATUS_COLOR[f.status];
  const due = (f.status !== 'completed' && f.status !== 'submitted')
    ? dueState(f.tax_year, f.extension_filed === true)
    : null;
  const headline = f.llc_name?.trim() || SERVICE_LABEL[f.service_type];
  // Unpaid filings (draft / in-progress) can be deleted; paid ones cannot.
  const deletable = f.status === 'draft' || f.status === 'in_progress';
  const showDelete = deletable && !!onDelete;
  return (
    <div
      style={{
        background: 'var(--tf-surface)',
        border: '1px solid var(--tf-border)',
        borderRadius: '0.75rem',
        padding: '1.25rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
          <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tf-text)' }}>
            {headline}{f.tax_year ? <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}> · {f.tax_year}</span> : ''}
          </p>
          <Pill bg={c.bg} fg={c.fg}>{STATUS_LABEL[f.status]}</Pill>
          {due && (
            <Pill bg={DUE_TONE[due.tone].bg} fg={DUE_TONE[due.tone].fg}>{due.label}</Pill>
          )}
        </div>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400 }}>
          {f.ein ? `EIN ${f.ein} · ` : ''}{SERVICE_LABEL[f.service_type]} · Updated {formatDate(f.updated_at)}
          {(f.status === 'draft' || f.status === 'in_progress') ? ` · Step ${f.current_step} of 5` : ''}
        </p>
      </div>
      {/* Delete sits INLINE, after Continue, in the row that already exists.
          It was briefly absolute in the top-right corner, which needed 3rem of
          card padding to clear the action column and left a visibly empty band
          across the top of every deletable card. Inline costs no vertical space
          at all, and it matches the per-year rows inside a catch-up job, which
          already put the trash at the end of the row. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', whiteSpace: 'nowrap' }}>
        <Link
          to={filingPath(f)}
          style={{ background: f.status === 'completed' ? 'transparent' : 'var(--tf-accent)', color: f.status === 'completed' ? 'var(--tf-accent)' : 'var(--tf-on-accent)', border: f.status === 'completed' ? '1px solid var(--tf-border)' : 'none', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1.1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '40px', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}
        >
          {actionLabel(f.status)}
        </Link>
        {showDelete && (
          <DeleteCardButton
            onClick={() => onDelete!(f)}
            busy={deleting}
            title={`Delete the ${f.tax_year ?? ''} filing for ${f.llc_name?.trim() || 'this LLC'}`}
          />
        )}
      </div>
    </div>
  );
}

// ── Multi-year job card (groups all years that share one reasonable-cause letter) ──
function JobCard({
  filings,
  onDeleteJob,
  onDeleteYear,
  busy,
}: {
  filings: Filing[];
  onDeleteJob?: (filings: Filing[]) => void;
  onDeleteYear?: (f: Filing) => void;
  busy?: string | null;
}) {
  const sorted = [...filings].sort((a, b) => Number(b.tax_year) - Number(a.tax_year));
  // Chronological (ascending) order to find the EARLIEST unfilled year.
  const chronological = [...filings].sort((a, b) => Number(a.tax_year) - Number(b.tax_year));
  const years = sorted.map((f) => f.tax_year).filter(Boolean);
  const llc = sorted.find((f) => f.llc_name)?.llc_name?.trim() || 'Catch-up filing';
  const remaining = sorted.filter((f) => f.status === 'draft' || f.status === 'in_progress').length;
  const allReady = sorted.every((f) => f.status === 'paid' || f.status === 'completed');
  // Continue → the EARLIEST year still needing work, so the catch-up is filed in
  // chronological order. When every year is done, the action points at the job's
  // review/download page (most-recent filing).
  const target = chronological.find((f) => f.status === 'draft' || f.status === 'in_progress') ?? sorted[0];

  // A job with any paid year cannot be deleted; the button is hidden rather than
  // shown-and-refused, so the only delete a filer can see is one that will work.
  const jobDeletable = sorted.every(
    (f) => f.status !== 'paid' && f.status !== 'completed' && f.status !== 'submitted',
  );
  const showJobDelete = jobDeletable && !!onDeleteJob;

  return (
    <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-accent)', borderRadius: '0.75rem', overflow: 'hidden' }}>
      <div style={{ padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', background: 'rgba(var(--tf-accent-rgb), 0.06)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <Pill bg="var(--tf-accent)" fg="var(--tf-on-accent)" uppercase>
              Multi-year catch-up
            </Pill>
          </div>
          <p style={{ fontWeight: 700, fontSize: '1.0625rem', color: 'var(--tf-text)' }}>{llc}</p>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', marginTop: '0.1rem' }}>
            {years.length} years ({years.slice().reverse().join(', ')}) · one reasonable-cause letter covers them all
            {remaining > 0 ? ` · ${remaining} year${remaining > 1 ? 's' : ''} left to complete` : allReady ? ' · all years ready' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
          {/* Delete inline after the primary action, same as the filing card
              and the per-year rows below. "Add or remove years" stays on its
              own line underneath. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Link
              to={filingPath(target)}
              style={{ background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1.1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '40px', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}
            >
              {remaining > 0 ? 'Continue' : 'Download all'}
            </Link>
            {showJobDelete && (
              <DeleteCardButton
                onClick={() => onDeleteJob!(filings)}
                busy={busy === `del-job-${sorted[0]?.job_id}`}
                title={`Delete the whole catch-up for ${llc}, all ${sorted.length} years`}
              />
            )}
          </div>
          {!allReady && sorted[0]?.job_id && (
            <Link
              to={`/catch-up?job=${sorted[0].job_id}`}
              style={{ color: 'var(--tf-accent)', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Add or remove years
            </Link>
          )}
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--tf-border)' }}>
        {sorted.map((f) => {
          const c = STATUS_COLOR[f.status];
          const yearDeletable = f.status === 'draft' || f.status === 'in_progress';
          // The row used to be a single <Link> wrapping everything. A delete
          // button cannot live inside that: nesting a button in an anchor is
          // invalid HTML, and every click would race the navigation. So the row
          // is now a flex container with the Link as one child and the delete as
          // its sibling. The Link keeps flex:1 so the whole row area is still
          // the click target for continuing that year.
          return (
            <div
              key={f.id}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 1.5rem 0 0', borderTop: '1px solid var(--tf-border)' }}
            >
              <Link to={filingPath(f)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.75rem 0.75rem 0.75rem 1.5rem', textDecoration: 'none' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', fontWeight: 600 }}>Tax year {f.tax_year}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Pill bg={c.bg} fg={c.fg}>{STATUS_LABEL[f.status]}</Pill>
                  <span style={{ color: 'var(--tf-accent)', fontSize: '0.8rem', fontWeight: 600 }}>{actionLabel(f.status)} →</span>
                </span>
              </Link>
              {/* Only when more than one year remains. Deleting the last year of
                  a catch-up would leave an empty job, and the job-level delete
                  in the header is the right way to remove the whole thing. */}
              {yearDeletable && onDeleteYear && sorted.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeleteYear(f)}
                  disabled={busy === `del-${f.id}`}
                  title={`Delete tax year ${f.tax_year} from this catch-up`}
                  aria-label={`Delete tax year ${f.tax_year} from this catch-up`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    // Same red as the card corner control. A destructive action
                    // should look destructive in both places, not muted in one.
                    color: 'var(--tf-error-text)',
                    cursor: busy === `del-${f.id}` ? 'not-allowed' : 'pointer',
                    opacity: busy === `del-${f.id}` ? 0.4 : 1,
                    padding: '0.4rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    borderRadius: '0.375rem',
                    minHeight: '32px',
                    minWidth: '32px',
                    justifyContent: 'center',
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--tf-bg)',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.75rem',
  padding: '1.5rem',
  boxShadow: '0 1px 2px oklch(0.2 0.01 80 / 0.06), 0 4px 16px oklch(0.2 0.01 80 / 0.04)',
  display: 'flex',
  flexDirection: 'column',
};
const tagStyle: React.CSSProperties = { color: 'var(--tf-muted)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' };
const priceStyle: React.CSSProperties = { color: 'var(--tf-accent)', fontWeight: 700, fontSize: '1.5rem', marginBottom: '0.25rem' };
const mutedStyle: React.CSSProperties = { color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, marginBottom: '1.25rem', flex: 1 };

function primaryBtn(busy: boolean): React.CSSProperties {
  return { background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: busy ? 0.7 : 1 };
}

const linkBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--tf-accent)', fontSize: '0.875rem', fontWeight: 600,
  textDecoration: 'underline', textUnderlineOffset: '2px',
};
