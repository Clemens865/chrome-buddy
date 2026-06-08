// HealthPanel — top-level aggregator. Runs every audit in parallel, composes
// a Health Score (0-100) + per-category sub-scores + global severity-sorted
// findings, and exposes ONE master IDE prompt + ONE Buddy handoff covering
// everything. Default landing surface for Console Inspector.

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { ErrorMatch } from '../../../console/errorPatterns';
import type { A11yReport as A11yReportType } from '../../../console/a11y';
import type { SeoReport as SeoReportType } from '../../../console/seo';
import type { SensitiveHit } from '../../../console/sensitivePatterns';
import type { TechMatch } from '../../../console/techStack';
import {
  buildMasterPrompt,
  type FixPromptContext,
  type MasterFinding,
} from '../../../console/fixPrompt';
import { composeHealth, type HealthReport, type HealthCategory } from '../../../console/healthScore';
import { buildHealthReportHtml } from '../../../console/healthReport';
import {
  runTool,
  copyToClipboard,
  errNoticeStyle,
  downloadText,
  recordScoreDelta,
  formatDelta,
  type OnHandoff,
} from './shared';

export function HealthPanel({ onHandoff }: { onHandoff?: OnHandoff } = {}) {
  const [health, setHealth] = useState<HealthReport | undefined>();
  const [context, setContext] = useState<FixPromptContext | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [delta, setDelta] = useState<number | undefined>();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    try {
      // Fire every audit in parallel — order preserved by Promise.all. `force`
      // propagates to every call so "Re-audit all" really re-runs.
      const opts = { force };
      const [errors, sec, a11y, seo, sens, vit, tech] = await Promise.all([
        runTool<{ matches: ErrorMatch[]; scanned: number; matchCount: number; hint?: string }>('analyze_errors', {}, opts),
        runTool<{ url: string; tls: { https: boolean }; csp: { metaPolicy: string | null; present: boolean }; mixedContent: string[]; cookies: { total: number; flagged: { name: string; domain: string; secure?: boolean; httpOnly?: boolean; sameSite?: string; issues: string[] }[] } }>('scan_security', {}, opts),
        runTool<A11yReportType>('analyze_a11y', {}, opts),
        runTool<SeoReportType & { url: string; h1Text?: string }>('analyze_seo', {}, opts),
        runTool<{ hits: SensitiveHit[]; scanned: number }>('scan_sensitive_data', {}, opts),
        runTool<{ url: string; title: string; vitals: Record<string, { value?: number; unit: string; verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown' }> }>('web_vitals', {}, opts),
        runTool<{ url: string; matches: TechMatch[] }>('detect_tech_stack', {}, opts),
      ]);
      // An SW error on one audit just leaves that category un-audited rather
      // than failing the whole report.
      const h = composeHealth({
        errors: errors.ok ? errors.data.matches : undefined,
        security: sec.ok ? sec.data : undefined,
        a11y: a11y.ok ? a11y.data : undefined,
        seo: seo.ok ? seo.data : undefined,
        sensitive: sens.ok ? sens.data.hits : undefined,
        vitals: vit.ok
          ? {
              lcp: vit.data.vitals.lcp,
              fid: vit.data.vitals.fid,
              cls: vit.data.vitals.cls,
              fcp: vit.data.vitals.fcp,
              ttfb: vit.data.vitals.ttfb,
            }
          : undefined,
      });
      setHealth(h);
      const url = sec.ok ? sec.data.url : seo.ok ? seo.data.url : vit.ok ? vit.data.url : undefined;
      const title = vit.ok ? vit.data.title : seo.ok ? seo.data.h1Text : undefined;
      setContext({
        url,
        title,
        techStack: tech.ok ? tech.data.matches.map((m) => m.name) : undefined,
      });
      // Verify loop: score delta vs the last audit of this page (this session).
      setDelta(recordScoreDelta('health', url ?? 'unknown', h.score));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const scoreClass = (s: number): 'good' | 'needs-improvement' | 'poor' =>
    s >= 90 ? 'good' : s >= 70 ? 'needs-improvement' : 'poor';

  const flash = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const copyMaster = async () => {
    if (!health) return;
    const md = buildMasterPrompt(
      health.score,
      health.findings.map<MasterFinding>((f) => ({ ...f })),
      context,
    );
    if (await copyToClipboard(md)) flash();
  };

  const downloadReport = () => {
    if (!health) return;
    const html = buildHealthReportHtml(health, { ...context, generatedAt: new Date().toLocaleString() });
    downloadText('site-health-report.html', html, 'text/html;charset=utf-8');
  };

  const sendToBuddy = () => {
    if (!health || !onHandoff) return;
    const lines: string[] = [];
    lines.push('Use list_files + read_file to inspect this repository and propose fixes for the');
    lines.push(`following site-health issues (current score ${health.score}/100). For each, locate the`);
    lines.push('offending code and prepare a write_file edit. Wait for confirmation before saving.');
    lines.push('');
    if (context?.url) lines.push(`Page URL: ${context.url}`);
    if (context?.techStack?.length) lines.push(`Detected stack: ${context.techStack.join(', ')}`);
    lines.push('');
    for (const f of health.findings.slice(0, 8)) {
      lines.push(`- [${f.severity}] ${f.category}: ${f.rule} — ${f.description}`);
      lines.push(`  → ${f.suggestion}`);
    }
    onHandoff({ prompt: lines.join('\n'), mode: 'agent' });
  };

  return (
    <div className="ci-panel" data-testid="ci-panel-health">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Auditing…' : 'Re-audit all'}
        </button>
        {health && (
          <button
            type="button"
            className="btn btn-sm"
            data-testid="ci-health-report"
            title="Download a shareable, self-contained HTML report of this audit."
            onClick={downloadReport}
          >
            Download report
          </button>
        )}
        {health && health.totalFindings > 0 && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="ci-health-copy"
              title="Copy ONE comprehensive fix prompt covering every audit for paste-into-IDE."
              onClick={copyMaster}
            >
              {copied ? 'Copied ✓' : 'Copy master prompt'}
            </button>
            {onHandoff && (
              <button
                type="button"
                className="btn btn-sm"
                data-testid="ci-health-send-buddy"
                title="Hand the audit to a Buddy chat that uses list_files/read_file/write_file to fix the code."
                onClick={sendToBuddy}
              >
                Send to Buddy
              </button>
            )}
          </>
        )}
        {health && <span className="ci-panel-meta">{health.totalFindings} finding(s)</span>}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {health && (
        <div className="ci-health" data-testid="ci-health">
          <div className="ci-health-hero">
            <div className={'ci-health-ring ci-health-score-' + scoreClass(health.score)} data-testid="ci-health-score">
              {health.score}
            </div>
            <div className="ci-health-hero-label">
              <div className="ci-health-hero-title">Site Health</div>
              <div className="ci-health-hero-sub">
                {health.score >= 90
                  ? 'Excellent — minor polish at most.'
                  : health.score >= 70
                    ? 'Needs improvement — focus on `high` and `critical` first.'
                    : 'Poor — multiple categories are below acceptable.'}
              </div>
              {typeof delta === 'number' && (
                <div className="ci-health-delta" data-testid="ci-health-delta">{formatDelta(delta)} since last audit</div>
              )}
            </div>
          </div>
          <div className="ci-health-categories">
            {health.categories.map((c) => (
              <div
                key={c.id}
                className={'ci-health-cat ci-health-cat-' + scoreClass(c.score)}
                data-testid={`ci-health-cat-${c.id}`}
              >
                <div className="ci-health-cat-label">{c.label}</div>
                <div className="ci-health-cat-val">{c.findings === 0 ? '—' : c.score}</div>
                {c.findings > 0 && <div className="ci-health-cat-n">{c.findings} issue(s)</div>}
              </div>
            ))}
          </div>
          {health.findings.length === 0 ? (
            <div className="empty-state">
              <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
              <div className="empty-state-title">All clear</div>
              <div className="empty-state-desc">
                Every audited category passed. Nothing to fix.
              </div>
            </div>
          ) : (
            <div className="ci-cards">
              {health.findings.slice(0, 12).map((f, i) => (
                <div key={i} className={'ci-card ci-sev-' + f.severity}>
                  <div className="ci-card-hd">
                    <span className={'ci-sev-pill ci-sev-pill-' + f.severity}>{f.severity}</span>
                    <span className="ci-card-cat ci-health-cat-tag">{categoryLabel(f.category)}</span>
                    <span className="ci-health-cat-rule">{f.rule}</span>
                    {f.count !== undefined && f.count > 1 && <span className="ci-card-count">×{f.count}</span>}
                  </div>
                  <div className="ci-card-desc">{f.description}</div>
                  <div className="ci-card-fix">
                    <strong>Fix:</strong> {f.suggestion}
                  </div>
                </div>
              ))}
              {health.findings.length > 12 && (
                <div className="ci-health-more">
                  +{health.findings.length - 12} more — included in the master prompt.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function categoryLabel(c: HealthCategory): string {
  return {
    errors: 'Errors',
    security: 'Security',
    a11y: 'A11y',
    seo: 'SEO',
    privacy: 'Privacy',
    performance: 'Perf',
  }[c];
}
