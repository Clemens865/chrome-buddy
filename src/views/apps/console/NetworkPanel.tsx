// NetworkPanel — a waterfall built from the page's Performance Resource Timing
// (no debugger needed): per-request timing bars, type/status/size, filters, and
// two artifacts — HAR export + copy-as-cURL. Reflects what the page has loaded
// so far; reload + Refresh after an interaction to capture more.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import {
  filterRequests,
  summarizeNetwork,
  buildHar,
  toCurl,
  isSlow,
  type NetRequest,
  type NetFilter,
} from '../../../console/network';
import { runTool, copyToClipboard, downloadText, formatBytes, shortHost, errNoticeStyle, noticeStyle } from './shared';

interface NetworkData {
  url: string;
  count: number;
  requests: NetRequest[];
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).slice(0, 80) || '/';
  } catch {
    return url;
  }
}

export function NetworkPanel({ capturing }: { capturing?: boolean }) {
  const [data, setData] = useState<NetworkData | undefined>();
  const [filter, setFilter] = useState<NetFilter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<NetworkData>('probe_network', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const all = data?.requests ?? [];
  const summary = summarizeNetwork(all);
  const shown = filterRequests(all, filter).sort((a, b) => a.startMs - b.startMs);

  const downloadHar = () => {
    if (!data) return;
    const har = buildHar(all, data.url, new Date().toISOString());
    downloadText('network.har', JSON.stringify(har, null, 2), 'application/json');
  };

  const copyCurl = async (r: NetRequest, idx: number) => {
    if (await copyToClipboard(toCurl(r))) {
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1400);
    }
  };

  return (
    <div className="ci-panel" data-testid="ci-panel-network">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Reading…' : 'Refresh'}
        </button>
        {(['all', 'slow', 'failed'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={'console-chip' + (filter === k ? ' is-on' : '')}
            onClick={() => setFilter(k)}
            data-testid={`ci-net-filter-${k}`}
          >
            <span className="console-chip-l">{k}{k === 'failed' && summary.failed > 0 ? ` (${summary.failed})` : ''}</span>
          </button>
        ))}
        {data && all.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={downloadHar} data-testid="ci-net-har" title="Download all requests as a HAR file (import into DevTools or any HTTP tool).">
            Export HAR
          </button>
        )}
        {data && (
          <span className="ci-panel-meta" title={data.url}>
            {summary.total} req · {formatBytes(summary.totalBytes)}{summary.slow ? ` · ${summary.slow} slow` : ''}
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && all.length === 0 && (
        <div className="console-notice" role="status" style={noticeStyle}>
          No resource timings on this page yet{capturing ? '' : ' — reload the page, then press Refresh'}.
        </div>
      )}
      {shown.length > 0 ? (
        <div className="ci-net" data-testid="ci-network-list">
          {shown.map((r, i) => {
            const failed = r.status >= 400;
            const left = (r.startMs / summary.spanMs) * 100;
            const width = Math.max(1.5, (r.durationMs / summary.spanMs) * 100);
            const barClass = failed ? 'ci-net-bar-bad' : isSlow(r) ? 'ci-net-bar-slow' : 'ci-net-bar-ok';
            return (
              <div key={i} className={'ci-net-row' + (failed ? ' ci-net-failed' : '')}>
                <div className="ci-net-head">
                  <span className={'ci-net-type ci-net-type-' + r.type}>{r.type}</span>
                  <span className={'ci-net-status' + (failed ? ' ci-net-status-bad' : '')}>{r.status || '—'}</span>
                  <span className="ci-net-path" title={r.url}>
                    <span className="ci-net-host">{shortHost(r.host) || r.host}</span>{pathOf(r.url)}
                  </span>
                  <span className="ci-net-size">{r.sizeBytes ? formatBytes(r.sizeBytes) : '·'}</span>
                  <span className="ci-net-dur">{r.durationMs}ms</span>
                  <button type="button" className="ci-card-copy" onClick={() => copyCurl(r, i)} title="Copy as cURL" data-testid={`ci-net-curl-${i}`}>
                    {copiedIdx === i ? '✓' : 'cURL'}
                  </button>
                </div>
                <div className="ci-net-track">
                  <div className={'ci-net-bar ' + barClass} style={{ left: `${left}%`, width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        data && all.length > 0 && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
            <div className="empty-state-title">No {filter} requests</div>
            <div className="empty-state-desc">Switch the filter back to “all”.</div>
          </div>
        )
      )}
    </div>
  );
}
