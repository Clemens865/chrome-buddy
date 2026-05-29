import { describe, it, expect } from 'vitest';
import { appBaseCss, THEME_VAR_MAP } from './appTheme';

describe('appBaseCss', () => {
  it('maps panel tokens onto --cb-* variables', () => {
    const css = appBaseCss({ '--panel-bg': '#13161B', '--accent': '#A78BFA' });
    expect(css).toContain('--cb-bg: #13161B;');
    expect(css).toContain('--cb-accent: #A78BFA;');
  });
  it('falls back when a token is missing/blank', () => {
    const css = appBaseCss({ '--panel-bg': '   ' });
    expect(css).toContain(`--cb-bg: ${THEME_VAR_MAP['--panel-bg'].fallback};`);
    expect(css).toContain(`--cb-fg: ${THEME_VAR_MAP['--panel-fg'].fallback};`);
  });
  it('ships base element + .cb-* component styles wired to the vars', () => {
    const css = appBaseCss({});
    expect(css).toMatch(/html, body \{[^}]*var\(--cb-bg\)/);
    expect(css).toContain('.cb-btn {');
    expect(css).toContain('.cb-input');
    expect(css).toContain('.cb-card');
  });
});
