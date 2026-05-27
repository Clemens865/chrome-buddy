// First-run onboarding (FR-ONB-1..4): obtain + paste + live-validate a Gemini
// key, explain where the key is kept, and gate cloud features until it's set.
// Shown by PanelApp until the user finishes or skips (on-device features and
// browsing can still work without a key).
import { useState } from 'react';
import { Ic } from '../ui/icons';
import { useApiKey } from '../key/useApiKey';

const GEMINI_PROVIDER = 'google-gemini';
const GET_KEY_URL = 'https://aistudio.google.com/apikey';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { keyStatus, setKey, validate } = useApiKey(GEMINI_PROVIDER);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const alreadySet = keyStatus === 'set';

  const validateAndSave = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await validate(key); // FR-ONB-2: live test call before completing
      if (!res.ok) {
        setError(res.error || 'That key was rejected. Check it and try again.');
        return;
      }
      await setKey(key);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onb">
      <div className="onb-card">
        <div className="onb-mark onb-mark-logo">
          <img src="/icon.svg" alt="Chrome Buddy" width={120} height={120} />
        </div>
        <h1 className="onb-title">Welcome to Chrome Buddy</h1>
        <p className="onb-sub">
          Your agentic browser assistant. Bring your own Google&nbsp;Gemini key — Buddy makes all
          cloud calls with it and shows you the running cost.
        </p>

        {alreadySet ? (
          <div className="onb-ok">
            <span className="ic">{Ic.check}</span> A Gemini key is already configured.
          </div>
        ) : (
          <>
            <a className="onb-link" href={GET_KEY_URL} target="_blank" rel="noreferrer">
              Get a free Gemini API key →
            </a>
            <input
              className="settings-input onb-input"
              type="password"
              placeholder="Paste your Gemini API key"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Gemini API key"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void validateAndSave();
              }}
            />
            {error && <div className="onb-error">{error}</div>}
            {/* Unrestricted API keys stop working on 2026-06-19 — nudge users
                to scope their key when creating it. */}
            <p className="onb-note onb-note-warn" role="note">
              Tip: when creating the key, restrict it to{' '}
              <code>generativelanguage.googleapis.com</code>. Google is disabling
              unrestricted keys soon.
            </p>
          </>
        )}

        <div className="onb-actions">
          {alreadySet ? (
            <button type="button" className="btn btn-primary" onClick={onDone}>Get started</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy || !draft.trim()} onClick={() => void validateAndSave()}>
              {busy ? 'Validating…' : 'Validate & continue'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Skip for now</button>
        </div>

        <p className="onb-note">
          Your key is kept in memory for this browser session only — never written to disk.
          Free-tier Gemini usage may be used by Google to improve their models; use a paid key for
          sensitive work.
        </p>
      </div>
    </div>
  );
}
