/**
 * How many additional Forms 5472 a job is actually billed for.
 *
 * The $25 add-on is priced "per additional Form 5472, per year", and the
 * package generator only produces a 5472 for an additional related party in a
 * year where that party has at least one reportable transaction:
 * `buildYearDocs` filters `filing.parties` on `is_owner || has transactions`.
 *
 * Billing used to count `filings.related_parties.length` on every filing row of
 * the job, which is a different number in two common cases:
 *
 *   • a party carried across a multi-year catch-up but with transactions in
 *     only one of the years, and
 *   • a party added with no transactions at all.
 *
 * Both charged $25 a year for a form that never appeared in the download. This
 * is the one definition of the billable count, and both the cart builder
 * (`create-checkout-session`) and the amount check (`verify-payment`) read it,
 * because the two have to agree or the payment is rejected as tampered.
 *
 * Transactions carry `related_party_index`: 0 is the owner (never billable,
 * their 5472 is the base filing) and 1..n index into `related_parties`.
 */

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (column: string, values: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

type TxRow = { filing_id?: string | null; related_party_index?: number | null };

/** Parties stored on a filing row, however the column happens to be shaped. */
export function storedPartyCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Billable additional parties per filing id: the distinct non-owner party
 * indices that have a transaction in that filing AND still exist on it.
 *
 * A transaction pointing past the end of `related_parties` (a party removed
 * before payment, leaving its rows behind) generates no form, so it bills
 * nothing.
 */
export async function billablePartyCounts(
  supabase: SupabaseLike,
  filings: { id: string; related_parties?: unknown }[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(filings.map((f) => [f.id, 0]));
  if (filings.length === 0) return counts;

  const { data, error } = await supabase
    .from('reportable_transactions')
    .select('filing_id, related_party_index')
    .in('filing_id', filings.map((f) => f.id));
  if (error) throw error;

  const stored = new Map(filings.map((f) => [f.id, storedPartyCount(f.related_parties)]));
  const seen = new Map<string, Set<number>>();
  for (const row of (data ?? []) as TxRow[]) {
    const filingId = row.filing_id ?? '';
    if (!counts.has(filingId)) continue;
    const idx = Number(row.related_party_index ?? 0);
    if (!Number.isInteger(idx) || idx < 1) continue;
    if (idx > (stored.get(filingId) ?? 0)) continue;
    const set = seen.get(filingId) ?? new Set<number>();
    set.add(idx);
    seen.set(filingId, set);
  }
  for (const [filingId, set] of seen) counts.set(filingId, set.size);
  return counts;
}

/** Total billable additional Forms 5472 across every year in a job. */
export async function billablePartyTotal(
  supabase: SupabaseLike,
  filings: { id: string; related_parties?: unknown }[],
): Promise<number> {
  const counts = await billablePartyCounts(supabase, filings);
  let total = 0;
  for (const n of counts.values()) total += n;
  return total;
}
