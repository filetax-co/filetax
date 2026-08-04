/**
 * startCheckout - hand a filing to the payment provider.
 *
 * One implementation, called from two places: the end of intake (the normal
 * path, where submit goes straight to payment) and the filing page (the
 * fallback, and the retry after a failed payment). A second copy would be a
 * second place for the error handling to be wrong, on the one screen where
 * being wrong costs a sale.
 *
 * Returns null when checkout has been launched, in which case the tab is
 * already navigating to the provider and the caller must not keep working.
 * Anything else is a message safe to show the filer.
 */
import { supabase } from './supabase';

export async function startCheckout(filingId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: { filing_id: filingId },
  });

  if (!error && data?.url) {
    window.location.assign(data.url);
    return null;
  }

  // The edge function's own message is the useful one ("this filing is already
  // paid", "no products in the cart"). It arrives in the response body rather
  // than in error.message, so it has to be read back off the context.
  let functionMessage = data?.error as string | undefined;
  const context = (error as { context?: Response } | null)?.context;
  if (!functionMessage && context) {
    try {
      const body = await context.clone().json();
      functionMessage = body?.error;
    } catch { /* retain the safe fallback below */ }
  }
  return functionMessage || error?.message || 'Unable to start checkout. Please try again.';
}
