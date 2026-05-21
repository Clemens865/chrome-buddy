// StubViews.tsx — Skills / Workflows (empty stubs) + History (real run log).
import { useEffect, useState } from 'react';
import { BuddyMark, Ic } from '../ui/icons';
import { hexAlpha } from '../ui/theme';
import { fetchRuns, clearHistory } from '../memory/request';
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

export function SkillsView() {
  return <EmptyView icon={Ic.skill} title="No skills yet" desc="Skills are saved, parameterized actions. Promote an agent run into a skill, or import one." cta="Import a skill" />;
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
              <span className="stub-row-meta">{fmtDuration(r.durationMs)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
