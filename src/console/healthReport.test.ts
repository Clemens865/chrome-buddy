import { describe, it, expect } from 'vitest';
import { buildHealthReportHtml } from './healthReport';
import type { HealthReport } from './healthScore';

const report: HealthReport = {
  score: 72,
  categories: [
    { id: 'security', label: 'Security', score: 60, findings: 2 },
    { id: 'seo', label: 'SEO', score: 100, findings: 0 },
  ],
  findings: [
    { category: 'security', rule: 'Content-Security-Policy', severity: 'high', description: 'No CSP set.', suggestion: 'Add a CSP header.', count: 1 },
    { category: 'security', rule: 'Cookie <evil>', severity: 'medium', description: 'Missing flags & "stuff".', suggestion: 'Set Secure.' },
  ],
  totalFindings: 2,
};

describe('buildHealthReportHtml', () => {
  it('produces a self-contained HTML doc with the score, categories, and findings', () => {
    const html = buildHealthReportHtml(report, { url: 'https://example.com/', techStack: ['React'], generatedAt: '2026-06-08' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>'); // inline CSS, no external assets
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).toContain('>72<'); // score ring
    expect(html).toContain('Site Health Report');
    expect(html).toContain('Security');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('Stack: React');
    expect(html).toContain('Generated 2026-06-08');
    expect(html).toContain('example.com'); // title includes host
  });

  it('escapes HTML in finding text (no injection from page content)', () => {
    const html = buildHealthReportHtml(report);
    expect(html).toContain('Cookie &lt;evil&gt;');
    expect(html).toContain('&quot;stuff&quot;');
    expect(html).not.toContain('<evil>');
  });

  it('renders an all-clear message when there are no findings', () => {
    const html = buildHealthReportHtml({ score: 100, categories: [{ id: 'seo', label: 'SEO', score: 100, findings: 0 }], findings: [], totalFindings: 0 });
    expect(html).toContain('every audited category passed');
  });

  it('is deterministic given the same inputs', () => {
    const a = buildHealthReportHtml(report, { generatedAt: 'x' });
    const b = buildHealthReportHtml(report, { generatedAt: 'x' });
    expect(a).toBe(b);
  });
});
