/**
 * The live password checklist shown on signup and on reset.
 *
 * It used to render only PASSWORD_RULES, the five character-class checks, which
 * are synchronous and cheap. But signup enforces two more gates on submit: the
 * zxcvbn strength score and the HaveIBeenPwned breach lookup. Neither appeared
 * here, so a password like a name with leet substitutions and a digit suffix
 * ticked all five rows green and was then rejected on submit with zxcvbn's own
 * suggestion text. From the filer's side that reads as the form contradicting
 * itself, and a filer who cannot tell what the form wants abandons signup.
 *
 * So the strength gate now gets a row of its own, evaluated as they type. The
 * breach check deliberately does not: it is a network call per keystroke
 * against a third party, and it is the rarer failure. It stays on submit.
 *
 * The strength row is asynchronous (zxcvbn is lazy-loaded and the scorer is not
 * free on a long password), so it debounces and drops out-of-order results.
 * Until the first result lands it renders as pending rather than as failing,
 * because a row that flashes red before it has scored anything teaches the
 * filer to ignore it.
 */
import { useState, useEffect, useRef } from 'react';
import {
  PASSWORD_RULES,
  ruleStatus,
  checkStrength,
  MIN_STRENGTH_SCORE,
} from '../../lib/passwordSecurity';

const DEBOUNCE_MS = 250;

const LIST_STYLE: React.CSSProperties = {
  listStyle: 'none',
  margin: '0.625rem 0 0',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.8125rem',
};

type StrengthState = { status: 'idle' | 'checking' | 'done'; ok: boolean; feedback: string };

/** Scores `password` with zxcvbn on a debounce, ignoring stale results. */
function useStrength(password: string): StrengthState {
  const [state, setState] = useState<StrengthState>({ status: 'idle', ok: false, feedback: '' });
  // Bumped on every change; a result is only applied if its id is still current.
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;

    if (!password) {
      setState({ status: 'idle', ok: false, feedback: '' });
      return;
    }

    setState((prev) => ({ ...prev, status: 'checking' }));

    const timer = setTimeout(() => {
      checkStrength(password)
        .then(({ score, feedback }) => {
          if (id !== requestId.current) return;
          setState({ status: 'done', ok: score >= MIN_STRENGTH_SCORE, feedback });
        })
        .catch(() => {
          // zxcvbn failed to load. Leave the row pending rather than asserting
          // a pass or a fail we did not compute; submit still runs the gate.
          if (id !== requestId.current) return;
          setState({ status: 'idle', ok: false, feedback: '' });
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [password]);

  return state;
}

function Row({ met, pending, label }: { met: boolean; pending: boolean; label: string }) {
  const color = pending ? 'var(--tf-muted)' : met ? '#059669' : 'var(--tf-muted)';
  return (
    <li style={{ ...ROW_STYLE, color }}>
      <span aria-hidden="true" style={{ fontWeight: 700, width: '0.9rem', display: 'inline-block' }}>
        {met ? '✓' : '○'}
      </span>
      {label}
    </li>
  );
}

export function PasswordChecklist({ password }: { password: string }) {
  const status = ruleStatus(password);
  const strength = useStrength(password);
  const strengthMet = strength.status === 'done' && strength.ok;
  const strengthPending = strength.status !== 'done';

  return (
    <>
      <ul style={LIST_STYLE}>
        {PASSWORD_RULES.map((r) => (
          <Row key={r.key} met={status[r.key]} pending={false} label={r.label} />
        ))}
        <Row
          met={strengthMet}
          pending={strengthPending}
          label="Not an easily guessed password"
        />
      </ul>
      {/* zxcvbn's own suggestion, e.g. "Add another word or two." Shown only
          once we have actually scored a failing password, so it never appears
          next to a row that is still pending. */}
      {strength.status === 'done' && !strength.ok && strength.feedback && (
        <p
          role="status"
          style={{
            margin: '0.375rem 0 0 1.3rem',
            fontSize: '0.8125rem',
            color: 'var(--tf-muted)',
            lineHeight: 1.45,
          }}
        >
          {strength.feedback}
        </p>
      )}
    </>
  );
}
