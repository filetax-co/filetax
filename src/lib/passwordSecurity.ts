/**
 * passwordSecurity.ts
 * -------------------
 * Two independent password-security checks used on signup:
 *
 *  1. strengthScore  — zxcvbn offline strength check (0–4).
 *                      Blocks common, guessable, and pattern-based passwords.
 *
 *  2. isBreached     — HaveIBeenPwned k-anonymity range API.
 *                      Checks if the exact password appeared in a known breach.
 *                      Only the first 5 chars of the SHA-1 hash are sent; the
 *                      full password never leaves the browser.
 *
 * Both are called in Portal.tsx during signup — strength check runs first
 * (fast, offline), HIBP only runs if the password passes strength.
 */

// ---------------------------------------------------------------------------
// 1. Strength check via zxcvbn (lazy-loaded to keep initial bundle small)
// ---------------------------------------------------------------------------

let zxcvbnModule: typeof import('zxcvbn') | null = null;

async function getZxcvbn() {
  if (!zxcvbnModule) {
    zxcvbnModule = (await import('zxcvbn')).default as unknown as typeof import('zxcvbn');
  }
  return zxcvbnModule;
}

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  feedback: string; // first suggestion from zxcvbn, or a default message
}

export async function checkStrength(password: string): Promise<StrengthResult> {
  const zxcvbn = await getZxcvbn();
  const result = zxcvbn(password);
  const feedback =
    result.feedback.suggestions[0] ??
    (result.score < 3
      ? 'Try a longer password with a mix of letters, numbers, and symbols.'
      : '');
  return { score: result.score as 0 | 1 | 2 | 3 | 4, feedback };
}

// ---------------------------------------------------------------------------
// 2. Breach check via HaveIBeenPwned k-anonymity range API
// ---------------------------------------------------------------------------

/**
 * Returns true if the password appears in the HIBP breach database.
 * Uses the k-anonymity model: only the first 5 hex chars of the SHA-1
 * hash are sent to the API. The full password is never transmitted.
 */
export async function isBreached(password: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      // Add-Padding prevents traffic-analysis attacks on the range request.
      headers: { 'Add-Padding': 'true' },
    });

    if (!response.ok) {
      // If HIBP is unreachable, fail open (don't block the user).
      console.warn('[passwordSecurity] HIBP request failed:', response.status);
      return false;
    }

    const text = await response.text();
    return text
      .split('\n')
      .some((line) => line.split(':')[0] === suffix);
  } catch (err) {
    // Network error or SubtleCrypto unavailable — fail open.
    console.warn('[passwordSecurity] HIBP check error:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 3. Combined validator — used by Portal.tsx on signup submit
// ---------------------------------------------------------------------------

export interface PasswordValidationResult {
  ok: boolean;
  error: string;
}

/**
 * Run strength check then breach check in sequence.
 * Returns { ok: true } when the password passes both, or { ok: false, error }
 * with a user-facing message on the first failure.
 *
 * Minimum length (8 chars) is checked inline in Portal.tsx before calling
 * this function, so we only need score >= 3 and not-breached here.
 */
export async function validatePassword(
  password: string,
): Promise<PasswordValidationResult> {
  // Step 1 — strength
  const { score, feedback } = await checkStrength(password);
  if (score < 3) {
    return {
      ok: false,
      error: feedback || 'Password is too weak. Try adding numbers, symbols, or more words.',
    };
  }

  // Step 2 — breach check
  const breached = await isBreached(password);
  if (breached) {
    return {
      ok: false,
      error:
        'This password has appeared in a known data breach. Please choose a different one.',
    };
  }

  return { ok: true, error: '' };
}
