// Map raw axe-core results into our A11yReport shape so the A11y panel + fix-
// prompt builder render axe's ~90 WCAG rules with zero panel changes, plus the
// extra detail axe gives (per-element selectors, WCAG tags, help URLs).
//
// axe-core is BUNDLED (MIT) and injected into the page by the SW — it is our own
// shipped code, never fetched at runtime, so it respects the MV3 zero-RCE line.
//
// Pure — no chrome, no I/O — fully unit-testable.

import type { A11yReport, A11yIssue, A11ySeverity } from './a11y';

/** Subset of axe-core's result types we consume. */
export interface AxeNode {
  target: string[];
  html: string;
  failureSummary?: string;
}
export interface AxeViolation {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}
export interface AxeResults {
  violations: AxeViolation[];
  testEngine?: { name?: string; version?: string };
}

/** A11yReport produced by the axe engine (carries the engine + version). */
export interface A11yAxeReport extends A11yReport {
  engine: 'axe';
  axeVersion?: string;
}

function mapImpact(impact: AxeViolation['impact']): A11ySeverity {
  switch (impact) {
    case 'critical': return 'critical';
    case 'serious': return 'serious';
    case 'moderate': return 'moderate';
    default: return 'minor';
  }
}

function severityRank(s: A11ySeverity): number {
  return s === 'critical' ? 0 : s === 'serious' ? 1 : s === 'moderate' ? 2 : 3;
}

/** First node's failureSummary makes the most actionable "Fix" line. */
function suggestionFor(v: AxeViolation): string {
  const summary = v.nodes[0]?.failureSummary?.replace(/\s*\n\s*/g, ' ').trim();
  if (summary) return summary;
  return `See axe guidance: ${v.helpUrl}`;
}

/** Map axe results → A11yAxeReport (A11yReport-compatible + engine metadata). */
export function mapAxeViolations(results: AxeResults): A11yAxeReport {
  const issues: A11yIssue[] = results.violations
    .map((v) => ({
      id: v.id,
      severity: mapImpact(v.impact),
      rule: v.help,
      description: v.description,
      suggestion: suggestionFor(v),
      count: v.nodes.length,
      docUrl: v.helpUrl,
      wcag: v.tags.filter((t) => /^wcag/i.test(t)),
      nodes: v.nodes.slice(0, 5).map((n) => ({
        target: n.target.join(' '),
        html: n.html,
        summary: n.failureSummary?.replace(/\s*\n\s*/g, ' ').trim(),
      })),
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return {
    engine: 'axe',
    axeVersion: results.testEngine?.version,
    total: issues.reduce((n, i) => n + i.count, 0),
    issues,
  };
}
