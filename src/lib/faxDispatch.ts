import { supabase } from './supabase';
import { edgeFunctionError } from './edgeErrors';

export interface FaxDispatchResult {
  status: 'dispatching' | 'submitted' | 'delivered';
  fax_id?: string;
  duplicate?: boolean;
}

/**
 * Sends the final signed PDF to the authenticated edge function. The PDF is
 * held only in memory and is not uploaded to Supabase Storage.
 */
export async function dispatchIrsFax(
  filingId: string,
  pdf: Uint8Array,
): Promise<FaxDispatchResult> {
  const body = new FormData();
  body.set('filing_id', filingId);
  body.set('file', new Blob([pdf], { type: 'application/pdf' }), `filetax-${filingId}.pdf`);

  const { data, error } = await supabase.functions.invoke('dispatch-irs-fax', { body });
  if (error || !data || !['dispatching', 'submitted', 'delivered'].includes(data.status)) {
    throw new Error(await edgeFunctionError(data, error, 'The fax could not be submitted.'));
  }
  return data as FaxDispatchResult;
}
