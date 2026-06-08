// SeoPanel — SEO audit (title/description/viewport/canonical/OG/Twitter/h1/
// structured-data/robots/lang/alt) with a 0-100 score, PLUS a Google-style
// rich-result (SERP) preview and JSON-LD structured-data validation.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { SeoReport, SeoIssue } from '../../../console/seo';
import type { StructuredFinding } from '../../../console/seoStructured';
import type { Finding } from '../../../console/fixPrompt';
import { runTool, errNoticeStyle, CopyHandoffButtons, useTechContext, type OnHandoff } from './shared';

interface SeoPanelData extends SeoReport {
  url: string;
  h1Text?: string;
  preview?: { title?: string; description?: string; canonical?: string; ogImage?: string };
  schema?: { types: string[]; findings: StructuredFinding[] };
}

function breadcrumb(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).slice(0, 3);
    return [u.host, ...segs].join(' › ');
  } catch {
    return url;
  }
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

  // Fix prompt = the rule issues + any structured-data validation gaps.
  const findings: Finding[] = [
    ...(data?.issues ?? []).map((i: SeoIssue) => ({ rule: i.rule, description: i.description, suggestion: i.suggestion, severity: i.severity, detail: i.detail })),
    ...(data?.schema?.findings ?? []).map((f) => ({
      rule: `Structured data — ${f.type}`,
      description: `The ${f.type} JSON-LD is missing recommended field(s): ${f.missing.join(', ')}.`,
      suggestion: `Add ${f.missing.join(', ')} so this block can produce a rich result.`,
      severity: 'low' as const,
    })),
  ];

  const preview = data?.preview;

  return (
    <div className="ci-panel" data-testid="ci-panel-seo">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit'}
        </button>
        <CopyHandoffButtons topic="SEO" findings={findings} context={{ ...techCtx, url: data?.url, title: data?.h1Text }} onHandoff={onHandoff} testid="ci-seo" />
        {data && <span className="ci-panel-meta" title={data.url}>Score: {data.score}/100</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {data && (
        <div className="ci-seo" data-testid="ci-seo">
          {/* Google-style rich-result preview */}
          {preview && (
            <div className="ci-serp" data-testid="ci-seo-serp">
              <div className="ci-serp-hd">Search preview</div>
              <div className="ci-serp-card">
                <div className="ci-serp-url">{breadcrumb(preview.canonical || data.url)}</div>
                <div className="ci-serp-title">{preview.title || '(no title — Google will use the page heading)'}</div>
                <div className="ci-serp-desc">
                  {preview.description || 'No meta description — Google will synthesize a snippet from the page content.'}
                </div>
              </div>
            </div>
          )}

          <div className="ci-seo-score">
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

          {/* Structured-data validation */}
          {data.schema && (data.schema.types.length > 0 || data.schema.findings.length > 0) && (
            <div className="ci-seo-schema" data-testid="ci-seo-schema">
              <div className="ci-storage-hd">Structured data</div>
              {data.schema.types.length > 0 && (
                <div className="ci-a11y-wcag" style={{ marginBottom: 6 }}>
                  {data.schema.types.map((t) => <span key={t} className="ci-a11y-tag">{t}</span>)}
                </div>
              )}
              {data.schema.findings.length === 0 ? (
                <div className="ci-card-fix">✓ Recognized types have their recommended fields.</div>
              ) : (
                data.schema.findings.map((f, i) => (
                  <div key={i} className="ci-card-fix" data-testid="ci-seo-schema-issue">
                    <strong>{f.type}</strong> — missing <code>{f.missing.join(', ')}</code>
                  </div>
                ))
              )}
            </div>
          )}

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
