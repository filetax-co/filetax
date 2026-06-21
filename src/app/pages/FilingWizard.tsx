import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { supabase, Filing, Transaction } from '../../lib/supabase';

// ─── helpers ──────────────────────────────────────────────────────────────────

const getEasternYear = (): number => {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return eastern.getFullYear();
};

const currentYear = getEasternYear();

const TAX_YEARS = Array.from(
  { length: currentYear - 2018 },
  (_, i) => 2019 + i,
).reverse();

// ─── component ───────────────────────────────────────────────────────────────
//
// FilingWizard is the GENERATE step only.
// It is reached via /filing/:id, which the Dashboard routes to for
// paid / completed filings. Data entry (steps 1-3) lives in Intake (/intake/:id).
//
// Combined PDF order:
//   Pro Forma 1120 → Form 5472 → statement_partV (if hasPartV) → statement_partVI (always)
//
// statement_partVI is always included (hardcoded true in pdfGenerator.ts).
// statement_partV is included only when distributions, contributions, dividends,
// or formation-cost payments are present (hasPartV === true).
// property_transfer and nonmonetary_other are disclosed in statement_partVI only —
// they do NOT trigger hasPartV.

export default function FilingWizard() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  // ── state ─────────────────────────────────────────────────────────────────

  const [filing,       setFiling]       = useState<Filing | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [genErr,       setGenErr]       = useState<string | null>(null);
  const [loadErr,      setLoadErr]      = useState<string | null>(null);

  // ── load filing + transactions ────────────────────────────────────────────

  useEffect(() => {
    if (!id) { setLoadErr('No filing ID in URL.'); setLoading(false); return; }
    setLoading(true);
    (async () => {
      const [{ data: fi, error: fiErr }, { data: txData, error: txErr }] = await Promise.all([
        supabase.from('filings').select('*').eq('id', id).single(),
        supabase.from('reportable_transactions').select('*').eq('filing_id', id).order('created_at', { ascending: true }),
      ]);
      setLoading(false);
      if (fiErr)  { setLoadErr(fiErr.message);  return; }
      if (txErr)  { setLoadErr(txErr.message);  return; }
      if (fi)     setFiling(fi);
      if (txData) setTransactions(txData);
    })();
  }, [id]);

  // ── generate PDF ──────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!id || !filing) return;
    setGenerating(true);
    setGenErr(null);
    try {
      const { data: fi, error: fiErr } = await supabase
        .from('filings').select('*').eq('id', id).single();
      if (fiErr) throw fiErr;

      const { data: txns, error: txErr2 } = await supabase
        .from('reportable_transactions').select('*').eq('filing_id', id);
      if (txErr2) throw txErr2;

      if (!txns || txns.length === 0) {
        throw new Error('No transactions found. Please add at least one reportable transaction before generating.');
      }

      const { generateFilingPackage } = await import('../../lib/pdfGenerator');
      const pkg = await generateFilingPackage(fi, txns);

      // Download the single combined PDF:
      //   pkg.combined = Pro Forma 1120 + Form 5472
      //                + pkg.statement_partV  (appended only when hasPartV is true)
      //                + pkg.statement_partVI (always appended — hardcoded in pdfGenerator.ts)
      const blob = new Blob([pkg.combined], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Form-5472-${fi.llc_name ?? 'filing'}-${fi.tax_year ?? 'draft'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revocation — browsers fetch blob asynchronously after click().
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setGenErr(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  // Determine which parts will be generated (mirrors pdfGenerator.ts logic)
  const hasPartV = transactions.some(t =>
    ['distribution', 'dividend', 'capital_contribution', 'formation_costs'].includes(t.transaction_type)
  );
  // Part VI is always generated — hardcoded true in pdfGenerator.ts

  return (
    <>
      {/* Scoped input styles — matches Intake.tsx, fixes dark mode visibility */}
      <style>{`
        .filing-wizard input,
        .filing-wizard select,
        .filing-wizard textarea {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--tf-border, #d1d5db);
          border-radius: 0.375rem;
          font-size: 0.9375rem;
          font-family: inherit;
          background: var(--tf-input-bg, var(--tf-surface, #fff));
          color: var(--tf-text, #111);
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .filing-wizard input:focus,
        .filing-wizard select:focus,
        .filing-wizard textarea:focus {
          border-color: var(--tf-primary, #2563eb);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--tf-primary, #2563eb) 18%, transparent);
        }
        .filing-wizard input::placeholder {
          color: var(--tf-text-muted, #9ca3af);
          opacity: 1;
        }
      `}</style>

      <div className="filing-wizard" style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '2rem 1rem',
        fontFamily: 'inherit',
      }}>

        {/* ── Back link ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '1.75rem' }}>
          <Link
            to="/dashboard"
            style={{
              fontSize: '0.875rem',
              color: 'var(--tf-text-muted, #6b7280)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            ← Dashboard
          </Link>
        </div>

        {/* ── Page heading ──────────────────────────────────────────────── */}
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.375rem' }}>
          Generate Filing Package
        </h2>
        {filing && (
          <p style={{ fontSize: '0.875rem', color: 'var(--tf-text-muted, #6b7280)', marginBottom: '1.75rem' }}>
            {filing.llc_name ?? '—'} · Tax year {filing.tax_year ?? '—'}
          </p>
        )}

        {/* ── Loading ───────────────────────────────────────────────────── */}
        {loading && (
          <p style={{ color: 'var(--tf-text-muted, #6b7280)', fontSize: '0.9rem' }}>Loading filing…</p>
        )}

        {/* ── Load error ────────────────────────────────────────────────── */}
        {loadErr && (
          <div style={errorBannerStyle}>{loadErr}</div>
        )}

        {/* ── Main content ──────────────────────────────────────────────── */}
        {!loading && !loadErr && filing && (
          <>
            {/* ── Filing summary card ──────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>Filing Details</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '0.75rem',
                background: 'var(--tf-surface, #fff)',
                border: '1px solid var(--tf-border, #e5e7eb)',
                borderRadius: '0.625rem',
                padding: '1.125rem 1.25rem',
              }}>
                <SummaryRow label="LLC / Corp"      value={filing.llc_name} />
                <SummaryRow label="EIN"             value={filing.ein} />
                <SummaryRow label="Tax year"        value={String(filing.tax_year ?? '—')} />
                <SummaryRow label="State"           value={filing.state_of_formation} />
                <SummaryRow label="Owner"           value={filing.owner_full_name} />
                <SummaryRow label="Country"         value={filing.owner_country_residence} />
                <SummaryRow label="Transactions"    value={String(transactions.length)} />
              </div>
            </section>

            {/* ── What's included card ─────────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionLabelStyle}>What's Included</h3>
              <div style={{
                background: 'var(--tf-surface, #fff)',
                border: '1px solid var(--tf-border, #e5e7eb)',
                borderRadius: '0.625rem',
                padding: '1.125rem 1.25rem',
              }}>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <IncludedItem icon="📄" label="Pro Forma 1120" desc="US corporation income tax return" always />
                  <IncludedItem icon="📋" label="Form 5472" desc="Information return for 25%-foreign-owned US corporations" always />
                  {hasPartV && (
                    <IncludedItem icon="📎" label="Part V Statement" desc="Monetary transactions — distributions, dividends, capital contributions, formation costs" always={false} />
                  )}
                  <IncludedItem icon="📎" label="Part VI Statement" desc="Nonmonetary / less-than-FMV transactions — always included" always />
                </ul>
                <p style={{
                  marginTop: '1rem',
                  fontSize: '0.8125rem',
                  color: 'var(--tf-text-muted, #6b7280)',
                  lineHeight: 1.55,
                }}>
                  All documents are combined into a single PDF ready to submit with your tax return.
                </p>
              </div>
            </section>

            {/* ── Transactions summary (if any) ─────────────────────────── */}
            {transactions.length > 0 && (
              <section style={sectionStyle}>
                <h3 style={sectionLabelStyle}>Transactions ({transactions.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {transactions.map(tx => (
                    <div key={tx.id} style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.55rem 0.875rem',
                      background: 'var(--tf-surface, #fff)',
                      border: '1px solid var(--tf-border, #e5e7eb)',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                    }}>
                      <div style={{ flex: 1, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                          {tx.transaction_type.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--tf-text-muted, #6b7280)', textTransform: 'capitalize' }}>
                          {tx.direction}
                        </span>
                        {tx.description && (
                          <span style={{ color: 'var(--tf-text-muted, #6b7280)' }}>— {tx.description}</span>
                        )}
                      </div>
                      {tx.amount_usd != null && (
                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--tf-primary, #2563eb)' }}>
                          ${tx.amount_usd.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* No transactions warning */}
            {transactions.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '2rem 1rem',
                color: 'var(--tf-text-muted, #6b7280)',
                border: '2px dashed var(--tf-border, #e5e7eb)',
                borderRadius: '0.75rem',
                marginBottom: '1.5rem',
                fontSize: '0.9rem',
              }}>
                <p style={{ marginBottom: '0.5rem', fontWeight: 600 }}>No transactions found.</p>
                <p style={{ fontSize: '0.8125rem' }}>
                  Go back to the intake form to add at least one reportable transaction before generating.
                </p>
                <button
                  onClick={() => id && navigate(`/intake/${id}`)}
                  style={{ ...secondaryBtnStyle, marginTop: '1rem', display: 'inline-block' }}
                >
                  ← Back to Intake
                </button>
              </div>
            )}

            {/* ── Generate error ───────────────────────────────────────── */}
            {genErr && (
              <div style={{ ...errorBannerStyle, marginBottom: '1rem' }}>{genErr}</div>
            )}

            {/* ── Action buttons ───────────────────────────────────────── */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--tf-border, #e5e7eb)',
              flexWrap: 'wrap',
            }}>
              <button
                onClick={() => id && navigate(`/intake/${id}`)}
                style={secondaryBtnStyle}
                type="button"
              >
                ← Edit Filing
              </button>

              <button
                onClick={handleGenerate}
                disabled={generating || transactions.length === 0}
                style={{
                  ...primaryBtnStyle,
                  opacity: generating || transactions.length === 0 ? 0.55 : 1,
                  cursor: generating || transactions.length === 0 ? 'not-allowed' : 'pointer',
                }}
                type="button"
              >
                {generating ? 'Generating…' : '⬇ Download Complete Filing'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── small components ─────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{
        fontSize: '0.75rem',
        color: 'var(--tf-text-muted, #6b7280)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.95rem',
        fontWeight: 500,
        color: value ? 'var(--tf-text, #111)' : 'var(--tf-text-muted, #9ca3af)',
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

function IncludedItem({
  icon, label, desc, always,
}: {
  icon: string;
  label: string;
  desc: string;
  always: boolean;
}) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
      <span style={{ fontSize: '1rem', lineHeight: 1.4, flexShrink: 0 }}>{icon}</span>
      <div>
        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--tf-text, #111)' }}>
          {label}
        </span>
        {!always && (
          <span style={{
            marginLeft: '0.4rem',
            fontSize: '0.72rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--tf-primary, #2563eb)',
            background: 'color-mix(in srgb, var(--tf-primary, #2563eb) 12%, transparent)',
            padding: '0.1rem 0.4rem',
            borderRadius: '0.25rem',
          }}>
            if applicable
          </span>
        )}
        <p style={{
          margin: '0.15rem 0 0',
          fontSize: '0.8125rem',
          color: 'var(--tf-text-muted, #6b7280)',
          lineHeight: 1.5,
        }}>
          {desc}
        </p>
      </div>
    </li>
  );
}

// ─── shared styles ────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  marginBottom: '1.75rem',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--tf-text-muted, #6b7280)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '0.75rem',
};

const errorBannerStyle: React.CSSProperties = {
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: '0.375rem',
  padding: '0.75rem 1rem',
  fontSize: '0.875rem',
  marginBottom: '1.25rem',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.5rem',
  background: 'var(--tf-primary, #2563eb)',
  color: '#fff',
  border: 'none',
  borderRadius: '0.5rem',
  fontWeight: 700,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  background: 'transparent',
  color: 'var(--tf-text, #111)',
  border: '1px solid var(--tf-border, #d1d5db)',
  borderRadius: '0.5rem',
  fontWeight: 600,
  fontSize: '0.95rem',
  cursor: 'pointer',
};

// TAX_YEARS is kept in scope for potential future use (e.g. year picker override).
void TAX_YEARS;
