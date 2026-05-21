// SettingsView.tsx — real settings: appearance (theme + accent), BYO key, model.
// No mock account/usage data.
import { type ReactNode, useState } from 'react';
import { Pill } from '../ui/primitives';
import { THEMES, type ThemeName } from '../ui/theme';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { usePersistedState } from '../sidepanel/usePersistedState';
import { useApiKey } from '../key/useApiKey';
import type { UserProfile } from '../agent';

// The bundled registry ships a single Gemini provider; keys are stored per
// provider id in the SW (chrome.storage.session).
const GEMINI_PROVIDER = 'google-gemini';

interface SettingsProps {
  themeName: ThemeName;
  accent: string;
  onThemeChange: (t: ThemeName) => void;
  onAccentChange: (a: string) => void;
}

const THEME_NAMES: ThemeName[] = ['slate', 'cream', 'graphite'];

export function SettingsView({ themeName, accent, onThemeChange, onAccentChange }: SettingsProps) {
  const theme = THEMES[themeName] ?? THEMES.slate;
  const defaultModel = DEFAULT_REGISTRY.defaultModel ?? 'gemini-3.5-flash';
  const [overlayEnabled, setOverlayEnabled] = usePersistedState<boolean>('overlayEnabled', true);
  const [profile, setProfile] = usePersistedState<UserProfile>('userProfile', {});
  const [attachProfile, setAttachProfile] = usePersistedState<boolean>('attachProfile', false);
  const updateProfile = (patch: Partial<UserProfile>) => setProfile({ ...profile, ...patch });

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-section-h">Appearance</div>
        <SettingsRow t="Theme" s="Color mood for the panel">
          <div className="seg">
            {THEME_NAMES.map((name) => (
              <button key={name} type="button" className={'seg-btn' + (themeName === name ? ' is-on' : '')} onClick={() => onThemeChange(name)}>
                {THEMES[name].name}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow t="Accent" s="Highlight color">
          <div className="accent-swatches">
            {theme.accents.map((c) => (
              <button
                key={c}
                type="button"
                className={'accent-swatch' + (accent === c ? ' is-on' : '')}
                style={{ background: c }}
                onClick={() => onAccentChange(c)}
                aria-label={'Accent ' + c}
              />
            ))}
          </div>
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Profile</div>
        <div className="settings-row" style={{ display: 'block' }}>
          <input
            className="settings-input"
            placeholder="Your name"
            value={profile.name ?? ''}
            onChange={(e) => updateProfile({ name: e.target.value })}
            aria-label="Name"
          />
          <input
            className="settings-input"
            style={{ marginTop: 6 }}
            placeholder="Your role (e.g. Product Manager)"
            value={profile.role ?? ''}
            onChange={(e) => updateProfile({ role: e.target.value })}
            aria-label="Role"
          />
          <textarea
            className="settings-input"
            style={{ marginTop: 6, resize: 'none' }}
            rows={3}
            placeholder="Anything Buddy should know about you or how you like answers"
            value={profile.about ?? ''}
            onChange={(e) => updateProfile({ about: e.target.value })}
            aria-label="About"
          />
        </div>
        <SettingsRow t="Personalize replies" s="Include your profile with chat messages">
          <Toggle on={attachProfile} onChange={setAttachProfile} />
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">On web pages</div>
        <SettingsRow t="Floating overlay" s="Show the panel floating over web pages (off = side panel only)">
          <Toggle on={overlayEnabled} onChange={setOverlayEnabled} />
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">API key</div>
        <SettingsRow t="Gemini API key" s="Kept in memory only · used for all cloud calls">
          <ApiKeyControl />
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Model</div>
        <SettingsRow t="Default model" s="Used for chat and skills"><Pill>{defaultModel}</Pill></SettingsRow>
        <SettingsRow t="Computer Use fallback" s="When DOM tools aren't enough"><Pill>gemini-2.5-computer-use</Pill></SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Permissions</div>
        <SettingsRow t="Require confirmation for" s="Consequential actions (send · purchase · delete)"><Pill tone="ok">Always on</Pill></SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Data</div>
        <SettingsRow t="Memory & history" s="Stored locally on this device"><button type="button" className="btn btn-ghost btn-sm">Clear</button></SettingsRow>
        <SettingsRow t="Export skills" s="Download all skills as JSON"><button type="button" className="btn btn-ghost btn-sm">Export</button></SettingsRow>
      </div>
    </div>
  );
}

function SettingsRow({ t, s, children }: { t: string; s: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-l">
        <div>
          <div className="settings-row-t">{t}</div>
          <div className="settings-row-s">{s}</div>
        </div>
      </div>
      <div className="settings-row-r">{children}</div>
    </div>
  );
}

// Inline BYO-key control: shows status (set / not set), reveals a key input on
// "Add key", and saves to the SW via useApiKey (the key never persists to disk).
function ApiKeyControl() {
  const { keyStatus, setKey, validate } = useApiKey(GEMINI_PROVIDER);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  if (!editing) {
    return (
      <div className="settings-row-r" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {keyStatus === 'set' ? (
          <Pill tone="ok">Key set</Pill>
        ) : keyStatus === 'unset' ? (
          <Pill>Not set</Pill>
        ) : null}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            setEditing(true);
            setMsg(null);
          }}
        >
          {keyStatus === 'set' ? 'Replace key' : 'Add key'}
        </button>
        {keyStatus === 'set' ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void setKey('');
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await validate(draft);
      if (!res.ok) {
        setMsg({ tone: 'err', text: res.error ?? 'Key did not validate.' });
        return;
      }
      await setKey(draft);
      setMsg({ tone: 'ok', text: 'Saved.' });
      setDraft('');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
      <input
        type="password"
        className="settings-input"
        placeholder="Paste API key"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        aria-label="API key"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || draft.length === 0}
          onClick={() => {
            void save();
          }}
        >
          {busy ? 'Validating…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setDraft('');
            setMsg(null);
          }}
        >
          Cancel
        </button>
      </div>
      {msg ? <Pill tone={msg.tone === 'ok' ? 'ok' : undefined}>{msg.text}</Pill> : null}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={'toggle' + (on ? ' is-on' : '')} onClick={() => onChange(!on)} aria-pressed={on} aria-label="Toggle">
      <span className="toggle-thumb" />
    </button>
  );
}
