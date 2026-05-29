// StubViews.tsx — Skills (real) + Workflows (stub) + History (real run log).
import { useEffect, useRef, useState } from 'react';
import { BuddyMark, Ic } from '../ui/icons';
import { hexAlpha } from '../ui/theme';
import { fetchRuns, clearHistory } from '../memory/request';
import { fetchSkills, persistSkill, removeSkill } from '../skills/request';
import { skillFromRun, parseSkillBundle, toSkillBundle } from '../skills/skillData';
import { detectSkillInputs, makeSkill, reviewImport, type ImportReview } from '../skills/edit';
import { parseClaudeSkill, looksLikeClaudeSkill } from '../skills/claudeSkill';
import { fetchWorkflows, persistWorkflow, removeWorkflow } from '../workflows/request';
import { parseWorkflowSteps, makeWorkflow, WORKFLOW_BUILDER_SYSTEM, toWorkflowBundle, parseWorkflowBundle, newWorkflowId } from '../workflows/build';
import { DUE_WORKFLOWS_KEY } from '../workflows/schedule';
import { generateViaBackground } from '../llm/instance';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { usePersistedState } from '../sidepanel/usePersistedState';
import type { Skill } from '../skills/types';
import type { Workflow, WorkflowStep, WorkflowTrigger } from '../workflows/types';
import type { RunRecord } from '../memory/types';

// Schedule presets offered in the Workflows list (minutes; 0 = manual).
const SCHEDULE_OPTIONS: { label: string; minutes: number }[] = [
  { label: 'Manual', minutes: 0 },
  { label: 'Every 15 min', minutes: 15 },
  { label: 'Hourly', minutes: 60 },
  { label: 'Daily', minutes: 1440 },
];

function triggerMinutes(t: WorkflowTrigger): number {
  return t.type === 'schedule' ? t.everyMinutes : 0;
}
function triggerFromMinutes(minutes: number): WorkflowTrigger {
  return minutes > 0 ? { type: 'schedule', everyMinutes: minutes } : { type: 'manual' };
}

export function SkillsView({ onRunSkill }: { onRunSkill: (skill: Skill) => void }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [editing, setEditing] = useState<Skill | 'new' | null>(null);
  const [importReview, setImportReview] = useState<ImportReview[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => fetchSkills().then(setSkills);
  useEffect(() => {
    void refresh();
  }, []);

  const onDelete = async (id: string) => {
    await removeSkill(id);
    void refresh();
  };

  const onSave = async (s: Skill) => {
    await persistSkill(s);
    setEditing(null);
    void refresh();
  };

  const onExport = () => {
    const bundle = toSkillBundle(skills ?? []);
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chrome-buddy-skills.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // FR-SKILL-9/10: review before enabling imported skills (no silent persist).
  // Accepts our own JSON skill bundles AND a Claude Agent Skill (SKILL.md).
  const onImportFile = async (file: File) => {
    const text = await file.text();
    const isMd = /\.(md|markdown|txt)$/i.test(file.name) || looksLikeClaudeSkill(text);
    if (isMd) {
      const skill = parseClaudeSkill(text);
      if (skill) setImportReview(reviewImport([skill]));
      return;
    }
    const parsed = parseSkillBundle(text);
    if (parsed.length) setImportReview(reviewImport(parsed));
  };
  const confirmImport = async () => {
    for (const r of importReview ?? []) await persistSkill(r.skill);
    setImportReview(null);
    void refresh();
  };

  if (editing) {
    return (
      <SkillEditor
        initial={editing === 'new' ? null : editing}
        onSave={(s) => void onSave(s)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  if (importReview) {
    return (
      <div className="stub">
        <div className="settings-section-h">Import skills — review</div>
        <div className="empty-state-desc" style={{ marginBottom: 10 }}>
          These skills request the following tools. Unknown tools won&apos;t be available.
        </div>
        <div className="stub-list">
          {importReview.map((r) => (
            <div key={r.skill.id} className="stub-row" style={{ alignItems: 'flex-start' }}>
              <span className="stub-row-ic" style={{ color: '#6366F1', background: hexAlpha('#6366F1', 0.12) }}>{Ic.skill}</span>
              <div className="stub-row-body">
                <div className="stub-row-title">{r.skill.name}</div>
                <div className="stub-row-sub">
                  Tools: {r.tools.length ? r.tools.join(', ') : 'none'}
                  {r.unknownTools.length > 0 && (
                    <span style={{ color: '#B45309' }}> · unknown: {r.unknownTools.join(', ')}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportReview(null)}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmImport()}>
            Import {importReview.length} skill{importReview.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    );
  }

  const empty = skills !== null && skills.length === 0;

  return (
    <div className="stub">
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>+ New skill</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} title="Import a Chrome Buddy skill bundle (.json) or a Claude Agent Skill (SKILL.md)">Import</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport} disabled={empty}>Export</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,.md,.markdown,text/markdown"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {empty ? (
        <div className="empty-state">
          <span className="ic" style={{ width: 30, height: 30 }}>{Ic.skill}</span>
          <div className="empty-state-title">No skills yet</div>
          <div className="empty-state-desc">Saved, re-runnable actions. Create one, save a run from History, or import a bundle.</div>
        </div>
      ) : (
        <div className="stub-list">
          {(skills ?? []).map((s) => (
            <div key={s.id} className="stub-row">
              <span className="stub-row-ic" style={{ color: '#6366F1', background: hexAlpha('#6366F1', 0.12) }}>{Ic.skill}</span>
              <div className="stub-row-body">
                <div className="stub-row-title">{s.name}</div>
                <div className="stub-row-sub">
                  {s.kind === 'agent' ? 'Agent' : 'Chat'}
                  {s.inputs && s.inputs.length > 0 ? ` · inputs: ${s.inputs.join(', ')}` : ` · ${s.prompt.slice(0, 48)}`}
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onRunSkill(s)}>Run</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Edit skill" onClick={() => setEditing(s)}>Edit</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete skill" onClick={() => void onDelete(s.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Linear skill editor (FR-SKILL-4/5/6): name, description, mode, prompt with
// auto-detected {{inputs}}, and an allowedTools whitelist.
function SkillEditor({ initial, onSave, onCancel }: { initial: Skill | null; onSave: (s: Skill) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  // Default new skills to 'chat' — it's the simpler, cheaper kind, matches
  // the UI ordering (Chat shown first in the seg control), and is what most
  // saved prompts actually are. Agent skills are an opt-in upgrade.
  const [kind, setKind] = useState<'chat' | 'agent'>(initial?.kind ?? 'chat');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [tools, setTools] = useState((initial?.allowedTools ?? []).join(', '));
  const inputs = detectSkillInputs(prompt);

  const save = () =>
    onSave(
      makeSkill({
        id: initial?.id,
        name,
        description,
        kind,
        prompt,
        allowedTools: tools.split(',').map((t) => t.trim()).filter(Boolean),
        createdAt: initial?.createdAt,
      }),
    );

  return (
    <div className="stub">
      <div className="settings-section-h">{initial ? 'Edit skill' : 'New skill'}</div>
      <div className="settings-row" style={{ display: 'block' }}>
        <input className="settings-input" placeholder="Skill name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Skill name" />
        <input className="settings-input" style={{ marginTop: 6 }} placeholder="Short description" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Skill description" />
        <div className="seg seg-sm" role="group" aria-label="Skill mode" style={{ marginTop: 6 }}>
          <button type="button" className={'seg-btn' + (kind === 'chat' ? ' is-on' : '')} aria-pressed={kind === 'chat'} onClick={() => setKind('chat')}>Chat</button>
          <button type="button" className={'seg-btn' + (kind === 'agent' ? ' is-on' : '')} aria-pressed={kind === 'agent'} onClick={() => setKind('agent')}>Agent</button>
        </div>
        <textarea
          className="settings-input"
          style={{ marginTop: 6, resize: 'none' }}
          rows={4}
          placeholder="Prompt / steps. Use {{variables}} for inputs (e.g. Compare {{competitors}})."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label="Skill prompt"
        />
        {inputs.length > 0 && (
          <div className="skill-inputs" aria-label="Detected inputs">
            Inputs: {inputs.map((i) => <span key={i} className="skill-input-chip">{i}</span>)}
          </div>
        )}
        <input className="settings-input" style={{ marginTop: 6 }} placeholder="Allowed tools (comma-separated, optional)" value={tools} onChange={(e) => setTools(e.target.value)} aria-label="Allowed tools" />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!name.trim() || !prompt.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function FlowsView({ onRunWorkflow }: { onRunWorkflow: (wf: Workflow) => void }) {
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [importReview, setImportReview] = useState<Workflow[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => fetchWorkflows().then(setWorkflows);
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
          { role: 'system', content: WORKFLOW_BUILDER_SYSTEM },
          { role: 'user', content: desc },
        ],
        params: { jsonMode: true },
      });
      const steps = parseWorkflowSteps(res.text);
      if (steps.length === 0) {
        setError('Could not generate steps. Try describing it more concretely.');
        return;
      }
      await persistWorkflow(makeWorkflow(name || desc, steps));
      setCreating(false);
      setName('');
      setDesc('');
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    await removeWorkflow(id);
    void refresh();
  };

  // Workflows the SW flagged as due (a scheduled alarm fired). Cleared on run.
  const [due, setDue] = usePersistedState<string[]>(DUE_WORKFLOWS_KEY, []);

  const setSchedule = async (w: Workflow, minutes: number) => {
    await persistWorkflow({ ...w, trigger: triggerFromMinutes(minutes) });
    void refresh();
  };

  const runAndClear = (w: Workflow) => {
    if (due.includes(w.id)) {
      const next = due.filter((id) => id !== w.id);
      setDue(next); // instant UI
      // onRunWorkflow navigates to chat, unmounting this view before
      // usePersistedState's effect can flush — so write the cleared flag
      // through to storage directly, or the "Due" badge reappears on reload.
      if (typeof chrome !== 'undefined') void chrome.storage?.local?.set({ [DUE_WORKFLOWS_KEY]: next });
    }
    onRunWorkflow(w);
  };

  const onExport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(toWorkflowBundle(workflows ?? []), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chrome-buddy-workflows.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const onImportFile = async (file: File) => {
    const parsed = parseWorkflowBundle(await file.text());
    if (parsed.length) setImportReview(parsed);
  };
  const confirmImport = async () => {
    for (const w of importReview ?? []) await persistWorkflow(w);
    setImportReview(null);
    void refresh();
  };
  const onSaveEdit = async (w: Workflow) => {
    await persistWorkflow(w);
    setEditing(null);
    void refresh();
  };

  if (editing) {
    return <WorkflowEditor initial={editing} onSave={(w) => void onSaveEdit(w)} onCancel={() => setEditing(null)} />;
  }
  if (importReview) {
    return (
      <div className="stub">
        <div className="settings-section-h">Import workflows — review</div>
        <div className="stub-list">
          {importReview.map((w) => (
            <div key={w.id} className="stub-row">
              <span className="stub-row-ic" style={{ color: '#A78BFA', background: hexAlpha('#A78BFA', 0.12) }}>{Ic.flow}</span>
              <div className="stub-row-body">
                <div className="stub-row-title">{w.name}</div>
                <div className="stub-row-sub">{w.steps.length} step{w.steps.length === 1 ? '' : 's'} · imported as manual</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportReview(null)}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmImport()}>Import {importReview.length}</button>
        </div>
      </div>
    );
  }

  const empty = workflows !== null && workflows.length === 0 && !creating;

  return (
    <div className="stub">
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : '+ New workflow'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>Import</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport} disabled={!workflows || workflows.length === 0}>Export</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {creating && (
        <div className="settings-row" style={{ display: 'block' }}>
          <input className="settings-input" placeholder="Workflow name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Workflow name" />
          <textarea
            className="settings-input"
            style={{ marginTop: 6, resize: 'none' }}
            rows={3}
            placeholder="Describe the workflow step by step (e.g. search the web for AI news, then summarize the top 3 into a briefing)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            aria-label="Workflow description"
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !desc.trim()} onClick={() => void generate()}>
              {busy ? 'Generating…' : 'Generate steps'}
            </button>
          </div>
          {error && <div className="empty-state-desc" style={{ color: '#B91C1C', marginTop: 6 }}>{error}</div>}
        </div>
      )}

      {empty ? (
        <div className="empty-state">
          <span className="ic" style={{ width: 30, height: 30 }}>{Ic.flow}</span>
          <div className="empty-state-title">No workflows yet</div>
          <div className="empty-state-desc">Multi-step automations. Describe one in plain language and Buddy builds the steps.</div>
        </div>
      ) : (
        <div className="stub-list">
          {(workflows ?? []).map((w) => {
            const minutes = triggerMinutes(w.trigger);
            const schedLabel = SCHEDULE_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `Every ${minutes} min`;
            return (
              <div key={w.id} className="stub-row">
                <span className="stub-row-ic" style={{ color: '#A78BFA', background: hexAlpha('#A78BFA', 0.12) }}>{Ic.flow}</span>
                <div className="stub-row-body">
                  <div className="stub-row-title">
                    {w.name}
                    {due.includes(w.id) && <span className="wf-due-badge">Due</span>}
                  </div>
                  <div className="stub-row-sub">
                    {w.steps.length} step{w.steps.length === 1 ? '' : 's'} ·{' '}
                    {w.trigger.type === 'event' ? 'on URL visit' : minutes > 0 ? schedLabel.toLowerCase() : 'manual'}
                  </div>
                </div>
                <select
                  className="settings-input"
                  style={{ maxWidth: 110, padding: '4px 6px' }}
                  aria-label={`Schedule for ${w.name}`}
                  value={minutes}
                  onChange={(e) => void setSchedule(w, Number(e.target.value))}
                >
                  {SCHEDULE_OPTIONS.map((o) => (
                    <option key={o.minutes} value={o.minutes}>{o.label}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => runAndClear(w)}>Run</button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Edit workflow" onClick={() => setEditing(w)}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete workflow" onClick={() => void onDelete(w.id)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Linear workflow editor (FR-WF-2): edit/reorder/remove steps + set the trigger
// (manual / schedule / event-on-URL-visit, FR-WF-4).
function WorkflowEditor({ initial, onSave, onCancel }: { initial: Workflow; onSave: (w: Workflow) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [steps, setSteps] = useState<WorkflowStep[]>(initial.steps);
  const [trigType, setTrigType] = useState<WorkflowTrigger['type']>(initial.trigger.type);
  const [minutes, setMinutes] = useState(initial.trigger.type === 'schedule' ? initial.trigger.everyMinutes : 60);
  const [urlPattern, setUrlPattern] = useState(initial.trigger.type === 'event' ? initial.trigger.urlPattern : '');

  const setStep = (i: number, patch: Partial<WorkflowStep>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setSteps((prev) => [...prev, { id: newWorkflowId('step'), mode: 'chat', prompt: '' }]);

  const save = () => {
    const trigger: WorkflowTrigger =
      trigType === 'schedule'
        ? { type: 'schedule', everyMinutes: minutes }
        : trigType === 'event'
          ? { type: 'event', urlPattern: urlPattern.trim() }
          : { type: 'manual' };
    onSave({ ...initial, name: name.trim() || 'Untitled workflow', steps: steps.filter((s) => s.prompt.trim()), trigger });
  };

  return (
    <div className="stub">
      <div className="settings-section-h">Edit workflow</div>
      <div className="settings-row" style={{ display: 'block' }}>
        <input className="settings-input" placeholder="Workflow name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Workflow name" />

        <div style={{ marginTop: 8 }}>
          {steps.map((s, i) => (
            <div key={s.id} className="wf-step">
              <div className="wf-step-hd">
                <span>Step {i + 1}</span>
                <div className="seg seg-sm" role="group" aria-label={`Step ${i + 1} mode`}>
                  <button type="button" className={'seg-btn' + (s.mode === 'chat' ? ' is-on' : '')} onClick={() => setStep(i, { mode: 'chat' })}>Chat</button>
                  <button type="button" className={'seg-btn' + (s.mode === 'agent' ? ' is-on' : '')} onClick={() => setStep(i, { mode: 'agent' })}>Agent</button>
                </div>
                <span style={{ flex: 1 }} />
                <button type="button" className="wf-step-btn" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="wf-step-btn" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="wf-step-btn" aria-label={`Remove step ${i + 1}`} onClick={() => remove(i)}>✕</button>
              </div>
              <textarea className="settings-input" style={{ resize: 'none' }} rows={2} placeholder="Step prompt" value={s.prompt} onChange={(e) => setStep(i, { prompt: e.target.value })} aria-label={`Step ${i + 1} prompt`} />
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={add}>+ Add step</button>
        </div>

        <div className="settings-section-h" style={{ marginTop: 12 }}>Trigger</div>
        <div className="seg seg-sm" role="group" aria-label="Trigger type">
          {(['manual', 'schedule', 'event'] as const).map((t) => (
            <button key={t} type="button" className={'seg-btn' + (trigType === t ? ' is-on' : '')} aria-pressed={trigType === t} onClick={() => setTrigType(t)}>
              {t === 'manual' ? 'Manual' : t === 'schedule' ? 'Schedule' : 'On URL'}
            </button>
          ))}
        </div>
        {trigType === 'schedule' && (
          <select className="settings-input" style={{ marginTop: 6, maxWidth: 160 }} aria-label="Schedule interval" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {SCHEDULE_OPTIONS.filter((o) => o.minutes > 0).map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
          </select>
        )}
        {trigType === 'event' && (
          <input className="settings-input" style={{ marginTop: 6 }} placeholder="URL pattern (e.g. https://example.com/*)" value={urlPattern} onChange={(e) => setUrlPattern(e.target.value)} aria-label="URL pattern" />
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!name.trim() || steps.filter((s) => s.prompt.trim()).length === 0} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function HistoryView() {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  // Polish: click a row to expand its details inline (task, answer,
  // tools, sources, model, duration). Click again or another row to toggle.
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchRuns().then((r) => live && setRuns(r));
    return () => {
      live = false;
    };
  }, []);

  const onClear = async () => {
    await clearHistory();
    setRuns([]);
  };

  if (runs !== null && runs.length === 0) {
    return (
      <div className="stub">
        <div className="empty-state">
          <span className="stub-empty-mark"><BuddyMark size={28} /></span>
          <div className="empty-state-title">No runs yet</div>
          <div className="empty-state-desc">Everything Buddy does shows up here — chats and agent runs with their tools and sources.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stub">
      {runs && runs.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onClear()}>Clear history</button>
        </div>
      )}
      <div className="stub-list">
        {(runs ?? []).map((r) => {
          const color = r.kind === 'agent' ? '#A78BFA' : '#0EA5E9';
          const icon = r.kind === 'agent' ? Ic.flow : Ic.chat;
          const sub =
            r.kind === 'agent'
              ? `${timeAgo(r.startedAt)} · ${r.toolCount} tool${r.toolCount === 1 ? '' : 's'} · ${r.outcome}`
              : `${timeAgo(r.startedAt)} · chat`;
          const isOpen = openId === r.id;
          return (
            <div key={r.id} className={'stub-row-wrap' + (isOpen ? ' is-open' : '')}>
              <div
                className="stub-row stub-row-clickable"
                onClick={() => setOpenId(isOpen ? null : r.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenId(isOpen ? null : r.id);
                  }
                }}
                aria-expanded={isOpen}
              >
                <span className="stub-row-ic" style={{ color, background: hexAlpha(color, 0.12) }}>{icon}</span>
                <div className="stub-row-body">
                  <div className="stub-row-title">{r.task}</div>
                  <div className="stub-row-sub">{sub}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Save as skill"
                  onClick={(e) => {
                    e.stopPropagation();
                    void persistSkill(skillFromRun(r));
                  }}
                >
                  + Skill
                </button>
                <span className="stub-row-meta">{fmtDuration(r.durationMs)}</span>
              </div>
              {isOpen && <RunDetail run={r} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunDetail({ run }: { run: RunRecord }) {
  return (
    <div className="run-detail">
      <div className="run-detail-meta">
        <span>{new Date(run.startedAt).toLocaleString()}</span>
        <span>·</span>
        <span>{run.model}</span>
        <span>·</span>
        <span>{run.outcome}</span>
      </div>
      <div className="run-detail-section">
        <div className="run-detail-h">Task</div>
        <div className="run-detail-body">{run.task}</div>
      </div>
      {run.answer && (
        <div className="run-detail-section">
          <div className="run-detail-h">Answer</div>
          <div className="run-detail-body run-detail-answer">{run.answer}</div>
        </div>
      )}
      {run.tools.length > 0 && (
        <div className="run-detail-section">
          <div className="run-detail-h">Tools ({run.tools.length})</div>
          <div className="run-detail-chips">
            {run.tools.map((t, i) => (
              <span key={`${t}-${i}`} className="run-detail-chip">{t}</span>
            ))}
          </div>
        </div>
      )}
      {run.provenance.length > 0 && (
        <div className="run-detail-section">
          <div className="run-detail-h">Sources</div>
          <ol className="run-detail-sources">
            {run.provenance.map((u, i) => (
              <li key={`${u}-${i}`}>
                <a href={u} target="_blank" rel="noreferrer">{u}</a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
