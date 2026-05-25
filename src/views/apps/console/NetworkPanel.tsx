// NetworkPanel — recent CDP-captured network requests. Three filter chips
// (all / failed / errors) backed by read_network. Only auto-refreshes when
// the live capture is on.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import { runTool, shortHost, errNoticeStyle, noticeStyle } from './shared';

interface NetEntry {
  level: string;
  text: string;
  source?: string;
  ts: number;
  count: number;
}
interface NetworkData {
  count: number;
  requests: NetEntry[];
  hint?: string;
}

export function NetworkPanel({ capturing }: { capturing: boolean }) {
  const [data, setData] = useState<NetworkData | undefined>();
  const [filter, setFilter] = useState<'all' | 'failed' | 'errors'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<NetworkData>('read_network', { filter: filter === 'all' ? '' : filter, limit: 100 }, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, [filter]);

  useEffect(() => {
    if (!capturing) return;
    run();
    const id = setInterval(run, 1200);
    return () => clearInterval(id);
  }, [capturing, run]);

  return (
    <div className="ci-panel" data-testid="ci-panel-network">
      <div className="ci-panel-bar">
        {(['all', 'failed', 'errors'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={'console-chip' + (filter === k ? ' is-on' : '')}
            onClick={() => setFilter(k)}
          >
            <span className="console-chip-l">{k}</span>
          </button>
        ))}
        <span className="console-spacer" />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Reading…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data?.hint && <div className="console-notice" role="status" style={noticeStyle}>{data.hint}</div>}
      {data && data.requests.length > 0 ? (
        <div className="console-list" data-testid="ci-network-list">
          {data.requests.map((r, i) => (
            <div key={i} className={'console-row' + (/\b(4\d\d|5\d\d)\b/.test(r.text) ? ' console-error' : '')}>
              <span className="console-lvl console-lvl-net">net</span>
              <span className="console-text" title={r.text}>{r.text}</span>
              <span className="console-src" title={r.source}>{shortHost(r.source)}</span>
              {r.count > 1 ? <span className="console-count">{r.count}</span> : <span />}
            </div>
          ))}
        </div>
      ) : (
        data && !data.hint && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
            <div className="empty-state-title">No requests captured</div>
            <div className="empty-state-desc">Start capture, then reload the page.</div>
          </div>
        )
      )}
    </div>
  );
}
