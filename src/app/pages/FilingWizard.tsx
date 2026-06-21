import { useEffect, useState, useMemo, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase, Filing, Transaction, Address } from '../../lib/supabase';

// ─── helpers ──────────────────────────────────────────────────────────────────

const getEasternYear = (): number => {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return eastern.getFullYear();
};

const currentYear = getEasternYear();

// Tax years available for filing (current year included so users can file for
// the just-completed calendar year starting Jan 1).
const TAX_YEARS = Array.from(
  { length: currentYear - 2018 },
  (_, i) => 2019 + i,
).reverse();

// ─── types ───────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

// ─── component ───────────────────────────────────────────────────────────────

export default function FilingWizard() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  // ── state ─────────────────────────────────────────────────────────────────

  const [step, setStep] = useState<WizardStep>(1);

  // Step 1 — filing header
  const [filingId, setFilingId]   = useState<string | null>(id ?? null);
  const [filing,   setFiling]     = useState<Filing | null>(null);
  const [saving,   setSaving]     = useState(false);
  const [saveErr,  setSaveErr]    = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Step 2 — transaction list
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading,    setTxLoading]    = useState(false);
  const [txErr,        setTxErr]        = useState<string | null>(null);

  // Step 3 — add transaction modal
  const [showTxForm, setShowTxForm] = useState(false);
  const [txForm,     setTxForm]     = useState<Partial<Transaction>>({
    transaction_type: 'sales',
    direction: 'received',
    amount_usd: undefined,
  });
  const [txSaving, setTxSaving] = useState(false);
  const [txSaveErr, setTxSaveErr] = useState<string | null>(null);

  // Step 4 — generate PDF
  const [generating, setGenerating] = useState(false);
  const [genErr,     setGenErr]     = useState<string | null>(null);

  // Suppress unused-variable warning — showTxForm is kept for future modal use
  void showTxForm;

  // ── load existing filing on mount ─────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    setFilingId(id);
    (async () => {
      const { data, error } = await supabase
        .from('filings')
        .select('*')
        .eq('id', id)
        .single();
      if (error) { setSaveErr(error.message); return; }
      if (data) setFiling(data);
    })();
  }, [id]);

  // ── pre-fill from user profile for NEW filings ────────────────────────────
  // When there is no :id in the URL, load the user's saved profile and
  // pre-populate every field except tax_year (the user must always choose
  // which year they are filing for).

  useEffect(() => {
    if (id) return; // existing filing — already loaded above
    if (profileLoaded) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      setProfileLoaded(true);
      if (!profile) return;
      setFiling(prev => ({
        ...(prev ?? {} as Filing),
        llc_name:                profile.llc_name                ?? prev?.llc_name                ?? '',
        ein:                     profile.ein                     ?? prev?.ein                     ?? '',
        state_of_formation:      profile.state_of_formation      ?? prev?.state_of_formation      ?? '',
        country_of_incorporation: profile.country_of_incorporation ?? prev?.country_of_incorporation ?? '',
        date_of_incorporation:   profile.date_of_incorporation   ?? prev?.date_of_incorporation   ?? null,
        llc_us_address:          profile.llc_us_address          ?? prev?.llc_us_address          ?? null,
        owner_full_name:         profile.owner_full_name         ?? prev?.owner_full_name         ?? '',
        owner_country_residence: profile.owner_country_residence ?? prev?.owner_country_residence ?? '',
        owner_foreign_tax_id:    profile.owner_foreign_tax_id    ?? prev?.owner_foreign_tax_id    ?? '',
        owner_foreign_address:   profile.owner_foreign_address   ?? prev?.owner_foreign_address   ?? null,
        // tax_year intentionally left as-is — user must pick it explicitly
      }));
    })();
  }, [id, profileLoaded]);

  // ── step 2: load transactions when reaching step 2 ───────────────────────

  useEffect(() => {
    if (step !== 2 && step !== 3) return;
    if (!filingId) return;
    setTxLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId);
      setTxLoading(false);
      if (error) { setTxErr(error.message); return; }
      setTransactions(data ?? []);
    })();
  }, [step, filingId]);

  // ── step 4: load filing + transactions when reaching step 4 ─────────────

  useEffect(() => {
    if (step !== 4 || !filingId) return;
    (async () => {
      const [{ data: fi }, { data: txData }] = await Promise.all([
        supabase.from('filings').select('*').eq('id', filingId).single(),
        supabase.from('reportable_transactions').select('*').eq('filing_id', filingId),
      ]);
      if (fi) setFiling(fi);
      // Sync transactions so step 4 review shows the correct count even
      // when the user navigated directly from step 2 via the breadcrumb.
      if (txData) setTransactions(txData);
    })();
  }, [step, filingId]);

  // ── derived ───────────────────────────────────────────────────────────────

  const canAdvanceStep1 = useMemo(() => {
    if (!filing) return false;
    return !!(
      filing.llc_name &&
      filing.ein &&
      filing.tax_year &&
      filing.owner_full_name &&
      filing.owner_country_residence
    );
  }, [filing]);

  // ── step 1 handlers ───────────────────────────────────────────────────────

  const handleFilingChange = (field: keyof Filing, value: string | number | null) => {
    setFiling(prev => ({ ...(prev ?? {} as Filing), [field]: value }));
  };

  const handleAddressChange = (
    addrField: 'llc_us_address' | 'owner_foreign_address',
    subField: keyof Address,
    value: string,
  ) => {
    setFiling(prev => {
      if (!prev) return prev;
      const existing = (prev[addrField] as Address | null) ?? {} as Address;
      return { ...prev, [addrField]: { ...existing, [subField]: value } };
    });
  };

  const handleSaveFiling = async () => {
    if (!filing) return;
    setSaving(true);
    setSaveErr(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build the upsert payload — include id only when updating
      const payload: Partial<Filing> & { user_id: string } = {
        ...filing,
        user_id: user.id,
      };

      const { data, error } = filingId
        ? await supabase.from('filings').update(payload).eq('id', filingId).select().single()
        : await supabase.from('filings').insert(payload).select().single();

      if (error) throw error;
      if (data) {
        setFiling(data);
        setFilingId(data.id);
        // Update the URL without remounting the component
        if (!filingId) navigate(`/filing/${data.id}`, { replace: true });
      }

      // ── upsert user profile so the next filing is pre-filled ────────────
      await supabase.from('user_profiles').upsert({
        user_id:                 user.id,
        llc_name:                filing.llc_name,
        ein:                     filing.ein,
        state_of_formation:      filing.state_of_formation,
        country_of_incorporation: filing.country_of_incorporation,
        date_of_incorporation:   filing.date_of_incorporation,
        llc_us_address:          filing.llc_us_address,
        owner_full_name:         filing.owner_full_name,
        owner_country_residence: filing.owner_country_residence,
        owner_foreign_tax_id:    filing.owner_foreign_tax_id,
        owner_foreign_address:   filing.owner_foreign_address,
        updated_at:              new Date().toISOString(),
      }, { onConflict: 'user_id' });
      // (profile upsert failure is non-fatal — we don't block the user)

      setStep(2);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── step 2/3 handlers ─────────────────────────────────────────────────────

  const handleDeleteTransaction = async (txId: string) => {
    const { error } = await supabase.from('reportable_transactions').delete().eq('id', txId);
    if (!error) setTransactions(prev => prev.filter(t => t.id !== txId));
  };

  const handleTxFormChange = (field: keyof Transaction, value: string | number | boolean | null) => {
    setTxForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveTransaction = async () => {
    if (!filingId) return;
    setTxSaving(true);
    setTxSaveErr(null);
    try {
      const payload = { ...txForm, filing_id: filingId };
      const { data, error } = await supabase
        .from('reportable_transactions')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      if (data) setTransactions(prev => [...prev, data]);
      setShowTxForm(false);
      setTxForm({ transaction_type: 'sales', direction: 'received', amount_usd: undefined });
    } catch (err) {
      setTxSaveErr(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setTxSaving(false);
    }
  };

  // ── step 4: generate PDF ──────────────────────────────────────────────────
  //
  // Generates the complete filing package and downloads a single combined PDF:
  //   Pro Forma 1120 → Form 5472 → statement_partV (if hasPartV) → statement_partVI (always)
  //
  // statement_partVI is always included (managerial services FMV disclosure).
  // statement_partV is included only when distributions, contributions, dividends,
  // or formation-cost payments are present.
  // property_transfer and nonmonetary_other are disclosed in statement_partVI only.

  const handleGenerate = async () => {
    if (!filingId || !filing) return;
    setGenerating(true);
    setGenErr(null);
    try {
      const { data: fi, error: fiErr } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();
      if (fiErr) throw fiErr;

      const { data: txns, error: txErr2 } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId);
      if (txErr2) throw txErr2;

      // Guard: require at least one transaction before generating
      if (!txns || txns.length === 0) {
        throw new Error('No transactions found. Please add at least one reportable transaction before generating.');
      }

      const { generateFilingPackage } = await import('../../lib/pdfGenerator');
      const pkg = await generateFilingPackage(fi, txns);

      // Download the single combined PDF (1120 + 5472 + statement_partV if applicable + statement_partVI always)
      const blob = new Blob([pkg.combined], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Form-5472-${fi.llc_name ?? 'filing'}-${fi.tax_year ?? 'draft'}.pdf`;
      // Append to DOM so Firefox triggers the download correctly, then remove.
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revocation — browsers fetch the blob asynchronously after click().
      // Revoking immediately can abort the download on Chrome mobile and Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setGenErr(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  const stepLabels: Record<WizardStep, string> = {
    1: 'Company & Owner Info',
    2: 'Review Transactions',
    3: 'Add Transactions',
    4: 'Generate Filing',
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>

      {/* ── breadcrumb nav ─────────────────────────────────────────────── */}
      <nav style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {([1, 2, 3, 4] as WizardStep[]).map(s => (
          <Fragment key={s}>
            <button
              onClick={() => {
                // Only allow backward navigation or to a step already visited
                if (s < step || (s === 3 && step >= 3) || (s === 4 && step >= 4)) setStep(s);
              }}
              style={{
                background: step === s ? 'var(--tf-primary)' : 'transparent',
                color: step === s ? '#fff' : step > s ? 'var(--tf-primary)' : 'var(--tf-text-muted)',
                border: `1px solid ${step === s ? 'var(--tf-primary)' : step > s ? 'var(--tf-primary)' : 'var(--tf-border)'}`,
                borderRadius: '2rem',
                padding: '0.3rem 0.9rem',
                fontSize: '0.82rem',
                fontWeight: step === s ? 700 : 400,
                cursor: s <= step ? 'pointer' : 'default',
                opacity: s > step ? 0.45 : 1,
              }}
            >
              {s}. {stepLabels[s]}
            </button>
            {s < 4 && <span style={{ color: 'var(--tf-text-muted)', alignSelf: 'center' }}>›</span>}
          </Fragment>
        ))}
      </nav>

      {/* ══════════════════════════════════════════════════════════════════
          STEP 1 — Company & Owner Info
      ══════════════════════════════════════════════════════════════════ */}
      {step === 1 && (
        <div>
          <h2 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>Step 1 — Company &amp; Owner Info</h2>
          {!id && profileLoaded && filing?.llc_name && (
            <p style={{ fontSize: '0.8rem', color: 'var(--tf-primary)', marginBottom: '1.25rem' }}>
              ✓ Pre-filled from your last filing — just pick the tax year.
            </p>
          )}

          {saveErr && (
            <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
              {saveErr}
            </div>
          )}

          {/* ── LLC / Company section ──────────────────────────────────── */}
          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--tf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              LLC / Corporation
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
              <Field label="Legal Name of LLC / Corp *">
                <input value={filing?.llc_name ?? ''} onChange={e => handleFilingChange('llc_name', e.target.value)} placeholder="Acme LLC" />
              </Field>
              <Field label="EIN *">
                <input value={filing?.ein ?? ''} onChange={e => handleFilingChange('ein', e.target.value)} placeholder="12-3456789" />
              </Field>
              <Field label="Tax Year *">
                <select value={filing?.tax_year ?? ''} onChange={e => handleFilingChange('tax_year', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Select year</option>
                  {TAX_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label="State of Formation">
                <input value={filing?.state_of_formation ?? ''} onChange={e => handleFilingChange('state_of_formation', e.target.value)} placeholder="DE" maxLength={2} />
              </Field>
              <Field label="Country of Incorporation">
                <input value={filing?.country_of_incorporation ?? ''} onChange={e => handleFilingChange('country_of_incorporation', e.target.value)} placeholder="US" />
              </Field>
              <Field label="Date of Incorporation">
                <input type="date" value={filing?.date_of_incorporation ?? ''} onChange={e => handleFilingChange('date_of_incorporation', e.target.value || null)} />
              </Field>
              <Field label="Total Assets (USD)">
                <input type="number" value={filing?.total_assets ?? ''} onChange={e => handleFilingChange('total_assets', e.target.value ? Number(e.target.value) : null)} placeholder="0" />
              </Field>
              <Field label="Tax Period Begin">
                <input type="date" value={filing?.tax_period_begin ?? ''} onChange={e => handleFilingChange('tax_period_begin', e.target.value || null)} />
              </Field>
              <Field label="Tax Period End">
                <input type="date" value={filing?.tax_period_end ?? ''} onChange={e => handleFilingChange('tax_period_end', e.target.value || null)} />
              </Field>
            </div>

            {/* US Address */}
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: '1.25rem', marginBottom: '0.75rem' }}>US Address</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
              <Field label="Street">
                <input value={(filing?.llc_us_address as Address)?.street ?? ''} onChange={e => handleAddressChange('llc_us_address', 'street', e.target.value)} />
              </Field>
              <Field label="City">
                <input value={(filing?.llc_us_address as Address)?.city ?? ''} onChange={e => handleAddressChange('llc_us_address', 'city', e.target.value)} />
              </Field>
              <Field label="State">
                <input value={(filing?.llc_us_address as Address)?.state ?? ''} onChange={e => handleAddressChange('llc_us_address', 'state', e.target.value)} maxLength={2} />
              </Field>
              <Field label="ZIP">
                <input value={(filing?.llc_us_address as Address)?.zip ?? ''} onChange={e => handleAddressChange('llc_us_address', 'zip', e.target.value)} />
              </Field>
            </div>
          </section>

          {/* ── Foreign Owner section ──────────────────────────────────── */}
          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--tf-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              Foreign Owner / Related Party
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
              <Field label="Full Legal Name *">
                <input value={filing?.owner_full_name ?? ''} onChange={e => handleFilingChange('owner_full_name', e.target.value)} placeholder="Jane Doe" />
              </Field>
              <Field label="Country of Residence *">
                <input value={filing?.owner_country_residence ?? ''} onChange={e => handleFilingChange('owner_country_residence', e.target.value)} placeholder="CA" />
              </Field>
              <Field label="Foreign Tax ID (TIN)">
                <input value={filing?.owner_foreign_tax_id ?? ''} onChange={e => handleFilingChange('owner_foreign_tax_id', e.target.value)} />
              </Field>
            </div>

            {/* Foreign Address */}
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: '1.25rem', marginBottom: '0.75rem' }}>Foreign Address</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
              <Field label="Street">
                <input value={(filing?.owner_foreign_address as Address)?.street ?? ''} onChange={e => handleAddressChange('owner_foreign_address', 'street', e.target.value)} />
              </Field>
              <Field label="City">
                <input value={(filing?.owner_foreign_address as Address)?.city ?? ''} onChange={e => handleAddressChange('owner_foreign_address', 'city', e.target.value)} />
              </Field>
              <Field label="Province / State">
                <input value={(filing?.owner_foreign_address as Address)?.state ?? ''} onChange={e => handleAddressChange('owner_foreign_address', 'state', e.target.value)} />
              </Field>
              <Field label="Postal Code">
                <input value={(filing?.owner_foreign_address as Address)?.zip ?? ''} onChange={e => handleAddressChange('owner_foreign_address', 'zip', e.target.value)} />
              </Field>
              <Field label="Country">
                <input value={(filing?.owner_foreign_address as Address)?.country ?? ''} onChange={e => handleAddressChange('owner_foreign_address', 'country', e.target.value)} />
              </Field>
            </div>
          </section>

          <button
            onClick={handleSaveFiling}
            disabled={!canAdvanceStep1 || saving}
            style={{
              background: 'var(--tf-primary)', color: '#fff',
              border: 'none', borderRadius: '0.5rem',
              padding: '0.65rem 1.75rem', fontWeight: 700,
              fontSize: '1rem',
              cursor: !canAdvanceStep1 || saving ? 'not-allowed' : 'pointer',
              opacity: !canAdvanceStep1 || saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : filingId ? 'Save & Continue →' : 'Create & Continue →'}
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          STEP 2 — Review Transactions
      ══════════════════════════════════════════════════════════════════ */}
      {step === 2 && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Step 2 — Review Transactions</h2>

          {txErr && (
            <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
              {txErr}
            </div>
          )}

          {txLoading ? (
            <p style={{ color: 'var(--tf-text-muted)' }}>Loading transactions…</p>
          ) : transactions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--tf-text-muted)', border: '2px dashed var(--tf-border)', borderRadius: '0.75rem', marginBottom: '1.5rem' }}>
              <p style={{ marginBottom: '0.5rem', fontSize: '1rem' }}>No transactions yet.</p>
              <p style={{ fontSize: '0.875rem' }}>Add at least one reportable transaction to continue.</p>
            </div>
          ) : (
            <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {transactions.map(tx => (
                <div key={tx.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
                  borderRadius: '0.5rem', padding: '0.6rem 0.9rem', gap: '0.5rem',
                }}>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.875rem' }}>
                    <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{tx.transaction_type.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--tf-text-muted)', textTransform: 'capitalize' }}>{tx.direction}</span>
                    {tx.amount_usd != null && (
                      <span style={{ color: 'var(--tf-primary)', fontWeight: 600 }}>
                        ${tx.amount_usd.toLocaleString()}
                      </span>
                    )}
                    {tx.description && <span style={{ color: 'var(--tf-text-muted)' }}>{tx.description}</span>}
                  </div>
                  <button
                    onClick={() => handleDeleteTransaction(tx.id)}
                    style={{ color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', padding: '0.2rem 0.5rem', borderRadius: '0.25rem' }}
                    title="Delete transaction"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setStep(3)}
              style={{
                background: 'var(--tf-surface)', color: 'var(--tf-text)',
                border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              }}
            >
              + Add Transaction
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={transactions.length === 0 || txLoading}
              style={{
                background: 'var(--tf-primary)', color: '#fff',
                border: 'none', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600,
                fontSize: '0.9rem',
                cursor: transactions.length === 0 || txLoading ? 'not-allowed' : 'pointer',
                opacity: transactions.length === 0 || txLoading ? 0.5 : 1,
              }}
            >
              Next → Review &amp; Generate
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          STEP 3 — Add Transaction
      ══════════════════════════════════════════════════════════════════ */}
      {step === 3 && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Step 3 — Add Transaction</h2>

          {txSaveErr && (
            <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
              {txSaveErr}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <Field label="Transaction Type">
              <select value={txForm.transaction_type ?? 'sales'} onChange={e => handleTxFormChange('transaction_type', e.target.value)}>
                <option value="sales">Sales</option>
                <option value="tangible_property">Tangible Property</option>
                <option value="rent_royalty">Rent / Royalty</option>
                <option value="intangible">Intangible Property</option>
                <option value="service_payment">Services</option>
                <option value="commission">Commission</option>
                <option value="interest">Interest</option>
                <option value="insurance">Insurance</option>
                <option value="loan_to_llc">Loan to LLC</option>
                <option value="loan_from_llc">Loan from LLC</option>
                <option value="loan_guarantee">Loan Guarantee</option>
                <option value="dividend">Dividend</option>
                <option value="capital_contribution">Capital Contribution</option>
                <option value="distribution">Distribution</option>
                <option value="formation_costs">Formation Costs (paid by owner)</option>
                <option value="property_transfer">Property Transfer (Part VI)</option>
                <option value="nonmonetary_other">Other Nonmonetary (Part VI)</option>
                <option value="other">Other</option>
              </select>
            </Field>

            <Field label="Direction">
              <select value={txForm.direction ?? 'received'} onChange={e => handleTxFormChange('direction', e.target.value)}>
                <option value="received">Received (LLC ← foreign party)</option>
                <option value="paid">Paid (LLC → foreign party)</option>
              </select>
            </Field>

            <Field label="Amount (USD)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={txForm.amount_usd ?? ''}
                onChange={e => handleTxFormChange('amount_usd', e.target.value ? Number(e.target.value) : null)}
                placeholder="0.00 (leave blank if nonmonetary)"
              />
            </Field>

            {txForm.transaction_type === 'rent_royalty' && (
              <Field label="Is Royalty?">
                <select
                  value={txForm.is_royalty ? 'true' : 'false'}
                  onChange={e => handleTxFormChange('is_royalty', e.target.value === 'true')}
                >
                  <option value="false">Rent</option>
                  <option value="true">Royalty</option>
                </select>
              </Field>
            )}

            <Field label="Description (optional)" style={{ gridColumn: '1 / -1' }}>
              <input
                value={txForm.description ?? ''}
                onChange={e => handleTxFormChange('description', e.target.value || null)}
                placeholder="Brief description of the transaction"
              />
            </Field>
          </div>

          {/* Hint for Part VI types */}
          {(txForm.transaction_type === 'property_transfer' || txForm.transaction_type === 'nonmonetary_other') && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--tf-text-muted)', marginBottom: '1rem', padding: '0.625rem 0.875rem', background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: '0.375rem' }}>
              ℹ️ This transaction type is disclosed in the <strong>Part VI statement</strong> (nonmonetary / less-than-FMV), not Part V. The amount field is optional — leave blank if no monetary consideration was exchanged.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setStep(2)}
              style={{
                background: 'var(--tf-surface)', color: 'var(--tf-text)',
                border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleSaveTransaction}
              disabled={txSaving}
              style={{
                background: 'var(--tf-primary)', color: '#fff',
                border: 'none', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600,
                fontSize: '0.9rem',
                cursor: txSaving ? 'not-allowed' : 'pointer',
                opacity: txSaving ? 0.5 : 1,
              }}
            >
              {txSaving ? 'Saving…' : 'Save Transaction'}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          STEP 4 — Review & Generate
      ══════════════════════════════════════════════════════════════════ */}
      {step === 4 && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Step 4 — Review &amp; Generate</h2>

          {genErr && (
            <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
              {genErr}
            </div>
          )}

          {/* Summary card */}
          <div style={{
            background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
            borderRadius: '0.75rem', padding: '1.25rem 1.5rem', marginBottom: '1rem',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem',
          }}>
            <SummaryRow label="LLC Name"        value={filing?.llc_name} />
            <SummaryRow label="EIN"             value={filing?.ein} />
            <SummaryRow label="Tax Year"        value={filing?.tax_year ? String(filing.tax_year) : undefined} />
            <SummaryRow label="Foreign Owner"   value={filing?.owner_full_name} />
            <SummaryRow label="Transactions"    value={String(transactions.length)} />
          </div>

          {/* What's included info box */}
          <div style={{
            fontSize: '0.8125rem', color: 'var(--tf-text-muted)',
            padding: '0.75rem 1rem', marginBottom: '1.5rem',
            background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
            borderRadius: '0.5rem', lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--tf-text)' }}>What's included in the download:</strong>
            <ul style={{ margin: '0.4rem 0 0 1.1rem', padding: 0 }}>
              <li>Pro Forma 1120</li>
              <li>Form 5472</li>
              {transactions.some(tx => ['distribution','dividend','capital_contribution','formation_costs'].includes(tx.transaction_type)) && (
                <li>Part V Statement — owner distributions, contributions &amp; payments</li>
              )}
              <li>Part VI Statement — managerial services FMV disclosure{transactions.some(tx => tx.transaction_type === 'property_transfer') ? ' + property transfer detail' : ''}{transactions.some(tx => tx.transaction_type === 'nonmonetary_other') ? ' + other nonmonetary transactions' : ''}</li>
            </ul>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setStep(2)}
              style={{
                background: 'var(--tf-surface)', color: 'var(--tf-text)',
                border: '1px solid var(--tf-border)', borderRadius: '0.5rem',
                padding: '0.6rem 1.4rem', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                background: 'var(--tf-primary)',
                color: '#fff', border: 'none', borderRadius: '0.5rem',
                padding: '0.6rem 1.75rem', fontWeight: 700,
                fontSize: '1rem',
                cursor: generating ? 'wait' : 'pointer',
                opacity: generating ? 0.75 : 1,
              }}
            >
              {generating ? 'Generating…' : '⬇ Download Complete Filing'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── small helper components ──────────────────────────────────────────────────

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--tf-text-muted)' }}>
        {label}
      </label>
      <div style={{
        display: 'contents',
      }}>
        {/* Input/select inherits styles from global CSS */}
        {children}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: 'var(--tf-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 500, color: value ? 'var(--tf-text)' : 'var(--tf-text-muted)' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}
