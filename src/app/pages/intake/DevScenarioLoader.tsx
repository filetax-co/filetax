// src/app/pages/intake/DevScenarioLoader.tsx
//
// Dev-only scenario loader for the intake wizard.
//
// The 100 test scenarios are the fastest way to exercise the form, but typing
// one in by hand takes several minutes and is itself error-prone, which makes
// a failed test ambiguous. This panel takes a pasted scenario and drops it into
// the form's state, so the tester spends their time on the part that matters:
// clicking Continue and reading what the product does.
//
// It fills the SAME state the user's own typing fills. It does not skip
// validation, does not write to Supabase, and does not submit anything, every
// Continue, every error and every generated PDF is the real path. That is the
// difference between this and `npm run seed`, which writes rows straight to the
// database and therefore proves nothing about the form.
//
// Rendered only when import.meta.env.DEV, so it cannot reach production.

import React, { useState } from 'react';

/** Accepts one scenario object, a {scenarios:[...]} file, or a bare array. */
function extractScenario(raw: string, wantedId: string): { scenario?: any; error?: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `Not valid JSON, ${(e as Error).message}` };
  }

  const list: any[] | null = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.scenarios)
      ? parsed.scenarios
      : null;

  if (!list) {
    // A single scenario object.
    if (!parsed || typeof parsed !== 'object') return { error: 'Expected a scenario object.' };
    return { scenario: parsed };
  }

  if (list.length === 0) return { error: 'That file has no scenarios in it.' };
  if (!wantedId.trim()) {
    return {
      error: `That is a file of ${list.length} scenarios, put a scenario number in the box above (${list[0].scenario_id}-${list[list.length - 1].scenario_id}).`,
    };
  }
  const id = Number(wantedId);
  const hit = list.find((s) => Number(s.scenario_id) === id);
  if (!hit) return { error: `No scenario ${id} in that file.` };
  return { scenario: hit };
}

export function DevScenarioLoader({
  onLoad,
}: {
  /** Applies the scenario to the wizard's state; returns a line to show the tester. */
  onLoad: (scenario: any) => string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [id, setId] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; body: string } | null>(null);
  const [scenario, setScenario] = useState<any | null>(null);

  const apply = () => {
    const { scenario: s, error } = extractScenario(text, id);
    if (error || !s) {
      setScenario(null);
      setMsg({ kind: 'err', body: error ?? 'Could not read that.' });
      return;
    }
    try {
      const summary = onLoad(s);
      setScenario(s);
      setMsg({ kind: 'ok', body: summary });
    } catch (e) {
      setScenario(null);
      setMsg({ kind: 'err', body: `Loaded the JSON but could not apply it, ${(e as Error).message}` });
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: '1rem', bottom: '1rem', zIndex: 900,
          padding: '0.5rem 0.9rem', borderRadius: '999px', cursor: 'pointer',
          border: '1px solid var(--tf-border)', background: 'var(--tf-surface)',
          color: 'var(--tf-text)', fontWeight: 700, fontSize: '0.8125rem',
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        }}
      >
        ⚙ Load scenario
      </button>
    );
  }

  const label: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: 'var(--tf-muted)', display: 'block', marginBottom: '0.3rem',
  };
  const field: React.CSSProperties = {
    width: '100%', padding: '0.45rem 0.6rem', borderRadius: '0.375rem',
    border: '1px solid var(--tf-border)', background: 'var(--tf-bg)',
    color: 'var(--tf-text)', fontSize: '0.8125rem',
  };

  return (
    <div
      style={{
        position: 'fixed', right: '1rem', bottom: '1rem', zIndex: 900,
        width: 'min(420px, calc(100vw - 2rem))', maxHeight: 'calc(100vh - 2rem)',
        overflowY: 'auto', padding: '1rem',
        background: 'var(--tf-surface)', border: '1px solid var(--tf-border)',
        borderRadius: '0.75rem', boxShadow: '0 6px 28px rgba(0,0,0,0.28)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Scenario loader <span style={{ color: 'var(--tf-muted)', fontWeight: 500 }}>· dev only</span></strong>
        <button type="button" onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tf-muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ marginBottom: '0.65rem' }}>
        <label style={label} htmlFor="dev-scenario-id">Scenario number (only needed if you paste the whole file)</label>
        <input id="dev-scenario-id" style={field} value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. 42" inputMode="numeric" />
      </div>

      <div>
        <label style={label} htmlFor="dev-scenario-json">Scenario JSON</label>
        <textarea
          id="dev-scenario-json"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder='Paste one scenario object, or the whole filetax_test_scenarios_all100.json and give its number above.'
          style={{ ...field, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.72rem', resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem' }}>
        <button
          type="button"
          onClick={apply}
          style={{ flex: 1, padding: '0.5rem 0.9rem', border: 'none', borderRadius: '0.375rem', background: 'var(--tf-accent)', color: 'var(--tf-on-accent)', fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer' }}
        >
          Fill the form
        </button>
        <button
          type="button"
          onClick={() => { setText(''); setId(''); setMsg(null); setScenario(null); }}
          style={{ padding: '0.5rem 0.9rem', borderRadius: '0.375rem', border: '1px solid var(--tf-border)', background: 'transparent', color: 'var(--tf-text)', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      {msg && (
        <p
          style={{
            marginTop: '0.65rem', marginBottom: 0, fontSize: '0.78rem', lineHeight: 1.5,
            color: msg.kind === 'ok' ? 'var(--tf-text)' : 'var(--tf-error-text)',
          }}
        >
          {msg.body}
        </p>
      )}

      {/* What the tester is looking for, kept next to the form rather than in a
          separate document they would have to hold open on a second screen. */}
      {scenario && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--tf-border)', fontSize: '0.78rem', lineHeight: 1.55 }}>
          <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>
            {scenario.scenario_id}. {scenario.title}
          </div>
          {scenario.tests && <p style={{ margin: '0 0 0.4rem', color: 'var(--tf-muted)' }}>{scenario.tests}</p>}
          {scenario.expected_result && (
            <p style={{ margin: '0 0 0.4rem', color: 'var(--tf-error-text)', fontWeight: 600 }}>
              Expected: {scenario.expected_result}
            </p>
          )}
          {scenario.manual_step && (
            <p style={{ margin: '0 0 0.4rem' }}><strong>Do this:</strong> {scenario.manual_step}</p>
          )}
          {scenario.note && <p style={{ margin: 0, color: 'var(--tf-muted)' }}>{scenario.note}</p>}
        </div>
      )}
    </div>
  );
}
