// SensitivePanel — redacted matches from scan_sensitive_data. Renders cards
// with severity pill, category, redacted preview (first-4 + last-4 of the
// match), and the source where it was found (storage key / dom).

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { SensitiveHit } from '../../../console/sensitivePatterns';
import { runTool, errNoticeStyle } from './shared';

export function SensitivePanel() {
  const [data, setData] = useState<{ url?: string; hits: SensitiveHit[]; scanned: number } | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<{ url?: string; hits: SensitiveHit[]; scanned: number }>('scan_sensitive_data', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  return (
    <div className="ci-panel" data-testid="ci-panel-sensitive">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Scanning…' : 'Re-scan'}
        </button>
        {data && (
          <span className="ci-panel-meta">
            {data.hits.length} hit(s) across {data.scanned} source(s)
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-cards" data-testid="ci-sensitive">
          {data.hits.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No leaked secrets detected</div>
              <div className="empty-state-desc">
                Scanned storage + visible page text. Re-run after the user signs in or after a
                state change to recheck.
              </div>
            </div>
          ) : (
            data.hits.map((h, i) => (
              <div key={i} className={'ci-card ci-sev-' + h.severity}>
                <div className="ci-card-hd">
                  <span className={'ci-sev-pill ci-sev-pill-' + h.severity}>{h.severity}</span>
                  <span className="ci-card-cat">{h.category}</span>
                  {h.count > 1 && <span className="ci-card-count">×{h.count}</span>}
                </div>
                <div className="ci-card-desc">{h.description}</div>
                <div className="ci-card-fix">
                  <strong>Found in:</strong> <code>{h.source}</code> — <code>{h.preview}</code>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
