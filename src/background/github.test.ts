import { describe, it, expect } from 'vitest';
import { parseRepo, utf8ToBase64, base64ToUtf8 } from './github';

describe('parseRepo', () => {
  it('parses "owner/name"', () => {
    expect(parseRepo('clemens/buddy-vault')).toEqual({ owner: 'clemens', name: 'buddy-vault' });
  });
  it('strips a trailing .git', () => {
    expect(parseRepo('user/repo.git')).toEqual({ owner: 'user', name: 'repo' });
  });
  it('trims surrounding whitespace', () => {
    expect(parseRepo('  user/repo  ')).toEqual({ owner: 'user', name: 'repo' });
  });
  it('returns null for malformed input', () => {
    expect(parseRepo('')).toBeNull();
    expect(parseRepo('just-a-name')).toBeNull();
    expect(parseRepo('owner/name/extra')).toBeNull();
    expect(parseRepo('owner with space/repo')).toBeNull();
  });
});

describe('base64 utf8 round-trip', () => {
  it('encodes and decodes ASCII', () => {
    expect(base64ToUtf8(utf8ToBase64('hello world'))).toBe('hello world');
  });
  it('handles non-Latin1 (emoji, accented, CJK)', () => {
    const s = '# Wien 🇦🇹 — naïve façade — 京都';
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s);
  });
  it('tolerates whitespace in encoded input (GitHub returns wrapped base64)', () => {
    const s = 'multiline\ncontent\nhere';
    const b64 = utf8ToBase64(s);
    const wrapped = b64.replace(/(.{4})/g, '$1\n');
    expect(base64ToUtf8(wrapped)).toBe(s);
  });
});
