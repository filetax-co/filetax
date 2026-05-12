import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { supabase, Filing } from '../../lib/supabase';
import { useAuth } from '../../lib/useAuth';
import { usePageMeta } from '../hooks/usePageMeta';

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  draft:          { label: 'Draft',       color: '#92400E', bg: '#FEF3C7' },
  in_progress:    { label: 'In Progress', color: '#1D4ED8', bg: '#DBEAFE' },
  payment_failed: { label: 'Pmt Failed',  color: '#991B1B', bg: '#FEE2E2' },
  paid:           { label: 'Paid',        color: '#065F46', bg: '#D1FAE5' },
  completed:      { label: 'Completed',   color: '#065F46', bg: '#D1FAE5' },
  submitted:      { label: 'Submitted',   color: '#1D4ED8', bg: '#DBEAFE' },
};

export function Dashboard() {
  usePageMeta({
    title: 'My Filings | FileTax.co',
    description: 'View the status of your Form 5472 filings and download completed forms.',
  });

  const { session, user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [filings, setFilings] = useState<Filing[]>([]);
  const [fetching, setFetching] = useState(true);
  const [creatingFiling, setCreatingFiling] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate('/portal?mode=login');
  }, [session, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('filings')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setFilings((data as Filing[]) ?? []);
        setFetching(false);
      });
  }, [user]);

  // After magic-link auth, if ?new-filing=1 is in the URL, create a draft and go to the wizard
  useEffect(() => {
    if (!user || fetching) return;
    if (searchParams.get('new-filing') !== '1') return;

    // Remove the param from the URL immediately so a refresh doesn't re-trigger
    const url = new URL(window.location.href);
    url.searchParams.delete('new-filing');
    window.history.replaceState({}, '', url.toString());

    setCreatingFiling(true);
    supabase
      .from('filings')
      .insert({ user_id: user.id, status: 'draft', current_step: 1 })
      .select('id')
      .single()
      .then(({ data, error }) => {
        setCreatingFiling(false);
        if (error || !data) return; // stay on dashboard if insert fails
        navigate(`/filing/${data.id}`);
      });
  }, [user, fetching, searchParams, navigate]);

  const handleNewFiling = async () => {
    if (!user) return;
    setCreatingFiling(true);
    const { data, error } = await supabase
      .from('filings')
      .insert({ user_id: user.id, status: 'draft', current_step: 1 })
      .select('id')
      .single();
    setCreatingFiling(false);
    if (error || !data) return;
    navigate(`/filing/${data.id}`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  if (loading || fetching || creatingFiling) {
    return (
      <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--tf-muted)' }}>
          {creatingFiling ? 'Creating your filing…' : 'Loading your filings…'}
        </p>
      </section>
    );
  }

  return (
    <section style={{ padding: '3rem 1rem 5rem' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)', marginBottom: '0.25rem' }}>My Filings</h1>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem' }}>{user?.email}</p>
          </div>
          <button
            onClick={handleSignOut}
            style={{ background: 'none', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.5rem 1rem', color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', minHeight: '36px' }}
          >
            Sign out
          </button>
        </div>

        {/* New filing CTA */}
        <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleNewFiling}
            disabled={creatingFiling}
            style={{ background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: creatingFiling ? 'not-allowed' : 'pointer', opacity: creatingFiling ? 0.7 : 1, minHeight: '40px' }}
          >
            {creatingFiling ? 'Creating…' : '+ Start new filing'}
          </button>
        </div>

        {/* Filings list */}
        {filings.length === 0 ? (
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '3rem', textAlign: 'center' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No filings yet</p>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '1.25rem' }}>
              Once your filing is started, it will appear here.
            </p>
            <button
              onClick={handleNewFiling}
              disabled={creatingFiling}
              style={{ display: 'inline-block', background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}
            >
              Start a filing
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filings.map((f) => {
              const s = STATUS_LABEL[f.status] ?? STATUS_LABEL.draft;
              const label = f.llc_name ? `${f.llc_name}` : 'Form 5472 Filing';
              return (
                <div
                  key={f.id}
                  style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{label}</span>
                      {f.tax_year && (
                        <span style={{ fontSize: '0.875rem', color: 'var(--tf-muted)' }}>— Tax Year {f.tax_year}</span>
                      )}
                    </div>
                    {f.ein && (
                      <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>EIN: {f.ein}</p>
                    )}
                    <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                      Started {new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ background: s.bg, color: s.color, fontWeight: 700, fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '9999px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {s.label}
                    </span>
                    {(f.status === 'draft' || f.status === 'in_progress') && (
                      <a
                        href={`/filing/${f.id}`}
                        style={{ background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.875rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '36px', display: 'inline-flex', alignItems: 'center' }}
                      >
                        Continue →
                      </a>
                    )}
                    {f.status === 'paid' || f.status === 'completed' ? (
                      <span style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 600 }}>Forms ready soon</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginTop: '2rem' }}>
          Questions? Email{' '}
          <a href="mailto:hello@filetax.co" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>hello@filetax.co</a>
        </p>
      </div>
    </section>
  );
}
