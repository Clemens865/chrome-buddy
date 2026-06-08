// Build a self-contained, shareable HTML site-health report from a composed
// HealthReport — the flagship artifact (our "Lighthouse report"): one .html file
// the user downloads, opens, prints, or sends to their team. No external assets:
// all CSS is inline so it renders anywhere offline.
//
// Pure — no chrome, no I/O, no clock (generatedAt is passed in) — unit-testable.

import type { HealthReport, HealthCategory } from './healthScore';

export interface HealthReportMeta {
  url?: string;
  title?: string;
  techStack?: readonly string[];
  /** ISO/human timestamp; passed in so the builder stays pure + deterministic. */
  generatedAt?: string;
}

const CATEGORY_LABEL: Record<HealthCategory, string> = {
  errors: 'Console Errors',
  security: 'Security',
  a11y: 'Accessibility',
  seo: 'SEO',
  privacy: 'Privacy / Secrets',
  performance: 'Performance',
};

/** Escape text for safe HTML interpolation (findings come from page content). */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function verdict(score: number): { cls: string; label: string } {
  if (score >= 90) return { cls: 'good', label: 'Excellent' };
  if (score >= 70) return { cls: 'warn', label: 'Needs improvement' };
  return { cls: 'poor', label: 'Poor' };
}

/** Build the full HTML document string. */
export function buildHealthReportHtml(report: HealthReport, meta: HealthReportMeta = {}): string {
  const host = (() => {
    try { return meta.url ? new URL(meta.url).host : ''; } catch { return meta.url ?? ''; }
  })();
  const v = verdict(report.score);

  const cats = report.categories
    .map((c) => {
      const cv = c.findings === 0 ? { cls: 'good' } : verdict(c.score);
      return `<div class="cat ${cv.cls}"><div class="cat-label">${esc(c.label)}</div><div class="cat-score">${c.findings === 0 ? '—' : c.score}</div><div class="cat-n">${c.findings} issue(s)</div></div>`;
    })
    .join('');

  // Group findings by category for readable sections.
  const byCat = new Map<HealthCategory, typeof report.findings[number][]>();
  for (const f of report.findings) {
    const arr = byCat.get(f.category) ?? [];
    arr.push(f);
    byCat.set(f.category, arr);
  }
  const sections = [...byCat.entries()]
    .map(([cat, items]) => {
      const rows = items
        .map(
          (f) => `<div class="finding sev-${esc(f.severity)}">
        <div class="finding-hd"><span class="sev">${esc(f.severity)}</span><span class="rule">${esc(f.rule)}</span>${f.count && f.count > 1 ? `<span class="count">×${f.count}</span>` : ''}</div>
        <div class="desc">${esc(f.description)}</div>
        <div class="fix"><b>Fix:</b> ${esc(f.suggestion)}</div>
      </div>`,
        )
        .join('');
      return `<section><h2>${esc(CATEGORY_LABEL[cat] ?? cat)} <span class="muted">(${items.length})</span></h2>${rows}</section>`;
    })
    .join('');

  const metaBits = [
    meta.url ? `<a href="${esc(meta.url)}">${esc(meta.url)}</a>` : '',
    meta.title ? esc(meta.title) : '',
    meta.techStack?.length ? `Stack: ${esc(meta.techStack.join(', '))}` : '',
    meta.generatedAt ? `Generated ${esc(meta.generatedAt)}` : '',
  ].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Site Health Report${host ? ' — ' + esc(host) : ''}</title>
<style>
  :root { --good:#16A34A; --warn:#D97706; --poor:#DC2626; --bg:#F8FAFC; --fg:#0F172A; --muted:#64748B; --border:#E2E8F0; --card:#FFFFFF; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--fg); }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; gap: 24px; margin-bottom: 8px; }
  .ring { width: 104px; height: 104px; border-radius: 50%; display: grid; place-items: center; font-size: 36px; font-weight: 800; color: #fff; flex: 0 0 auto; }
  .ring.good { background: var(--good); } .ring.warn { background: var(--warn); } .ring.poor { background: var(--poor); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; }
  .meta { color: var(--muted); font-size: 12.5px; margin: 6px 0 28px; word-break: break-word; }
  .meta a { color: inherit; }
  .cats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 32px; }
  .cat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; border-top: 3px solid var(--border); }
  .cat.good { border-top-color: var(--good); } .cat.warn { border-top-color: var(--warn); } .cat.poor { border-top-color: var(--poor); }
  .cat-label { font-size: 12px; color: var(--muted); } .cat-score { font-size: 26px; font-weight: 700; } .cat-n { font-size: 11.5px; color: var(--muted); }
  section { margin-bottom: 28px; }
  h2 { font-size: 16px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h2 .muted { color: var(--muted); font-weight: 400; font-size: 13px; }
  .finding { background: var(--card); border: 1px solid var(--border); border-left: 4px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
  .finding.sev-critical { border-left-color: var(--poor); } .finding.sev-high, .finding.sev-serious { border-left-color: var(--warn); }
  .finding.sev-medium, .finding.sev-moderate { border-left-color: #6366F1; } .finding.sev-low, .finding.sev-minor { border-left-color: var(--border); }
  .finding-hd { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .sev { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #fff; background: var(--muted); padding: 2px 7px; border-radius: 5px; }
  .sev-critical .sev { background: var(--poor); } .sev-high .sev, .sev-serious .sev { background: var(--warn); } .sev-medium .sev, .sev-moderate .sev { background: #6366F1; }
  .rule { font-weight: 600; } .count { color: var(--muted); font-size: 12px; }
  .desc { margin-bottom: 4px; } .fix { color: var(--muted); font-size: 14px; }
  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 40px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="ring ${v.cls}">${report.score}</div>
      <div>
        <h1>Site Health Report</h1>
        <div class="sub">${esc(v.label)} — ${report.totalFindings} finding(s) across ${report.categories.length} audited categor${report.categories.length === 1 ? 'y' : 'ies'}.</div>
      </div>
    </header>
    ${metaBits ? `<div class="meta">${metaBits}</div>` : '<div style="height:20px"></div>'}
    <div class="cats">${cats}</div>
    ${sections || '<p class="sub">No issues found — every audited category passed.</p>'}
    <footer>Generated by Chrome Buddy · Console Inspector</footer>
  </div>
</body>
</html>
`;
}
