// A11yPanel — light axe-style audit (img-alt, label, html[lang], title,
// heading-order, h1 count, unlabeled buttons/links). Threads detect_tech_stack
// into the fix prompt context.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { A11yReport } from '../../../console/a11y';
import type { Finding } from '../../../console/fixPrompt';
import { runTool, errNoticeStyle, CopyHandoffButtons, useTechContext, type OnHandoff } from './shared';

export function A11yPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [data, setData] = useState<A11yReport | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const techCtx = useTechContext();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<A11yReport>('analyze_a11y', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const findings: Finding[] = (data?.issues ?? []).map((i) => ({
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity,
    count: i.count,
  }));

  return (
    <div className="ci-panel" data-testid="ci-panel-a11y">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit'}
        </button>
        <CopyHandoffButtons topic="Accessibility" findings={findings} context={techCtx} onHandoff={onHandoff} testid="ci-a11y" />
        {data && (
          <span className="ci-panel-meta">
            {data.issues.length} rule(s) · {data.total} element(s)
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-cards" data-testid="ci-a11y">
          {data.issues.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No accessibility issues detected</div>
              <div className="empty-state-desc">
                This is a light audit — for a full WCAG pass, run axe-core or Lighthouse.
              </div>
            </div>
          ) : (
            data.issues.map((i, idx) => (
              <div key={idx} className={'ci-card ci-sev-' + i.severity}>
                <div className="ci-card-hd">
                  <span className={'ci-sev-pill ci-sev-pill-' + i.severity}>{i.severity}</span>
                  <span className="ci-card-cat">{i.rule}</span>
                  {i.count > 1 && <span className="ci-card-count">×{i.count}</span>}
                </div>
                <div className="ci-card-desc">{i.description}</div>
                <div className="ci-card-fix">
                  <strong>Fix:</strong> {i.suggestion}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
