// SettingsView.tsx — real settings: appearance (theme + accent), BYO key, model.
// No mock account/usage data.
import { type ReactNode, useEffect, useState } from 'react';
import { Pill } from '../ui/primitives';
import { THEMES, type ThemeName } from '../ui/theme';
import { selectableModels, useActiveModel } from '../llm/modelPref';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { generateViaBackground } from '../llm/instance';
import { loadUserRegistry, mergeRegistry, saveUserModel } from '../llm/userRegistry';
import type { ModelConfig } from '../llm/types';
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
  // Effective model list = bundled floor + user overlay (FR-MR-8).
  const [models, setModels] = useState<ModelConfig[]>(selectableModels());
  const reloadModels = () => {
    void loadUserRegistry().then((u) => {
      const merged = mergeRegistry(DEFAULT_REGISTRY, u);
      setModels(Object.values(merged.models).filter((m) => m.enabled !== false && m.capabilities?.tools !== false));
    });
  };
  useEffect(() => {
    reloadModels();
  }, []);
  const [overlayEnabled, setOverlayEnabled] = usePersistedState<boolean>('overlayEnabled', true);
  const [profiles, setProfiles] = usePersistedState<Profiles>('userProfiles', EMPTY_PROFILES);
  const [activeProfile, setActiveProfile] = usePersistedState<ProfileKind>('activeProfile', 'professional');
  const [attachProfile, setAttachProfile] = usePersistedState<boolean>('attachProfile', false);
  const [askBeforePlan, setAskBeforePlan] = usePersistedState<boolean>('askBeforePlan', true);
  const [preferNano, setPreferNano] = usePersistedState<boolean>('preferNano', false);
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
            style={{ maxWidth: 150 }}
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
        <SettingsRow t="Test the active model" s="A tiny live call: latency + status">
          <ModelTestButton model={activeModel} />
        </SettingsRow>
        <SettingsRow t="Prefer on-device (Nano)" s="Short private chats run on-device when available — $0, no upload">
          <Toggle on={preferNano} onChange={setPreferNano} />
        </SettingsRow>
        <ModelEditor onAdded={reloadModels} />
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
        <SettingsRow t="Review plans before running" s="Approve the agent's plan before it acts">
          <Toggle on={askBeforePlan} onChange={setAskBeforePlan} />
        </SettingsRow>
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

// FR-MR-12/13: a tiny live call against a model → latency + green/red status;
// an invalid model fails fast with a clear error.
function ModelTestButton({ model }: { model: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; ms?: number; error?: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setStatus(null);
    const t0 = performance.now();
    try {
      await generateViaBackground({ model, messages: [{ role: 'user', content: 'ping' }], params: { maxOutputTokens: 1 } });
      setStatus({ ok: true, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      setStatus({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run()}>
        {busy ? 'Testing…' : 'Test'}
      </button>
      {status &&
        (status.ok ? (
          <Pill tone="ok">✓ {status.ms} ms</Pill>
        ) : (
          <span style={{ color: '#B91C1C', fontSize: 12 }}>{(status.error ?? 'failed').slice(0, 44)}</span>
        ))}
    </div>
  );
}

// FR-MR-8: add a Gemini model entry in-app (id, display name, pricing, caps).
// Stored in the user overlay and merged over the bundled registry.
function ModelEditor({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [inP, setInP] = useState('0.3');
  const [outP, setOutP] = useState('2.5');
  const [tools, setTools] = useState(true);
  const [vision, setVision] = useState(true);

  const add = async () => {
    if (!id.trim()) return;
    const model: ModelConfig = {
      id: id.trim(),
      provider: 'google-gemini',
      displayName: name.trim() || id.trim(),
      contextWindow: 1_048_576,
      maxOutputTokens: 8192,
      pricing: { inputPerMTok: Number(inP) || 0, outputPerMTok: Number(outP) || 0 },
      capabilities: { tools, vision, jsonMode: true, streaming: true },
      enabled: true,
    };
    await saveUserModel(model);
    setOpen(false);
    setId('');
    setName('');
    onAdded();
  };

  if (!open) {
    return (
      <SettingsRow t="Custom model" s="Add a Gemini model id by config (no code change)">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>+ Add</button>
      </SettingsRow>
    );
  }
  return (
    <div className="settings-row" style={{ display: 'block' }}>
      <input className="settings-input" placeholder="Model id (e.g. gemini-3-pro)" value={id} onChange={(e) => setId(e.target.value)} aria-label="Model id" />
      <input className="settings-input" style={{ marginTop: 6 }} placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Model display name" />
      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
        <span style={{ color: 'var(--panel-muted)', fontSize: 12 }}>$/M</span>
        <input className="settings-input" style={{ width: 80 }} type="number" step="0.1" value={inP} onChange={(e) => setInP(e.target.value)} aria-label="Input price per M tokens" />
        <input className="settings-input" style={{ width: 80 }} type="number" step="0.1" value={outP} onChange={(e) => setOutP(e.target.value)} aria-label="Output price per M tokens" />
        <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={tools} onChange={(e) => setTools(e.target.checked)} /> tools
        </label>
        <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} /> vision
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!id.trim()} onClick={() => void add()}>Add model</button>
      </div>
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
