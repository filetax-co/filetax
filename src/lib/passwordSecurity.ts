/**
 * passwordSecurity.ts
 * -------------------
 * Two independent password-security checks used on signup:
 *
 *  1. strengthScore, zxcvbn offline strength check (0–4).
 *                      Blocks common, guessable, and pattern-based passwords.
 *
 *  2. isBreached, HaveIBeenPwned k-anonymity range API.
 *                      Checks if the exact password appeared in a known breach.
 *                      Only the first 5 chars of the SHA-1 hash are sent; the
 *                      full password never leaves the browser.
 *
 * Both are called in Portal.tsx during signup, strength check runs first
 * (fast, offline), HIBP only runs if the password passes strength.
 */

// ---------------------------------------------------------------------------
// 0. Explicit character-class requirements (synchronous, for live checklist)
// ---------------------------------------------------------------------------
//
// These are the rules we SHOW the user up front and tick off live as they type,
// so they know what's expected before submitting instead of after a rejection.
// The zxcvbn strength score and the breach check below are additional gates run
// on submit.

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRule {
  key: string;
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { key: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { key: 'lower', label: 'One lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { key: 'upper', label: 'One uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { key: 'number', label: 'One number (0-9)', test: (p) => /[0-9]/.test(p) },
  { key: 'symbol', label: 'One symbol (!?@#$…)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** True when the password satisfies every character-class requirement. */
export function meetsAllRules(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

/** Which rules currently pass, used to render the live checklist. */
export function ruleStatus(password: string): Record<string, boolean> {
  return Object.fromEntries(PASSWORD_RULES.map((r) => [r.key, r.test(password)]));
}

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
    // Network error or SubtleCrypto unavailable, fail open.
    console.warn('[passwordSecurity] HIBP check error:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 3. Combined validator, used by Portal.tsx on signup submit
// ---------------------------------------------------------------------------

export interface PasswordValidationResult {
  ok: boolean;
  error: string;
}

/**
 * Runs, in order: explicit character-class rules, zxcvbn strength, then the
 * breach check. Returns { ok: true } when the password passes all, or
 * { ok: false, error } with a user-facing message on the first failure.
 */
export async function validatePassword(
  password: string,
): Promise<PasswordValidationResult> {
  // Step 0, explicit requirements (length + character classes). These are the
  // same rules shown as a live checklist next to the field.
  if (!meetsAllRules(password)) {
    const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label.toLowerCase());
    return {
      ok: false,
      error: `Your password still needs: ${missing.join(', ')}.`,
    };
  }

  // Step 1, strength
  const { score, feedback } = await checkStrength(password);
  if (score < 3) {
    return {
      ok: false,
      error: feedback || 'Password is too weak. Try adding numbers, symbols, or more words.',
    };
  }

  // Step 2, breach check
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
