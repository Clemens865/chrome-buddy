// AppsView.tsx — apps grid launcher + shared app metadata + micro-app header.
// Also hosts Tier-1 app generation: describe a tool in natural language, Buddy
// emits a validated declarative config (a form + prompt template), it's saved
// and shown in the grid, and runs via a generic engine (no code — pure data).
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Ic } from '../ui/icons';
import { hexAlpha } from '../ui/theme';
import { Markdown } from '../ui/Markdown';
import { generateViaBackground } from '../llm/instance';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { runPlainChat } from '../agent';
import { useActiveModel } from '../llm/modelPref';
import { fetchApps, persistApp, removeApp } from '../apps/request';
import { parseAppConfig, parseCodeApp, renderTemplate, APP_BUILDER_SYSTEM, CODE_APP_BUILDER_SYSTEM } from '../apps/build';
import { runInSandbox } from '../sandbox/host';
import type { AppConfig } from '../apps/types';

export type AppId = 'console' | 'image' | 'transcriber' | 'livescribe';

/** Chat presets launched from an app card instead of opening an app view.
 *  (Kept as a hook for future preset cards — Summarizer used to live here but
 *  was removed from the grid per the apps-vs-chat-decision memory: anything
 *  that's just "preset a chat prompt" doesn't earn an app card. Ask in chat.) */
export type AppPreset = { prompt: string; mode: 'auto' | 'ask' | 'agent' };
const PRESETS: Record<string, AppPreset> = {};

export interface AppMeta {
  id: string;
  icon: ReactElement;
  name: string;
  desc: string;
  color: string;
  running?: boolean;
}

export const APPS: AppMeta[] = [
  { id: 'console', icon: Ic.console, name: 'Console Inspector', desc: 'Read console logs and explain errors.', color: '#10B981' },
  { id: 'image', icon: Ic.image, name: 'Image Generator', desc: 'Generate images from a prompt.', color: '#A78BFA' },
  { id: 'transcriber', icon: Ic.mic, name: 'Audio Transcriber', desc: 'Turn an audio file into text.', color: '#0EA5E9' },
  { id: 'livescribe', icon: Ic.mic, name: 'Live Transcriber', desc: 'Live mic → text in real time (Gemini Live).', color: '#06B6D4' },
  { id: 'scrape', icon: Ic.scrape, name: 'Scrape to Table', desc: 'Extract structured data to CSV.', color: '#F43F5E' },
  { id: 'watch', icon: Ic.watch, name: 'Price Watch', desc: 'Ping me when something changes.', color: '#6366F1' },
];

export function appById(id: string): AppMeta {
  return APPS.find((a) => a.id === id) ?? APPS[0];
}

const GEN_COLOR = '#8B5CF6';

export function AppsView({
  onOpenApp,
  onPreset,
  recents = ['console', 'image'],
}: {
  onOpenApp: (id: AppId) => void;
  onPreset: (preset: AppPreset) => void;
  recents?: string[];
}) {
  const openable = new Set<AppId>(['console', 'image', 'transcriber', 'livescribe']);
  const open = (id: string) => {
    if (PRESETS[id]) {
      onPreset(PRESETS[id]); // chat-coverable (e.g. Summarizer) → seed a chat prompt
      return;
    }
    if (openable.has(id as AppId)) onOpenApp(id as AppId);
  };

  const [genApps, setGenApps] = useState<AppConfig[]>([]);
  const [openGen, setOpenGen] = useState<AppConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [tier, setTier] = useState<1 | 2>(1);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = () => fetchApps().then(setGenApps);
  useEffect(() => {
    void refresh();
  }, []);

  const generate = async () => {
    if (!desc.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await generateViaBackground({
        model: DEFAULT_REGISTRY.defaultModel,
        messages: [
          { role: 'system', content: tier === 2 ? CODE_APP_BUILDER_SYSTEM : APP_BUILDER_SYSTEM },
          { role: 'user', content: desc },
        ],
        params: { jsonMode: true },
      });
      const cfg = tier === 2 ? parseCodeApp(res.text) : parseAppConfig(res.text);
      if (!cfg) {
        setError('Could not build an app from that. Try describing inputs and output more concretely.');
        return;
      }
      await persistApp(cfg);
      setCreating(false);
      setDesc('');
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (openGen) {
    return <GeneratedApp app={openGen} onBack={() => setOpenGen(null)} />;
  }

  return (
    <div className="apps">
      <div className="apps-search">
        <input className="apps-search-input" placeholder="Search apps…" />
      </div>
      <div className="apps-section-h">Recent</div>
      <div className="apps-grid">
        {recents.map((id) => <AppCard key={id} app={appById(id)} onOpen={() => open(id)} />)}
      </div>

      {genApps.length > 0 && (
        <>
          <div className="apps-section-h">Your generated apps</div>
          <div className="apps-grid">
            {genApps.map((a) => (
              <AppCard
                key={a.id}
                app={{ id: a.id, icon: Ic.sparkle, name: a.name, desc: a.tier === 2 ? `${a.description} · sandboxed` : a.description, color: GEN_COLOR }}
                onOpen={() => setOpenGen(a)}
                onDelete={async () => {
                  await removeApp(a.id);
                  void refresh();
                }}
              />
            ))}
          </div>
        </>
      )}

      <div className="apps-section-h">All apps</div>
      <div className="apps-grid">
        {APPS.map((a) => <AppCard key={a.id} app={a} onOpen={() => open(a.id)} />)}
      </div>

      {creating ? (
        <div className="settings-row" style={{ display: 'block', marginTop: 10 }}>
          <div className="seg seg-sm" role="group" aria-label="App type" style={{ marginBottom: 6 }}>
            <button type="button" className={'seg-btn' + (tier === 1 ? ' is-on' : '')} aria-pressed={tier === 1} onClick={() => setTier(1)}>
              Prompt app
            </button>
            <button type="button" className={'seg-btn' + (tier === 2 ? ' is-on' : '')} aria-pressed={tier === 2} onClick={() => setTier(2)}>
              Code app (sandboxed)
            </button>
          </div>
          <textarea
            className="settings-input"
            style={{ resize: 'none' }}
            rows={3}
            placeholder={
              tier === 2
                ? 'Describe a deterministic transform (e.g. count words and characters; convert CSV to JSON; slugify a title)'
                : 'Describe an app to generate (e.g. rewrite text in a tone I choose; or a tweet-thread drafter from notes)'
            }
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            aria-label="App description"
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !desc.trim()} onClick={() => void generate()}>
              {busy ? 'Generating…' : 'Generate app'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
          </div>
          {error && <div className="empty-state-desc" style={{ color: '#B91C1C', marginTop: 6 }}>{error}</div>}
        </div>
      ) : (
        <div className="apps-foot">
          <button type="button" className="apps-add" onClick={() => setCreating(true)}><span className="ic">{Ic.plus}</span>Generate app from a description</button>
        </div>
      )}
    </div>
  );
}

function AppCard({ app, onOpen, onDelete }: { app: AppMeta; onOpen: () => void; onDelete?: () => void | Promise<void> }) {
  return (
    <div className="app-card-wrap">
      <button type="button" className="app-card" onClick={onOpen}>
        <span className="app-card-ic" style={{ color: app.color, background: hexAlpha(app.color, 0.12) }}>{app.icon}</span>
        <div className="app-card-body">
          <div className="app-card-name">{app.name}{app.running && <span className="app-card-dot" />}</div>
          <div className="app-card-desc">{app.desc}</div>
        </div>
      </button>
      {onDelete && (
        <button type="button" className="app-card-del" aria-label={`Delete ${app.name}`} onClick={() => void onDelete()}>✕</button>
      )}
    </div>
  );
}

// Generic engine for a Tier-1 declarative app: render its form, fill the
// template, run a plain LLM call, show the result.
function GeneratedApp({ app, onBack }: { app: AppConfig; onBack: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [activeModel] = useActiveModel();
  // FR-T2-5: a Tier-2 code app needs human review of its code + capabilities
  // before its first run.
  const [reviewed, setReviewed] = useState(app.tier !== 2 || !app.code || !!app.reviewed);

  const canRun = useMemo(() => app.inputs.every((i) => (values[i.id] ?? '').trim()), [app.inputs, values]);

  // Host bridge (FR-T2-3/4): authorize each op against the app's permissions.
  const onBridge = async (op: string, args: unknown) => {
    if (op === 'gemini' && (app.permissions ?? []).includes('gemini')) {
      const r = await runPlainChat(String(args ?? ''), { model: activeModel });
      return r.outcome === 'no-key'
        ? { ok: false, error: 'No API key set.' }
        : { ok: true, result: r.text ?? '' };
    }
    return { ok: false, error: `Capability "${op}" is not permitted for this app.` };
  };

  const run = async () => {
    setBusy(true);
    setNoKey(false);
    setOutput(null);
    try {
      // Tier-2: run generated code in the opaque-origin sandbox, exposing only
      // the app's declared capabilities via the bridge.
      if (app.tier === 2 && app.code) {
        const res = await runInSandbox(app.code, values, {
          capabilities: app.permissions ?? [],
          onBridge,
          timeoutMs: (app.permissions ?? []).length > 0 ? 30_000 : 4_000,
        });
        setOutput(
          res.ok
            ? typeof res.result === 'string'
              ? res.result
              : '```json\n' + JSON.stringify(res.result, null, 2) + '\n```'
            : `**Error:** ${res.error}`,
        );
        return;
      }
      // Tier-1: fill the template and run a plain LLM call.
      const prompt = renderTemplate(app.promptTemplate ?? '', values);
      const r = await runPlainChat(prompt, { model: activeModel });
      if (r.outcome === 'no-key') setNoKey(true);
      else setOutput(r.text ?? '');
    } finally {
      setBusy(false);
    }
  };

  const approveReview = async () => {
    await persistApp({ ...app, reviewed: true });
    setReviewed(true);
  };

  if (!reviewed) {
    return (
      <div className="apps">
        <div className="app-hd">
          <button type="button" className="app-hd-back" onClick={onBack} aria-label="Back to apps"><span className="ic">{Ic.collapse}</span></button>
          <span className="app-hd-ic" style={{ color: GEN_COLOR, background: hexAlpha(GEN_COLOR, 0.12) }}>{Ic.sparkle}</span>
          <div className="app-hd-text">
            <div className="app-hd-name">Review “{app.name}”</div>
            <div className="app-hd-sub">Generated code — review before the first run</div>
          </div>
        </div>
        <div style={{ padding: '4px 2px' }}>
          <div className="settings-section-h">Requested capabilities</div>
          <div className="empty-state-desc" style={{ marginBottom: 8 }}>
            {(app.permissions ?? []).length ? (app.permissions ?? []).join(', ') : 'none (pure compute — no network, no DOM)'}
          </div>
          <div className="settings-section-h">Code (runs sandboxed)</div>
          <pre className="t2-code">{app.code}</pre>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void approveReview()}>Approve &amp; enable</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="apps">
      <div className="app-hd">
        <button type="button" className="app-hd-back" onClick={onBack} aria-label="Back to apps"><span className="ic">{Ic.collapse}</span></button>
        <span className="app-hd-ic" style={{ color: GEN_COLOR, background: hexAlpha(GEN_COLOR, 0.12) }}>{Ic.sparkle}</span>
        <div className="app-hd-text">
          <div className="app-hd-name">{app.name}</div>
          <div className="app-hd-sub">{app.description}</div>
        </div>
      </div>

      <div style={{ padding: '4px 2px' }}>
        {app.inputs.map((inp) => (
          <div key={inp.id} className="settings-row" style={{ display: 'block', marginBottom: 8 }}>
            <label className="settings-row-t" htmlFor={`f_${inp.id}`}>{inp.label}</label>
            {inp.type === 'textarea' ? (
              <textarea
                id={`f_${inp.id}`}
                className="settings-input"
                style={{ resize: 'none', marginTop: 4 }}
                rows={3}
                placeholder={inp.placeholder}
                value={values[inp.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [inp.id]: e.target.value }))}
              />
            ) : (
              <input
                id={`f_${inp.id}`}
                className="settings-input"
                style={{ marginTop: 4 }}
                placeholder={inp.placeholder}
                value={values[inp.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [inp.id]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !canRun} onClick={() => void run()}>
          {busy ? 'Running…' : 'Run app'}
        </button>
        {noKey && <div className="empty-state-desc" style={{ marginTop: 8 }}>Add a Gemini API key in Settings to run this app.</div>}
        {output !== null && (
          <div className="msg msg-agent" style={{ marginTop: 12 }}>
            <div className="msg-body"><Markdown>{output}</Markdown></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppHeader({ app, onBack }: { app: AppMeta; onBack: () => void }) {
  return (
    <div className="app-hd">
      <button type="button" className="app-hd-back" onClick={onBack} aria-label="Back to apps"><span className="ic">{Ic.collapse}</span></button>
      <span className="app-hd-ic" style={{ color: app.color, background: hexAlpha(app.color, 0.12) }}>{app.icon}</span>
      <div className="app-hd-text">
        <div className="app-hd-name">{app.name}</div>
        <div className="app-hd-sub">{app.desc}</div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm">Hand to Agent</button>
    </div>
  );
}
