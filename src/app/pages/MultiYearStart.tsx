/**
 * Multi-year catch-up, year picker.
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
import { listCompanies, type FilingProfile } from '../../lib/filingProfile';
import { REASONABLE_CAUSE_REASONS, EARLIEST_TAX_YEAR } from './intake/constants';
import { PRICE_RCL, PRICE_FAX } from '../../lib/pricing';

// Defined once, in intake/constants. It was written out here and in
// PenaltyCalculator, and the dashboard catch-up prompt needed a third.
const EARLIEST_YEAR = EARLIEST_TAX_YEAR;

// The company selector's "not one of these" option. A saved EIN can never be
// this, so it cannot collide with a real value.
const NEW_COMPANY = '__new__';

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
  // The company and the years the dashboard's catch-up prompt was talking
  // about. Without them this screen opened on whichever company was used last,
  // which on a multi-LLC account is a different entity than the one the filer
  // just clicked, with a different set of years already filed.
  const presetEin = (params.get('ein') ?? '').replace(/\D/g, '');
  const presetYears = (params.get('years') ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((y) => Number.isFinite(y) && y > 0);

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
  // Saved companies, and which one this catch-up is for. A catch-up seeds EVERY
  // year from one company, so picking the wrong one is a whole job of filings
  // carrying the wrong EIN, not a single return. Defaults to the most recently
  // used, which is the right answer for the common single-company filer.
  const [companies, setCompanies] = useState<FilingProfile[]>([]);
  const [selectedEin, setSelectedEin] = useState<string>('');
  // IRS fax delivery, the $9 add-on, charged ONCE for the whole catch-up.
  //
  // Asked here rather than on each year's review screen, because a catch-up is
  // transmitted as one package: asking on review meant asking the same question
  // three or five times for a single fee. Written to every year row, since
  // `filings.include_irs_fax` is the only source of the entitlement the checkout
  // and the dispatcher read, and both of them take it across the job with
  // `some()`. A filer who says no here is offered it again after payment, on the
  // filing page below the download, which is the moment they discover they have
  // no fax machine.
  const [includeIrsFax, setIncludeIrsFax] = useState(false);
  // Years this company has already been filed for, so they cannot be bought
  // twice. A year that has been paid for is not an option to re-select: the
  // filer's own dashboard already holds that return, and selecting it here
  // would create a second filing for the same year and charge $99 for it.
  // Keyed by year, valued with what it is, so the hover can say which.
  const [filedYears, setFiledYears] = useState<Map<number, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [anyYearPaid, setAnyYearPaid] = useState(false);

  // Load the saved companies and default to the most recently used.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const saved = await listCompanies(user.id);
      if (cancelled || saved.length === 0) return;
      setCompanies(saved);
      // The company named in the link wins over the most recently used one, and
      // only falls back when that EIN is not one of this user's saved companies.
      const asked = presetEin
        ? saved.find((c) => (c.ein ?? '').replace(/\D/g, '') === presetEin)
        : undefined;
      const chosen = asked ?? saved[0];
      setSelectedEin((cur) => cur || (chosen.ein ?? ''));
      if (!incorpDate && chosen.date_of_incorporation) {
        setIncorpDate(String(chosen.date_of_incorporation));
      }
      // Preselect the years the prompt offered, but only when arriving with
      // them and not when editing an existing job, which loads its own set.
      // Anything already filed is dropped by the filed-years effect below.
      if (!editJobId && presetYears.length) {
        setSelected((prev) => (prev.size ? prev : new Set(presetYears)));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Load the years already filed for the selected company. Matched on EIN,
  // which is the identifier the IRS files under and the one thing a filer
  // cannot have two of for one entity; a name can be edited between years.
  // Rows belonging to the job being EDITED are excluded, or every year already
  // in this catch-up would lock itself the moment one of them was paid.
  useEffect(() => {
    if (!user || !selectedEin || selectedEin === NEW_COMPANY) { setFiledYears(new Map()); return; }
    let cancelled = false;
    (async () => {
      const dashed = formatEin(selectedEin);
      if (!dashed) { setFiledYears(new Map()); return; }
      const { data } = await supabase
        .from('filings')
        .select('tax_year, status, job_id')
        .eq('user_id', user.id)
        .eq('ein', dashed)
        .in('status', ['paid', 'submitted', 'completed']);
      if (cancelled) return;
      const next = new Map<number, string>();
      for (const row of (data ?? []) as any[]) {
        if (editJobId && row.job_id === editJobId) continue;
        const y = Number(row.tax_year);
        if (!Number.isFinite(y)) continue;
        next.set(y, row.status === 'submitted' ? 'faxed to the IRS' : 'already filed');
      }
      setFiledYears(next);
      // A year that turns out to be filed cannot stay selected.
      setSelected((prev) => new Set([...prev].filter((y) => !next.has(y))));
    })();
    return () => { cancelled = true; };
  }, [user, selectedEin, editJobId]);

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
        .select('tax_year, status, date_of_incorporation, include_irs_fax')
        .eq('job_id', editJobId);
      if (cancelled) return;
      if (job) {
        setIncludeRcl(!!job.include_rcl);
        setRclReasons(((job as any).reasonable_cause_reasons as string[] | null) ?? []);
      }
      if (fs && fs.length) {
        setSelected(new Set(fs.map((f: any) => Number(f.tax_year))));
        // Job-scoped, so any year carrying it means the job has it. Same
        // `some()` the checkout and the dispatcher use.
        setIncludeIrsFax(fs.some((f: any) => f.include_irs_fax === true));
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
  const isNewCompany = selectedEin === NEW_COMPANY;
  const incorpYear = incorpDate ? Number(incorpDate.split('-')[0]) : null;
  const isYearEligible = (y: number) =>
    !filedYears.has(y) && (incorpYear == null || y >= incorpYear);

  /** Why a year cannot be picked, for the chip's hover. Null when it can. */
  const whyBlocked = (y: number): string | null => {
    const filed = filedYears.get(y);
    if (filed) return `${y} is ${filed}. Open it from your dashboard.`;
    if (incorpYear != null && y < incorpYear) return `Your LLC was not incorporated until ${incorpYear}`;
    return null;
  };

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

      // The same choice has to reach the YEAR ROWS, not just the job. A
      // single-year package is generated from filing.include_rcl, while the
      // job bundle reads filing_jobs.include_rcl, so a job edited to add the
      // letter left every year row already created still saying no: the bundle
      // carried the letter and the individual year's download did not. Only
      // draft rows are touched, never a paid one.
      await supabase.from('filings').update({
        include_rcl: includeRcl,
        include_reasonable_cause: includeRcl,
        reasonable_cause_reasons: includeRcl ? rclReasons : [],
        // Every draft year, not one of them: the entitlement is read across the
        // job with `some()`, so leaving it on a year that is later deselected
        // and deleted would silently drop a fax the filer had asked for.
        // Draft rows only, which is also what `filings_freeze_when_paid()`
        // permits once any year is paid.
        include_irs_fax: includeIrsFax,
      }).eq('job_id', editJobId).eq('status', 'draft');

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
        const seed = buildSeed(selectedCompany());
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
          include_reasonable_cause: includeRcl,
          reasonable_cause_reasons: includeRcl ? rclReasons : [],
          include_irs_fax: includeIrsFax,
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

  /** "999999999" → "99-9999999". Profiles store digits; filings store the dashed form. */
  function formatEin(digits: string | null | undefined): string {
    const d = (digits ?? '').replace(/\D/g, '');
    return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : '';
  }

  /**
   * The company this catch-up is for, or null when there is nothing to seed
   * from: either the filer has no saved company, or they picked one we have
   * never filed for. Both cases produce an empty seed and intake collects the
   * entity and owner on the first year, exactly as a first-ever filing does.
   */
  function selectedCompany(): FilingProfile | null {
    if (companies.length === 0 || selectedEin === NEW_COMPANY) return null;
    return companies.find((c) => c.ein === selectedEin) ?? companies[0];
  }

  function buildSeed(profile: FilingProfile | null): Record<string, unknown> {
    return profile
      ? {
          llc_name: profile.llc_name ?? null,
          ein: formatEin(profile.ein),
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

      // 2. Seed entity/owner from the chosen company so every year carries it.
      const seed = buildSeed(selectedCompany());

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
        // Both columns, deliberately. include_rcl is what the generator reads;
        // include_reasonable_cause is what intake reads and writes. A row with
        // only one of them set opens in intake showing the opposite of what the
        // filer chose here.
        include_rcl: includeRcl,
        include_reasonable_cause: includeRcl,
        reasonable_cause_reasons: includeRcl ? rclReasons : [],
        // On every year, for one $9 fee. `create-checkout-session` and
        // `dispatch-irs-fax` both take the entitlement across the job with
        // `some()` and the fee is added once, so this cannot multiply the charge.
        include_irs_fax: includeIrsFax,
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

        {/* Shown whenever anything is saved, because "a company I haven't filed
            for yet" is now one of the answers, so there is a real choice to make
            even with a single saved company: a second LLC's catch-up used to
            open pre-filled with the first one's EIN and owner, and the filer had
            to notice and overwrite it. With nothing saved there is still nothing
            to list, and intake collects the company as it always has. Every year
            in the catch-up is seeded from this one answer. */}
        {companies.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text)', marginBottom: '0.375rem' }}>
              Which company is this catch-up for?
            </label>
            <select
              value={selectedEin}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedEin(v);
                // A different company shares nothing with the one that was
                // selected, and the incorporation date decides which years are
                // even selectable, so carrying it over would offer years this
                // LLC may not have existed for.
                if (v === NEW_COMPANY) { setIncorpDate(''); setSelected(new Set()); return; }
                const co = companies.find((c) => c.ein === v);
                if (co?.date_of_incorporation) setIncorpDate(String(co.date_of_incorporation));
              }}
              style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', background: 'var(--tf-surface)', color: 'var(--tf-text)', fontSize: '0.9375rem' }}
            >
              {companies.map((c) => (
                <option key={c.ein ?? ''} value={c.ein ?? ''}>
                  {(c.llc_name?.trim() || 'Unnamed company')} · EIN {formatEin(c.ein)}
                </option>
              ))}
              <option value={NEW_COMPANY}>A different company, not listed here</option>
            </select>
            <p style={{ fontSize: '0.8125rem', color: 'var(--tf-muted)', marginTop: '0.375rem', lineHeight: 1.5 }}>
              {isNewCompany
                ? 'You’ll enter this LLC’s name, EIN and owner details on the first year, and we carry them across every other year you select.'
                : 'Every year you select below is prepared for this company.'}
            </p>
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
            const blocked = whyBlocked(y);
            const filed = filedYears.get(y);
            return (
              // The title sits on the WRAPPER, not on the button. A disabled
              // button receives no mouse events, so a tooltip written on it
              // never appears, which is the whole point of this one: a chip that
              // cannot be pressed and does not say why reads as broken.
              <span key={y} style={{ display: 'block' }} title={blocked ?? undefined}>
                <button
                  type="button"
                  onClick={() => toggle(y)}
                  aria-pressed={on}
                  disabled={!eligible}
                  aria-label={blocked ? `${y}, ${blocked}` : String(y)}
                  className={`tf-chip${on ? ' tf-chip--on' : ''}`}
                  style={{ width: '100%' }}
                >
                  {y}
                  {filed && (
                    <span style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, marginTop: '0.125rem' }}>
                      Filed
                    </span>
                  )}
                </button>
              </span>
            );
          })}
        </div>

        {/* Delivery, asked here and only here for a catch-up. On a single-year
            filing this sits on the review screen, beside the price. A catch-up
            has one review screen per year for a fee charged once, so asking
            there asked the same question five times; this is the screen that
            already decides the job-wide things. Frozen once any year is paid,
            because that is when the $9 was either bought or not.

            Above the letter, because the letter's reason list unfolds beneath it
            and pushed this to the bottom of a long screen, where it read as an
            afterthought to a decision the filer had already finished making. */}
        <label style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.875rem 1rem', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', background: 'var(--tf-offset)', cursor: anyYearPaid ? 'not-allowed' : 'pointer', marginBottom: '0.75rem', opacity: anyYearPaid ? 0.6 : 1 }}>
          <input
            type="checkbox"
            checked={includeIrsFax}
            disabled={anyYearPaid}
            onChange={(e) => setIncludeIrsFax(e.target.checked)}
            style={{ marginTop: '2px', accentColor: 'var(--tf-accent)', width: 16, height: 16 }}
          />
          <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', lineHeight: 1.55 }}>
            <strong>Fax the finished package to the IRS for me (${PRICE_FAX} once).</strong> Every year
            goes together, and you get the confirmation. Without it, you download the forms and mail
            them yourself.
          </span>
        </label>

        <label style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.875rem 1rem', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', background: 'var(--tf-offset)', cursor: 'pointer', marginBottom: '1.5rem' }}>
          <input type="checkbox" checked={includeRcl} onChange={(e) => setIncludeRcl(e.target.checked)} style={{ marginTop: '2px', accentColor: 'var(--tf-accent)', width: 16, height: 16 }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--tf-text)', lineHeight: 1.55 }}>
            <strong>Include a reasonable-cause letter (${PRICE_RCL} once, recommended).</strong> One letter, covering every year
            above, asking the IRS to waive the late-filing penalty. Strongly recommended when filing late.
          </span>
        </label>

        {includeRcl && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.625rem' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                Why were these years filed late? (select all that apply, asked once for every year){rclReasons.length > 0 ? ` · ${rclReasons.length} selected` : ''}
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
                : `Start filing, begin with ${Math.min(...selected)}`}
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
