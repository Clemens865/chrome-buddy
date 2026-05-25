import { describe, it, expect } from 'vitest';
import { summarizeStorage, flagKey, previewValue } from './storageSummary';

describe('flagKey', () => {
  it('catches obvious auth-shaped keys', () => {
    expect(flagKey('authorization')).toBeTruthy();
    expect(flagKey('access_token')).toBeTruthy();
    expect(flagKey('JWT_CACHE')).toBeTruthy();
    expect(flagKey('api_key')).toBeTruthy();
    expect(flagKey('user_email')).toBeTruthy();
  });
  it('lets ordinary keys through', () => {
    expect(flagKey('theme')).toBeNull();
    expect(flagKey('lastSeenPage')).toBeNull();
  });
});

describe('previewValue', () => {
  it('redacts large values to their shape', () => {
    expect(previewValue('')).toBe('(empty)');
    expect(previewValue('12345')).toMatch(/^number/);
    expect(previewValue('https://example.com/x')).toMatch(/^url/);
    expect(previewValue('{"a":1}')).toMatch(/^json-ish/);
    expect(previewValue('eyJhbGciOi…')).toMatch(/^jwt-ish/);
    expect(previewValue('hi')).toMatch(/^string "hi/);
  });
});

describe('summarizeStorage', () => {
  it('aggregates totals across all three areas', () => {
    const r = summarizeStorage({
      url: 'https://example.com/',
      localStorage: [{ key: 'theme', value: 'dark' }, { key: 'cart', value: 'a'.repeat(500) }],
      sessionStorage: [{ key: 'sid', value: 'session-' + 'b'.repeat(20) }],
      cookies: [{ name: 'csrf', value: 'cccc' }],
    });
    expect(r.total.keys).toBe(4);
    expect(r.byArea.localStorage.keys).toBe(2);
    expect(r.byArea.cookies.keys).toBe(1);
    expect(r.total.bytes).toBeGreaterThan(500);
  });

  it('flags auth-shaped keys and surfaces them first in `top`', () => {
    const r = summarizeStorage({
      url: 'https://example.com/',
      localStorage: [
        { key: 'huge', value: 'h'.repeat(2000) },
        { key: 'access_token', value: 'short' },
      ],
      sessionStorage: [],
      cookies: [],
    });
    expect(r.flagged.find((f) => f.key === 'access_token')).toBeTruthy();
    // `access_token` (small) outranks `huge` (large) because it's flagged.
    expect(r.top[0].key).toBe('access_token');
    expect(r.top[1].key).toBe('huge');
  });

  it('does not echo raw values in the preview', () => {
    const r = summarizeStorage({
      url: 'x',
      localStorage: [{ key: 'tok', value: 'eyJhbGciOiJIUzI1NiJ9.payload.sig' }],
      sessionStorage: [],
      cookies: [],
    });
    expect(r.top[0].preview).toMatch(/^jwt-ish/);
    expect(r.top[0].preview).not.toContain('payload');
  });
});
