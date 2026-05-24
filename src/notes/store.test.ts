import { describe, it, expect } from 'vitest';
import { normalizeKey, snippet } from './store';

describe('normalizeKey', () => {
  it('lowercases, slugifies, and clamps to 80 chars', () => {
    expect(normalizeKey('Staging URL')).toBe('staging-url');
    expect(normalizeKey('2026-05-25 meeting')).toBe('2026-05-25-meeting');
    expect(normalizeKey('  --hello world!--  ')).toBe('hello-world');
    expect(normalizeKey('a'.repeat(200))).toHaveLength(80);
  });
  it('returns "" for unusable input', () => {
    expect(normalizeKey('')).toBe('');
    expect(normalizeKey('   ')).toBe('');
    expect(normalizeKey('!!!')).toBe('');
  });
  it('keeps dot/dash/underscore', () => {
    expect(normalizeKey('foo.bar_baz-quux')).toBe('foo.bar_baz-quux');
  });
});

describe('snippet', () => {
  it('collapses whitespace and clips with an ellipsis', () => {
    expect(snippet('hello\n\n  world')).toBe('hello world');
    expect(snippet('xxxxxxxxxx', 5)).toBe('xxxxx…');
  });
});
