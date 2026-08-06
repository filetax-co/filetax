// src/lib/money.ts
//
// One place to render a transaction amount for the screen.
//
// WHY THIS EXISTS
// Every call site used a bare `Number(x).toLocaleString()`, whose default is
// `maximumFractionDigits: 3` and `minimumFractionDigits: 0`. That renders
// 1234567.89 correctly and 12500.50 as "12,500.5", because the trailing zero is
// not significant to the formatter and very much is to someone checking their
// own figures on a form they are about to sign. The transaction card, the
// review page and the post-payment package page all showed it.
//
// Whole amounts keep their plain form: 1312768 stays "1,312,768", not
// "1,312,768.00". Cents appear only when there are cents, and then always both
// of them.

/** Grouped digits, with exactly two decimals when the amount has any. */
export function formatAmount(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || !Number.isFinite(n)) return '';
  const hasCents = Math.abs(n % 1) > 1e-9;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}

/** The same, prefixed "USD ", which is how the intake and package pages label it. */
export function formatUsd(value: number | string | null | undefined): string {
  const out = formatAmount(value);
  return out ? `USD ${out}` : '';
}
