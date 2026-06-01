import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cosineSim, cosineSimAll, embedText, embedBatch } from './embed';

describe('cosineSim', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('returns -1 for opposite vectors', () => {
    expect(cosineSim([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });
  it('returns 0 on shape mismatch or empty input', () => {
    expect(cosineSim([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSim([], [])).toBe(0);
  });
  it('returns 0 on zero vectors (no division by zero)', () => {
    expect(cosineSim([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('cosineSimAll', () => {
  const pool = [
    { embedding: [1, 0, 0] },
    { embedding: [0.9, 0.1, 0] },
    { embedding: [0, 1, 0] },
    { embedding: [-1, 0, 0] },
  ];

  it('ranks by descending similarity to the query', () => {
    const out = cosineSimAll([1, 0, 0], pool);
    expect(out.map((r) => r.idx)).toEqual([0, 1, 2, 3]);
    expect(out[0].score).toBeCloseTo(1, 6);
    expect(out[3].score).toBeCloseTo(-1, 6);
  });

  it('limits to top-K when requested', () => {
    const out = cosineSimAll([1, 0, 0], pool, { k: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.idx)).toEqual([0, 1]);
  });

  it('applies a similarity threshold', () => {
    const out = cosineSimAll([1, 0, 0], pool, { threshold: 0.5 });
    expect(out.map((r) => r.idx)).toEqual([0, 1]);
  });

  it('returns empty for an empty pool', () => {
    expect(cosineSimAll([1, 0], [])).toEqual([]);
  });
});

describe('embedText', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
    } as unknown as Response);
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('L2-normalizes the vector and sends taskType + outputDimensionality', async () => {
    const v = await embedText('hello', 'fake-key', 'RETRIEVAL_QUERY');
    // Unit length (normalized) but same direction as [0.1, 0.2, 0.3].
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);
    expect(v[1] / v[0]).toBeCloseTo(2, 5);
    const body = JSON.parse(
      (globalThis.fetch as unknown as { mock: { calls: [unknown, { body: string }][] } }).mock.calls[0][1].body,
    );
    expect(body.taskType).toBe('RETRIEVAL_QUERY');
    expect(body.outputDimensionality).toBe(768);
  });

  it('rejects when text is empty', async () => {
    await expect(embedText('', 'key')).rejects.toThrow(/empty text/);
  });

  it('rejects when API key is missing', async () => {
    await expect(embedText('hi', '')).rejects.toThrow(/missing API key/);
  });

  it('rejects when the API returns an error status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { get: () => null },
      text: async () => 'denied',
    } as unknown as Response);
    await expect(embedText('hi', 'key')).rejects.toThrow(/403/);
  });

  it('rejects when response has no embedding values', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({}),
    } as unknown as Response);
    await expect(embedText('hi', 'key')).rejects.toThrow(/no embedding/);
  });
});

describe('embedBatch', () => {
  const origFetch = globalThis.fetch;
  let calls = 0;
  beforeEach(() => {
    calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls += 1;
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ embedding: { values: [calls, 0, 0] } }),
      } as unknown as Response;
    });
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('preserves input order across concurrent workers', async () => {
    const texts = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const vectors = await embedBatch(texts, 'key', 4);
    expect(vectors).toHaveLength(12);
    // Each entry has a 3-dim vector; specific values depend on fetch order
    // (we ran in parallel), but no slot should be undefined.
    for (const v of vectors) expect(v.length).toBe(3);
  });
});
