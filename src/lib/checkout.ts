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
import { edgeFunctionError } from './edgeErrors';

/**
 * `addon` buys ONE thing against a filing that is already paid, rather than
 * re-deriving the whole cart. Today that is the $9 fax, which a filer who did
 * not tick it at intake could otherwise never buy: the entitlement is set on
 * the intake screen and frozen at payment, so the only routes to it were a new
 * filing or an email to support.
 */
export async function startCheckout(
  filingId: string,
  addon?: 'fax',
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', {
    body: { filing_id: filingId, ...(addon ? { addon } : {}) },
  });

  if (!error && data?.url) {
    window.location.assign(data.url);
    return null;
  }

  // The edge function's own message is the useful one ("this filing is already
  // paid", "no products in the cart"). It arrives in the response body rather
  // than in error.message, so it has to be read back off the context. Shared
  // with faxDispatch and the payment screen: see lib/edgeErrors.ts.
  return edgeFunctionError(data, error, 'Unable to start checkout. Please try again.');
}
