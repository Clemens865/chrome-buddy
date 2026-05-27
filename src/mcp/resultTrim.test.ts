// Tests for the chat-side result trimmer. Locks the byte-accurate cut and the
// "no multi-byte chars get split" guarantee.
import { describe, it, expect } from 'vitest';
import { trimForChat, byteLength, formatBytes, CHAT_RESULT_TRIM_BYTES } from './resultTrim';

describe('trimForChat', () => {
  it('returns full visible + empty hidden when the input is small', () => {
    const r = trimForChat('hello');
    expect(r.trimmed).toBe(false);
    expect(r.visible).toBe('hello');
    expect(r.hidden).toBe('');
    expect(r.totalBytes).toBe(5);
  });

  it('cuts at the byte threshold for ASCII', () => {
    const long = 'x'.repeat(CHAT_RESULT_TRIM_BYTES + 100);
    const r = trimForChat(long);
    expect(r.trimmed).toBe(true);
    expect(byteLength(r.visible)).toBeLessThanOrEqual(CHAT_RESULT_TRIM_BYTES);
    expect(r.visible.length + r.hidden.length).toBe(long.length);
  });

  it('honors a custom maxBytes argument', () => {
    const r = trimForChat('abcdefghij', 4);
    expect(r.trimmed).toBe(true);
    expect(r.visible).toBe('abcd');
    expect(r.hidden).toBe('efghij');
  });

  it('never splits a multi-byte character', () => {
    // '€' is 3 bytes. If we ask for a cut at 2 bytes, the visible portion must
    // be empty rather than half a codepoint.
    const r = trimForChat('€', 2);
    expect(r.visible).toBe('');
    expect(r.hidden).toBe('€');
  });

  it('handles surrogate-pair emoji', () => {
    // '🎉' is 4 bytes (U+1F389). Cut at 3 bytes → visible should be ''.
    const r = trimForChat('🎉hello', 3);
    expect(r.visible).toBe('');
    expect(r.hidden).toBe('🎉hello');
  });
});

describe('byteLength', () => {
  it('counts UTF-8 bytes, not chars', () => {
    expect(byteLength('a')).toBe(1);
    expect(byteLength('é')).toBe(2);
    expect(byteLength('€')).toBe(3);
    expect(byteLength('🎉')).toBe(4);
  });
});

describe('formatBytes', () => {
  it('renders B / KB / MB with one decimal place', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
  });
});
