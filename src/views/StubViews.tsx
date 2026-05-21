// StubViews.tsx — Skills (real) + Workflows (stub) + History (real run log).
import { useEffect, useRef, useState } from 'react';
import { BuddyMark, Ic } from '../ui/icons';
import { hexAlpha } from '../ui/theme';
import { fetchRuns, clearHistory } from '../memory/request';
import { fetchSkills, persistSkill, removeSkill } from '../skills/request';
import { skillFromRun, parseSkillBundle, toSkillBundle } from '../skills/skillData';
import type { Skill } from '../skills/types';
import type { RunRecord } from '../memory/types';
import type { ReactElement } from 'react';

function EmptyView({ icon, title, desc, cta }: { icon: ReactElement; title: string; desc: string; cta?: string }) {
  return (
    <div className="stub">
      <div className="empty-state">
        <span className="ic" style={{ width: 30, height: 30 }}>{icon}</span>
        <div className="empty-state-title">{title}</div>
        <div className="empty-state-desc">{desc}</div>
        {cta && <button type="button" className="btn btn-ghost btn-sm">{cta}</button>}
      </div>
    </div>
  );
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

export function FlowsView() {
  return <EmptyView icon={Ic.flow} title="No workflows yet" desc="Multi-step automations. Build one in natural language, edit it as steps, or record your actions." cta="New workflow" />;
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
