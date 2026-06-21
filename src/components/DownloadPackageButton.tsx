/**
 * DownloadPackageButton
 *
 * Fetches a filing + its transactions from Supabase, generates the
 * combined Form 5472 + Pro Forma 1120 PDF via pdf-lib, and triggers
 * a single-file browser download.
 *
 * Downloaded file: FilingPackage_<year>_<slug>.pdf
 *   Combined PDF order:
 *     1. Pro Forma 1120 pages
 *     2. Form 5472 pages
 *     3. statement_partV  — Part V statement (distributions, dividends,
 *                           capital contributions, formation costs)
 *                           ONLY included when hasPartV is true
 *     4. statement_partVI — Part VI statement (managerial services FMV
 *                           disclosure; property transfers; nonmonetary
 *                           exchanges) — ALWAYS included in every filing
 *   AcroForm fields flattened (values baked in, renders correctly everywhere)
 *
 * pdfGenerator (~480 kB) is dynamically imported on first click.
 */

import { useState } from 'react';
import { Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Filing, Transaction } from '../lib/supabase';

interface Props {
  filingId: string;
  taxYear?: string;
  llcName?: string;
  onSuccess?: () => void;
}

type Status = 'idle' | 'fetching' | 'generating' | 'done' | 'error';

const STATUS_LABELS: Record<Status, string> = {
  idle:       'Download Filing Package',
  fetching:   'Loading filing data...',
  generating: 'Generating PDF...',
  done:       'Downloaded!',
  error:      'Failed — try again',
};

export function DownloadPackageButton({ filingId, taxYear, llcName, onSuccess }: Props) {
  const [status, setStatus]     = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleDownload() {
    if (status === 'fetching' || status === 'generating') return;

    try {
      setStatus('fetching');
      setErrorMsg(null);

      // 1. Fetch filing row
      const { data: filingData, error: filingErr } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();
      if (filingErr || !filingData) throw new Error(filingErr?.message ?? 'Filing not found');

      // 2. Fetch transactions
      const { data: txnsData, error: txnsErr } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId);
      if (txnsErr) throw new Error(txnsErr.message);

      const filing       = filingData as Filing;
      const transactions = (txnsData ?? []) as Transaction[];
      const year         = taxYear ?? filing.tax_year ?? String(new Date().getFullYear() - 1);

      // 3. Generate combined PDF — lazy-load pdfGenerator only on demand
      setStatus('generating');
      const { generateFilingPackage } = await import('../lib/pdfGenerator');
      const { combined } = await generateFilingPackage(filing, transactions, Number(year));

      // 4. Trigger download
      const slug = (llcName ?? filing.llc_name ?? 'LLC')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toLowerCase();
      const blob = new Blob([combined], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `FilingPackage_${year}_${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      setStatus('done');
      onSuccess?.();
      setTimeout(() => setStatus('idle'), 3000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(msg);
      setStatus('error');
      console.error('[DownloadPackageButton]', err);
    }
  }

  const isLoading = status === 'fetching' || status === 'generating';

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleDownload}
        disabled={isLoading}
        className={[
          'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
          'transition-all duration-150',
          status === 'done'
            ? 'bg-green-100 text-green-800 border border-green-200'
            : status === 'error'
            ? 'bg-red-100 text-red-800 border border-red-200'
            : isLoading
            ? 'bg-gray-100 text-gray-500 border border-gray-200 cursor-not-allowed'
            : 'bg-teal-600 text-white hover:bg-teal-700 border border-teal-600 cursor-pointer',
        ].join(' ')}
        aria-label={STATUS_LABELS[status]}
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : status === 'done' ? (
          <CheckCircle2 size={16} />
        ) : status === 'error' ? (
          <AlertCircle size={16} />
        ) : (
          <Download size={16} />
        )}
        <span>{STATUS_LABELS[status]}</span>
      </button>

      {isLoading && (
        <p className="text-xs text-gray-500 pl-1">
          {status === 'fetching'   && 'Reading your filing data...'}
          {status === 'generating' && 'Building combined PDF (1120 + 5472)...'}
        </p>
      )}

      {status === 'error' && errorMsg && (
        <p className="text-xs text-red-600 pl-1 max-w-xs">{errorMsg}</p>
      )}
    </div>
  );
}
