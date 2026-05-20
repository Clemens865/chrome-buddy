// AppsView.tsx — apps grid launcher + shared app metadata + micro-app header.
import type { ReactElement } from 'react';
import { Ic } from '../ui/icons';
import { hexAlpha } from '../ui/theme';

export type AppId = 'summarizer' | 'console' | 'image';

export interface AppMeta {
  id: string;
  icon: ReactElement;
  name: string;
  desc: string;
  color: string;
  running?: boolean;
}

export const APPS: AppMeta[] = [
  { id: 'summarizer', icon: Ic.reader, name: 'Page Summarizer', desc: 'Distill any page into TL;DR + key points.', color: '#0EA5E9' },
  { id: 'console', icon: Ic.console, name: 'Console Inspector', desc: 'Read console logs and explain errors.', color: '#10B981' },
  { id: 'image', icon: Ic.image, name: 'Image Generator', desc: 'Generate images from a prompt.', color: '#A78BFA' },
  { id: 'translate', icon: Ic.translate, name: 'Translator', desc: 'Translate this page inline.', color: '#F59E0B' },
  { id: 'scrape', icon: Ic.scrape, name: 'Scrape to Table', desc: 'Extract structured data to CSV.', color: '#F43F5E' },
  { id: 'watch', icon: Ic.watch, name: 'Price Watch', desc: 'Ping me when something changes.', color: '#6366F1', running: true },
];

export function appById(id: string): AppMeta {
  return APPS.find((a) => a.id === id) ?? APPS[0];
}

export function AppsView({ onOpenApp, recents = ['summarizer', 'image'] }: { onOpenApp: (id: AppId) => void; recents?: string[] }) {
  const openable = new Set<AppId>(['summarizer', 'console', 'image']);
  const open = (id: string) => {
    if (openable.has(id as AppId)) onOpenApp(id as AppId);
  };
  return (
    <div className="apps">
      <div className="apps-search">
        <input className="apps-search-input" placeholder="Search apps…" />
      </div>
      <div className="apps-section-h">Recent</div>
      <div className="apps-grid">
        {recents.map((id) => <AppCard key={id} app={appById(id)} onOpen={() => open(id)} />)}
      </div>
      <div className="apps-section-h">All apps</div>
      <div className="apps-grid">
        {APPS.map((a) => <AppCard key={a.id} app={a} onOpen={() => open(a.id)} />)}
      </div>
      <div className="apps-foot">
        <button type="button" className="apps-add"><span className="ic">{Ic.plus}</span>Add app from skill</button>
      </div>
    </div>
  );
}

function AppCard({ app, onOpen }: { app: AppMeta; onOpen: () => void }) {
  return (
    <button type="button" className="app-card" onClick={onOpen}>
      <span className="app-card-ic" style={{ color: app.color, background: hexAlpha(app.color, 0.12) }}>{app.icon}</span>
      <div className="app-card-body">
        <div className="app-card-name">{app.name}{app.running && <span className="app-card-dot" />}</div>
        <div className="app-card-desc">{app.desc}</div>
      </div>
    </button>
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
