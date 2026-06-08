// AeoPanel — Answer Engine Optimization audit. Scores how well an AI answer
// engine can read/extract/cite the page, lists fixes, and ships two artifacts:
//   • Download llms.txt — a starter manifest the user drops at their site root.
//   • Ask an AI about this page — a live simulation of what an engine extracts.
// It also bakes in the "verify loop": re-auditing shows the score delta since
// the last scan of the same URL (persisted in sessionStorage for the session).

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { AeoReport, AeoIssue } from '../../../console/aeo';
import { buildLlmsTxt } from '../../../console/aeo';
import { runSimulation, type AeoSimulation } from '../../../console/aeoSimulation';
import type { Finding } from '../../../console/fixPrompt';
import { useResolvedModelId } from '../../../llm/modelPref';
import { runTool, errNoticeStyle, CopyHandoffButtons, useTechContext, type OnHandoff } from './shared';
import { AeoSimulationCard } from './AeoSimulationCard';

interface AeoPanelData extends AeoReport {
  url: string;
  title?: string;
  metaDescription?: string;
  headings: string[];
}

/** Trigger a client-side text download (the llms.txt artifact). */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const lastScoreKey = (url: string) => `aeo:lastScore:${url}`;

export function AeoPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [data, setData] = useState<AeoPanelData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [delta, setDelta] = useState<number | undefined>();
  const [sim, setSim] = useState<AeoSimulation | undefined>();
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState<string | undefined>();
  const [dlFlash, setDlFlash] = useState(false);
  const techCtx = useTechContext();
  const modelId = useResolvedModelId();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<AeoPanelData>('analyze_aeo', {}, { force });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    // Verify loop: compare to the last score for this URL (this session).
    try {
      const prev = sessionStorage.getItem(lastScoreKey(r.data.url));
      if (prev !== null) setDelta(r.data.score - Number(prev));
      sessionStorage.setItem(lastScoreKey(r.data.url), String(r.data.score));
    } catch {
      /* sessionStorage may be unavailable; delta is best-effort */
    }
    setData(r.data);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const askAi = async () => {
    setSimBusy(true);
    setSimError(undefined);
    try {
      const r = await runTool<{ url: string; title?: string; text: string }>('read_dom', {});
      if (!r.ok) throw new Error(r.error.message);
      const result = await runSimulation(
        { url: r.data.url, title: r.data.title, text: r.data.text ?? '' },
        modelId,
      );
      setSim(result);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Simulation failed. Try again.');
    } finally {
      setSimBusy(false);
    }
  };

  const downloadLlms = () => {
    if (!data) return;
    downloadText('llms.txt', buildLlmsTxt(data, data.headings));
    setDlFlash(true);
    window.setTimeout(() => setDlFlash(false), 1400);
  };

  const findings: Finding[] = (data?.issues ?? []).map((i: AeoIssue) => ({
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity,
    detail: i.detail,
  }));

  return (
    <div className="ci-panel" data-testid="ci-panel-aeo">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={askAi}
          disabled={simBusy}
          data-testid="ci-aeo-ask"
          title="Have an AI read the page and show you what it can extract + cite."
        >
          {simBusy ? 'Asking…' : '🔎 Ask an AI'}
        </button>
        {data && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={downloadLlms}
            data-testid="ci-aeo-llms"
            title="Download a starter llms.txt manifest for this site."
          >
            {dlFlash ? 'Saved ✓' : 'Download llms.txt'}
          </button>
        )}
        <CopyHandoffButtons
          topic="AEO"
          findings={findings}
          context={{ ...techCtx, url: data?.url, title: data?.title }}
          onHandoff={onHandoff}
          testid="ci-aeo"
        />
        {data && <span className="ci-panel-meta" title={data.url}>Score: {data.score}/100</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {simError && <div className="console-notice" role="alert" style={errNoticeStyle}>{simError}</div>}
      {sim && <AeoSimulationCard sim={sim} onDismiss={() => setSim(undefined)} />}
      {data && (
        <div className="ci-seo" data-testid="ci-aeo">
          <div className="ci-seo-score">
            <div className={'ci-seo-score-ring ci-seo-score-' + aeoScoreClass(data.score)}>{data.score}</div>
            <div className="ci-seo-score-facts">
              {typeof delta === 'number' && (
                <div className="ci-seo-fact" data-testid="ci-aeo-delta">
                  <span>Since last scan</span> {delta === 0 ? 'no change' : (delta > 0 ? '▲ +' : '▼ ') + delta}
                </div>
              )}
              <div className="ci-seo-fact"><span>Schema types</span> {data.facts.schemaTypes.length || '—'}</div>
              <div className="ci-seo-fact"><span>Word count</span> {data.facts.wordCount}</div>
              <div className="ci-seo-fact"><span>FAQ / Q&amp;A</span> {data.facts.hasFaq ? '✓' : '—'}</div>
              <div className="ci-seo-fact"><span>Attributable</span> {data.facts.attributable ? '✓' : '—'}</div>
              <div className="ci-seo-fact"><span>llms.txt</span> {data.facts.hasLlmsTxt ? '✓' : '—'}</div>
              <div className="ci-seo-fact"><span>AI crawlers blocked</span> {data.facts.aiCrawlersBlocked || '—'}</div>
            </div>
          </div>
          {data.issues.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.sparkle}</span>
              <div className="empty-state-title">Great AI-readability</div>
              <div className="empty-state-desc">This page is well set up for AI answer engines to read and cite.</div>
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

function aeoScoreClass(score: number): 'good' | 'needs-improvement' | 'poor' {
  if (score >= 90) return 'good';
  if (score >= 70) return 'needs-improvement';
  return 'poor';
}
