import { describe, it, expect } from 'vitest';
import { matchErrors, ERROR_PATTERNS } from './errorPatterns';

describe('matchErrors', () => {
  it('catches the headline React pattern (critical)', () => {
    const out = matchErrors([
      "Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState.",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('React');
    expect(out[0].severity).toBe('critical');
    expect(out[0].framework).toBe('React');
  });

  it('groups identical patterns and counts them', () => {
    const out = matchErrors([
      "TypeError: Cannot read property 'x' of undefined",
      "TypeError: Cannot read properties of null (reading 'y')",
      "TypeError: foo.bar is not a function",
    ]);
    // First two collapse to Null Reference; third matches Type Error.
    expect(out.find((m) => m.category === 'Null Reference')?.count).toBe(2);
    expect(out.find((m) => m.category === 'Type Error')?.count).toBe(1);
  });

  it('sorts results by severity (critical → low)', () => {
    const out = matchErrors([
      'deprecated API usage', // low
      'Mixed Content blocked', // high
      'Invalid hook call detected', // critical
    ]);
    expect(out.map((m) => m.severity)).toEqual(['critical', 'high', 'low']);
  });

  it('skips unmatched / empty input', () => {
    expect(matchErrors([])).toEqual([]);
    expect(matchErrors(['', 'just a regular log line'])).toEqual([]);
  });

  it('pattern table is the full 26 known entries', () => {
    // Spot-check coverage of each headline framework / category bucket.
    const cats = new Set(ERROR_PATTERNS.map((p) => p.category));
    expect(cats.has('React')).toBe(true);
    expect(cats.has('Vue')).toBe(true);
    expect(cats.has('Angular')).toBe(true);
    expect(cats.has('Network')).toBe(true);
    expect(cats.has('CORS')).toBe(true);
    expect(cats.has('Security')).toBe(true);
    expect(cats.has('Type Error')).toBe(true);
    expect(cats.has('Syntax')).toBe(true);
    expect(cats.has('Reference')).toBe(true);
    expect(cats.has('Performance')).toBe(true);
    expect(ERROR_PATTERNS.length).toBeGreaterThanOrEqual(26);
  });
});
