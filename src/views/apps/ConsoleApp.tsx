import { useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';

// Empty/initial state. Live console capture (chrome.debugger) and AI analysis
// are wired in the Console Buddy port (later wave). No mock logs.
type Level = 'error' | 'warn' | 'log' | 'net';

export function ConsoleApp({ onBack }: { onBack: () => void }) {
  const app = appById('console');
  const [filter, setFilter] = useState<'all' | Level>('all');
  const tabs: ('all' | Level)[] = ['all', 'error', 'warn', 'log', 'net'];
  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />
      <div className="console-bar">
        {tabs.map((k) => (
          <button key={k} type="button" className={'console-chip' + (filter === k ? ' is-on' : '')} onClick={() => setFilter(k)}>
            <span className={'console-chip-dot dot-' + k} />
            <span className="console-chip-l">{k}</span>
            <span className="console-chip-c">0</span>
          </button>
        ))}
        <span className="console-spacer" />
        <button type="button" className="console-clear">Clear</button>
      </div>
      <div className="console-list">
        <div className="empty-state">
          <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
          <div className="empty-state-title">No console activity yet</div>
          <div className="empty-state-desc">Start capturing to stream console logs and network calls from the current tab. Buddy will flag and explain errors.</div>
          <button type="button" className="btn btn-primary">Start capturing</button>
        </div>
      </div>
    </div>
  );
}
