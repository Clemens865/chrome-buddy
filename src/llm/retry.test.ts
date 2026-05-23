import { describe, it, expect, vi } from 'vitest';
import { parseRetryAfter, backoffDelay, decideRetry, retryFetch } from './retry';

describe('parseRetryAfter', () => {
  it('parses seconds form', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });
  it('parses HTTP-date form using `now` as anchor', () => {
    const now = Date.parse('2026-05-23T12:00:00Z');
    // HTTP-date only has second precision, so 7500ms rounds to 7000.
    const future = new Date(now + 7_500).toUTCString();
    const ms = parseRetryAfter(future, now);
    expect(ms).toBeGreaterThanOrEqual(7_000);
    expect(ms).toBeLessThanOrEqual(8_000);
  });
  it('returns null for nonsense', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('nope')).toBeNull();
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and respects the cap', () => {
    // Force rand = 1 to take the ceiling — easier to assert exactly.
    const ceil = (a: number) => backoffDelay(a, 500, 30_000, () => 0.999_999);
    expect(ceil(0)).toBeGreaterThanOrEqual(499);
    expect(ceil(0)).toBeLessThanOrEqual(500);
    expect(ceil(1)).toBeLessThanOrEqual(1000);
    expect(ceil(10)).toBeLessThanOrEqual(30_000);
  });
});

describe('decideRetry', () => {
  const opts = { maxAttempts: 4, baseMs: 500, maxDelayMs: 30_000, rand: () => 0, now: () => 0 };

  it('retries 429/503/504 within attempts', () => {
    for (const status of [429, 503, 504]) {
      const d = decideRetry(0, { kind: 'ok', status }, opts);
      expect(d.retry).toBe(true);
    }
  });

  it('does not retry other 4xx', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(decideRetry(0, { kind: 'ok', status }, opts).retry).toBe(false);
    }
  });

  it('does not retry on the last attempt', () => {
    const d = decideRetry(3, { kind: 'ok', status: 429 }, opts);
    expect(d.retry).toBe(false);
  });

  it('honors Retry-After (seconds) over backoff', () => {
    const d = decideRetry(
      0,
      { kind: 'ok', status: 429, retryAfter: '3' },
      { ...opts, rand: () => 0 /* would yield 0ms */ },
    );
    expect(d.delayMs).toBe(3000);
  });

  it('retries transient network errors', () => {
    const d = decideRetry(0, { kind: 'error', error: new TypeError('failed') }, opts);
    expect(d.retry).toBe(true);
  });
});

describe('retryFetch', () => {
  it('retries on 429 then returns the eventual 200', async () => {
    const responses = [
      new Response('rate-limited', { status: 429, headers: { 'Retry-After': '0' } }),
      new Response('ok', { status: 200 }),
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift()!);
    const sleep = vi.fn(async () => {});
    const res = await retryFetch('https://example/api', undefined, { sleep, baseMs: 1, maxDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
