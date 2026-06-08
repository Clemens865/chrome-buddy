// SensitivePanel — redacted secret/PII matches from scan_sensitive_data. Adds
// an allowlist (dismiss a known-safe finding so it stops nagging — kills the
// email false-positive problem), per-provider rotation guidance, and a redacted
// compliance CSV export. Allowlist persists per host in chrome.storage.local.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { SensitiveHit } from '../../../console/sensitivePatterns';
import { getRotation, hitSignature, buildSecretsCsv } from '../../../console/secretsRemediation';
import { runTool, downloadText, hostOnly, errNoticeStyle } from './shared';

interface SensitiveData { url?: string; hits: SensitiveHit[]; scanned: number }

const allowKey = (host: string) => `secrets:allow:${host}`;

async function loadAllow(host: string): Promise<Set<string>> {
  try {
    const k = allowKey(host);
    const r = await chrome.storage?.local?.get(k);
    return new Set((r?.[k] as string[]) ?? []);
  } catch {
    return new Set();
  }
}
async function saveAllow(host: string, set: Set<string>): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [allowKey(host)]: [...set] });
  } catch {
    /* storage unavailable; allowlist is best-effort */
  }
}

export function SensitivePanel() {
  const [data, setData] = useState<SensitiveData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [allow, setAllow] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);

  const host = data?.url ? hostOnly(data.url) : '';

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<SensitiveData>('scan_sensitive_data', {}, { force });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setData(r.data);
    setAllow(await loadAllow(r.data.url ? hostOnly(r.data.url) : ''));
  }, []);
  useEffect(() => { void run(); }, [run]);

  const toggleIgnore = async (h: SensitiveHit) => {
    const sig = hitSignature(h);
    const next = new Set(allow);
    if (next.has(sig)) next.delete(sig);
    else next.add(sig);
    setAllow(next);
    await saveAllow(host, next);
  };

  const hits = data?.hits ?? [];
  const ignoredCount = hits.filter((h) => allow.has(hitSignature(h))).length;
  const active = hits.filter((h) => !allow.has(hitSignature(h)));
  const shown = showIgnored ? hits : active;

  const exportCsv = () => {
    downloadText('secrets.csv', buildSecretsCsv(active), 'text/csv;charset=utf-8');
  };

  return (
    <div className="ci-panel" data-testid="ci-panel-sensitive">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Scanning…' : 'Re-scan'}
        </button>
        {active.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={exportCsv} data-testid="ci-sec-csv" title="Download a redacted CSV for your compliance record.">
            Export CSV
          </button>
        )}
        {ignoredCount > 0 && (
          <button type="button" className={'console-chip' + (showIgnored ? ' is-on' : '')} onClick={() => setShowIgnored((s) => !s)} data-testid="ci-sec-show-ignored">
            <span className="console-chip-l">Ignored ({ignoredCount})</span>
          </button>
        )}
        {data && (
          <span className="ci-panel-meta">
            {active.length} active{ignoredCount ? ` · ${ignoredCount} ignored` : ''} · {data.scanned} source(s)
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-cards" data-testid="ci-sensitive">
          {shown.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.sparkle}</span>
              <div className="empty-state-title">{ignoredCount ? 'No active findings' : 'No leaked secrets detected'}</div>
              <div className="empty-state-desc">
                Scanned storage + visible page text. Re-run after sign-in or a state change to recheck.
              </div>
            </div>
          ) : (
            shown.map((h, i) => {
              const sig = hitSignature(h);
              const ignored = allow.has(sig);
              const rot = getRotation(h);
              return (
                <div key={i} className={'ci-card ci-sev-' + h.severity + (ignored ? ' ci-card-muted' : '')}>
                  <div className="ci-card-hd">
                    <span className={'ci-sev-pill ci-sev-pill-' + h.severity}>{h.severity}</span>
                    <span className="ci-card-cat">{h.category}</span>
                    {h.count > 1 && <span className="ci-card-count">×{h.count}</span>}
                    <button type="button" className="ci-card-copy" onClick={() => void toggleIgnore(h)} data-testid={`ci-sec-ignore-${i}`} title={ignored ? 'Restore this finding' : 'Mark as a known-safe value'}>
                      {ignored ? 'Restore' : 'Ignore'}
                    </button>
                  </div>
                  <div className="ci-card-desc">{h.description}</div>
                  <div className="ci-card-fix">
                    <strong>Found in:</strong> <code>{h.source}</code> — <code>{h.preview}</code>
                  </div>
                  {rot && (
                    <div className="ci-card-fix">
                      <strong>Remediation:</strong> {rot.steps}
                      {rot.url && <> <a href={rot.url} target="_blank" rel="noreferrer" className="ci-card-doc">{rot.label} ↗</a></>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
