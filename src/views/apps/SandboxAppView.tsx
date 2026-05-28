// Standalone host for a deployed Tier-3 sandbox-UI app: persistent Chrome Buddy
// chrome (header + "Sandboxed" badge, anti-spoofing) wrapping the reusable
// SandboxAppFrame runtime (the iframe + capability-bridge broker).
import { useState } from 'react';
import { AppHeader } from '../AppsView';
import { Ic } from '../../ui/icons';
import type { AppConfig } from '../../apps/types';
import { SandboxAppFrame, grantedCaps, type AppStatus } from './SandboxAppFrame';

export function SandboxAppView({ app, onBack }: { app: AppConfig; onBack: () => void }) {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const caps = grantedCaps(app);
  const meta = { id: app.id, icon: Ic.sparkle, name: app.name, desc: app.description || 'Sandboxed app', color: '#8B5CF6' };

  return (
    <div className="micro" data-testid="sandbox-app">
      <AppHeader app={meta} onBack={onBack} />
      <div className="sandbox-app-bar">
        <span className="sandbox-badge">{Ic.warn}Sandboxed app — runs isolated; can’t read your keys or other tabs</span>
        {caps.length > 0 && <span className="sandbox-caps">Uses: {caps.join(', ')}</span>}
      </div>
      {status === 'error' && (
        <div className="empty-state-desc" style={{ color: '#B91C1C', padding: '8px 14px' }}>{errMsg}</div>
      )}
      <SandboxAppFrame app={app} onStatus={(s, e) => { setStatus(s); setErrMsg(e ?? null); }} />
    </div>
  );
}
