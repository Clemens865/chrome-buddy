import { describe, it, expect } from 'vitest';
import { mapAxeViolations, type AxeResults } from './axeMap';

const results: AxeResults = {
  testEngine: { name: 'axe-core', version: '4.12.0' },
  violations: [
    {
      id: 'image-alt',
      impact: 'critical',
      help: 'Images must have alternative text',
      description: 'Ensures <img> elements have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      tags: ['cat.text-alternatives', 'wcag2a', 'wcag111'],
      nodes: [
        { target: ['img.hero'], html: '<img class="hero" src="x.png">', failureSummary: 'Fix any of the following:\n  Element does not have an alt attribute' },
        { target: ['img.logo'], html: '<img class="logo">' },
      ],
    },
    {
      id: 'color-contrast',
      impact: 'serious',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      description: 'Ensures the contrast is sufficient',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
      tags: ['wcag2aa', 'wcag143'],
      nodes: [{ target: ['.muted'], html: '<p class="muted">hi</p>' }],
    },
  ],
};

describe('mapAxeViolations', () => {
  it('maps to A11yReport shape with engine + version', () => {
    const r = mapAxeViolations(results);
    expect(r.engine).toBe('axe');
    expect(r.axeVersion).toBe('4.12.0');
    expect(r.issues).toHaveLength(2);
    expect(r.total).toBe(3); // 2 + 1 nodes
  });

  it('maps impact → severity and sorts critical first', () => {
    const r = mapAxeViolations(results);
    expect(r.issues[0].severity).toBe('critical');
    expect(r.issues[0].rule).toBe('Images must have alternative text');
    expect(r.issues[1].severity).toBe('serious');
  });

  it('carries helpUrl, WCAG tags, and capped node details', () => {
    const img = mapAxeViolations(results).issues[0];
    expect(img.docUrl).toMatch(/dequeuniversity/);
    expect(img.wcag).toEqual(['wcag2a', 'wcag111']); // non-wcag tags filtered out
    expect(img.nodes).toHaveLength(2);
    expect(img.nodes![0].target).toBe('img.hero');
    expect(img.nodes![0].summary).toContain('does not have an alt attribute');
  });

  it('uses the first failureSummary as the fix suggestion', () => {
    expect(mapAxeViolations(results).issues[0].suggestion).toContain('does not have an alt attribute');
  });

  it('falls back to the helpUrl when there is no failureSummary', () => {
    expect(mapAxeViolations(results).issues[1].suggestion).toMatch(/See axe guidance: https/);
  });

  it('defaults null impact to minor', () => {
    const r = mapAxeViolations({ violations: [{ id: 'x', impact: null, help: 'h', description: 'd', helpUrl: 'u', tags: [], nodes: [{ target: ['a'], html: '<a>' }] }] });
    expect(r.issues[0].severity).toBe('minor');
  });
});
