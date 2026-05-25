// SeoPanel — 11-rule SEO audit (title/description lengths, viewport, canonical,
// Open Graph, Twitter, h1, structured data, robots, lang, alt). Renders a 0-100
// score ring + facts grid + severity-sorted issue cards.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { SeoReport, SeoIssue } from '../../../console/seo';
import type { Finding } from '../../../console/fixPrompt';
import { runTool, errNoticeStyle, CopyHandoffButtons, useTechContext, type OnHandoff } from './shared';

interface SeoPanelData extends SeoReport {
  url: string;
  h1Text?: string;
}

export function SeoPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [data, setData] = useState<SeoPanelData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const techCtx = useTechContext();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<SeoPanelData>('analyze_seo', {}, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const findings: Finding[] = (data?.issues ?? []).map((i: SeoIssue) => ({
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity,
    detail: i.detail,
  }));

  return (
    <div className="ci-panel" data-testid="ci-panel-seo">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit'}
        </button>
        <CopyHandoffButtons
          topic="SEO"
          findings={findings}
          context={{ ...techCtx, url: data?.url, title: data?.h1Text }}
          onHandoff={onHandoff}
          testid="ci-seo"
        />
        {data && <span className="ci-panel-meta" title={data.url}>Score: {data.score}/100</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-seo" data-testid="ci-seo">
          <div className="ci-seo-score" data-score-class={seoScoreClass(data.score)}>
            <div className={'ci-seo-score-ring ci-seo-score-' + seoScoreClass(data.score)}>{data.score}</div>
            <div className="ci-seo-score-facts">
              <div className="ci-seo-fact"><span>Title</span> {data.facts.titleLength} chars</div>
              <div className="ci-seo-fact"><span>Description</span> {data.facts.descriptionLength} chars</div>
              <div className="ci-seo-fact"><span>OG tags</span> {data.facts.ogKeys}</div>
              <div className="ci-seo-fact"><span>Twitter tags</span> {data.facts.twitterKeys}</div>
              <div className="ci-seo-fact"><span>Structured data</span> {data.facts.structuredData} block(s)</div>
              <div className="ci-seo-fact"><span>Canonical</span> {data.facts.canonical ? '✓' : '—'}</div>
            </div>
          </div>
          {data.issues.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">No SEO issues detected</div>
              <div className="empty-state-desc">This audit covers basic meta tags + heading structure.</div>
            </div>
          ) : (
            <div className="ci-cards">
              {data.issues.map((i, idx) => (
                <div key={idx} className={'ci-card ci-sev-' + i.severity}>
                  <div className="ci-card-hd">
                    <span className={'ci-sev-pill ci-sev-pill-' + i.severity}>{i.severity}</span>
                    <span className="ci-card-cat">{i.rule}</span>
                    {i.detail && <span className="ci-card-count">{i.detail}</span>}
                  </div>
                  <div className="ci-card-desc">{i.description}</div>
                  <div className="ci-card-fix">
                    <strong>Fix:</strong> {i.suggestion}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function seoScoreClass(score: number): 'good' | 'needs-improvement' | 'poor' {
  if (score >= 90) return 'good';
  if (score >= 70) return 'needs-improvement';
  return 'poor';
}
