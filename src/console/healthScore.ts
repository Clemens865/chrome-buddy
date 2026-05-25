// Compose the outputs of every analytical tool into ONE unified report:
// a 0-100 Health Score, per-category sub-scores, and a flat list of findings
// severity-sorted globally. Pure module — no chrome, no I/O — so the aggregator
// can be unit-tested in isolation and reused by both the HealthPanel UI and
// the agent-side "Run full audit" tool path.

import type { ErrorMatch } from './errorPatterns';
import type { SensitiveHit } from './sensitivePatterns';
import type { A11yReport, A11yIssue } from './a11y';
import type { SeoReport, SeoIssue } from './seo';
import type { Finding, FindingSeverity } from './fixPrompt';

/** Per-category sub-score, displayed as a chip in the HealthPanel UI. */
export interface CategoryScore {
  id: HealthCategory;
  label: string;
  score: number;
  /** Number of findings contributing to this category. */
  findings: number;
}

export type HealthCategory = 'errors' | 'security' | 'a11y' | 'seo' | 'privacy' | 'performance';

/** Web Vitals slice — small enough to inline (don't import the panel type). */
export interface VitalsSlice {
  lcp?: { value?: number; verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown' };
  fid?: { value?: number; verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown' };
  cls?: { value?: number; verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown' };
  fcp?: { value?: number; verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown' };
  ttfb?: { value?: number; verdict: 'good' | 'needs-improvement' | 'poor' | 'unknown' };
}

/** Security panel input slice — narrowed to what we score on. */
export interface SecuritySlice {
  url: string;
  tls: { https: boolean };
  csp: { present: boolean };
  mixedContent: ReadonlyArray<string>;
  cookies: { total: number; flagged: ReadonlyArray<{ name: string; domain: string; issues: ReadonlyArray<string> }> };
}

export interface HealthInputs {
  errors?: ReadonlyArray<ErrorMatch>;
  security?: SecuritySlice;
  a11y?: A11yReport;
  seo?: SeoReport;
  sensitive?: ReadonlyArray<SensitiveHit>;
  vitals?: VitalsSlice;
}

export interface HealthReport {
  /** Overall Health Score (0-100) — the weighted floor of every contributing
   * category. NOT a simple average — one critical issue should hurt the score
   * even if other categories are perfect, which a min-style metric captures. */
  score: number;
  /** Per-category sub-scores rendered as chips on the panel. */
  categories: CategoryScore[];
  /** Flat list of every finding from every analyser, severity-sorted globally,
   * each tagged with its `category` (Errors/Security/A11y/SEO/Privacy/Perf). */
  findings: ReadonlyArray<Finding & { category: HealthCategory }>;
  /** Total finding count (sum across categories). */
  totalFindings: number;
}

/** Score-weight table — keyed by FindingSeverity so the same numbers govern
 * a11y "serious", error "high", etc. Tuned to make `critical` truly painful
 * and `low` mostly cosmetic. */
const WEIGHT: Record<FindingSeverity, number> = {
  critical: 25,
  high: 15,
  serious: 15,
  medium: 8,
  moderate: 8,
  low: 3,
  minor: 3,
};

/**
 * Compose every available input into a single HealthReport. Every input is
 * optional — the report only counts categories that were actually audited.
 */
export function composeHealth(inputs: HealthInputs): HealthReport {
  const findings: (Finding & { category: HealthCategory })[] = [];

  // 1. Errors → findings
  if (inputs.errors) {
    for (const m of inputs.errors) {
      findings.push({
        category: 'errors',
        rule: `${m.framework ? m.framework + ' · ' : ''}${m.category}`,
        description: m.description,
        suggestion: m.suggestion,
        severity: m.severity as FindingSeverity,
        count: m.count,
        docUrl: m.docUrl,
      });
    }
  }

  // 2. Security → findings (only "bad" rows produce findings)
  if (inputs.security) {
    const s = inputs.security;
    if (!s.tls.https) {
      findings.push({
        category: 'security',
        rule: 'HTTPS',
        severity: 'critical',
        description: 'The page is served over plain HTTP.',
        suggestion: 'Redirect HTTP → HTTPS at the edge and serve all resources securely.',
      });
    }
    if (!s.csp.present) {
      findings.push({
        category: 'security',
        rule: 'Content-Security-Policy',
        severity: 'medium',
        description: 'No CSP meta tag (header may still be set).',
        suggestion: 'Set a CSP that constrains script-src / connect-src / frame-src to known origins.',
      });
    }
    if (s.mixedContent.length > 0) {
      findings.push({
        category: 'security',
        rule: 'Mixed content',
        severity: 'high',
        description: `${s.mixedContent.length} insecure http:// resource(s) on an HTTPS page.`,
        suggestion: 'Replace each http:// URL with https:// (or use protocol-relative URLs).',
        count: s.mixedContent.length,
      });
    }
    for (const c of s.cookies.flagged) {
      findings.push({
        category: 'security',
        rule: `Cookie ${c.name}`,
        severity: 'medium',
        description: `Cookie "${c.name}" on ${c.domain} missing: ${c.issues.join(', ')}.`,
        suggestion: 'Set Secure / HttpOnly / SameSite when issuing the cookie.',
      });
    }
  }

  // 3. A11y → findings
  if (inputs.a11y) {
    for (const i of inputs.a11y.issues) findings.push(a11yToFinding(i));
  }

  // 4. SEO → findings
  if (inputs.seo) {
    for (const i of inputs.seo.issues) findings.push(seoToFinding(i));
  }

  // 5. Privacy (sensitive data leaks) → findings
  if (inputs.sensitive) {
    for (const h of inputs.sensitive) {
      findings.push({
        category: 'privacy',
        rule: `Leaked ${h.category}`,
        severity: h.severity as FindingSeverity,
        description: `${h.description} (in ${h.source})`,
        suggestion: 'Remove the value from the page and rotate the credential immediately.',
        detail: h.preview,
        count: h.count,
      });
    }
  }

  // 6. Performance (web vitals) → findings (only when "poor" or "needs-improvement")
  if (inputs.vitals) {
    for (const [key, v] of Object.entries(inputs.vitals)) {
      if (!v || v.verdict === 'good' || v.verdict === 'unknown') continue;
      const sev: FindingSeverity = v.verdict === 'poor' ? 'high' : 'medium';
      findings.push({
        category: 'performance',
        rule: key.toUpperCase(),
        severity: sev,
        description: `${key.toUpperCase()} is in the "${v.verdict}" range${v.value !== undefined ? ` (${formatMetric(key, v.value)})` : ''}.`,
        suggestion: perfSuggestion(key),
      });
    }
  }

  // Sort globally by severity.
  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  // Per-category sub-scores.
  const categories = buildCategoryScores(inputs, findings);

  // Overall: the weighted floor. Take the lowest category-score among the
  // categories that were actually audited (a missing audit doesn't drag the
  // overall down — it just doesn't contribute).
  const audited = categories.filter((c) => isAudited(c.id, inputs));
  const overall = audited.length ? Math.min(...audited.map((c) => c.score)) : 100;

  return {
    score: overall,
    categories,
    findings,
    totalFindings: findings.length,
  };
}

function a11yToFinding(i: A11yIssue): Finding & { category: HealthCategory } {
  return {
    category: 'a11y',
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity as FindingSeverity,
    count: i.count,
  };
}

function seoToFinding(i: SeoIssue): Finding & { category: HealthCategory } {
  return {
    category: 'seo',
    rule: i.rule,
    description: i.description,
    suggestion: i.suggestion,
    severity: i.severity as FindingSeverity,
    detail: i.detail,
  };
}

/** Build per-category sub-score chips. Score = 100 - sum(weights of findings in that category), floored at 0. */
function buildCategoryScores(inputs: HealthInputs, findings: ReadonlyArray<Finding & { category: HealthCategory }>): CategoryScore[] {
  const categories: { id: HealthCategory; label: string }[] = [
    { id: 'errors', label: 'Errors' },
    { id: 'security', label: 'Security' },
    { id: 'a11y', label: 'A11y' },
    { id: 'seo', label: 'SEO' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'performance', label: 'Performance' },
  ];
  return categories.map(({ id, label }) => {
    if (!isAudited(id, inputs)) {
      // Not audited → display as score:- and findings:0
      return { id, label, score: 100, findings: 0 };
    }
    const cat = findings.filter((f) => f.category === id);
    const penalty = cat.reduce((sum, f) => sum + WEIGHT[f.severity], 0);
    return { id, label, score: Math.max(0, 100 - penalty), findings: cat.length };
  });
}

function isAudited(id: HealthCategory, inputs: HealthInputs): boolean {
  return {
    errors: inputs.errors !== undefined,
    security: inputs.security !== undefined,
    a11y: inputs.a11y !== undefined,
    seo: inputs.seo !== undefined,
    privacy: inputs.sensitive !== undefined,
    performance: inputs.vitals !== undefined,
  }[id];
}

function severityRank(s: FindingSeverity): number {
  switch (s) {
    case 'critical': return 0;
    case 'high':
    case 'serious': return 1;
    case 'medium':
    case 'moderate': return 2;
    case 'low':
    case 'minor': return 3;
  }
}

function formatMetric(key: string, v: number): string {
  if (key === 'cls') return v.toFixed(3);
  return `${Math.round(v)} ms`;
}

function perfSuggestion(key: string): string {
  switch (key) {
    case 'lcp': return 'Optimize the largest paint: preload hero image / inline critical CSS / defer non-critical JS.';
    case 'fid': return 'Reduce main-thread work during initial load: code-split, defer third-party scripts, use Web Workers for heavy work.';
    case 'cls': return 'Reserve space for images and embeds (width/height or aspect-ratio CSS); avoid injecting content above the fold.';
    case 'fcp': return 'Improve server response (TTFB) and eliminate render-blocking resources to shorten first-paint time.';
    case 'ttfb': return 'Investigate server latency, add a CDN, enable HTTP/2 or HTTP/3, and cache static assets aggressively.';
    default: return 'Profile this metric and optimize the contributing scripts / resources.';
  }
}
