// Black-box tests for the in-memory tool cache logic. We extract the small
// helpers we need to test by re-implementing the same shape — the production
// cache lives in consolePanels.tsx (a React file) which we can't unit-test
// directly, but this verifies the algorithm we ported.
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CacheEntry { result: { ok: true; data: unknown }; ts: number; }
const TTL = 30_000;

function makeCachedRunner(send: (key: string) => Promise<{ ok: true; data: unknown }>) {
  const cache = new Map<string, CacheEntry>();
  async function run(tool: string, args: Record<string, unknown> = {}, force = false) {
    const key = `${tool}:${JSON.stringify(args)}`;
    if (!force) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.ts < TTL) return hit.result;
    }
    const result = await send(key);
    if (result.ok) cache.set(key, { result, ts: Date.now() });
    return result;
  }
  return { run, cache };
}

describe('runTool cache', () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    now = 1_000_000;
  });

  it('serves a second identical call from cache (one network round-trip)', async () => {
    const send = vi.fn(async () => ({ ok: true as const, data: { x: 1 } }));
    const { run } = makeCachedRunner(send);
    const a = await run('analyze_seo');
    const b = await run('analyze_seo');
    expect(a).toBe(b);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('treats different args as distinct cache keys', async () => {
    const send = vi.fn(async () => ({ ok: true as const, data: {} }));
    const { run } = makeCachedRunner(send);
    await run('read_storage', { limit: 10 });
    await run('read_storage', { limit: 20 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache when force=true (Re-audit button path)', async () => {
    const send = vi.fn(async () => ({ ok: true as const, data: {} }));
    const { run } = makeCachedRunner(send);
    await run('analyze_seo');
    await run('analyze_seo');
    expect(send).toHaveBeenCalledTimes(1);
    await run('analyze_seo', {}, true); // force
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('expires the entry after TTL', async () => {
    const send = vi.fn(async () => ({ ok: true as const, data: {} }));
    const { run } = makeCachedRunner(send);
    await run('analyze_seo');
    now += TTL + 1;
    await run('analyze_seo');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
