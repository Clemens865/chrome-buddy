import { describe, it, expect } from 'vitest';
import { composeHealth, type HealthInputs } from './healthScore';
import type { ErrorMatch } from './errorPatterns';
import type { A11yReport } from './a11y';
import type { SeoReport } from './seo';
import type { SensitiveHit } from './sensitivePatterns';

const ERR_CRITICAL: ErrorMatch = {
  text: 'Maximum update depth exceeded',
  category: 'React',
  framework: 'React',
  description: 'Infinite loop in useEffect or setState',
  suggestion: 'Check useEffect dependencies',
  severity: 'critical',
  count: 1,
};

const A11Y_REPORT: A11yReport = {
  total: 3,
  issues: [
    { id: 'label', rule: 'Form controls must have labels', severity: 'critical',
      description: '2 controls unlabeled', suggestion: 'Add labels', count: 2 },
    { id: 'image-alt', rule: 'Images must have alt text', severity: 'serious',
      description: '1 image missing alt', suggestion: 'Add alt', count: 1 },
  ],
};

const SEO_REPORT: SeoReport = {
  score: 70,
  facts: { titleLength: 12, descriptionLength: 0, ogKeys: 0, twitterKeys: 0, structuredData: 0 },
  issues: [
    { id: 'meta-description-missing', rule: 'Meta description', severity: 'high',
      description: 'No description tag', suggestion: 'Add one' },
  ],
};

const SENSITIVE: SensitiveHit[] = [
  { id: 'jwt', category: 'Auth Token', severity: 'high', description: 'JWT in storage',
    preview: 'eyJ…sw5c', source: 'localStorage:tok', count: 1 },
];

describe('composeHealth', () => {
  it('returns a clean 100 when no inputs were audited', () => {
    const h = composeHealth({});
    expect(h.score).toBe(100);
    expect(h.totalFindings).toBe(0);
    // Every category chip shows 0 findings.
    for (const c of h.categories) expect(c.findings).toBe(0);
  });

  it('returns 100 across audited categories when nothing is wrong', () => {
    const inputs: HealthInputs = {
      errors: [],
      a11y: { total: 0, issues: [] },
      seo: { score: 100, facts: { titleLength: 50, descriptionLength: 100, ogKeys: 4, twitterKeys: 1, structuredData: 0 }, issues: [] },
    };
    const h = composeHealth(inputs);
    expect(h.score).toBe(100);
    expect(h.findings).toEqual([]);
  });

  it('translates each analyser into category-tagged Findings', () => {
    const h = composeHealth({ errors: [ERR_CRITICAL], a11y: A11Y_REPORT, seo: SEO_REPORT, sensitive: SENSITIVE });
    const cats = new Set(h.findings.map((f) => f.category));
    expect(cats).toEqual(new Set(['errors', 'a11y', 'seo', 'privacy']));
  });

  it('sorts findings by severity globally (critical → low)', () => {
    const h = composeHealth({ errors: [ERR_CRITICAL], a11y: A11Y_REPORT, seo: SEO_REPORT });
    const sevs = h.findings.map((f) => f.severity);
    // First severity must be critical or serious / high (they share rank).
    expect(sevs[0]).toBe('critical');
    expect(sevs[sevs.length - 1]).toMatch(/low|medium|minor|moderate|high|serious/);
  });

  it('overall score is the WEIGHTED FLOOR — worst audited category drives it', () => {
    // Errors has one critical (-25 → 75). A11y has one critical + one serious (-25 -15 → 60).
    // SEO has one high (-15 → 85). Min = 60 (a11y).
    const h = composeHealth({ errors: [ERR_CRITICAL], a11y: A11Y_REPORT, seo: SEO_REPORT });
    const a11y = h.categories.find((c) => c.id === 'a11y');
    expect(a11y?.score).toBe(60);
    expect(h.score).toBe(60);
  });

  it('un-audited categories do not drag the overall score down', () => {
    // Only errors audited (1 critical → -25 → 75). Other categories show as 100
    // but are NOT in the floor calculation, so overall = 75.
    const h = composeHealth({ errors: [ERR_CRITICAL] });
    expect(h.score).toBe(75);
  });

  it('counts per-category findings on the chips', () => {
    const h = composeHealth({ a11y: A11Y_REPORT, sensitive: SENSITIVE });
    expect(h.categories.find((c) => c.id === 'a11y')?.findings).toBe(2);
    expect(h.categories.find((c) => c.id === 'privacy')?.findings).toBe(1);
  });

  it('emits Findings for security issues only when present', () => {
    const h = composeHealth({
      security: {
        url: 'https://x.test/',
        tls: { https: false },              // critical
        csp: { present: false },            // medium
        mixedContent: ['http://x'],         // high
        cookies: { total: 1, flagged: [{ name: 'sid', domain: 'x.test', issues: ['not Secure'] }] }, // medium
      },
    });
    const sec = h.findings.filter((f) => f.category === 'security');
    expect(sec.map((f) => f.rule)).toEqual(
      expect.arrayContaining(['HTTPS', 'Content-Security-Policy', 'Mixed content']),
    );
    // critical + high + medium*2 → 25+15+8+8 = 56 → 44
    expect(h.categories.find((c) => c.id === 'security')?.score).toBe(44);
  });

  it('emits Performance findings only for poor / needs-improvement vitals', () => {
    const h = composeHealth({
      vitals: {
        lcp: { value: 5000, verdict: 'poor' },
        cls: { value: 0.05, verdict: 'good' },          // omitted from findings
        ttfb: { value: 1000, verdict: 'needs-improvement' },
        fid: { verdict: 'unknown' },                    // omitted
      },
    });
    const perf = h.findings.filter((f) => f.category === 'performance');
    expect(perf.map((f) => f.rule).sort()).toEqual(['LCP', 'TTFB']);
    // LCP poor → high (-15), TTFB needs-improvement → medium (-8) → 100-23 = 77
    expect(h.categories.find((c) => c.id === 'performance')?.score).toBe(77);
  });
});
