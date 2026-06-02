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
import { useResolvedModelId, modelLabel } from '../../llm/modelPref';
import { ModelPicker } from '../ModelPicker';
import {
  parseBuilderReply,
  toAppConfig,
  describeMessages,
  iterateMessage,
  repairMessage,
  answersMessage,
  UI_APP_BUILDER_SYSTEM,
} from '../../apps/uiBuild';
import { SandboxAppFrame, describeCaps, type AppStatus } from './SandboxAppFrame';

const MAX_REPAIRS = 3;

/** Seed an edit session: the system contract + the app's current spec as the
 *  prior assistant turn, so "Refine it…" edits the existing app. */
function seedMessages(app: AppConfig): ChatMessage[] {
  const spec = JSON.stringify({ name: app.name, description: app.description, html: app.html ?? '', css: app.css ?? '', ui: app.ui ?? '', permissions: app.permissions ?? [] });
  return [
    { role: 'system', content: UI_APP_BUILDER_SYSTEM },
    { role: 'assistant', content: spec },
  ];
}

// `initial` (optional) reopens a saved Tier-3 app to iterate on it — its id is
// preserved so saving UPDATES the same app rather than creating a duplicate.
export function AppBuilderView({ onBack, onSaved, initial }: { onBack: () => void; onSaved: (app: AppConfig) => void; initial?: AppConfig }) {
  const [desc, setDesc] = useState('');
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState<AppConfig | null>(initial ?? null);
  const [version, setVersion] = useState(initial ? 1 : 0); // bump to remount the preview
  const [status, setStatus] = useState<AppStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>('');           // what the builder is doing now
  const [clarify, setClarify] = useState<string[] | null>(null); // questions from the model
  const [answer, setAnswer] = useState('');
  const messages = useRef<ChatMessage[]>(initial ? seedMessages(initial) : []);
  const repairs = useRef(0);

  // Unified model choice (Settings → Quality vs. cost). Set "Best" + an
  // Anthropic key to build with Opus 4.8.
  const model = useResolvedModelId();

  // Run a builder turn: send the accumulated messages, parse the app spec,
  // record the assistant turn (so the next edit builds on it), and preview it.
  const runTurn = async (phaseLabel: string) => {
    setBusy(true);
    setError(null);
    setPhase(phaseLabel);
    try {
      const res = await generateViaBackground({ messages: messages.current, model, params: { jsonMode: true } });
      messages.current.push({ role: 'assistant', content: res.text });
      const reply = parseBuilderReply(res.text);
      if (!reply) {
        setError('The builder didn’t return a valid app. Try rephrasing or run it again.');
        return;
      }
      if (reply.kind === 'clarify') {
        setClarify(reply.questions); // the builder is asking for directions
        return;
      }
      setClarify(null);
      const id = draft?.id ?? `app_${Date.now().toString(36)}`;
      setDraft(toAppConfig(reply.app, id));
      setVersion((v) => v + 1);
      setStatus('loading');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const build = async () => {
    if (!desc.trim()) return;
    messages.current = describeMessages(desc.trim());
    repairs.current = 0;
    await runTurn('Designing your app…');
  };

  const sendAnswers = async () => {
    if (!answer.trim()) return;
    messages.current.push(answersMessage(answer.trim()));
    setAnswer('');
    setClarify(null);
    await runTurn('Building from your answers…');
  };

  const iterate = async () => {
    if (!instruction.trim() || !draft) return;
    messages.current.push(iterateMessage(instruction.trim()));
    setInstruction('');
    repairs.current = 0;
    await runTurn('Applying your change…');
  };

  const autoFix = async () => {
    if (!error && status !== 'error') return;
    if (repairs.current >= MAX_REPAIRS) {
      setError(`Couldn’t fix it automatically after ${MAX_REPAIRS} tries. Try describing the change yourself.`);
      return;
    }
    repairs.current += 1;
    messages.current.push(repairMessage(lastRunError.current ?? 'The app failed to run.'));
    await runTurn('Fixing it…');
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
              <ModelPicker title="Model used to build this app" />
            </div>
            {busy && phase && <div className="builder-phase" data-testid="builder-phase">{phase}</div>}
            {clarify && (
              <div className="builder-clarify" data-testid="builder-clarify">
                <div className="scrape-section-h">A couple of questions first</div>
                <ul className="builder-clarify-list">{clarify.map((q, i) => <li key={i}>{q}</li>)}</ul>
                <textarea
                  className="settings-input"
                  style={{ resize: 'none', marginTop: 4 }}
                  rows={2}
                  placeholder="Answer here…"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  aria-label="Answers"
                />
                <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={busy || !answer.trim()} onClick={() => void sendAnswers()}>
                  {busy ? 'Building…' : 'Continue'}
                </button>
              </div>
            )}
            {error && <div className="empty-state-desc" style={{ color: '#B91C1C', marginTop: 6 }}>{error}</div>}
          </div>
        ) : (
          <>
            <div className="builder-preview">
              <SandboxAppFrame key={version} app={draft} onStatus={onStatus} />
            </div>
            <div className="sandbox-app-bar">
              <span className="sandbox-badge">{Ic.warn}{busy && phase ? phase : `${draft.name} — live preview`}</span>
              {(draft.permissions ?? []).length > 0 && <span className="sandbox-caps">Uses: {describeCaps(draft.permissions ?? [])}</span>}
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
                <span className="builder-model-note">{modelLabel(model)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
