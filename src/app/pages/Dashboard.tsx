import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase, type Filing, type ServiceType } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

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

const STATUS_COLOR: Record<Filing['status'], { bg: string; fg: string }> = {
  draft: { bg: '#E2E8F0', fg: '#0F172A' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  payment_failed: { bg: '#FEE2E2', fg: '#B31D1D' },
  paid: { bg: '#DBEAFE', fg: '#1E40AF' },
  completed: { bg: '#D1FAE5', fg: '#065F46' },
  submitted: { bg: '#DBEAFE', fg: '#1E40AF' },
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

function deriveTaxYear(years: string | null | undefined): string | null {
  const now = new Date().getUTCFullYear();
  if (!years || years === 'current') return String(now - 1);
  if (years === '1-prior') return String(now - 2);
  if (years === '2-prior') return String(now - 3);
  return null;
}

function actionLabel(status: Filing['status']): string {
  if (status === 'draft' || status === 'in_progress') return 'Continue';
  if (status === 'payment_failed') return 'Retry payment';
  if (status === 'paid' || status === 'completed') return 'Download forms';
  return 'View';
}

/** Route draft/in_progress → Intake wizard; paid/completed → FilingWizard (download step) */
function filingPath(f: Filing): string {
  if (f.status === 'paid' || f.status === 'completed') return `/filing/${f.id}`;
  return `/intake/${f.id}`;
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

    navigate(`/intake/${data.id}`);
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
        include_rcl: serviceType === 'past_year',
      })
      .select('id')
      .single();
    setBusy(null);
    if (error || !data) {
      setError(error?.message ?? 'Could not create filing.');
      return;
    }
    navigate(`/intake/${data.id}`);
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
            <span style={{ display: 'inline-block', background: '#059669', color: 'white', borderRadius: '9999px', padding: '0.2rem 0.875rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.875rem' }}>
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
            <div style={{ border: '2px solid #0284C7', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', background: 'rgba(2,132,199,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ display: 'inline-block', background: '#0284C7', color: 'white', borderRadius: '9999px', padding: '0.2rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
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
                style={{ background: '#0284C7', color: 'white', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: busy === 'eligibility' ? 0.7 : 1 }}
              >
                {busy === 'eligibility' ? 'Setting up...' : 'Continue your filing'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section style={{ background: 'var(--tf-bg)', padding: '1rem 1rem 2rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Your filings</h2>
          {error && <p style={{ color: '#DC2626', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>}
          {loading ? (
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 500 }}>Loading...</p>
          ) : filings.length === 0 ? (
            <div style={{ background: 'var(--tf-surface)', border: '1px dashed var(--tf-border)', borderRadius: '0.75rem', padding: '2rem', textAlign: 'center' }}>
              <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>No filings yet.</p>
              <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>Start one below.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filings.map((f) => {
                const c = STATUS_COLOR[f.status];
                return (
                  <div key={f.id} style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <p style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--tf-text)' }}>
                          {SERVICE_LABEL[f.service_type]}{f.tax_year ? ` (${f.tax_year})` : ''}
                        </p>
                        <span style={{ display: 'inline-block', background: c.bg, color: c.fg, borderRadius: '9999px', padding: '0.125rem 0.625rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.03em' }}>
                          {STATUS_LABEL[f.status]}
                        </span>
                      </div>
                      <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400 }}>
                        Updated {formatDate(f.updated_at)}
                        {(f.status === 'draft' || f.status === 'in_progress') ? ` (Step ${f.current_step} of 4)` : ''}
                      </p>
                    </div>
                    <Link
                      to={filingPath(f)}
                      style={{ background: '#0284C7', color: 'white', fontWeight: 600, fontSize: '0.875rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '40px', display: 'inline-flex', alignItems: 'center' }}
                    >
                      {actionLabel(f.status)}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section style={{ background: 'var(--tf-surface)', padding: '3rem 1rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Start a new filing</h2>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400, marginBottom: '1.5rem' }}>Pick a service to begin.</p>
          <div className="dash-services" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
            <div style={cardStyle}>
              <p style={tagStyle}>Most Popular</p>
              <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>Form 5472 + Pro Forma 1120</h3>
              <p style={priceStyle}>$150</p>
              <p style={mutedStyle}>One-time filing. No ongoing fees.</p>
              <button onClick={() => startFiling('current_year')} disabled={busy !== null} style={primaryBtn(busy === 'current_year')}>
                {busy === 'current_year' ? 'Creating...' : 'Start filing'}
              </button>
            </div>
            <div style={cardStyle}>
              <p style={tagStyle}>For Late Filers</p>
              <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>Past Year Filing + RCL</h3>
              <p style={priceStyle}>from $350</p>
              <p style={mutedStyle}>Includes Reasonable Cause Letter.</p>
              <button onClick={() => startFiling('past_year')} disabled={busy !== null} style={primaryBtn(busy === 'past_year')}>
                {busy === 'past_year' ? 'Creating...' : 'Start filing'}
              </button>
            </div>
            <div style={cardStyle}>
              <p style={tagStyle}>Add-on Service</p>
              <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>LLC Tax Classification Change</h3>
              <p style={priceStyle}>$50</p>
              <p style={mutedStyle}>One-time filing. No ongoing fees.</p>
              <button onClick={() => startFiling('tax_classification')} disabled={busy !== null} style={primaryBtn(busy === 'tax_classification')}>
                {busy === 'tax_classification' ? 'Creating...' : 'Start filing'}
              </button>
            </div>
          </div>
        </div>
        <style>{`@media (max-width: 800px) { .dash-services { grid-template-columns: 1fr !important; } }`}</style>
      </section>

      <section style={{ background: 'var(--tf-bg)', padding: '2rem 1rem 4rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', fontWeight: 400 }}>
            Need help? Email us at{' '}
            <a href="mailto:hello@filetax.co" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>hello@filetax.co</a>. We respond within 1 business day.
          </p>
        </div>
      </section>
    </>
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
const priceStyle: React.CSSProperties = { color: '#0284C7', fontWeight: 700, fontSize: '1.5rem', marginBottom: '0.25rem' };
const mutedStyle: React.CSSProperties = { color: 'var(--tf-muted)', fontSize: '0.8125rem', fontWeight: 400, marginBottom: '1.25rem', flex: 1 };

function primaryBtn(busy: boolean): React.CSSProperties {
  return { background: '#0284C7', color: 'white', fontWeight: 600, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', minHeight: '44px', opacity: busy ? 0.7 : 1 };
}
