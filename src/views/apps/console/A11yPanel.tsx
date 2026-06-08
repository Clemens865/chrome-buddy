// A11yPanel — deep accessibility audit powered by BUNDLED axe-core (~90 WCAG
// rules: contrast, ARIA, names, roles, order…). Falls back to the fast built-in
// heuristic if axe can't run on the page. Renders per-element selectors + WCAG
// tags + a downloadable JSON report (CI-ingestible).

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { A11yReport } from '../../../console/a11y';
import type { Finding } from '../../../console/fixPrompt';
import {
  runTool,
  errNoticeStyle,
  CopyHandoffButtons,
  useTechContext,
  downloadText,
  type OnHandoff,
} from './shared';

type A11yPanelData = A11yReport & { engine?: 'axe'; axeVersion?: string; url?: string };

export function A11yPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [data, setData] = useState<A11yPanelData | undefined>();
  const [engine, setEngine] = useState<'axe' | 'quick'>('axe');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const techCtx = useTechContext();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    // Prefer axe-core; fall back to the heuristic if it can't run (e.g. a page
    // that blocks injection, or an internal page).
    const axe = await runTool<A11yPanelData>('analyze_a11y_axe', {}, { force });
    if (axe.ok) {
      setEngine('axe');
      setData(axe.data);
    } else {
      const quick = await runTool<A11yPanelData>('analyze_a11y', {}, { force });
      if (quick.ok) {
        setEngine('quick');
        setData(quick.data);
      } else {
        setError(axe.error.message);
      }
    }
    setBusy(false);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const findings: Finding[] = (data?.issues ?? []).map((i) => ({
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity,
    count: i.count,
    docUrl: i.docUrl,
  }));

  const downloadReport = () => {
    if (!data) return;
    const report = {
      engine: engine === 'axe' ? `axe-core ${data.axeVersion ?? ''}`.trim() : 'chrome-buddy-heuristic',
      url: data.url,
      total: data.total,
      issues: data.issues,
    };
    downloadText('a11y-report.json', JSON.stringify(report, null, 2), 'application/json');
  };

  return (
    <div className="ci-panel" data-testid="ci-panel-a11y">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit'}
        </button>
        {data && data.issues.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={downloadReport} data-testid="ci-a11y-report" title="Download the full audit as JSON (CI-ingestible).">
            Download report
          </button>
        )}
        <CopyHandoffButtons topic="Accessibility" findings={findings} context={techCtx} onHandoff={onHandoff} testid="ci-a11y" />
        {data && (
          <span className="ci-panel-meta" data-testid="ci-a11y-engine">
            {engine === 'axe' ? `axe-core${data.axeVersion ? ' ' + data.axeVersion : ''}` : 'quick scan'} · {data.issues.length} rule(s)
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-cards" data-testid="ci-a11y">
          {data.issues.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.sparkle}</span>
              <div className="empty-state-title">No accessibility violations</div>
              <div className="empty-state-desc">
                {engine === 'axe' ? 'axe-core found no WCAG violations on this page.' : 'The quick scan found nothing — axe-core could not run here.'}
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
                {i.wcag && i.wcag.length > 0 && (
                  <div className="ci-a11y-wcag">{i.wcag.map((w) => <span key={w} className="ci-a11y-tag">{w}</span>)}</div>
                )}
                <div className="ci-card-desc">{i.description}</div>
                <div className="ci-card-fix">
                  <strong>Fix:</strong> {i.suggestion}
                </div>
                {i.nodes && i.nodes.length > 0 && (
                  <ul className="ci-a11y-nodes">
                    {i.nodes.map((n, ni) => (
                      <li key={ni} title={n.html}><code>{n.target}</code></li>
                    ))}
                  </ul>
                )}
                {i.docUrl && (
                  <a href={i.docUrl} target="_blank" rel="noreferrer" className="ci-card-doc">Learn more ↗</a>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
