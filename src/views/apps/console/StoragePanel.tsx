// StoragePanel — localStorage + sessionStorage + cookies summary. Renders
// the 3-area totals row, flagged auth-shaped keys, and the top-N entries
// by bytes with redacted shape previews ("jwt-ish 247 chars").

import { useCallback, useEffect, useState } from 'react';
import type { StorageReport } from '../../../console/storageSummary';
import { runTool, formatBytes, errNoticeStyle } from './shared';

export function StoragePanel() {
  const [data, setData] = useState<StorageReport | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<StorageReport>('read_storage', { limit: 10 }, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  return (
    <div className="ci-panel" data-testid="ci-panel-storage">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Reading…' : 'Refresh'}
        </button>
        {data && (
          <span className="ci-panel-meta">
            {data.total.keys} key(s) · {formatBytes(data.total.bytes)}
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-storage" data-testid="ci-storage">
          <div className="ci-storage-totals">
            {(['localStorage', 'sessionStorage', 'cookies'] as const).map((area) => (
              <div key={area} className="ci-storage-area">
                <div className="ci-storage-area-key">{area}</div>
                <div className="ci-storage-area-val">
                  {data.byArea[area].keys} · {formatBytes(data.byArea[area].bytes)}
                </div>
              </div>
            ))}
          </div>
          {data.flagged.length > 0 && (
            <div className="ci-storage-flagged">
              <div className="ci-storage-hd">Flagged keys</div>
              {data.flagged.map((f, i) => (
                <div key={i} className="ci-storage-flag-row">
                  <span className="ci-sev-pill ci-sev-pill-high">{f.area}</span>
                  <code>{f.key}</code>
                  <span className="ci-storage-flag-why">{f.reason}</span>
                </div>
              ))}
            </div>
          )}
          <div className="ci-storage-hd">Top entries</div>
          <div className="ci-storage-list">
            {data.top.length === 0 ? (
              <div className="empty-state-desc">No storage on this origin.</div>
            ) : (
              data.top.map((e, i) => (
                <div key={i} className="ci-storage-row">
                  <span className="console-lvl console-lvl-net">{e.area === 'localStorage' ? 'local' : e.area === 'sessionStorage' ? 'session' : 'cookie'}</span>
                  <code className="ci-storage-key" title={e.key}>{e.key}</code>
                  <span className="ci-storage-preview" title={e.preview}>{e.preview}</span>
                  <span className="ci-storage-bytes">{formatBytes(e.bytes)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
