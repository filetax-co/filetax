import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { supabase, Filing } from '../../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Received',    color: '#92400E', bg: '#FEF3C7' },
  in_progress: { label: 'In Progress', color: '#1D4ED8', bg: '#DBEAFE' },
  completed:   { label: 'Completed',   color: '#065F46', bg: '#D1FAE5' },
};

export function Dashboard() {
  usePageMeta({
    title: 'My Filings | FileTax.co',
    description: 'View the status of your Form 5472 filings and download completed forms.',
  });

  const { session, user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [filings, setFilings] = useState<Filing[]>([]);
  const [fetching, setFetching] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!loading && !session) navigate('/auth');
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

  const getSignedUrl = async (path: string, filingId: string) => {
    const { data } = await supabase.storage.from('filings').createSignedUrl(path, 60);
    if (data?.signedUrl) setFileUrls((prev) => ({ ...prev, [filingId]: data.signedUrl }));
  };

  const handleUpload = async (filingId: string, file: File) => {
    if (!user) return;
    setUploadingId(filingId);
    const ext = file.name.split('.').pop();
    const path = `${user.id}/${filingId}.${ext}`;
    const { error } = await supabase.storage.from('filings').upload(path, file, { upsert: true });
    if (!error) {
      await supabase.from('filings').update({ file_path: path }).eq('id', filingId);
      setFilings((prev) => prev.map((f) => f.id === filingId ? { ...f, file_path: path } : f));
      getSignedUrl(path, filingId);
    }
    setUploadingId(null);
  };

  if (loading || fetching) {
    return (
      <section style={{ padding: '5rem 1rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--tf-muted)' }}>Loading your filings…</p>
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
            onClick={signOut}
            style={{ background: 'none', border: '1px solid var(--tf-border)', borderRadius: '0.5rem', padding: '0.5rem 1rem', color: 'var(--tf-muted)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', minHeight: '36px' }}
          >
            Sign out
          </button>
        </div>

        {/* Filings table */}
        {filings.length === 0 ? (
          <div style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '3rem', textAlign: 'center' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No filings yet</p>
            <p style={{ color: 'var(--tf-muted)', fontSize: '0.9375rem', marginBottom: '1.25rem' }}>
              Once your filing is started, it will appear here.
            </p>
            <a href="/portal" style={{ display: 'inline-block', background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.9375rem', padding: '0.625rem 1.25rem', borderRadius: '0.5rem', textDecoration: 'none' }}>
              Start a filing
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filings.map((f) => {
              const s = STATUS_LABEL[f.status] ?? STATUS_LABEL.pending;
              return (
                <div key={f.id} style={{ background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.75rem', padding: '1.25rem 1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ minWidth: '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{f.form_type}</span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--tf-muted)' }}>— Tax Year {f.tax_year}</span>
                    </div>
                    {f.notes && <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem' }}>{f.notes}</p>}
                    {f.created_at && (
                      <p style={{ color: 'var(--tf-muted)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                        Submitted {new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ background: s.bg, color: s.color, fontWeight: 700, fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '9999px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {s.label}
                    </span>
                    {f.status === 'completed' && (
                      f.file_path ? (
                        <a
                          href={fileUrls[f.id!] ?? '#'}
                          onClick={() => !fileUrls[f.id!] && f.file_path && getSignedUrl(f.file_path, f.id!)}
                          style={{ background: '#059669', color: 'white', fontWeight: 700, fontSize: '0.875rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', textDecoration: 'none', minHeight: '36px', display: 'inline-flex', alignItems: 'center' }}
                          target="_blank" rel="noopener noreferrer"
                        >
                          ↓ Download
                        </a>
                      ) : (
                        <label style={{ cursor: 'pointer' }}>
                          <span style={{ background: '#0284C7', color: 'white', fontWeight: 700, fontSize: '0.875rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', display: 'inline-block', minHeight: '36px', lineHeight: '20px' }}>
                            {uploadingId === f.id ? 'Uploading…' : 'Upload form'}
                          </span>
                          <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleUpload(f.id!, e.target.files[0])} />
                        </label>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ color: 'var(--tf-muted)', fontSize: '0.875rem', marginTop: '2rem' }}>
          Questions? Email <a href="mailto:hello@filetax.co" style={{ color: '#0284C7', fontWeight: 600, textDecoration: 'none' }}>hello@filetax.co</a>
        </p>
      </div>
    </section>
  );
}
