import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase, type Filing, type ServiceType } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { FILING_DUE_DATES, filingDueDates, effectivePeriodEnd } from './intake/constants';
import { PRICE_PER_YEAR, PRICE_RCL, unavailableServices, serviceWithPrice } from '../../lib/pricing';
import {
  normalizeEin, formatEin, listCompanies, updateCompany, deleteCompany,
  setYearsFiledElsewhere, type FilingProfile,
} from '../../lib/filingProfile';
import { missingTaxYears, describeYears } from '../../lib/catchUpYears';

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
  // NOT "Filed & downloaded". Downloading is not filing: on the mail path the
  // filer still has to print, sign and post the package to Ogden, and this
  // heading was telling them the return was filed when a PDF had merely
  // reached their Downloads folder. The one case that IS more than a download,
  // a delivered fax, is `submitted`, and its own status pill says so.
  done: 'Downloaded',
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

/**
 * Does this filing have an extension behind it?
 *
 * extension_filed is the owner's own answer in intake step 1b. include_7004 is
 * a legacy column nothing in the app writes any more, but older rows carry it
 * and FilingWizard still puts a 7004 in the package for them, so the deadline
 * shown here has to agree with the package the same filing hands over.
 */
function hasExtension(f: Filing): boolean {
  return f.extension_filed === true || f.include_7004 === true;
}

/**
 * The period end this filing's deadline actually runs from.
 *
 * The deadline follows the PERIOD, not the label on it, and a final return's
 * period ends on the dissolution date. An LLC dissolved 30 June 2025 is due 15
 * October 2025, not 15 April 2026, so keying the dashboard on the tax year
 * alone could show a deadline six months later than the real one and, through
 * dueState's tone, call a late filing on time.
 *
 * This mirrors resolvePeriod() in pdfGenerator.ts, including the comparison
 * operators: the closure date is taken only when it falls strictly inside the
 * nominal period, so a closure on the first or last day leaves the period
 * unchanged rather than producing a one-day year, and a dissolution recorded
 * against a later year cannot extend this one. The generator already truncates
 * the printed period this way; this is the dashboard catching up with it.
 */
function periodEndOf(f: Filing): string | null {
  return effectivePeriodEnd(
    f.tax_year,
    f.tax_period_begin,
    f.tax_period_end,
    f.final_return,
    f.date_of_closure,
  );
}

/**
 * Compute the deadline state, using the extension date only for a filed 7004.
 *
 * Without a 7004 the extended date is not this filer's deadline at all, so
 * showing "Extension due 15 October" to someone who never filed one told them
 * they had six months they did not have.
 *
 * Takes the whole filing rather than the tax year, because a final return's
 * dates come off its own period end. FILING_DUE_DATES is still the fallback
 * for a row with no usable period, since it is the same calendar-year table
 * filingDueDates() generates.
 */
function dueState(f: Filing, extensionFiled: boolean): DueState {
  const taxYear = f.tax_year;
  if (!taxYear) return null;
  const periodEnd = periodEndOf(f);
  const dates = periodEnd ? filingDueDates(periodEnd) : FILING_DUE_DATES[Number(taxYear)];
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
  // "Submitted" said nothing a filer could act on, and next to it sat a second
  // green chip reading "Faxed to the IRS" driven by a separate read of
  // fax_transmissions. Two pills, one fact. A delivered fax now advances the
  // filing itself to `submitted`, so this label carries the meaning and the
  // chip is gone. If a second submission channel ever exists, this becomes a
  // generic word again and the channel goes in the card's detail line.
  submitted: 'Faxed to the IRS',
};

// Status badge colors via design tokens so they adapt to dark mode.
const STATUS_COLOR: Record<Filing['status'], { bg: string; fg: string }> = {
  draft:          { bg: 'var(--tf-offset)',           fg: 'var(--tf-text)' },
  in_progress:    { bg: 'var(--tf-banner-amber-bg)',  fg: 'var(--tf-banner-amber-text)' },
  payment_failed: { bg: 'var(--tf-banner-red-bg)',    fg: 'var(--tf-banner-red-text)' },
  paid:           { bg: 'rgba(var(--tf-accent-rgb), 0.12)', fg: 'var(--tf-accent)' },
  completed:      { bg: 'var(--tf-banner-green-bg)',  fg: 'var(--tf-banner-green-text)' },
  // Green, the same green the removed "Faxed to the IRS" chip used. This is the
  // strongest state a filing reaches, and it was wearing the same accent blue
  // as `paid`, which meant the two were only distinguishable by their text.
  submitted:      { bg: 'var(--tf-banner-green-bg)',  fg: 'var(--tf-banner-green-text)' },
};

/**
 * Has this filer bought the $9 IRS fax and not yet had it confirmed at Ogden?
 *
 * The deleted "Faxed to the IRS" chip only ever said something once delivery
 * had happened, which left the gap in between silent: a filer paid $9 for a fax
 * and the dashboard looked identical to one who had not. This fills that gap,
 * and unlike the old chip it needs NO second query. `include_irs_fax` is a
 * column on the filing row the page already has, and `submitted` is the row's
 * own status, so the pill cannot disagree with the pill beside it.
 *
 * Deliberately covers both "bought, never dispatched" and "dispatched, not yet
 * confirmed". From the filer's side those are the same fact, and the honest
 * word for both is pending: nothing is at the IRS until a provider says so. The
 * filing page, which does load the transmission, is where the difference is
 * spelled out, along with the send button and the failure reason.
 *
 * Unpaid filings are excluded. Before payment the fax is a checkbox in the
 * intake, not a thing owed, and "Fax pending" over a draft would promise a
 * transmission nobody has bought.
 *
 * `owed` is overridable so a multi-year job can pass its own answer: the flag
 * is written on whichever year the filer was looking at when they bought the
 * fax, and the transmission covers all of them.
 */
function faxPending(f: Filing, owed: boolean = f.include_irs_fax === true): boolean {
  return owed
    && f.status !== 'submitted'
    && (f.status === 'paid' || f.status === 'completed');
}

const FAX_PENDING_PILL = { bg: 'var(--tf-banner-amber-bg)', fg: 'var(--tf-banner-amber-text)' };

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
        // A pill never widens the page. "Extension due October 15, 2026" is
        // wider than the text column on a 390px phone; nowrap plus no cap let
        // it run under the action button and made the whole document scroll
        // sideways. It wraps rather than truncates: a half-shown deadline is
        // worse than a two-line pill.
        maxWidth: '100%',
        whiteSpace: 'normal',
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
  if (status === 'paid' || status === 'completed' || status === 'submitted') return 'Download forms';
  return 'View';
}

/**
 * Route draft/in_progress → Intake wizard (?filing_id=); paid/completed → FilingWizard
 *
 * Carries `step` so "Continue" reopens where the filer left off. Without it the
 * intake fell back to step 1 and someone who had reached Transactions was put
 * back at their LLC's name, on a card that had just told them they were on
 * step 4. `current_step` is the same number the card shows.
 */
function filingPath(f: Filing): string {
  // `submitted` belongs here too. It was falling through to the intake branch,
  // so the moment a delivered fax could produce that status, the card's button
  // would have thrown a filer whose return is already at Ogden back into the
  // wizard at step 1.
  if (f.status === 'paid' || f.status === 'completed' || f.status === 'submitted') return `/filing/${f.id}`;
  const step = Number(f.current_step);
  const resumeAt = step >= 1 && step <= 5 ? step : 1;
  return `/intake?filing_id=${f.id}&step=${resumeAt}`;
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
  const [companies, setCompanies] = useState<FilingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Turned off the first time a write proves the column is missing, so the
  // button disappears instead of failing again on the next company.
  const [canDismissYears, setCanDismissYears] = useState(true);

  /**
   * Normalised EIN → the latest tax year this user has PAID for.
   *
   * The saved-companies list used to read `company_profiles.last_filed_tax_year`
   * and every card said "Not filed yet", including over companies with paid,
   * completed and faxed returns. The column is written by one code path only,
   * the switch into a multi-year catch-up, and that path passes no tax year, so
   * it was null on every row. Derive it from the filings instead, which is the
   * only place that knows.
   *
   * PAYMENT is the bar, not the existence of a draft, which keeps this
   * consistent with the intake's duplicate gate. EINs are normalised on both
   * sides because `filings.ein` is stored formatted ("88-7776665") while
   * `company_profiles.ein` is digits only.
   */
  const lastFiledByEin = filings.reduce<Record<string, number>>((acc, f) => {
    if (!f.paid_at) return acc;
    const key = normalizeEin(f.ein);
    const year = Number(f.tax_year);
    if (!key || !year) return acc;
    if (!acc[key] || year > acc[key]) acc[key] = year;
    return acc;
  }, {});

  useEffect(() => {
    if (authLoading) return;

    if (!effectiveUserId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);

      // Both at once. The saved companies are a separate table and neither
      // read depends on the other, so serialising them would only make the
      // dashboard slower to appear.
      // This used to fetch delivered fax_transmissions as a third read, purely
      // to decide a "Faxed to the IRS" chip. It is gone: a delivered fax now
      // advances filings.status to `submitted` at the moment of delivery, so
      // the fact travels on the filing row this query already returns, and the
      // dashboard can no longer disagree with the filing page about it.
      const [filingsRes, companiesRes] = await Promise.all([
        supabase
          .from('filings')
          .select('*')
          .eq('user_id', effectiveUserId)
          .order('updated_at', { ascending: false }),
        listCompanies(effectiveUserId),
      ]);

      if (cancelled) return;

      if (filingsRes.error) {
        setError(filingsRes.error.message);
      } else {
        setFilings((filingsRes.data ?? []) as Filing[]);
      }
      // listCompanies returns [] rather than throwing, so a failure here shows
      // an empty companies section rather than blocking the filings list, which
      // is the part of this page the filer actually came for.
      setCompanies(companiesRes);

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
    // `.select()` on the delete so we get the rows back and can tell "deleted
    // nothing" apart from "deleted it". Without it a delete that RLS filtered
    // to zero rows returned no error, this code took that for success, and the
    // card disappeared from local state only to return on the next refresh.
    // That is exactly what happened while `filings` had no DELETE policy.
    const { data: removed, error } = await supabase
      .from('filings').delete().eq('id', f.id).select('id');
    if (error) {
      setBusy(null);
      setError(error.message);
      return;
    }
    if (!removed || removed.length === 0) {
      setBusy(null);
      setError('That filing could not be deleted. Refresh and try again, or contact support@filetax.co if it persists.');
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
    const { data: removed, error } = await supabase
      .from('filings').delete().eq('job_id', jobId).select('id');
    if (error) {
      setBusy(null);
      setError(error.message);
      return;
    }
    // Same reasoning as deleteFiling: zero rows back is a failure, not a
    // success. Here it matters more, because dropping the job row after a
    // no-op delete would orphan every year in the catch-up.
    if (!removed || removed.length === 0) {
      setBusy(null);
      setError('That catch-up could not be deleted. Refresh and try again, or contact support@filetax.co if it persists.');
      return;
    }
    await supabase.from('filing_jobs').delete().eq('id', jobId);
    setFilings((prev) => prev.filter((x) => x.job_id !== jobId));
    setBusy(null);
  }

  /**
   * Tell us these years are filed somewhere else, so the prompt stops.
   *
   * Stored PER YEAR even though the button dismisses the whole visible set. The
   * grain matters later, not now: a filer who dismisses 2021 to 2024 today and
   * comes back next January still gets asked about 2025, because only the years
   * actually dismissed are remembered. A single "hide this company" flag would
   * silence that too.
   */
  async function dismissYears(ein: string | null, years: number[]) {
    const key = normalizeEin(ein);
    if (!key || busy) return;
    setBusy(`dismiss-${key}`);
    setError('');
    const company = companies.find((c) => normalizeEin(c.ein) === key);
    const existing = company?.years_filed_elsewhere ?? [];
    const next = [...existing, ...years.map(String)];
    const res = await setYearsFiledElsewhere(effectiveUserId, key, next);
    setBusy(null);
    if (res === 'unsupported') {
      // The migration has not been applied to this database. Say what is true
      // rather than "something went wrong", because nothing did.
      setError('Marking years as filed elsewhere is not available on this account yet. Contact support@filetax.co.');
      setCanDismissYears(false);
      return;
    }
    if (res === 'error') {
      setError('That could not be saved. Refresh and try again, or contact support@filetax.co.');
      return;
    }
    setCompanies((prev) => prev.map((c) => (
      normalizeEin(c.ein) === key ? { ...c, years_filed_elsewhere: next.map(String) } : c
    )));
  }

  // Computed once and read by BOTH the summary strip and the company sections.
  // The strip's "Years not filed here" is the sum of what the prompts show, so
  // deriving it separately would let the tile say six over a page showing two.
  const companyGroups = groupByCompany(filings);

  /**
   * The years this company has no filing for, or [] when we cannot say.
   *
   * Empty whenever something is unknown rather than guessed: no EIN to key on,
   * no saved profile, no formation date, or no gap. The formation date is what
   * silences it most often, and rightly, since without one the range is a guess
   * spanning years of returns the filer may never have owed.
   */
  function missingYearsFor(group: CompanyGroup): number[] {
    const key = normalizeEin(group.ein);
    if (!key) return [];
    const profile = companies.find((c) => normalizeEin(c.ein) === key);
    if (!profile) return [];
    // The profile's date first; a filing's own date is the fallback, because a
    // company recovered by the migration's backfill carries whatever its most
    // recent filing had.
    const formation = profile.date_of_incorporation
      ?? group.filings.find((f) => f.date_of_incorporation)?.date_of_incorporation
      ?? null;
    // A company that has filed a final return is closed, and a closed LLC owes
    // nothing for any later year. Taken only from a filing marked final_return,
    // not from a stray date_of_closure: a dissolution date can sit on an
    // earlier year's row in a catch-up job without that year being the final
    // one. The earliest such date wins, so a wrongly re-opened later year
    // cannot push the prompt back out past the closure.
    const dissolution = group.filings
      .filter((f) => f.final_return === true && f.date_of_closure)
      .map((f) => f.date_of_closure as string)
      .sort()[0] ?? null;
    return missingTaxYears({
      formationDate: formation,
      filedYears: group.filings.map((f) => f.tax_year),
      dismissedYears: profile.years_filed_elsewhere ?? [],
      dissolutionDate: dissolution,
    });
  }

  /** The prompt for one company group, or null when there is no gap. */
  function catchUpFor(group: CompanyGroup) {
    const years = missingYearsFor(group);
    if (years.length === 0) return null;
    const key = normalizeEin(group.ein);
    return (
      <CatchUpPrompt
        companyName={group.name}
        ein={group.ein}
        years={years}
        canDismiss={canDismissYears}
        dismissing={busy === `dismiss-${key}`}
        onFile={() => navigate('/catch-up')}
        onDismiss={(subset) => dismissYears(group.ein, subset ?? years)}
      />
    );
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
              //
              // Each date also carries the FILING it came from, so the tile can
              // say whose deadline it is. Everything below this strip is grouped
              // by company, so an unattributed date was the only thing left on
              // the page whose scope you could not tell by looking: "Oldest
              // missed deadline, October 15 2021" over two LLCs names neither.
              const pending = filings
                .filter((f) => BUCKET_OF[f.status] !== 'done')
                .map((f) => ({ f, d: dueState(f, hasExtension(f)) }))
                .filter((x): x is { f: Filing; d: NonNullable<DueState> } => !!x.d)
                .sort((a, b) => a.d.due.localeCompare(b.d.due));
              const overdue = pending.filter((x) => x.d.tone === 'late')[0];
              const upcoming = pending.filter((x) => x.d.tone !== 'late')[0];
              // Attribution, not scope. These tiles answer "which is worst
              // across the account", and that is ONE filing, so it has one
              // owner. Shown only when there is more than one company, since a
              // name repeated down a page with one LLC on it is noise.
              const ownerOf = (f: Filing | undefined) => {
                // companyGroups, not the saved-profile list: this has to match
                // the condition the sections below use to show their headings,
                // or the strip names companies on a page that does not.
                if (!f || companyGroups.length < 2) return undefined;
                const name = f.llc_name?.trim();
                return name || undefined;
              };
              // The sum of what the catch-up prompts below are showing, so the
              // strip and the sections cannot disagree. Dismissed years are
              // already out of missingTaxYears, so dismissing a company's years
              // drops this count too.
              const yearsNotFiled = companyGroups
                .reduce((n, g) => n + missingYearsFor(g).length, 0);
              const stat = (label: string, value: string, tone?: 'late' | 'warn', who?: string) => (
                <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.625rem', padding: '0.875rem 1rem' }}>
                  <div style={{ fontSize: '1.375rem', fontWeight: 700, color: tone === 'late' ? 'var(--tf-banner-red-text)' : tone === 'warn' ? 'var(--tf-banner-amber-text)' : 'var(--tf-text)' }}>{value}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--tf-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.15rem' }}>
                    {label}
                    {/* On its own line rather than beside the value. The longest
                        of these, "Extension due October 15, 2026", already wraps
                        on a 390px phone, and that pill is what caused the
                        document-level horizontal overflow once before. */}
                    {who && <><br /><span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 'normal' }}>{who}</span></>}
                  </div>
                </div>
              );
              return (
                <>
                  {counts.action > 0 && stat('Need attention', String(counts.action), 'late')}
                  {counts.ready > 0 && stat('Ready to download', String(counts.ready))}
                  {counts.in_progress > 0 && stat('In progress', String(counts.in_progress))}
                  {stat('Total filings', String(filings.length))}
                  {yearsNotFiled > 0 && stat('Years not filed here', String(yearsNotFiled), 'late')}
                  {overdue && stat('Oldest missed deadline', humanDate(overdue.d.due), 'late', ownerOf(overdue.f))}
                  {upcoming && stat('Next deadline', humanDate(upcoming.d.due), upcoming.d.tone === 'warn' ? 'warn' : undefined, ownerOf(upcoming.f))}
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
              // One company is the common case, and a heading naming the only
              // LLC on the page is noise. The entity grouping appears only when
              // there is something to tell apart.
              if (companyGroups.length < 2) {
                return (
                  <>
                    {/* The prompt belongs to a company, not to the grouping, so
                        it shows for a single-company filer too. That is in fact
                        the commonest case for it: one 2025 filing and an LLC
                        formed years earlier. */}
                    {companyGroups[0] && catchUpFor(companyGroups[0])}
                    <FilingGroups
                      filings={filings}
                      onDeleteJob={deleteJob}
                      onDeleteFiling={deleteFiling}
                      busy={busy}
                    />
                  </>
                );
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                  {companyGroups.map((c) => (
                    <div key={c.key}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem', paddingBottom: '0.6rem', borderBottom: '1px solid var(--tf-border)' }}>
                        <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--tf-text)' }}>{c.name}</h3>
                        {c.ein && (
                          <span style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 500 }}>EIN {c.ein}</span>
                        )}
                        <span style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, marginLeft: 'auto' }}>
                          {c.filings.length} filing{c.filings.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      {catchUpFor(c)}
                      <FilingGroups
                        filings={c.filings}
                        onDeleteJob={deleteJob}
                        onDeleteFiling={deleteFiling}
                        busy={busy}
                      />
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

      {/* ── Saved companies ─────────────────────────────────────────────── */}
      {!loading && companies.length > 0 && (
        <SavedCompanies
          companies={companies}
          userId={effectiveUserId}
          onChange={setCompanies}
          canUndoDismissed={canDismissYears}
          lastFiledByEin={lastFiledByEin}
        />
      )}

      <section style={{ background: 'var(--tf-bg)', padding: '2rem 1rem 4rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>
            Need help? Email us at{' '}
            <a href="mailto:support@filetax.co" style={{ color: 'var(--tf-accent)', fontWeight: 600, textDecoration: 'none' }}>support@filetax.co</a>. We respond within 1 business day.
          </p>
        </div>
      </section>
    </>
  );
}

// ── Catch-up prompt ─────────────────────────────────────────────────────────
/**
 * "Have you filed 2021 to 2024 for this company?"
 *
 * Shown per company, above its filings, when we hold a formation date and there
 * are years between it and now with no filing here.
 *
 * WORDED AS A QUESTION, ON PURPOSE. We know one thing, that we have no filing
 * for those years, and that is a fact about our own records. Whether a given
 * year REQUIRES a return turns on whether the company had a reportable
 * transaction that year, which nothing on this page knows, and §4's claims
 * rules do not let us assert it. "You have not filed these with us" is true;
 * "you need to file these" is a claim we cannot support.
 *
 * NOT the amber deadline colour. Amber on this page means a deadline is close
 * or missed, and it is used by the due-date pills a few pixels below. An offer
 * to file more years in that colour reads as something being wrong with a
 * filing already made. This uses the accent border and tint the multi-year job
 * card already uses, which is the dashboard's existing "notable, not alarming".
 */
function CatchUpPrompt({
  companyName,
  ein,
  years,
  onFile,
  onDismiss,
  dismissing,
  canDismiss,
}: {
  companyName: string;
  ein: string | null;
  years: number[];
  onFile: () => void;
  /** Called with the years to forget, or undefined to forget all shown. */
  onDismiss: (subset?: number[]) => void;
  dismissing: boolean;
  canDismiss: boolean;
}) {
  const many = years.length > 1;
  const cost = years.length * PRICE_PER_YEAR;
  return (
    <div
      style={{
        background: 'rgba(var(--tf-accent-rgb), 0.06)',
        border: '1px solid var(--tf-accent)',
        borderRadius: '0.75rem',
        padding: '1.125rem 1.375rem',
        marginBottom: '1rem',
      }}
    >
      <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tf-text)', marginBottom: '0.35rem' }}>
        Have you filed {describeYears(years)} for {companyName}?
      </p>
      <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.6 }}>
        {/* States what we know, not what they owe. See the note above. */}
        We have no {many ? 'filings' : 'filing'} here for {many ? 'these years' : 'this year'}.
        If {many ? 'they have' : 'it has'} already been filed elsewhere, say so and we will stop asking.
      </p>
      {/* Each year is separately dismissible, because the real case is partial:
          a filer who did 2023 and 2024 with an accountant before they found us
          and genuinely has not filed 2021 or 2022. One button for all four
          would force them to either over-claim or keep being asked.
          The × is always visible rather than on hover: a control that only
          exists under a cursor does not exist on a phone at all. */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
        {years.map((y) => (
          <span
            key={y}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: 'var(--tf-surface)',
              border: '1px solid var(--tf-border)',
              borderRadius: '0.375rem',
              padding: canDismiss ? '0.1rem 0.25rem 0.1rem 0.6rem' : '0.2rem 0.6rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--tf-text)',
            }}
          >
            {y}
            {canDismiss && (
              <button
                type="button"
                onClick={() => onDismiss([y])}
                disabled={dismissing}
                title={`Mark ${y} as already filed elsewhere`}
                aria-label={`Mark ${y} as already filed elsewhere`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  padding: 0,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '0.25rem',
                  color: 'var(--tf-muted)',
                  cursor: dismissing ? 'not-allowed' : 'pointer',
                  opacity: dismissing ? 0.4 : 1,
                  fontSize: '0.9rem',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {many && (
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.6, marginBottom: '0.875rem' }}>
          {/* The letter is charged once however many years, which is the whole
              argument for filing them together and is worth stating here rather
              than making the filer find it on /pricing. */}
          Filing {years.length} years together is ${cost}, plus one ${PRICE_RCL} reasonable cause
          letter that covers all of them however many you file.
        </p>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onFile}
          style={{ background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', border: 'none', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1.1rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '40px' }}
        >
          {many ? 'File these years' : `File ${years[0]}`}
        </button>
        {/* Hidden, not disabled, when the column is missing: a dismissal that
            looks like it worked and returns on reload is worse than none. */}
        {canDismiss && many && (
          <button type="button" onClick={() => onDismiss()} disabled={dismissing} style={linkBtnStyle}>
            {dismissing ? 'Saving…' : 'I already filed all of these'}
          </button>
        )}
      </div>
      {ein && (
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.75rem', fontWeight: 400, marginTop: '0.75rem' }}>
          Based on the formation date saved for EIN {formatEin(ein)}.
        </p>
      )}
    </div>
  );
}

// ── Saved companies ─────────────────────────────────────────────────────────
/**
 * Manage the details we offer to prefill, one entry per company.
 *
 * There was no surface for this at all. `company_profiles` rows are created as
 * a side effect of submitting a filing, and until now nothing could rename one,
 * correct one, or remove one. A filer who mistyped an EIN got a phantom company
 * in the intake picker permanently, sitting next to the real one and differing
 * by a digit, which is precisely the confusion the per-company rewrite existed
 * to end.
 *
 * THE ONE THING THIS SCREEN MUST KEEP SAYING: editing here changes what the next
 * filing is offered and nothing else. It does not amend a return, and it cannot,
 * because `filings_freeze_when_paid` locks the EIN at payment and an already
 * filed wrong EIN is an amended return, which is deferred. A filer correcting a
 * typo will otherwise assume they have fixed the filing it went onto. The copy
 * says so twice, once in the section subtitle and once on the delete confirm,
 * because those are the two moments someone believes they are fixing a return.
 */
function SavedCompanies({
  companies,
  userId,
  onChange,
  canUndoDismissed,
  lastFiledByEin,
}: {
  companies: FilingProfile[];
  userId: string | null;
  onChange: (next: FilingProfile[]) => void;
  canUndoDismissed: boolean;
  /** Normalised EIN → the latest tax year this user has PAID for. */
  lastFiledByEin: Record<string, number>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftEin, setDraftEin] = useState('');
  const [rowError, setRowError] = useState('');
  const [busy, setBusy] = useState(false);

  const startEdit = (c: FilingProfile) => {
    setEditing(c.ein ?? null);
    setDraftName(c.llc_name ?? '');
    setDraftEin(formatEin(c.ein));
    setRowError('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setRowError('');
  };

  async function save(original: FilingProfile) {
    if (busy) return;
    setBusy(true);
    setRowError('');
    const res = await updateCompany(userId, original.ein, {
      llc_name: draftName,
      ein: draftEin,
    });
    setBusy(false);
    if (!res.ok) {
      setRowError(res.message);
      return;
    }
    // Patch in place rather than refetching: the row we just wrote is the only
    // one that changed, and a refetch would reorder the list under the filer by
    // updated_at, moving the entry they were just looking at.
    onChange(companies.map((c) => (
      c.ein === original.ein
        ? { ...c, ein: res.ein, llc_name: draftName.trim() || null }
        : c
    )));
    setEditing(null);
  }

  /**
   * Undo "I already filed these".
   *
   * Lives here rather than on the prompt, because once a year is dismissed the
   * prompt is gone and there is nothing left to click. Without this the only
   * route back was contacting support, which makes a one-click action on the
   * dashboard effectively irreversible.
   *
   * Clears the whole list rather than one year: this is an undo, and the prompt
   * it restores is itself per-year dismissible again.
   */
  async function undoDismissed(c: FilingProfile) {
    if (busy) return;
    setBusy(true);
    setRowError('');
    const res = await setYearsFiledElsewhere(userId, c.ein, []);
    setBusy(false);
    if (res !== 'ok') {
      setRowError('That could not be undone. Refresh and try again, or contact support@filetax.co.');
      return;
    }
    onChange(companies.map((x) => (
      x.ein === c.ein ? { ...x, years_filed_elsewhere: [] } : x
    )));
  }

  async function remove(c: FilingProfile) {
    if (busy) return;
    const label = c.llc_name?.trim() || `EIN ${formatEin(c.ein)}`;
    if (!window.confirm(
      `Forget the saved details for ${label}?\n\n`
      + 'This only removes what we offer to fill in when you start a new filing. '
      + 'Every filing you have already made is kept exactly as it is.',
    )) return;
    setBusy(true);
    setRowError('');
    const ok = await deleteCompany(userId, c.ein);
    setBusy(false);
    if (!ok) {
      setRowError('Those details could not be removed. Refresh and try again, or contact support@filetax.co.');
      return;
    }
    onChange(companies.filter((x) => x.ein !== c.ein));
  }

  return (
    <section style={{ background: 'var(--tf-bg)', padding: '2.5rem 1rem 1rem' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.35rem' }}>Your saved companies</h2>
        <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.25rem', maxWidth: '760px' }}>
          These are the details we offer to fill in when you start a new filing. Changing them here
          affects future filings only. Filings you have already made are never changed.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {companies.map((c) => {
            const isEditing = editing === c.ein;
            return (
              <div
                key={c.ein ?? c.llc_name ?? Math.random()}
                style={{
                  background: 'var(--tf-surface)',
                  border: '1px solid var(--tf-border)',
                  borderRadius: '0.75rem',
                  padding: '1.125rem 1.5rem',
                }}
              >
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <label style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <span style={editLabelStyle}>LLC name</span>
                        <input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          style={editInputStyle}
                          placeholder="Acme Holdings LLC"
                        />
                      </label>
                      <label style={{ flex: '0 1 200px', minWidth: 0 }}>
                        <span style={editLabelStyle}>EIN</span>
                        <input
                          value={draftEin}
                          onChange={(e) => setDraftEin(e.target.value)}
                          style={editInputStyle}
                          placeholder="12-3456789"
                          inputMode="numeric"
                        />
                      </label>
                    </div>
                    {/* Said here as well as in the section subtitle: this is the
                        moment someone believes they are correcting a return. */}
                    <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.55 }}>
                      Correcting an EIN here does not change a filing you have already made. If a
                      return went to the IRS with the wrong EIN, email{' '}
                      <a href="mailto:support@filetax.co" style={{ color: 'var(--tf-accent)', fontWeight: 600, textDecoration: 'none' }}>support@filetax.co</a>.
                    </p>
                    {rowError && (
                      <p style={{ color: 'var(--tf-error-text)', fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.55 }}>{rowError}</p>
                    )}
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => save(c)}
                        disabled={busy}
                        style={{ background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', border: 'none', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1.1rem', borderRadius: '0.5rem', cursor: busy ? 'not-allowed' : 'pointer', minHeight: '40px', opacity: busy ? 0.7 : 1 }}
                      >
                        {busy ? 'Saving…' : 'Save changes'}
                      </button>
                      <button type="button" onClick={cancelEdit} disabled={busy} style={linkBtnStyle}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                      <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tf-text)' }}>
                        {c.llc_name?.trim() || 'Unnamed company'}
                      </p>
                      <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, marginTop: '0.15rem' }}>
                        EIN {formatEin(c.ein)}
                        {/* Derived from the filings themselves, NOT from
                            `company_profiles.last_filed_tax_year`. That column
                            is written by exactly one code path, the switch to a
                            multi-year catch-up, which does not pass a tax year,
                            so it was null for every company on this account and
                            every card read "Not filed yet" over companies with
                            paid, completed, faxed returns. The filings table is
                            the only thing that knows, and payment is what makes
                            a year filed, which is the same bar the intake's
                            duplicate gate uses. */}
                        {lastFiledByEin[normalizeEin(c.ein) ?? ''] != null
                          ? ` · Last filed ${lastFiledByEin[normalizeEin(c.ein) ?? '']}`
                          : ' · Not filed yet'}
                      </p>
                      {/* Says what the filer TOLD US, not that a return exists.
                          This is the only place a dismissed year is visible at
                          all, since dismissing removes the prompt that named it. */}
                      {(c.years_filed_elsewhere?.length ?? 0) > 0 && (
                        <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, marginTop: '0.35rem' }}>
                          You told us {describeYears((c.years_filed_elsewhere ?? []).map(Number).filter(Number.isFinite))} {(c.years_filed_elsewhere?.length ?? 0) > 1 ? 'were' : 'was'} filed elsewhere.
                          {canUndoDismissed && (
                            <>
                              {' '}
                              <button type="button" onClick={() => undoDismissed(c)} disabled={busy} style={{ ...linkBtnStyle, fontSize: '0.8125rem' }}>
                                Undo
                              </button>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        style={{ background: 'transparent', color: 'var(--tf-text)', border: '1px solid var(--tf-border)', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1.1rem', borderRadius: '0.5rem', cursor: 'pointer', minHeight: '40px' }}
                      >
                        Edit
                      </button>
                      <DeleteCardButton
                        onClick={() => remove(c)}
                        busy={busy}
                        title={`Forget the saved details for ${c.llc_name?.trim() || `EIN ${formatEin(c.ein)}`}`}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* An error from a delete has no open edit form to sit inside. */}
        {rowError && editing === null && (
          <p style={{ color: 'var(--tf-error-text)', fontSize: '0.8125rem', fontWeight: 500, marginTop: '0.75rem' }}>{rowError}</p>
        )}
      </div>
    </section>
  );
}

const editLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--tf-muted)',
  marginBottom: '0.3rem',
};

const editInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--tf-input-bg)',
  color: 'var(--tf-text)',
  border: '1px solid var(--tf-border)',
  borderRadius: '0.5rem',
  padding: '0.55rem 0.75rem',
  fontSize: '0.9375rem',
  fontWeight: 500,
  minHeight: '42px',
};

// ── Grouping by entity ───────────────────────────────────────────────────────
/**
 * Split a user's filings by the company they are for.
 *
 * Saved details are per company (`company_profiles`, keyed on user_id + EIN),
 * but the dashboard listed every filing flat, so a filer with two LLCs saw them
 * interleaved with nothing but the LLC name in each card to tell them apart.
 * That is the same confusion that let the old per-user profile file a return
 * against the wrong EIN, one screen earlier.
 *
 * Keyed on the EIN, digits only, for the same reason the table is: "99-9999999"
 * and "999999999" are one company. A filing with no EIN yet is a draft that has
 * not reached step 2; it falls back to its LLC name, and failing that lands in
 * one "Not identified yet" group rather than becoming a group of its own per
 * empty draft.
 *
 * Company order follows the filings, which arrive newest-updated first, so the
 * company the filer last touched is at the top. The unidentified group is
 * always last: it is by definition the least informative heading on the page.
 */
type CompanyGroup = { key: string; name: string; ein: string | null; filings: Filing[] };

const UNIDENTIFIED = '__unidentified__';

function groupByCompany(filings: Filing[]): CompanyGroup[] {
  const groups = new Map<string, CompanyGroup>();
  for (const f of filings) {
    const ein = normalizeEin(f.ein);
    const name = f.llc_name?.trim() ?? '';
    const key = ein ?? (name ? `name:${name.toLowerCase()}` : UNIDENTIFIED);
    const existing = groups.get(key);
    if (existing) {
      existing.filings.push(f);
      // The newest filing wins the display EIN and name, but an older one still
      // fills a blank: a fresh draft carries neither yet.
      if (!existing.name && name) existing.name = name;
      if (!existing.ein && f.ein) existing.ein = f.ein.trim();
    } else {
      groups.set(key, {
        key,
        name: name || (key === UNIDENTIFIED ? 'Not identified yet' : ''),
        ein: f.ein?.trim() || null,
        filings: [f],
      });
    }
  }
  const out = [...groups.values()];
  for (const g of out) if (!g.name) g.name = g.ein ? `EIN ${g.ein}` : 'Not identified yet';
  return out.sort((a, b) =>
    (a.key === UNIDENTIFIED ? 1 : 0) - (b.key === UNIDENTIFIED ? 1 : 0));
}

/**
 * The filings of one company (or of everything, when there is only one),
 * as multi-year job cards followed by the status buckets.
 *
 * Extracted so the flat one-company layout and each per-company section are
 * literally the same code: the alternative was two copies of the bucket
 * rendering that would drift the first time a status was added.
 */
function FilingGroups({
  filings,
  onDeleteJob,
  onDeleteFiling,
  busy,
}: {
  filings: Filing[];
  onDeleteJob: (filings: Filing[]) => void;
  onDeleteFiling: (f: Filing) => void;
  busy: string | null;
}) {
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
          onDeleteJob={onDeleteJob}
          onDeleteYear={onDeleteFiling}
          busy={busy}
        />
      ))}

      {BUCKET_ORDER.filter((b) => (byBucket.get(b)?.length ?? 0) > 0).map((b) => (
        <div key={b}>
          <h4 style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--tf-muted)', marginBottom: '0.75rem' }}>
            {BUCKET_TITLE[b]}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {byBucket.get(b)!.map((f) => (
              <FilingCard
                key={f.id}
                f={f}
                onDelete={onDeleteFiling}
                deleting={busy === `del-${f.id}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
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
    ? dueState(f, hasExtension(f))
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
      {/* 1 1 220px, not flex: 1. With flex: 1 the text column shrank to nothing
          rather than letting the card wrap, so on a phone the status and due
          pills were squeezed under the action button instead of the button
          dropping to its own line. */}
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
          <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--tf-text)' }}>
            {headline}{f.tax_year ? <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}> · {f.tax_year}</span> : ''}
          </p>
          <Pill bg={c.bg} fg={c.fg}>{STATUS_LABEL[f.status]}</Pill>
          {faxPending(f) && (
            <Pill bg={FAX_PENDING_PILL.bg} fg={FAX_PENDING_PILL.fg}>Fax pending</Pill>
          )}
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
  // `submitted` counts as ready. Without it a fully faxed catch-up read as not
  // finished: no "all years ready" line, and "Add or remove years" still
  // offered on a job whose package is already at Ogden.
  const allReady = sorted.every(
    (f) => f.status === 'paid' || f.status === 'completed' || f.status === 'submitted',
  );
  // Continue → the EARLIEST year still needing work, so the catch-up is filed in
  // chronological order. When every year is done, the action points at the job's
  // review/download page (most-recent filing).
  const target = chronological.find((f) => f.status === 'draft' || f.status === 'in_progress') ?? sorted[0];

  // A job with any paid year cannot be deleted; the button is hidden rather than
  // shown-and-refused, so the only delete a filer can see is one that will work.
  // Job-scoped, because the $9 fax is: one transmission covers every year in
  // the catch-up, and `include_irs_fax` is only written on the year the filer
  // happened to be looking at when they bought it. Per-year here would have put
  // the pill on one row of a job whose whole envelope is waiting to go.
  const jobFaxOwed = sorted.some((f) => f.include_irs_fax === true);

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
                  {faxPending(f, jobFaxOwed) && (
                    <Pill bg={FAX_PENDING_PILL.bg} fg={FAX_PENDING_PILL.fg}>Fax pending</Pill>
                  )}
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
