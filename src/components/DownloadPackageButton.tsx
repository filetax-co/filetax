/**
 * DownloadPackageButton
 *
 * Fetches a filing + its transactions from Supabase, generates the complete
 * Form 5472 filing package via pdf-lib, bundles all PDFs into a ZIP, and
 * triggers a browser download.
 *
 * ZIP contents:
 *   1. COMPLETE_FILING_PACKAGE_<year>_<slug>.pdf  — single combined PDF (correct page order)
 *   2. Form_5472_<year>_<slug>.pdf               — standalone Form 5472
 *   3. ProForma_1120_<year>_<slug>.pdf           — standalone Pro Forma 1120
 *   4. Statements_<year>_<slug>.pdf              — Part VI always; Part V if applicable
 *   5. Cover_Letter_<year>_<slug>.pdf            — IRS cover letter
 *   6. Filing_Instructions_<year>_<slug>.pdf     — mailing instructions (omitted if fax)
 *
 * Both pdfGenerator (pdf-lib, ~480 kB) and jszip (~50 kB) are dynamically
 * imported on first click — excluded from initial bundle.
 *
 * Usage:
 *   <DownloadPackageButton filingId="uuid" taxYear="2025" llcName="Acme LLC" />
 */

import { useState } from 'react';
import { Download, Loader2, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Filing, Transaction } from '../lib/supabase';

interface Props {
  filingId: string;
  taxYear?: string;
  llcName?: string;
  /** Optional callback after successful generation */
  onSuccess?: () => void;
}

type Status = 'idle' | 'fetching' | 'generating' | 'bundling' | 'done' | 'error';

const STATUS_LABELS: Record<Status, string> = {
  idle:       'Download Filing Package',
  fetching:   'Loading filing data…',
  generating: 'Generating PDFs…',
  bundling:   'Creating ZIP…',
  done:       'Downloaded!',
  error:      'Failed — try again',
};

export function DownloadPackageButton({ filingId, taxYear, llcName, onSuccess }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleDownload() {
    if (status === 'fetching' || status === 'generating' || status === 'bundling') return;

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

      // 2. Fetch transactions for this filing
      const { data: txnsData, error: txnsErr } = await supabase
        .from('transactions')
        .select('*')
        .eq('filing_id', filingId);
      if (txnsErr) throw new Error(txnsErr.message);

      const filing = filingData as Filing;
      const transactions = (txnsData ?? []) as Transaction[];

      // 3. Generate all PDFs — lazy-load pdfGenerator (~480 kB) only on demand
      setStatus('generating');
      const { generateFilingPackage } = await import('../lib/pdfGenerator');
      const pkg = await generateFilingPackage(filing, transactions);

      // 4. Bundle into ZIP — lazy-load jszip (~50 kB) only on demand
      setStatus('bundling');
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const year = taxYear ?? filing.tax_year ?? String(new Date().getFullYear() - 1);
      const name = llcName ?? filing.llc_name ?? 'LLC';
      const slug = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

      // ── Primary file: single combined PDF (all pages in the correct order) ──
      // This is the file to print and mail. Page order:
      //   Cover Letter → Filing Instructions (if not fax) → Pro Forma 1120 → Form 5472 → Statements
      zip.file(
        `COMPLETE_FILING_PACKAGE_${year}_${slug}.pdf`,
        pkg.combinedPdfBytes
      );

      // ── Individual PDFs for reference / separate review ────────────────────
      zip.file(`Form_5472_${year}_${slug}.pdf`,      pkg.form5472Bytes);
      zip.file(`ProForma_1120_${year}_${slug}.pdf`,  pkg.proForma1120Bytes);
      zip.file(`Statements_${year}_${slug}.pdf`,     pkg.statementsPdfBytes);
      zip.file(`Cover_Letter_${year}_${slug}.pdf`,   pkg.coverLetterBytes);

      if (pkg.filingInstructionsBytes) {
        zip.file(
          `Filing_Instructions_${year}_${slug}.pdf`,
          pkg.filingInstructionsBytes
        );
      }

      // ── README (plain text, human-readable checklist) ─────────────────────
      const statementNote = pkg.hasPartV
        ? '     Statements_*.pdf contains: Part VI disclosure + Part V non-monetary transactions'
        : '     Statements_*.pdf contains: Part VI disclosure (no Part V transactions this year)';

      zip.file('README.txt', [
        `FORM 5472 FILING PACKAGE — TAX YEAR ${year}`,
        `Entity: ${filing.llc_name ?? name}  |  EIN: ${filing.ein ?? 'See Form 5472'}`,
        `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        '',
        '─────────────────────────────────────────────────',
        'FILES IN THIS ZIP',
        '─────────────────────────────────────────────────',
        '',
        '  COMPLETE_FILING_PACKAGE_*.pdf  ← PRINT AND MAIL THIS FILE',
        '     All pages assembled in the correct order for the IRS.',
        '',
        '  Individual PDFs (for review):',
        '     Cover_Letter_*.pdf',
        pkg.filingInstructionsBytes ? '     Filing_Instructions_*.pdf' : '',
        '     ProForma_1120_*.pdf',
        '     Form_5472_*.pdf',
        statementNote,
        '',
        '─────────────────────────────────────────────────',
        'MAILING ADDRESS',
        '─────────────────────────────────────────────────',
        '',
        '  Internal Revenue Service',
        '  1973 Rulon White Blvd',
        '  M/S 6112 Attn: PIN Unit',
        '  Ogden, UT 84201',
        '',
        '─────────────────────────────────────────────────',
        'DUE DATE',
        '─────────────────────────────────────────────────',
        '',
        `  April 15, ${Number(year) + 1}`,
        `  (October 15, ${Number(year) + 1} with timely Form 7004 extension)`,
        '',
        '  Late filing penalty: $25,000 per form (IRC § 6038A(d)).',
        '',
        '─────────────────────────────────────────────────',
        'DISCLAIMER',
        '─────────────────────────────────────────────────',
        '',
        '  This package was generated by FileTax. Review all fields',
        '  with your CPA or tax advisor before filing.',
      ].filter(l => l !== null).join('\n'));

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

      // 5. Trigger download
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `5472_filing_package_${year}_${slug}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      setStatus('done');
      onSuccess?.();

      // Reset to idle after 3s
      setTimeout(() => setStatus('idle'), 3000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrorMsg(msg);
      setStatus('error');
      console.error('[DownloadPackageButton]', err);
    }
  }

  const isLoading = ['fetching', 'generating', 'bundling'].includes(status);

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
        {!isLoading && status === 'idle' && (
          <FileText size={14} className="opacity-60" />
        )}
      </button>

      {/* Progress hint during loading */}
      {isLoading && (
        <p className="text-xs text-gray-500 pl-1">
          {status === 'fetching'   && 'Reading your filing data from database…'}
          {status === 'generating' && 'Generating cover letter, Form 5472, Pro Forma 1120, and statements…'}
          {status === 'bundling'   && 'Assembling combined PDF and packaging ZIP…'}
        </p>
      )}

      {/* Error detail */}
      {status === 'error' && errorMsg && (
        <p className="text-xs text-red-600 pl-1 max-w-xs">{errorMsg}</p>
      )}
    </div>
  );
}
