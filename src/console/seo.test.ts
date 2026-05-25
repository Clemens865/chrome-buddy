import { describe, it, expect } from 'vitest';
import { analyzeSeo, scoreFor, type SeoSignal } from './seo';

function signal(over: Partial<SeoSignal> = {}): SeoSignal {
  return {
    title: 'A Good Page Title For Testing The SEO Audit',
    metaDescription: 'A meta description that is long enough to be a useful snippet of about a hundred characters or so to pass.',
    metaViewport: 'width=device-width, initial-scale=1',
    canonical: 'https://example.com/',
    openGraph: {
      'og:title': 'A',
      'og:description': 'B',
      'og:image': 'C',
      'og:url': 'D',
    },
    twitterCard: { 'twitter:card': 'summary_large_image' },
    h1Count: 1,
    h1Text: 'A',
    imgsMissingAlt: 0,
    structuredDataBlocks: 0,
    structuredDataValid: true,
    htmlLang: 'en',
    isHttps: true,
    ...over,
  };
}

describe('analyzeSeo', () => {
  it('returns a clean report when nothing is wrong', () => {
    const r = analyzeSeo(signal());
    expect(r.issues).toHaveLength(0);
    expect(r.score).toBe(100);
  });

  it('flags missing title as critical', () => {
    const r = analyzeSeo(signal({ title: '' }));
    expect(r.issues.find((i) => i.id === 'title-missing')?.severity).toBe('critical');
  });

  it('flags title length issues with a detail measurement', () => {
    const r = analyzeSeo(signal({ title: 'short title' }));
    const i = r.issues.find((x) => x.id === 'title-short');
    expect(i).toBeTruthy();
    expect(i?.detail).toMatch(/11 chars/);
    const r2 = analyzeSeo(signal({ title: 'x'.repeat(80) }));
    expect(r2.issues.find((x) => x.id === 'title-long')).toBeTruthy();
  });

  it('flags missing meta description as high', () => {
    const r = analyzeSeo(signal({ metaDescription: '' }));
    expect(r.issues.find((i) => i.id === 'meta-description-missing')?.severity).toBe('high');
  });

  it('flags missing viewport and missing canonical', () => {
    const r = analyzeSeo(signal({ metaViewport: undefined, canonical: undefined }));
    expect(r.issues.map((i) => i.id)).toEqual(
      expect.arrayContaining(['viewport-missing', 'canonical-missing']),
    );
  });

  it('flags Open Graph absent vs. incomplete differently', () => {
    const none = analyzeSeo(signal({ openGraph: {} }));
    expect(none.issues.find((i) => i.id === 'og-missing')).toBeTruthy();
    const partial = analyzeSeo(signal({ openGraph: { 'og:title': 'X' } }));
    const partialIssue = partial.issues.find((i) => i.id === 'og-incomplete');
    expect(partialIssue?.description).toMatch(/og:description|og:image|og:url/);
  });

  it('flags missing h1 (high) and multiple h1 (medium)', () => {
    const none = analyzeSeo(signal({ h1Count: 0 }));
    expect(none.issues.find((i) => i.id === 'h1-missing')?.severity).toBe('high');
    const multi = analyzeSeo(signal({ h1Count: 3 }));
    expect(multi.issues.find((i) => i.id === 'h1-multiple')?.severity).toBe('medium');
  });

  it('flags noindex robots as critical (unexpected indexing block)', () => {
    const r = analyzeSeo(signal({ metaRobots: 'noindex, nofollow' }));
    expect(r.issues.find((i) => i.id === 'robots-noindex')?.severity).toBe('critical');
  });

  it('flags structured-data blocks that did not parse', () => {
    const r = analyzeSeo(signal({ structuredDataBlocks: 2, structuredDataValid: false }));
    expect(r.issues.find((i) => i.id === 'structured-data-invalid')).toBeTruthy();
  });

  it('sorts issues by severity', () => {
    const r = analyzeSeo(
      signal({
        title: '',                       // critical
        metaDescription: '',             // high
        h1Count: 3,                      // medium
        canonical: undefined,            // medium
        htmlLang: undefined,             // low
      }),
    );
    const sevs = r.issues.map((i) => i.severity);
    // critical must come before any high; high before any medium; medium before low.
    expect(sevs.indexOf('critical')).toBeLessThan(sevs.indexOf('high'));
    expect(sevs.indexOf('high')).toBeLessThan(sevs.indexOf('medium'));
    expect(sevs.indexOf('medium')).toBeLessThan(sevs.indexOf('low'));
  });

  it('echoes the structural facts so the panel can render chips', () => {
    const r = analyzeSeo(signal({ canonical: 'https://x.test/y' }));
    expect(r.facts.titleLength).toBeGreaterThan(0);
    expect(r.facts.canonical).toBe('https://x.test/y');
    expect(r.facts.ogKeys).toBe(4);
    expect(r.facts.twitterKeys).toBe(1);
  });
});

describe('scoreFor', () => {
  it('starts at 100 and subtracts severity weights', () => {
    expect(scoreFor([])).toBe(100);
    expect(scoreFor([{ id: 'a', severity: 'critical', rule: 'r', description: 'd', suggestion: 's' }])).toBe(75);
    expect(scoreFor([
      { id: 'a', severity: 'high', rule: 'r', description: 'd', suggestion: 's' },
      { id: 'b', severity: 'medium', rule: 'r', description: 'd', suggestion: 's' },
    ])).toBe(77); // 100 - 15 - 8
  });

  it('floors at 0 when severity weights exceed 100', () => {
    const many = Array.from({ length: 10 }, () => ({ id: 'x', severity: 'critical' as const, rule: 'r', description: 'd', suggestion: 's' }));
    expect(scoreFor(many)).toBe(0);
  });
});
