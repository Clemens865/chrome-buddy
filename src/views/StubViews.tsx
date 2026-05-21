// StubViews.tsx — Skills (real) + Workflows (stub) + History (real run log).
import { useEffect, useRef, useState } from 'react';
import { BuddyMark, Ic } from '../ui/icons';
import { hexAlpha } from '../ui/theme';
import { fetchRuns, clearHistory } from '../memory/request';
import { fetchSkills, persistSkill, removeSkill } from '../skills/request';
import { skillFromRun, parseSkillBundle, toSkillBundle } from '../skills/skillData';
import { fetchWorkflows, persistWorkflow, removeWorkflow } from '../workflows/request';
import { parseWorkflowSteps, makeWorkflow, WORKFLOW_BUILDER_SYSTEM } from '../workflows/build';
import { DUE_WORKFLOWS_KEY } from '../workflows/schedule';
import { generateViaBackground } from '../llm/instance';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { usePersistedState } from '../sidepanel/usePersistedState';
import type { Skill } from '../skills/types';
import type { Workflow, WorkflowTrigger } from '../workflows/types';
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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => fetchSkills().then(setSkills);
  useEffect(() => {
    void refresh();
  }, []);

  const onDelete = async (id: string) => {
    await removeSkill(id);
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

  const onImportFile = async (file: File) => {
    const parsed = parseSkillBundle(await file.text());
    for (const s of parsed) await persistSkill(s);
    void refresh();
  };

  const empty = skills !== null && skills.length === 0;

  return (
    <div className="stub">
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>Import</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport} disabled={empty}>Export</button>
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

      {empty ? (
        <div className="empty-state">
          <span className="ic" style={{ width: 30, height: 30 }}>{Ic.skill}</span>
          <div className="empty-state-title">No skills yet</div>
          <div className="empty-state-desc">Saved, re-runnable actions. Save a run from History as a skill, or import a bundle.</div>
        </div>
      ) : (
        <div className="stub-list">
          {(skills ?? []).map((s) => (
            <div key={s.id} className="stub-row">
              <span className="stub-row-ic" style={{ color: '#6366F1', background: hexAlpha('#6366F1', 0.12) }}>{Ic.skill}</span>
              <div className="stub-row-body">
                <div className="stub-row-title">{s.name}</div>
                <div className="stub-row-sub">{s.kind === 'agent' ? 'Agent' : 'Chat'} · {s.prompt.slice(0, 60)}</div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onRunSkill(s)}>Run</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete skill" onClick={() => void onDelete(s.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
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
    if (due.includes(w.id)) setDue(due.filter((id) => id !== w.id));
    onRunWorkflow(w);
  };

  const empty = workflows !== null && workflows.length === 0 && !creating;

  return (
    <div className="stub">
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : '+ New workflow'}
        </button>
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
                    {w.steps.length} step{w.steps.length === 1 ? '' : 's'} · {minutes > 0 ? schedLabel.toLowerCase() : 'manual'}
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
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Delete workflow" onClick={() => void onDelete(w.id)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
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
          return (
            <div key={r.id} className="stub-row">
              <span className="stub-row-ic" style={{ color, background: hexAlpha(color, 0.12) }}>{icon}</span>
              <div className="stub-row-body">
                <div className="stub-row-title">{r.task}</div>
                <div className="stub-row-sub">{sub}</div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Save as skill"
                onClick={() => void persistSkill(skillFromRun(r))}
              >
                + Skill
              </button>
              <span className="stub-row-meta">{fmtDuration(r.durationMs)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
