// StubViews.tsx — Skills / Workflows / History. Empty initial states (no mock data).
import { BuddyMark, Ic } from '../ui/icons';
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

export function HistoryView() {
  return (
    <div className="stub">
      <div className="empty-state">
        <span className="stub-empty-mark"><BuddyMark size={28} /></span>
        <div className="empty-state-title">No runs yet</div>
        <div className="empty-state-desc">Everything Buddy does will show up here with its full tool-call trace.</div>
      </div>
    </div>
  );
}
