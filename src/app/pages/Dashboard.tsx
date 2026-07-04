import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase, type Filing, type ServiceType } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { FILING_DUE_DATES } from './intake/constants';

const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

// ── Status buckets — group filings into a small, human set on the dashboard ──
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

/** "December 1, 2025" — the one human date format used across the product. */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${MONTHS[m]} ${d}, ${y}`;
}

type DueState = { label: string; tone: 'ok' | 'warn' | 'late'; due: string } | null;

/** Compute the IRS on-time / extended / late state for a filing's tax year. */
function dueState(taxYear: string | null | undefined): DueState {
  if (!taxYear) return null;
  const dates = FILING_DUE_DATES[Number(taxYear)];
  if (!dates) return null;
  const today = new Date();
  const original = new Date(dates.original);
  const extended = new Date(dates.extended);
  if (today <= original) return { label: `Due ${humanDate(dates.original)}`, tone: 'ok', due: dates.original };
  if (today <= extended) return { label: `Extension due ${humanDate(dates.extended)}`, tone: 'warn', due: dates.extended };
  return { label: 'Past due, file ASAP', tone: 'late', due: dates.extended };
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

type EligibilityIntake = {
  id: string;
  years_param: string | null;
  sections_param: string | null;
  parties_param: number | null;
  rcl_param: boolean | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function deriveServiceType(years: string | null | undefined): ServiceType {
  if (!years || years === 'current') return 'current_year';
  return 'past_year';
}

/**
 * Seed tax year for a brand-new filing. Never returns null — the filings table
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
  const [pendingIntake, setPendingIntake] = useState<EligibilityIntake | null>(null);
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

      const intakeRes = await supabase
        .from('intake_submissions')
        .select('id, years_param, sections_param, parties_param, rcl_param')
        .eq('user_id', effectiveUserId)
        .is('linked_filing_id', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (filingsRes.error) {
        setError(filingsRes.error.message);
      } else {
        setFilings((filingsRes.data ?? []) as Filing[]);
      }

      const candidate = (intakeRes.data ?? [])[0] as EligibilityIntake | undefined;
      const hasEligibilityData = candidate && (
        candidate.years_param || candidate.sections_param ||
        (candidate.parties_param && candidate.parties_param > 1) ||
        candidate.rcl_param
      );
      setPendingIntake(hasEligibilityData ? candidate! : null);

      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [effectiveUserId, authLoading]);

  async function startFromEligibility() {
    if (!effectiveUserId || !pendingIntake || busy) return;
    setBusy('eligibility');
    setError('');

    const sections = pendingIntake.sections_param
      ? pendingIntake.sections_param.split(',').filter(Boolean)
      : [];

    const { data, error } = await supabase
      .from('filings')
      .insert({
        user_id: effectiveUserId,
        service_type: deriveServiceType(pendingIntake.years_param),
        tax_year: deriveTaxYear(pendingIntake.years_param),
        status: 'draft',
        current_step: 1,
        include_rcl: !!pendingIntake.rcl_param,
        parties_count: pendingIntake.parties_param ?? 1,
        complex_sections: sections,
      })
      .select('id')
      .single();

    if (error || !data) {
      setBusy(null);
      setError(error?.message ?? 'Could not create filing.');
      return;
    }

    await supabase
      .from('intake_submissions')
      .update({ linked_filing_id: data.id, status: 'in_progress' })
      .eq('id', pendingIntake.id);

    navigate(`/intake?filing_id=${data.id}`);
  }

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
  // never deletable — a payment must remain auditable. Its transactions cascade
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
            <span style={{ display: 'inline-block', background: 'var(--tf-success)', color: 'var(--tf-on-accent)', borderRadius: '9999px', padding: '0.2rem 0.875rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.875rem' }}>
              Dashboard
            </span>
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

      {!loading && pendingIntake && (
        <section style={{ background: 'var(--tf-bg)', padding: '0 1rem 1rem' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ border: '2px solid var(--tf-accent)', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', background: 'rgba(var(--tf-accent-rgb), 0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ display: 'inline-block', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', borderRadius: '9999px', padding: '0.2rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  From Your Eligibility Check
                </span>
              </div>
              <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tf-text)', marginBottom: '0.5rem' }}>
                Pick up where you left off.
              </p>
              <p style={{ color: 'var(--tf-text)', fontSize: '0.9375rem', fontWeight: 400, lineHeight: 1.6, marginBottom: '1rem' }}>
                We saved your eligibility answers. Continue your filing and we will carry them forward, so you do not need to enter them again.
              </p>
              <button
                onClick={startFromEligibility}
                disabled={busy !== null}
                style={{ background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: busy === 'eligibility' ? 0.7 : 1 }}
              >
                {busy === 'eligibility' ? 'Setting up...' : 'Continue your filing'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Summary strip ───────────────────────────────────────────────── */}
      {!loading && filings.length > 0 && (
        <section style={{ background: 'var(--tf-bg)', padding: '0.5rem 1rem 1.5rem' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }} className="dash-summary">
            {(() => {
              const counts = { action: 0, in_progress: 0, ready: 0, done: 0 } as Record<Bucket, number>;
              for (const f of filings) counts[BUCKET_OF[f.status]]++;
              // Nearest upcoming/most-urgent deadline among non-done filings.
              const upcoming = filings
                .filter((f) => BUCKET_OF[f.status] !== 'done')
                .map((f) => dueState(f.tax_year))
                .filter((d): d is NonNullable<DueState> => !!d)
                .sort((a, b) => a.due.localeCompare(b.due))[0];
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
                  {upcoming && stat('Next deadline', humanDate(upcoming.due), upcoming.tone === 'late' ? 'late' : upcoming.tone === 'warn' ? 'warn' : undefined)}
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
                    <JobCard key={jobId} filings={yearFilings} />
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
            File this year, or catch up on years you missed.
          </p>
          <div className="dash-services" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div style={cardStyle}>
              <p style={tagStyle}>Most popular</p>
              <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>File this year</h3>
              <p style={priceStyle}>$150</p>
              <p style={mutedStyle}>Form 5472 + pro forma 1120 for the current tax year. One-time, no ongoing fees.</p>
              <button onClick={() => startFiling('current_year')} disabled={busy !== null} style={primaryBtn(busy === 'current_year')}>
                {busy === 'current_year' ? 'Creating…' : 'Start filing'}
              </button>
            </div>
            <div style={cardStyle}>
              <p style={tagStyle}>For late filers</p>
              <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>Catch up on past years</h3>
              <p style={priceStyle}>$150<span style={{ fontSize: '0.8125rem', fontWeight: 400, color: 'var(--tf-muted)' }}> / year + one $200 letter</span></p>
              <p style={mutedStyle}>File one or more missed years. A single reasonable-cause letter covers them all.</p>
              <button onClick={() => navigate('/catch-up')} disabled={busy !== null} style={primaryBtn(false)}>
                Choose years
              </button>
            </div>
          </div>

          {/* Secondary / additional services */}
          <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem 1.25rem', flexWrap: 'wrap', padding: '1rem 1.25rem', background: 'var(--tf-bg)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', fontWeight: 600 }}>Coming soon:</span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)' }}>
              LLC tax classification change (8832 / 2553) · $50 &nbsp;·&nbsp; IRS fax submission add-on &nbsp;·&nbsp; Form 7004, FBAR &amp; more
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
function FilingCard({ f, onDelete, deleting }: { f: Filing; onDelete?: (f: Filing) => void; deleting?: boolean }) {
  const c = STATUS_COLOR[f.status];
  const due = (f.status !== 'completed' && f.status !== 'submitted') ? dueState(f.tax_year) : null;
  const headline = f.llc_name?.trim() || SERVICE_LABEL[f.service_type];
  // Unpaid filings (draft / in-progress) can be deleted; paid ones cannot.
  const deletable = f.status === 'draft' || f.status === 'in_progress';
  return (
    <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
          <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tf-text)' }}>
            {headline}{f.tax_year ? <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}> · {f.tax_year}</span> : ''}
          </p>
          <span style={{ background: c.bg, color: c.fg, borderRadius: '9999px', padding: '0.125rem 0.625rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.03em' }}>
            {STATUS_LABEL[f.status]}
          </span>
          {due && (
            <span style={{ background: due.tone === 'late' ? 'var(--tf-banner-red-bg)' : due.tone === 'warn' ? 'var(--tf-banner-amber-bg)' : 'var(--tf-offset)', color: due.tone === 'late' ? 'var(--tf-banner-red-text)' : due.tone === 'warn' ? 'var(--tf-banner-amber-text)' : 'var(--tf-muted)', borderRadius: '9999px', padding: '0.125rem 0.625rem', fontSize: '0.72rem', fontWeight: 600 }}>
              {due.label}
            </span>
          )}
        </div>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400 }}>
          {f.ein ? `EIN ${f.ein} · ` : ''}{SERVICE_LABEL[f.service_type]} · Updated {formatDate(f.updated_at)}
          {(f.status === 'draft' || f.status === 'in_progress') ? ` · Step ${f.current_step} of 5` : ''}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
        <Link
          to={filingPath(f)}
          style={{ background: f.status === 'completed' ? 'transparent' : 'var(--tf-accent)', color: f.status === 'completed' ? 'var(--tf-accent)' : 'var(--tf-on-accent)', border: f.status === 'completed' ? '1px solid var(--tf-border)' : 'none', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1.1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '40px', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}
        >
          {actionLabel(f.status)}
        </Link>
        {deletable && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(f)}
            disabled={deleting}
            title="Delete this unpaid filing"
            aria-label="Delete this unpaid filing"
            style={{ background: 'transparent', border: '1px solid var(--tf-border)', color: 'var(--tf-muted)', fontWeight: 600, fontSize: '0.8125rem', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', cursor: deleting ? 'not-allowed' : 'pointer', minHeight: '40px', opacity: deleting ? 0.5 : 1 }}
          >
            {deleting ? '…' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Multi-year job card (groups all years that share one reasonable-cause letter) ──
function JobCard({ filings }: { filings: Filing[] }) {
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

  return (
    <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-accent)', borderRadius: '0.75rem', overflow: 'hidden' }}>
      <div style={{ padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', background: 'rgba(var(--tf-accent-rgb), 0.06)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <span style={{ background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', borderRadius: '9999px', padding: '0.125rem 0.625rem', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Multi-year catch-up
            </span>
          </div>
          <p style={{ fontWeight: 700, fontSize: '1.0625rem', color: 'var(--tf-text)' }}>{llc}</p>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', marginTop: '0.1rem' }}>
            {years.length} years ({years.slice().reverse().join(', ')}) · one reasonable-cause letter covers them all
            {remaining > 0 ? ` · ${remaining} year${remaining > 1 ? 's' : ''} left to complete` : allReady ? ' · all years ready' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
          <Link
            to={filingPath(target)}
            style={{ background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1.1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '40px', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}
          >
            {remaining > 0 ? 'Continue' : 'Download all'}
          </Link>
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
          return (
            <Link key={f.id} to={filingPath(f)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.75rem 1.5rem', borderTop: '1px solid var(--tf-border)', textDecoration: 'none' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', fontWeight: 600 }}>Tax year {f.tax_year}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ background: c.bg, color: c.fg, borderRadius: '9999px', padding: '0.1rem 0.55rem', fontSize: '0.72rem', fontWeight: 700 }}>{STATUS_LABEL[f.status]}</span>
                <span style={{ color: 'var(--tf-accent)', fontSize: '0.8rem', fontWeight: 600 }}>{actionLabel(f.status)} →</span>
              </span>
            </Link>
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
