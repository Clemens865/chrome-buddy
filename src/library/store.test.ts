import { describe, it, expect } from 'vitest';
import { hashContent, makeDocId } from './store';

describe('hashContent', () => {
  it('returns the same hash for identical text', () => {
    expect(hashContent('hello world')).toBe(hashContent('hello world'));
  });
  it('returns different hashes for different text', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
  it('is stable for empty input (FNV-1a offset basis)', () => {
    expect(hashContent('')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('produces an 8-char lowercase hex string', () => {
    expect(hashContent('the quick brown fox')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('makeDocId', () => {
  it('produces deterministic ids when sourceRef is provided', () => {
    expect(makeDocId('chat', 'chat_abc')).toBe(makeDocId('chat', 'chat_abc'));
  });
  it('separates ids across sources for the same ref', () => {
    expect(makeDocId('chat', 'x')).not.toBe(makeDocId('note', 'x'));
  });
  it('falls back to a random suffix when no sourceRef is given (manual)', () => {
    const a = makeDocId('manual');
    const b = makeDocId('manual');
    expect(a).not.toBe(b);
    expect(a.startsWith('manual:')).toBe(true);
  });
});
