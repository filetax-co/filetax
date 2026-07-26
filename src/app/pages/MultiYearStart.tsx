/**
 * Multi-year catch-up — year picker.
 *
 * The filer selects every tax year they missed (2019 → most recent filing
 * year). We create ONE filing_jobs row (which carries the single, shared
 * reasonable-cause letter) and one `filings` row per selected year, all linked
 * by job_id and seeded from the user's saved profile. The filer is then sent to
 * the MOST RECENT year's intake; finishing a year routes to the next unfinished
 * year, and finally to the job review.
 *
 * Earliest supported year is 2019 (the foreign-owned DE Form 5472 requirement
 * began for tax years beginning on/after 2017; 2019 is our supported floor and
 * there is no statute of limitations on these penalties).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { loadProfile } from '../../lib/filingProfile';
import { REASONABLE_CAUSE_REASONS } from './intake/constants';

const EARLIEST_YEAR = 2019;

export function MultiYearStart() {
  usePageMeta({
    title: 'Catch up on past years | FileTax.co',
    description: 'Select the tax years you missed. One reasonable-cause letter covers them all.',
  });

  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  // When editing an existing job (before payment), we reconcile years instead of
  // creating a new job.
  const editJobId = params.get('job');

  // Most recent filable year = last completed calendar year.
  const latestYear = new Date().getUTCFullYear() - 1;
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = latestYear; y >= EARLIEST_YEAR; y--) out.push(y);
    return out;
  }, [latestYear]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [includeRcl, setIncludeRcl] = useState(true);
  const [rclReasons, setRclReasons] = useState<string[]>([]);
  const [incorpDate, setIncorpDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [anyYearPaid, setAnyYearPaid] = useState(false);

  // When editing an existing job, prefill the selected years, RCL choice,
  // reasons and incorporation date from the job and its filings.
  useEffect(() => {
    if (!editJobId || !user) return;
    let cancelled = false;
    (async () => {
      const { data: job } = await supabase
        .from('filing_jobs')
        .select('include_rcl, reasonable_cause_reasons')
        .eq('id', editJobId)
        .single();
      const { data: fs } = await supabase
        .from('filings')
        .select('tax_year, status, date_of_incorporation')
        .eq('job_id', editJobId);
      if (cancelled) return;
      if (job) {
        setIncludeRcl(!!job.include_rcl);
        setRclReasons(((job as any).reasonable_cause_reasons as string[] | null) ?? []);
      }
      if (fs && fs.length) {
        setSelected(new Set(fs.map((f: any) => Number(f.tax_year))));
        const doi = fs.find((f: any) => f.date_of_incorporation)?.date_of_incorporation;
        if (doi) setIncorpDate(doi);
        // If any year is already paid, years can no longer be changed.
        setAnyYearPaid(fs.some((f: any) => f.status === 'paid' || f.status === 'completed'));
      }
    })();
    return () => { cancelled = true; };
  }, [editJobId, user]);

  // The entity can't have a filing obligation before it existed. Once the
  // incorporation date is known, years before that year are not selectable.
  const incorpYear = incorpDate ? Number(incorpDate.split('-')[0]) : null;
  const isYearEligible = (y: number) => incorpYear == null || y >= incorpYear;

  const toggle = (y: number) => {
    if (!isYearEligible(y)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(y) ? next.delete(y) : next.add(y);
      return next;
    });
  };

  // Drop any now-ineligible years if the incorporation date changes.
  const handleIncorpChange = (v: string) => {
    setIncorpDate(v);
    const y = v ? Number(v.split('-')[0]) : null;
    if (y != null) setSelected((prev) => new Set([...prev].filter((yr) => yr >= y)));
  };

  async function reconcileJob() {
    if (!user || !editJobId || selected.size === 0 || busy || anyYearPaid) return;
    setBusy(true);
    setError('');
    const chosen = [...selected].sort((a, b) => a - b);
    try {
      // Update the job-level choices.
      await supabase.from('filing_jobs').update({
        tax_years: [...chosen].sort((a, b) => b - a),
        include_rcl: includeRcl,
        reasonable_cause_reasons: includeRcl ? rclReasons : [],
      }).eq('id', editJobId);

      // Existing (draft) year rows for this job.
      const { data: existing } = await supabase
        .from('filings')
        .select('id, tax_year, status')
        .eq('job_id', editJobId);
      const existingYears = new Set((existing ?? []).map((f: any) => Number(f.tax_year)));

      // Delete draft rows for years no longer selected (never touch paid rows).
      const toDelete = (existing ?? []).filter(
        (f: any) => !selected.has(Number(f.tax_year)) && f.status === 'draft',
      );
      if (toDelete.length) {
        await supabase.from('filings').delete().in('id', toDelete.map((f: any) => f.id));
      }

      // Insert rows for newly-added years, seeded from the profile.
      const newYears = chosen.filter((y) => !existingYears.has(y));
      if (newYears.length) {
        const profile = await loadProfile(user.id);
        const seed = buildSeed(profile);
        const rows = newYears.map((y) => ({
          ...seed,
          date_of_incorporation: incorpDate || (seed.date_of_incorporation as string | null) || null,
          user_id: user.id,
          job_id: editJobId,
          service_type: 'past_year',
          status: 'draft',
          current_step: 1,
          tax_year: String(y),
          include_rcl: includeRcl,
        }));
        await supabase.from('filings').insert(rows);
      }

      // Go to the earliest still-draft year.
      const { data: after } = await supabase
        .from('filings')
        .select('id, tax_year, status')
        .eq('job_id', editJobId)
        .order('tax_year', { ascending: true });
      const target = (after ?? []).find((f: any) => f.status === 'draft') ?? (after ?? [])[0];
      if (target) navigate(`/intake?filing_id=${target.id}`);
      else navigate('/dashboard');
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  function buildSeed(profile: Awaited<ReturnType<typeof loadProfile>>): Record<string, unknown> {
    return profile
      ? {
          llc_name: profile.llc_name ?? null,
          ein: profile.ein ?? null,
          state_of_formation: profile.state_of_formation ?? null,
          date_of_incorporation: incorpDate || profile.date_of_incorporation || null,
          mailing_address: profile.mailing_address ?? null,
          naics_code: profile.naics_code ?? profile.entity_business_code ?? null,
          naics_description: profile.naics_description ?? profile.entity_business_activity ?? null,
          entity_business_activity: profile.entity_business_activity ?? null,
          entity_business_code: profile.entity_business_code ?? null,
          owner_full_name: profile.owner_full_name ?? null,
          owner_country: profile.owner_country ?? null,
          owner_primary_country: profile.owner_primary_country ?? null,
          owner_country_residence: profile.owner_country_residence ?? null,
          owner_country_citizenship: profile.owner_country_citizenship ?? null,
          owner_foreign_tax_id: profile.owner_foreign_tax_id ?? null,
          owner_us_tin: profile.owner_us_tin ?? null,
          owner_reference_id: profile.owner_reference_id ?? null,
          owner_address: profile.owner_address ?? null,
          owner_business_activity: profile.owner_business_activity ?? null,
          owner_business_code: profile.owner_business_code ?? null,
          owner_naics_code: profile.owner_naics_code ?? null,
          related_parties: profile.related_parties ?? [],
        }
      : {};
  }

  async function createJob() {
    if (editJobId) return reconcileJob();
    if (!user || selected.size === 0 || busy) return;
    setBusy(true);
    setError('');

    const chosen = [...selected].sort((a, b) => b - a); // most recent first

    try {
      // 1. Create the job (holds the shared RCL).
      const { data: job, error: jobErr } = await supabase
        .from('filing_jobs')
        .insert({
          user_id: user.id,
          tax_years: chosen,
          include_rcl: includeRcl,
          reasonable_cause_reasons: includeRcl ? rclReasons : [],
          status: 'draft',
        })
        .select('id')
        .single();
      if (jobErr || !job) throw new Error(jobErr?.message ?? 'Could not create the catch-up job.');

      // 2. Prefill entity/owner from the saved profile so every year carries it.
      const profile = await loadProfile(user.id);
      const seed = buildSeed(profile);

      // 3. One filing per year, linked to the job. Every row carries the
      //    incorporation date (so an initial-return short year is derived) and
      //    the shared RCL flag. The reasonable-cause REASONS live on the job and
      //    are collected once, not per year.
      const rows = chosen.map((y) => ({
        ...seed,
        date_of_incorporation: incorpDate || (seed.date_of_incorporation as string | null | undefined) || null,
        user_id: user.id,
        job_id: job.id,
        service_type: 'past_year',
        status: 'draft',
        current_step: 1,
        tax_year: String(y),
        include_rcl: includeRcl,
      }));
      const { data: created, error: insErr } = await supabase
        .from('filings')
        .insert(rows)
        .select('id, tax_year');
      if (insErr || !created) throw new Error(insErr?.message ?? 'Could not create the year filings.');

      // 4. Go to the EARLIEST year's intake first, then walk forward year by
      //    year so the catch-up is filed in chronological order.
      const earliest = created.sort((a, b) => Number(a.tax_year) - Number(b.tax_year))[0];
      navigate(`/intake?filing_id=${earliest.id}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  const box: React.CSSProperties = {
    background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
    borderRadius: '0.75rem', padding: '2rem', maxWidth: 640, margin: '0 auto',
  };

  return (
    <section style={{ background: 'var(--tf-bg)', minHeight: '80vh', padding: '3rem 1rem' }}>
      <div style={box}>
        <h1 style={{ fontSize: 'clamp(1.25rem, 3.5vw, 1.625rem)', marginBottom: '0.5rem' }}>
          {editJobId ? 'Adjust the years you’re filing' : 'Which years do you need to file?'}
        </h1>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          Select every year you missed. We prepare a separate Form 5472 + pro forma 1120 for each year,
          and a single reasonable-cause letter that covers all of them. Your LLC and owner details carry
          across every year. You’ll only add each year’s transactions.
        </p>

        {editJobId && anyYearPaid && (
          <div className="cat-banner-amber" style={{ marginBottom: '1.5rem' }}>
            <strong>Years are locked.</strong> One or more years in this catch-up have already been paid,
            so the set of years can no longer be changed. Continue from your dashboard to finish or download.
          </div>
        )}

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text)', marginBottom: '0.375rem' }}>
            LLC incorporation date
          </label>
          <input
            type="date"
            value={incorpDate}
            onChange={(e) => handleIncorpChange(e.target.value)}
            style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', background: 'var(--tf-surface)', color: 'var(--tf-text)', fontSize: '0.9375rem' }}
          />
          <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.375rem', lineHeight: 1.5 }}>
            We use this to lock out years before your LLC existed, so you only file the years you actually owe.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.625rem' }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
            Tax years to file{selected.size > 0 ? ` · ${selected.size} selected` : ''}
          </p>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, padding: 0 }}
            >
              Clear all
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {years.map((y) => {
            const on = selected.has(y);
            const eligible = isYearEligible(y);
            return (
              <button
                key={y}
                type="button"
                onClick={() => toggle(y)}
                aria-pressed={on}
                disabled={!eligible}
                title={eligible ? undefined : `Your LLC was not incorporated until ${incorpYear}`}
                className={`tf-chip${on ? ' tf-chip--on' : ''}`}
              >
                {y}
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.875rem 1rem', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', background: 'var(--tf-offset)', cursor: 'pointer', marginBottom: '1.5rem' }}>
          <input type="checkbox" checked={includeRcl} onChange={(e) => setIncludeRcl(e.target.checked)} style={{ marginTop: '2px', accentColor: 'var(--tf-accent)', width: 16, height: 16 }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', lineHeight: 1.55 }}>
            <strong>Include a reasonable-cause letter ($200, recommended).</strong> One letter, covering every year
            above, asking the IRS to waive the late-filing penalty. Strongly recommended when filing late.
          </span>
        </label>

        {includeRcl && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.625rem' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                Why were these years filed late? (select all that apply — asked once for every year){rclReasons.length > 0 ? ` · ${rclReasons.length} selected` : ''}
              </p>
              {rclReasons.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRclReasons([])}
                  style={{ background: 'none', border: 'none', color: 'var(--tf-accent)', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, padding: 0, whiteSpace: 'nowrap' }}
                >
                  Clear all
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {REASONABLE_CAUSE_REASONS.map((r) => {
                const checked = rclReasons.includes(r.value);
                const toggleReason = () => setRclReasons((prev) => checked ? prev.filter((x) => x !== r.value) : [...prev, r.value]);
                return (
                  <div
                    key={r.value}
                    role="checkbox"
                    aria-checked={checked}
                    tabIndex={0}
                    onClick={toggleReason}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleReason(); } }}
                    style={{
                      display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                      padding: '0.75rem 0.875rem', borderRadius: '0.5rem',
                      border: `1px solid ${checked ? 'var(--tf-accent)' : 'var(--tf-border)'}`,
                      background: checked ? 'rgba(var(--tf-accent-rgb), 0.08)' : 'var(--tf-surface)',
                      cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={checked} readOnly tabIndex={-1} style={{ marginTop: 2, pointerEvents: 'none', accentColor: 'var(--tf-accent)' }} />
                    <span>
                      <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--tf-text)' }}>{r.label}</span>
                      <span style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--tf-muted)', lineHeight: 1.45 }}>{r.hint}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="cat-banner-red" style={{ marginBottom: '1rem' }}>{error}</div>
        )}

        <button
          onClick={createJob}
          disabled={selected.size === 0 || busy || (editJobId != null && anyYearPaid)}
          style={{
            background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontWeight: 600,
            fontSize: '0.9375rem', padding: '0.875rem 1.5rem', borderRadius: '0.5rem', border: 'none',
            cursor: selected.size === 0 || busy || (editJobId != null && anyYearPaid) ? 'not-allowed' : 'pointer',
            opacity: selected.size === 0 || busy || (editJobId != null && anyYearPaid) ? 0.5 : 1, width: '100%', minHeight: 48,
          }}
        >
          {busy
            ? 'Saving…'
            : selected.size === 0
              ? 'Select at least one year'
              : editJobId
                ? `Save ${selected.size} year${selected.size > 1 ? 's' : ''}`
                : `Start filing — begin with ${Math.min(...selected)}`}
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          style={{ background: 'none', border: 'none', color: 'var(--tf-muted)', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, padding: '0.875rem 0 0', display: 'block', margin: '0 auto' }}
        >
          ← Back to dashboard
        </button>
      </div>
    </section>
  );
}
