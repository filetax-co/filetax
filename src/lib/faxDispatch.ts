import { supabase } from './supabase';

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
    throw new Error(await failureMessage(data, error));
  }
  return data as FaxDispatchResult;
}

/**
 * The edge function's own message, not the transport's.
 *
 * On any non-2xx, supabase-js resolves with `data: null` and a FunctionsHttpError
 * whose message is the generic "Edge Function returned a non-2xx status code".
 * Reading `data.error` therefore never saw the server's text, and every
 * deliberate message was unreachable: the 403 entitlement refusal, the 502 Sinch
 * failure, and above all the 409 that tells a filer whose three attempts are
 * spent that their $9 is refundable. The body is on `error.context`, which is
 * the raw Response.
 */
async function failureMessage(data: unknown, error: unknown): Promise<string> {
  const fallback = 'The fax could not be submitted.';
  const inline = (data as { error?: unknown } | null)?.error;
  if (typeof inline === 'string' && inline) return inline;

  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (typeof body?.error === 'string' && body.error) return body.error;
    } catch {
      // A non-JSON body tells the filer nothing useful; fall through.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
