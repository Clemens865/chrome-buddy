// TechStackPanel — Wappalyzer-style fingerprint groups (Framework / CSS /
// Analytics / CDN). Each detected tech shows the evidence signal count;
// hover the row for the actual evidence list.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { TechMatch } from '../../../console/techStack';
import { runTool, errNoticeStyle } from './shared';

export function TechStackPanel() {
  const [data, setData] = useState<{ url: string; matches: TechMatch[] } | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<{ url: string; matches: TechMatch[]; count: number }>('detect_tech_stack', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const grouped = data
    ? data.matches.reduce<Record<string, TechMatch[]>>((acc, m) => {
        (acc[m.category] ??= []).push(m);
        return acc;
      }, {})
    : {};

  return (
    <div className="ci-panel" data-testid="ci-panel-tech">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Detecting…' : 'Re-detect'}
        </button>
        {data && <span className="ci-panel-meta">{data.matches.length} detected</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-tech" data-testid="ci-tech">
          {data.matches.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No known frameworks detected</div>
              <div className="empty-state-desc">
                The page may be plain HTML, or uses a stack outside our fingerprint set.
              </div>
            </div>
          ) : (
            Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="ci-tech-group">
                <div className="ci-tech-cat">{cat}</div>
                {items.map((m, i) => (
                  <div key={i} className="ci-tech-row" title={m.evidence.join('\n')}>
                    <span className="ci-tech-name">{m.name}</span>
                    <span className="ci-tech-ev">{m.evidence.length} signal(s)</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
