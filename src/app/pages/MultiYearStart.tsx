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
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { loadProfile } from '../../lib/filingProfile';

const EARLIEST_YEAR = 2019;

export function MultiYearStart() {
  usePageMeta({
    title: 'Catch up on past years | FileTax.co',
    description: 'Select the tax years you missed. One reasonable-cause letter covers them all.',
  });

  const navigate = useNavigate();
  const { user } = useAuth();

  // Most recent filable year = last completed calendar year.
  const latestYear = new Date().getUTCFullYear() - 1;
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = latestYear; y >= EARLIEST_YEAR; y--) out.push(y);
    return out;
  }, [latestYear]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [includeRcl, setIncludeRcl] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (y: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(y) ? next.delete(y) : next.add(y);
      return next;
    });

  async function createJob() {
    if (!user || selected.size === 0 || busy) return;
    setBusy(true);
    setError('');

    const chosen = [...selected].sort((a, b) => b - a); // most recent first

    try {
      // 1. Create the job (holds the shared RCL).
      const { data: job, error: jobErr } = await supabase
        .from('filing_jobs')
        .insert({ user_id: user.id, tax_years: chosen, include_rcl: includeRcl, status: 'draft' })
        .select('id')
        .single();
      if (jobErr || !job) throw new Error(jobErr?.message ?? 'Could not create the catch-up job.');

      // 2. Prefill entity/owner from the saved profile so every year carries it.
      const profile = await loadProfile(user.id);
      const seed: Record<string, unknown> = profile
        ? {
            llc_name: profile.llc_name ?? null,
            ein: profile.ein ?? null,
            state_of_formation: profile.state_of_formation ?? null,
            date_of_incorporation: profile.date_of_incorporation ?? null,
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

      // 3. One filing per year, linked to the job.
      const rows = chosen.map((y) => ({
        ...seed,
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

      // 4. Go to the most recent year's intake first.
      const mostRecent = created.sort((a, b) => Number(b.tax_year) - Number(a.tax_year))[0];
      navigate(`/intake?filing_id=${mostRecent.id}`);
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
          Which years do you need to file?
        </h1>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          Select every year you missed. We prepare a separate Form 5472 + pro forma 1120 for each year,
          and a single reasonable-cause letter that covers all of them. Your LLC and owner details carry
          across every year — you’ll only add each year’s transactions.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {years.map((y) => {
            const on = selected.has(y);
            return (
              <button
                key={y}
                type="button"
                onClick={() => toggle(y)}
                aria-pressed={on}
                style={{
                  padding: '0.75rem 0.5rem', borderRadius: '0.5rem',
                  border: `1.5px solid ${on ? 'var(--tf-accent)' : 'var(--tf-border)'}`,
                  background: on ? 'rgba(var(--tf-accent-rgb), 0.10)' : 'var(--tf-surface)',
                  color: 'var(--tf-text)', fontWeight: 700, fontSize: '1rem',
                  cursor: 'pointer', minHeight: '48px',
                }}
              >
                {y}
              </button>
            );
          })}
        </div>

        <label style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.875rem 1rem', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', background: 'var(--tf-offset)', cursor: 'pointer', marginBottom: '1.5rem' }}>
          <input type="checkbox" checked={includeRcl} onChange={(e) => setIncludeRcl(e.target.checked)} style={{ marginTop: '2px', accentColor: 'var(--tf-accent)', width: 16, height: 16 }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', lineHeight: 1.55 }}>
            <strong>Include a reasonable-cause letter (recommended).</strong> One letter, covering every year
            above, asking the IRS to waive the late-filing penalty. Strongly recommended when filing late.
          </span>
        </label>

        {error && (
          <div className="cat-banner-red" style={{ marginBottom: '1rem' }}>{error}</div>
        )}

        <button
          onClick={createJob}
          disabled={selected.size === 0 || busy}
          style={{
            background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontWeight: 600,
            fontSize: '0.9375rem', padding: '0.875rem 1.5rem', borderRadius: '0.5rem', border: 'none',
            cursor: selected.size === 0 || busy ? 'not-allowed' : 'pointer',
            opacity: selected.size === 0 || busy ? 0.5 : 1, width: '100%', minHeight: 48,
          }}
        >
          {busy ? 'Setting up…' : selected.size === 0 ? 'Select at least one year' : `Continue with ${selected.size} year${selected.size > 1 ? 's' : ''}`}
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
