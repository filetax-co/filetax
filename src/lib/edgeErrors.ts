/**
 * The edge function's own message, not the transport's.
 *
 * On any non-2xx, supabase-js resolves with `data: null` and a FunctionsHttpError
 * whose `message` is the string "Edge Function returned a non-2xx status code".
 * That sentence is what a filer saw on the payment screen when verify-payment
 * answered 402: true, useless, and alarming on the one screen where money has
 * just left their account. The server's own text is on `error.context`, which
 * is the raw Response, and it is the message worth showing: "this filing is
 * already paid", "your payment is still processing", "three attempts spent, the
 * $9 is refundable".
 *
 * This existed three times over, in checkout.ts, faxDispatch.ts and inline in
 * FilingWizard, and the inline copy was the one that was wrong. One function
 * now, so a fourth caller cannot get it wrong again.
 */
export async function edgeFunctionError(
  data: unknown,
  error: unknown,
  fallback: string,
): Promise<string> {
  // Some functions answer 200 with an `error` field; prefer it, it is already parsed.
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

  // `error.message` last, and only when it is not the generic transport line:
  // showing that sentence is the defect this function exists to prevent.
  const message = error instanceof Error ? error.message : undefined;
  if (message && !/non-2xx status code/i.test(message)) return message;
  return fallback;
}
