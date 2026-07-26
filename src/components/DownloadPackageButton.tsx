/**
 * DownloadPackageButton
 *
 * Fetches a filing + its transactions from Supabase, generates the combined
 * filing package via pdf-lib, and offers it two ways: an in-page PREVIEW modal
 * and a file download.
 *
 * Downloaded file: FilingPackage_<year>_<slug>.pdf
 *   Combined PDF order is owned by generateFilingPackage() in pdfGenerator.ts
 *   (Instructions → reasonable-cause letter, if any → Pro Forma 1120 → Form
 *   7004, if any → owner's Form 5472 with its Part V / Part VI statements →
 *   Form 5472 for each remaining related party). Do not restate the order here
 *   — the previous copy of this comment drifted out of date and described a
 *   sequence the generator had long since stopped producing.
 *
 *   AcroForm fields flattened (values baked in, renders correctly everywhere)
 *
 * pdfGenerator (~480 kB) is dynamically imported on first use.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, CheckCircle2, AlertCircle, Eye } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Filing, Transaction } from '../lib/supabase';
import { PdfPreviewModal } from './PdfPreviewModal';

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

/** The generated package, held so preview and download never rebuild it twice. */
interface BuiltPackage {
  url: string;
  filename: string;
}

export function DownloadPackageButton({ filingId, taxYear, llcName, onSuccess }: Props) {
  const [status, setStatus]     = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [built, setBuilt]       = useState<BuiltPackage | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // The object URL outlives a render, so it is revoked on unmount rather than
  // on a timer — a preview left open must not have its source pulled away.
  const builtRef = useRef<BuiltPackage | null>(null);
  builtRef.current = built;
  useEffect(() => () => {
    if (builtRef.current) URL.revokeObjectURL(builtRef.current.url);
  }, []);

  /** Fetch + generate once, reusing the result on later clicks. */
  const buildPackage = useCallback(async (): Promise<BuiltPackage | null> => {
    if (built) return built;
    try {
      setStatus('fetching');
      setErrorMsg(null);

      const { data: filingData, error: filingErr } = await supabase
        .from('filings')
        .select('*')
        .eq('id', filingId)
        .single();
      if (filingErr || !filingData) throw new Error(filingErr?.message ?? 'Filing not found');

      const { data: txnsData, error: txnsErr } = await supabase
        .from('reportable_transactions')
        .select('*')
        .eq('filing_id', filingId);
      if (txnsErr) throw new Error(txnsErr.message);

      const filing       = filingData as Filing;
      const transactions = (txnsData ?? []) as Transaction[];
      const year         = taxYear ?? filing.tax_year ?? String(new Date().getFullYear() - 1);

      setStatus('generating');
      const { generateFilingPackage } = await import('../lib/pdfGenerator');
      const { combined } = await generateFilingPackage(filing, transactions, Number(year));

      const slug = (llcName ?? filing.llc_name ?? 'LLC')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toLowerCase();
      const blob = new Blob([combined], { type: 'application/pdf' });
      const pkg: BuiltPackage = {
        url: URL.createObjectURL(blob),
        filename: `FilingPackage_${year}_${slug}.pdf`,
      };
      setBuilt(pkg);
      setStatus('idle');
      return pkg;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(msg);
      setStatus('error');
      console.error('[DownloadPackageButton]', err);
      return null;
    }
  }, [built, filingId, llcName, taxYear]);

  const saveToDisk = (pkg: BuiltPackage) => {
    const a = document.createElement('a');
    a.href = pkg.url;
    a.download = pkg.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  async function handleDownload() {
    if (status === 'fetching' || status === 'generating') return;
    const pkg = await buildPackage();
    if (!pkg) return;
    saveToDisk(pkg);
    setStatus('done');
    onSuccess?.();
    setTimeout(() => setStatus('idle'), 3000);
  }

  async function handlePreview() {
    if (status === 'fetching' || status === 'generating') return;
    const pkg = await buildPackage();
    if (pkg) setPreviewOpen(true);
  }

  const isLoading = status === 'fetching' || status === 'generating';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
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

        <button
          onClick={handlePreview}
          disabled={isLoading}
          className={[
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
            'transition-all duration-150 border',
            isLoading
              ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 cursor-pointer',
          ].join(' ')}
        >
          <Eye size={16} />
          <span>Preview</span>
        </button>
      </div>

      {isLoading && (
        <p className="text-xs text-gray-500 pl-1">
          {status === 'fetching'   && 'Reading your filing data...'}
          {status === 'generating' && 'Building your filing package...'}
        </p>
      )}

      {status === 'error' && errorMsg && (
        <p className="text-xs text-red-600 pl-1 max-w-xs">{errorMsg}</p>
      )}

      {previewOpen && built && (
        <PdfPreviewModal
          target={built}
          onClose={() => setPreviewOpen(false)}
          onDownload={() => {
            saveToDisk(built);
            onSuccess?.();
          }}
          title="Filing package preview"
        />
      )}
    </div>
  );
}
