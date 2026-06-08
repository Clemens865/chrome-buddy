// StoragePanel — the full client-storage picture: localStorage / sessionStorage
// / cookies (read_storage) PLUS IndexedDB, Cache Storage, and the origin quota
// (probe_storage_extra). Adds a quota bar, a key search, and a JSON snapshot
// export.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StorageReport } from '../../../console/storageSummary';
import { runTool, downloadText, formatBytes, errNoticeStyle } from './shared';

interface StorageExtra {
  quota?: { usage: number; quota: number };
  idb: Array<{ name: string; version?: number; stores: Array<{ name: string; count: number }> }>;
  caches: Array<{ name: string; entries: number }>;
}

export function StoragePanel() {
  const [data, setData] = useState<StorageReport | undefined>();
  const [extra, setExtra] = useState<StorageExtra | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const [base, ex] = await Promise.all([
      runTool<StorageReport>('read_storage', { limit: 50 }, { force }),
      runTool<StorageExtra>('probe_storage_extra', {}, { force }),
    ]);
    setBusy(false);
    if (!base.ok) { setError(base.error.message); return; }
    setData(base.data);
    setExtra(ex.ok ? ex.data : { idb: [], caches: [] });
  }, []);
  useEffect(() => { void run(); }, [run]);

  const top = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.top ?? [];
    return q ? all.filter((e) => e.key.toLowerCase().includes(q) || e.preview.toLowerCase().includes(q)) : all;
  }, [data, search]);

  const exportSnapshot = () => {
    if (!data) return;
    const snap = { total: data.total, byArea: data.byArea, flagged: data.flagged, top: data.top, indexedDB: extra?.idb ?? [], cacheStorage: extra?.caches ?? [], quota: extra?.quota };
    downloadText('storage-snapshot.json', JSON.stringify(snap, null, 2), 'application/json');
  };

  const q = extra?.quota;
  const pct = q && q.quota > 0 ? Math.min(100, Math.round((q.usage / q.quota) * 100)) : undefined;

  return (
    <div className="ci-panel" data-testid="ci-panel-storage">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Reading…' : 'Refresh'}
        </button>
        {data && (
          <button type="button" className="btn btn-sm" onClick={exportSnapshot} data-testid="ci-storage-export" title="Download a JSON snapshot of all client storage.">
            Export
          </button>
        )}
        {data && (
          <span className="ci-panel-meta">
            {data.total.keys} key(s) · {formatBytes(data.total.bytes)}
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-storage" data-testid="ci-storage">
          {q && pct !== undefined && (
            <div className="ci-storage-quota" data-testid="ci-storage-quota">
              <div className="ci-storage-quota-hd">
                <span>Origin quota</span>
                <span>{formatBytes(q.usage)} / {formatBytes(q.quota)} · {pct}%</span>
              </div>
              <div className="ci-storage-quota-track">
                <div className={'ci-storage-quota-bar' + (pct >= 80 ? ' ci-storage-quota-hot' : '')} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

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

          {extra && (extra.idb.length > 0 || extra.caches.length > 0) && (
            <div className="ci-storage-deep">
              {extra.idb.length > 0 && (
                <div data-testid="ci-storage-idb">
                  <div className="ci-storage-hd">IndexedDB</div>
                  {extra.idb.map((db, i) => (
                    <div key={i} className="ci-storage-db">
                      <code className="ci-storage-db-name">{db.name}</code>
                      <span className="ci-storage-db-stores">
                        {db.stores.length === 0 ? 'no stores' : db.stores.map((s) => `${s.name} (${s.count < 0 ? '?' : s.count})`).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {extra.caches.length > 0 && (
                <div data-testid="ci-storage-caches">
                  <div className="ci-storage-hd">Cache Storage</div>
                  {extra.caches.map((c, i) => (
                    <div key={i} className="ci-storage-db">
                      <code className="ci-storage-db-name">{c.name}</code>
                      <span className="ci-storage-db-stores">{c.entries < 0 ? '?' : c.entries} entr{c.entries === 1 ? 'y' : 'ies'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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

          <div className="ci-storage-hd">Entries</div>
          <div className="console-search" style={{ padding: '0 0 6px' }}>
            <input type="text" className="cb-input" placeholder="Filter keys…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="ci-storage-search" />
          </div>
          <div className="ci-storage-list">
            {top.length === 0 ? (
              <div className="empty-state-desc">{search ? 'No keys match.' : 'No key/value storage on this origin.'}</div>
            ) : (
              top.map((e, i) => (
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
