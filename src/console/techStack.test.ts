import { describe, it, expect } from 'vitest';
import { detectTech, type TechProbe } from './techStack';

function probe(over: Partial<TechProbe> = {}): TechProbe {
  return {
    globals: [],
    scripts: [],
    links: [],
    cookies: [],
    ...over,
  };
}

describe('detectTech', () => {
  it('detects React from window global OR matching script src (rule OR)', () => {
    const r1 = detectTech(probe({ globals: ['React'] }));
    expect(r1.find((m) => m.name === 'React')).toBeTruthy();
    const r2 = detectTech(probe({ scripts: ['https://cdn.example/react.production.min.js'] }));
    expect(r2.find((m) => m.name === 'React')).toBeTruthy();
  });

  it('flags Next.js from __NEXT_DATA__ or /_next/static path', () => {
    expect(detectTech(probe({ globals: ['__NEXT_DATA__'] })).map((m) => m.name)).toContain('Next.js');
    expect(detectTech(probe({ scripts: ['/_next/static/chunks/main.js'] })).map((m) => m.name)).toContain('Next.js');
  });

  it('deduplicates a tech when multiple rules match (merged evidence)', () => {
    const out = detectTech(
      probe({
        globals: ['React'],
        scripts: ['https://cdn.example/react.production.min.js'],
      }),
    );
    const react = out.filter((m) => m.name === 'React');
    expect(react).toHaveLength(1);
    expect(react[0].evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for an unrecognised page', () => {
    expect(detectTech(probe())).toHaveLength(0);
  });

  it('sorts JavaScript Framework before Analytics', () => {
    const out = detectTech(
      probe({
        globals: ['gtag', 'React'],
      }),
    );
    expect(out[0].name).toBe('React');
    expect(out.find((m) => m.name === 'Google Analytics')).toBeTruthy();
  });

  it('detects WordPress from meta generator OR wp-content script', () => {
    expect(
      detectTech(probe({ metaGenerator: 'WordPress 6.4.2' })).map((m) => m.name),
    ).toContain('WordPress');
    expect(
      detectTech(probe({ scripts: ['/wp-content/themes/twentytwentyfour/script.js'] })).map((m) => m.name),
    ).toContain('WordPress');
  });
});
