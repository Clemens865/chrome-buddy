import { describe, it, expect } from 'vitest';
import { analyzeA11y, countHeadingOrderViolations, type A11ySignal } from './a11y';

function signal(over: Partial<A11ySignal> = {}): A11ySignal {
  return {
    images: [],
    controls: [],
    headingLevels: [],
    title: 'A Page',
    htmlLang: 'en',
    unlabeledButtons: 0,
    unlabeledLinks: 0,
    ...over,
  };
}

describe('analyzeA11y', () => {
  it('flags <img> elements without alt as serious', () => {
    const r = analyzeA11y(
      signal({
        images: [
          { src: '/a.png' }, // missing alt
          { src: '/b.png', alt: 'OK' },
          { src: '/c.png', role: 'presentation' }, // intentionally decorative
        ],
      }),
    );
    const issue = r.issues.find((i) => i.id === 'image-alt');
    expect(issue?.count).toBe(1);
    expect(issue?.severity).toBe('serious');
  });

  it('flags unlabeled form controls as critical', () => {
    const r = analyzeA11y(
      signal({
        controls: [
          { tag: 'input', type: 'text', hasLabel: false },
          { tag: 'input', type: 'text', hasLabel: false, ariaLabel: 'Email' },
          { tag: 'input', type: 'hidden', hasLabel: false }, // hidden is excluded
        ],
      }),
    );
    expect(r.issues.find((i) => i.id === 'label')?.count).toBe(1);
  });

  it('flags missing html[lang] and missing <title>', () => {
    const r = analyzeA11y(signal({ htmlLang: undefined, title: undefined }));
    expect(r.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['html-has-lang', 'document-title']));
  });

  it('flags heading-order jumps and missing h1', () => {
    const r = analyzeA11y(signal({ headingLevels: [2, 4, 5] }));
    expect(r.issues.find((i) => i.id === 'heading-order')?.count).toBe(1);
    expect(r.issues.find((i) => i.id === 'page-has-h1')).toBeTruthy();
  });

  it('sorts issues by severity (critical → minor)', () => {
    const r = analyzeA11y(
      signal({
        images: [{ src: '/a.png' }], // serious
        controls: [{ tag: 'input', type: 'text', hasLabel: false }], // critical
      }),
    );
    expect(r.issues[0].severity).toBe('critical');
    expect(r.issues[1].severity).toBe('serious');
  });

  it('returns an empty report for a clean page', () => {
    const r = analyzeA11y(
      signal({
        images: [{ src: '/a.png', alt: 'A' }],
        controls: [{ tag: 'input', type: 'text', hasLabel: true }],
        headingLevels: [1, 2, 2, 3],
      }),
    );
    expect(r.issues).toHaveLength(0);
    expect(r.total).toBe(0);
  });
});

describe('countHeadingOrderViolations', () => {
  it('flags level skips downward only', () => {
    expect(countHeadingOrderViolations([1, 2, 3, 2])).toBe(0); // going up again is fine
    expect(countHeadingOrderViolations([1, 3])).toBe(1);
    expect(countHeadingOrderViolations([1, 2, 4, 6])).toBe(2);
  });
});
