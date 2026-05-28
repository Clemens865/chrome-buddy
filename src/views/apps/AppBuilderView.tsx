// Conversational Tier-3 app builder (P3): describe → live preview → iterate →
// save to the grid. The model emits a complete app spec each turn (html/css/ui
// + permissions); we render it live in the sandbox, let the user refine it in
// natural language, auto-repair run errors (capped), and only enable Save once
// the app has actually mounted+run once. Gemini Flash by default; Opus 4.8 as
// an optional power builder when an Anthropic key is set.
import { useRef, useState } from 'react';
import { AppHeader } from '../AppsView';
import { Ic } from '../../ui/icons';
import type { AppConfig } from '../../apps/types';
import type { ChatMessage } from '../../llm/types';
import { generateViaBackground } from '../../llm/instance';
import { persistApp } from '../../apps/request';
import { useApiKey } from '../../key/useApiKey';
import {
  parseUiApp,
  toAppConfig,
  describeMessages,
  iterateMessage,
  repairMessage,
} from '../../apps/uiBuild';
import { SandboxAppFrame, type AppStatus } from './SandboxAppFrame';

const MAX_REPAIRS = 3;
const OPUS_MODEL = 'claude-opus-4-8';

export function AppBuilderView({ onBack, onSaved }: { onBack: () => void; onSaved: (app: AppConfig) => void }) {
  const [desc, setDesc] = useState('');
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [version, setVersion] = useState(0); // bump to remount the preview
  const [status, setStatus] = useState<AppStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useOpus, setUseOpus] = useState(false);
  const messages = useRef<ChatMessage[]>([]);
  const repairs = useRef(0);

  const { keyStatus: anthropicKey } = useApiKey('anthropic');
  const model = useOpus ? OPUS_MODEL : undefined;

  // Run a builder turn: send the accumulated messages, parse the app spec,
  // record the assistant turn (so the next edit builds on it), and preview it.
  const runTurn = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await generateViaBackground({ messages: messages.current, model, params: { jsonMode: true } });
      messages.current.push({ role: 'assistant', content: res.text });
      const parsed = parseUiApp(res.text);
      if (!parsed) {
        setError('The builder didn’t return a valid app. Try rephrasing or run it again.');
        return;
      }
      const id = draft?.id ?? `app_${Date.now().toString(36)}`;
      setDraft(toAppConfig(parsed, id));
      setVersion((v) => v + 1);
      setStatus('loading');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    if (!desc.trim()) return;
    messages.current = describeMessages(desc.trim());
    repairs.current = 0;
    await runTurn();
  };

  const iterate = async () => {
    if (!instruction.trim() || !draft) return;
    messages.current.push(iterateMessage(instruction.trim()));
    setInstruction('');
    repairs.current = 0;
    await runTurn();
  };

  const autoFix = async () => {
    if (!error && status !== 'error') return;
    if (repairs.current >= MAX_REPAIRS) {
      setError(`Couldn’t fix it automatically after ${MAX_REPAIRS} tries. Try describing the change yourself.`);
      return;
    }
    repairs.current += 1;
    messages.current.push(repairMessage(lastRunError.current ?? 'The app failed to run.'));
    await runTurn();
  };

  const lastRunError = useRef<string | null>(null);
  const onStatus = (s: AppStatus, e?: string) => {
    setStatus(s);
    if (s === 'error') {
      lastRunError.current = e ?? 'The app failed to run.';
      setError(e ?? 'The app failed to run.');
    } else if (s === 'running') {
      lastRunError.current = null;
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = { ...draft, reviewed: true };
      await persistApp(saved);
      onSaved(saved);
    } finally {
      setBusy(false);
    }
  };

  const meta = { id: 'builder', icon: Ic.sparkle, name: draft?.name || 'Build an app', desc: 'Describe it, preview it, ship it', color: '#8B5CF6' };
  const canSave = !!draft && status === 'running' && !busy;

  return (
    <div className="micro" data-testid="app-builder">
      <AppHeader app={meta} onBack={onBack} />
      <div className="micro-body" style={{ paddingBottom: 8 }}>
        {!draft ? (
          <div className="scrape-section">
            <div className="scrape-section-h">Describe the app you want</div>
            <textarea
              className="settings-input"
              style={{ resize: 'none' }}
              rows={3}
              placeholder="e.g. an SVG icon generator with a style picker and a download button; or a tip calculator"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              aria-label="App description"
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !desc.trim()} onClick={() => void build()}>
                {busy ? 'Building…' : 'Build'}
              </button>
              <ModelToggle useOpus={useOpus} setUseOpus={setUseOpus} opusAvailable={anthropicKey === 'set'} />
            </div>
          </div>
        ) : (
          <>
            <div className="builder-preview">
              <SandboxAppFrame key={version} app={draft} onStatus={onStatus} />
            </div>
            <div className="sandbox-app-bar">
              <span className="sandbox-badge">{Ic.warn}Live preview — sandboxed</span>
              {(draft.permissions ?? []).length > 0 && <span className="sandbox-caps">Uses: {(draft.permissions ?? []).join(', ')}</span>}
            </div>
            {status === 'error' && (
              <div className="empty-state-desc" style={{ color: '#B91C1C' }}>
                {error}
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} disabled={busy} onClick={() => void autoFix()}>
                  {busy ? 'Fixing…' : `Auto-fix (${repairs.current}/${MAX_REPAIRS})`}
                </button>
              </div>
            )}
            {status !== 'error' && error && <div className="empty-state-desc" style={{ color: '#B91C1C' }}>{error}</div>}
            <div className="scrape-section">
              <div className="row" style={{ display: 'flex', gap: 6 }}>
                <input
                  className="settings-input"
                  style={{ flex: 1 }}
                  placeholder="Refine it… e.g. add a batch mode, make buttons bigger"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void iterate(); }}
                  aria-label="Refine the app"
                  disabled={busy}
                />
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !instruction.trim()} onClick={() => void iterate()}>
                  {busy ? '…' : 'Refine'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={!canSave} onClick={() => void save()} title={canSave ? '' : 'The app must run once before saving'}>
                  Save to my apps
                </button>
                <ModelToggle useOpus={useOpus} setUseOpus={setUseOpus} opusAvailable={anthropicKey === 'set'} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModelToggle({ useOpus, setUseOpus, opusAvailable }: { useOpus: boolean; setUseOpus: (v: boolean) => void; opusAvailable: boolean }) {
  if (!opusAvailable) {
    return <span className="builder-model-note">Builder: Gemini Flash · add an Anthropic key in Settings for Opus</span>;
  }
  return (
    <label className="builder-model-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <input type="checkbox" checked={useOpus} onChange={(e) => setUseOpus(e.target.checked)} aria-label="Use Opus 4.8 to build" />
      Build with Opus 4.8
    </label>
  );
}
