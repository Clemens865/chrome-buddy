// Theme bridge for Tier-3 apps. The sandbox iframe is a separate document and
// can't see the panel's CSS variables, so the host reads the live theme tokens
// and injects an equivalent base stylesheet into the app — giving apps Chrome
// Buddy's look + light/cream/graphite awareness via `--cb-*` vars and `.cb-*`
// classes, without breaking isolation (it's only CSS).

/** Panel CSS var → app-facing `--cb-*` alias, with a sensible fallback. */
export const THEME_VAR_MAP: Record<string, { cb: string; fallback: string }> = {
  '--panel-bg': { cb: '--cb-bg', fallback: '#ffffff' },
  '--panel-fg': { cb: '--cb-fg', fallback: '#0a0a0a' },
  '--panel-muted': { cb: '--cb-muted', fallback: '#71717a' },
  '--panel-border': { cb: '--cb-border', fallback: '#e4e4e7' },
  '--panel-elev': { cb: '--cb-elev', fallback: '#f8f8f9' },
  '--accent': { cb: '--cb-accent', fallback: '#6366f1' },
};

/** Build the base stylesheet injected before an app's own CSS, from the read
 *  theme tokens (panel var name → value). Pure + testable. */
export function appBaseCss(tokens: Record<string, string>): string {
  const vars = Object.entries(THEME_VAR_MAP)
    .map(([panelVar, { cb, fallback }]) => `  ${cb}: ${(tokens[panelVar] || '').trim() || fallback};`)
    .join('\n');
  return `:root {
${vars}
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--cb-bg); color: var(--cb-fg); font: 13px/1.5 -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; }
.cb-btn { font: inherit; border: 0; border-radius: 8px; padding: 7px 14px; background: var(--cb-accent); color: #fff; cursor: pointer; }
.cb-btn:disabled { opacity: .5; cursor: default; }
.cb-btn.cb-ghost { background: transparent; color: var(--cb-fg); border: 1px solid var(--cb-border); }
.cb-input, textarea.cb-input, select.cb-input { font: inherit; width: 100%; border: 1px solid var(--cb-border); border-radius: 8px; padding: 8px; background: var(--cb-bg); color: var(--cb-fg); }
.cb-card { border: 1px solid var(--cb-border); border-radius: 10px; padding: 10px; background: var(--cb-elev); }
.cb-muted { color: var(--cb-muted); }
.cb-row { display: flex; gap: 8px; align-items: center; }`;
}

/** Read the live theme tokens from an element inside the themed panel tree
 *  (custom properties inherit, so any descendant resolves them). */
export function readThemeTokens(el: Element | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el || typeof getComputedStyle !== 'function') return out;
  const cs = getComputedStyle(el);
  for (const panelVar of Object.keys(THEME_VAR_MAP)) {
    out[panelVar] = cs.getPropertyValue(panelVar);
  }
  return out;
}
