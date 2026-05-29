// Standalone host for a deployed Tier-3 sandbox-UI app: persistent Chrome Buddy
// chrome (header + "Sandboxed" badge, anti-spoofing) wrapping the reusable
// SandboxAppFrame runtime (the iframe + capability-bridge broker).
//
// Imported/unreviewed apps pass a first-run review gate (capability disclosure
// + Approve) BEFORE the app code ever executes (FR-T2-5, extended to Tier-3).
import { useState } from 'react';
import { AppHeader } from '../AppsView';
import { Ic } from '../../ui/icons';
import type { AppConfig } from '../../apps/types';
import { persistApp } from '../../apps/request';
import { SandboxAppFrame, grantedCaps, describeCaps, type AppStatus } from './SandboxAppFrame';

export function SandboxAppView({ app, onBack }: { app: AppConfig; onBack: () => void }) {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(!!app.reviewed);
  const caps = grantedCaps(app);
  const meta = { id: app.id, icon: Ic.sparkle, name: app.name, desc: app.description || 'Sandboxed app', color: '#8B5CF6' };

  // First-run review gate: an imported/unreviewed app must be approved before
  // its code runs. The gate cannot be bypassed — the frame isn't mounted yet.
  if (!reviewed) {
    const approve = async () => {
      await persistApp({ ...app, reviewed: true });
      setReviewed(true);
    };
    return (
      <div className="apps" data-testid="sandbox-app-review">
        <AppHeader app={{ ...meta, name: `Review “${app.name}”`, desc: 'Imported app — review before the first run' }} onBack={onBack} />
        <div style={{ padding: '4px 2px' }}>
          {app.description && <div className="empty-state-desc" style={{ marginBottom: 8 }}>{app.description}</div>}
          <div className="settings-section-h">What this app can do</div>
          <div className="empty-state-desc" style={{ marginBottom: 8 }}>
            {caps.length ? describeCaps(caps) : 'nothing external — pure UI (no AI, no page access, no downloads)'}
          </div>
          <div className="empty-state-desc" style={{ marginBottom: 8 }}>
            It runs isolated in a sandbox: it can’t read your API keys, your other tabs, or the rest of the extension.
          </div>
          {app.ui && (
            <>
              <div className="settings-section-h">Logic (runs sandboxed)</div>
              <pre className="t2-code">{app.ui.slice(0, 4000)}</pre>
            </>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" style={{ background: meta.color }} onClick={() => void approve()}>Approve &amp; run</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="micro" data-testid="sandbox-app">
      <AppHeader app={meta} onBack={onBack} />
      <div className="sandbox-app-bar">
        <span className="sandbox-badge">{Ic.warn}Sandboxed app — runs isolated; can’t read your keys or other tabs</span>
        {caps.length > 0 && <span className="sandbox-caps">Uses: {describeCaps(caps)}</span>}
      </div>
      {status === 'error' && (
        <div className="empty-state-desc" style={{ color: '#B91C1C', padding: '8px 14px' }}>{errMsg}</div>
      )}
      <SandboxAppFrame app={app} onStatus={(s, e) => { setStatus(s); setErrMsg(e ?? null); }} />
    </div>
  );
}
