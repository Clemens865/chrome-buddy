// BuddyPanel.tsx — full panel (rail + content) when expanded; collapses to a
// slim floating icon-rail card (content hidden) per the design. The side panel
// itself is resizable by dragging its edge in Chrome.
import { useState, type ReactElement, type ReactNode } from 'react';
import { Ic, BuddyMark } from '../ui/icons';
import { IconBtn } from '../ui/primitives';
import { modelLabel, useActiveModel } from '../llm/modelPref';

export type View = 'chat' | 'apps' | 'skills' | 'flows' | 'history' | 'settings';

const RAIL_ITEMS: { id: View; icon: ReactElement; label: string }[] = [
  { id: 'chat', icon: Ic.chat, label: 'Chat' },
  { id: 'apps', icon: Ic.apps, label: 'Apps' },
  { id: 'skills', icon: Ic.skill, label: 'Skills' },
  { id: 'flows', icon: Ic.flow, label: 'Workflows' },
  { id: 'history', icon: Ic.history, label: 'History' },
];

const TITLES: Record<View, { title: string; sub: string }> = {
  chat: { title: 'Chat with Buddy', sub: '' },
  apps: { title: 'Apps', sub: 'Tailored tools for one job' },
  skills: { title: 'Skills', sub: 'Saved, parameterized actions' },
  flows: { title: 'Workflows', sub: 'Multi-step automations' },
  history: { title: 'History', sub: 'Past agent runs' },
  settings: { title: 'Settings', sub: '' },
};

interface BuddyPanelProps {
  view: View;
  onView: (v: View) => void;
  collapsed: boolean;
  collapsible: boolean;
  onToggleCollapsed: () => void;
  onClose?: () => void;
  children: ReactNode;
}

function RailNav({ view, onSelect }: { view: View; onSelect: (v: View) => void }) {
  return (
    <>
      <div className="rail-stack">
        {RAIL_ITEMS.map((it) => (
          <button
            key={it.id}
            type="button"
            className={'rail-btn' + (view === it.id ? ' is-active' : '')}
            onClick={() => onSelect(it.id)}
            aria-label={it.label}
            title={it.label}
          >
            <span className="ic">{it.icon}</span>
          </button>
        ))}
      </div>
      <div className="rail-foot">
        <button
          type="button"
          className={'rail-btn' + (view === 'settings' ? ' is-active' : '')}
          onClick={() => onSelect('settings')}
          aria-label="Settings"
          title="Settings"
        >
          <span className="ic">{Ic.settings}</span>
        </button>
      </div>
    </>
  );
}

export function BuddyPanel({ view, onView, collapsed, collapsible, onToggleCollapsed, onClose, children }: BuddyPanelProps) {
  // While collapsed, selecting an item expands the panel and navigates.
  const selectFromCollapsed = (v: View) => {
    onToggleCollapsed();
    onView(v);
  };

  if (collapsed) {
    return (
      <aside className="panel is-collapsed">
        <nav className="rail rail-floating">
          <button type="button" className="rail-buddy" onClick={() => selectFromCollapsed('chat')} aria-label="Expand Buddy" title="Expand">
            <BuddyMark size={22} />
          </button>
          <div className="rail-divider" />
          <RailNav view={view} onSelect={selectFromCollapsed} />
        </nav>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <nav className="rail">
        <button type="button" className="rail-buddy" onClick={() => onView('chat')} aria-label="Buddy home">
          <BuddyMark size={22} />
        </button>
        {collapsible && (
          <button type="button" className="rail-toggle" onClick={onToggleCollapsed} aria-label="Collapse panel" title="Collapse">
            <span className="ic">{Ic.collapse}</span>
          </button>
        )}
        <div className="rail-divider" />
        <RailNav view={view} onSelect={onView} />
      </nav>
      <div className="panel-body">
        <PanelHeader view={view} onClose={onClose} />
        <div className="panel-content">{children}</div>
      </div>
    </aside>
  );
}

function PanelHeader({ view, onClose }: { view: View; onClose?: () => void }) {
  const t = TITLES[view] ?? TITLES.chat;
  const [activeModel] = useActiveModel();
  const [menu, setMenu] = useState(false);
  // The chat header shows the live active model (picked in Settings).
  const sub = view === 'chat' ? modelLabel(activeModel) : t.sub;
  return (
    <header className="panel-hd">
      <div className="panel-hd-l">
        <div className="panel-hd-title">{t.title}</div>
        {sub && (
          <div className="panel-hd-sub">
            {view === 'chat' && <span className="dot-online" />}
            {sub}
          </div>
        )}
      </div>
      <div className="panel-hd-r">
        {view === 'chat' && <IconBtn icon={Ic.plus} label="New chat" size={28} />}
        <div className="hd-menu-wrap">
          <IconBtn icon={Ic.more} label="More" size={28} onClick={() => setMenu((m) => !m)} />
          {menu && (
            <div className="hd-menu" onMouseLeave={() => setMenu(false)}>
              <div className="hd-menu-section">Chat</div>
              <button type="button" className="hd-menu-item" onClick={() => setMenu(false)}>Export chat</button>
              <button type="button" className="hd-menu-item" onClick={() => setMenu(false)}>Clear history</button>
            </div>
          )}
        </div>
        {onClose && <IconBtn icon={Ic.x} label="Close" size={28} onClick={onClose} />}
      </div>
    </header>
  );
}
