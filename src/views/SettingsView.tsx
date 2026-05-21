// SettingsView.tsx — real settings: appearance (theme + accent), BYO key, model.
// No mock account/usage data.
import { type ReactNode, useEffect, useState } from 'react';
import { Pill } from '../ui/primitives';
import { THEMES, type ThemeName } from '../ui/theme';
import { selectableModels, useActiveModel } from '../llm/modelPref';
import { usePersistedState } from '../sidepanel/usePersistedState';
import { useApiKey } from '../key/useApiKey';
import { isFsSupported, pickRootFolder, forgetRootFolder, rootFolderName } from '../fs/root';
import { BUDGET_KEYS, BUDGET_DEFAULTS } from '../cost/budget';
import { EMPTY_PROFILES, type UserProfile, type Profiles, type ProfileKind } from '../agent';
import { clearHistory } from '../memory/request';

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
  const [activeModel, setActiveModel] = useActiveModel();
  const models = selectableModels();
  const [overlayEnabled, setOverlayEnabled] = usePersistedState<boolean>('overlayEnabled', true);
  const [profiles, setProfiles] = usePersistedState<Profiles>('userProfiles', EMPTY_PROFILES);
  const [activeProfile, setActiveProfile] = usePersistedState<ProfileKind>('activeProfile', 'professional');
  const [attachProfile, setAttachProfile] = usePersistedState<boolean>('attachProfile', false);
  const current: UserProfile = profiles[activeProfile] ?? {};
  const updateProfile = (patch: Partial<UserProfile>) =>
    setProfiles({ ...profiles, [activeProfile]: { ...current, ...patch } });

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
        <SettingsRow t="Active profile" s="Which profile Buddy uses when personalizing">
          <div className="seg">
            {(['professional', 'personal'] as ProfileKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={'seg-btn' + (activeProfile === k ? ' is-on' : '')}
                onClick={() => setActiveProfile(k)}
                style={{ textTransform: 'capitalize' }}
              >
                {k}
              </button>
            ))}
          </div>
        </SettingsRow>
        <div className="settings-row" style={{ display: 'block' }}>
          <input
            className="settings-input"
            placeholder="Your name"
            value={current.name ?? ''}
            onChange={(e) => updateProfile({ name: e.target.value })}
            aria-label="Name"
          />
          <input
            className="settings-input"
            style={{ marginTop: 6 }}
            placeholder={activeProfile === 'professional' ? 'Role / company (e.g. PM at Acme)' : 'How you describe yourself'}
            value={current.role ?? ''}
            onChange={(e) => updateProfile({ role: e.target.value })}
            aria-label="Role"
          />
          <textarea
            className="settings-input"
            style={{ marginTop: 6, resize: 'none' }}
            rows={3}
            placeholder={
              activeProfile === 'professional'
                ? 'What you do, your goals, how you like work answers'
                : 'Interests, background, tone you prefer'
            }
            value={current.about ?? ''}
            onChange={(e) => updateProfile({ about: e.target.value })}
            aria-label="About"
          />
        </div>
        <SettingsRow t="Personalize replies" s="Attach the active profile to chat messages">
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
        <SettingsRow t="Gemini API key" s="Kept in memory for this browser session — never written to disk">
          <ApiKeyControl />
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Model</div>
        <SettingsRow t="Active model" s="Used for chat, agent runs, and skills">
          <select
            className="settings-input"
            style={{ maxWidth: 180 }}
            aria-label="Active model"
            value={activeModel}
            onChange={(e) => setActiveModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow t="Computer Use fallback" s="When DOM tools aren't enough"><Pill>gemini-2.5-computer-use</Pill></SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Budget</div>
        <SettingsRow t="Per-run cap" s="Stop an agent run at this spend">
          <BudgetInput k={BUDGET_KEYS.perRun} def={BUDGET_DEFAULTS.perRun} step={0.05} />
        </SettingsRow>
        <SettingsRow t="Daily cap" s="Pause new runs after this much spend today">
          <BudgetInput k={BUDGET_KEYS.perDay} def={BUDGET_DEFAULTS.perDay} step={1} />
        </SettingsRow>
        <SettingsRow t="Step budget" s="Max plan steps per agent run">
          <BudgetInput k={BUDGET_KEYS.steps} def={BUDGET_DEFAULTS.steps} step={1} dollar={false} />
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Files</div>
        <SettingsRow t="Root folder" s="Read/write files here (read_file · write_file · save)">
          <RootFolderControl />
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Permissions</div>
        <SettingsRow t="Require confirmation for" s="Consequential actions (send · purchase · delete)"><Pill tone="ok">Always on</Pill></SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Data</div>
        <SettingsRow t="Memory & history" s="Stored locally on this device"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void clearHistory()}>Clear</button></SettingsRow>
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

// A persisted numeric budget field ($ or count). 0 = no cap.
function BudgetInput({ k, def, step, dollar = true }: { k: string; def: number; step: number; dollar?: boolean }) {
  const [value, setValue] = usePersistedState<number>(k, def);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {dollar && <span style={{ color: 'var(--panel-muted)' }}>$</span>}
      <input
        type="number"
        className="settings-input"
        style={{ width: 78, textAlign: 'right' }}
        min={0}
        step={step}
        value={value}
        aria-label={k}
        onChange={(e) => setValue(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

// Root-folder picker: choose a folder once (gesture), shows its name, forget it.
function RootFolderControl() {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = isFsSupported();

  useEffect(() => {
    void rootFolderName().then(setName);
  }, []);

  if (!supported) {
    return <Pill>Not supported in this browser</Pill>;
  }

  const choose = async () => {
    setBusy(true);
    try {
      const picked = await pickRootFolder();
      if (picked) setName(picked);
    } catch {
      // user dismissed the picker — ignore
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    await forgetRootFolder();
    setName(null);
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {name && <Pill tone="ok">{name}</Pill>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void choose()}>
        {name ? 'Change' : 'Choose folder'}
      </button>
      {name && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void forget()}>
          Forget
        </button>
      )}
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
