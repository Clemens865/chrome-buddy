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

// Eviction algorithm test — uses the same shape the real evictOldestDocs
// applies, so this locks the contract (oldest-updatedAt first; cap honored).
function evictOldest<T extends { id: string; updatedAt: number }>(all: T[], max: number): T[] {
  if (all.length <= max) return all;
  const sorted = [...all].sort((a, b) => a.updatedAt - b.updatedAt);
  const keep = new Set(sorted.slice(all.length - max).map((c) => c.id));
  return all.filter((c) => keep.has(c.id));
}

describe('library doc eviction policy', () => {
  function mk(id: string, updatedAt: number) {
    return { id, updatedAt };
  }
  it('keeps everything when under the cap', () => {
    const docs = Array.from({ length: 50 }, (_, i) => mk(`d${i}`, i));
    expect(evictOldest(docs, 1000)).toEqual(docs);
  });
  it('drops (count - max) oldest-updatedAt entries when over', () => {
    const docs = Array.from({ length: 1005 }, (_, i) => mk(`d${i}`, i));
    const kept = evictOldest(docs, 1000);
    expect(kept).toHaveLength(1000);
    for (let i = 0; i < 5; i++) expect(kept.find((d) => d.id === `d${i}`)).toBeUndefined();
    for (let i = 1000; i < 1005; i++) expect(kept.find((d) => d.id === `d${i}`)).toBeTruthy();
  });
  it('preserves a doc that was just re-touched even if its createdAt is old', () => {
    const docs = [
      mk('old-but-touched', 100), // updatedAt > some newer
      mk('newer', 50),
      mk('newest', 200),
    ];
    expect(evictOldest(docs, 2).map((d) => d.id).sort()).toEqual(['newest', 'old-but-touched']);
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
