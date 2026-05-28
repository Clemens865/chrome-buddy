// Regression locks for ToolRegistry.invoke() — the call-site for every tool
// in the system. A handler that THROWS instead of returning err(...) used to
// crash up into the agent runtime with a partially-mutated scratchpad. Now
// every throw is normalized into a structured ToolResult so the loop can
// observe + recover.
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './registry';
import { ok, err, type ToolResult } from '../types';
import type { ToolDefinition } from './types';

function makeRegistry(handler: (args: Record<string, unknown>) => Promise<ToolResult>) {
  const reg = new ToolRegistry();
  const def: ToolDefinition = {
    name: 'demo',
    description: 'demo',
    paramsSchema: { type: 'object', properties: {} },
    consequential: false,
    handler,
  };
  reg.register(def);
  return reg;
}

describe('ToolRegistry.invoke() error handling', () => {
  it('returns ok({...}) when the handler returns ok', async () => {
    const reg = makeRegistry(async () => ok({ value: 42 }));
    const res = await reg.invoke('demo', {}, { caller: 'test' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ value: 42 });
  });

  it('returns err({...}) when the handler returns err', async () => {
    const reg = makeRegistry(async () => err('not-found', 'nope'));
    const res = await reg.invoke('demo', {}, { caller: 'test' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('not-found');
      expect(res.error.message).toBe('nope');
    }
  });

  it('NORMALIZES a thrown Error into err(runtime-error) instead of escaping', async () => {
    const reg = makeRegistry(async () => {
      throw new Error('handler exploded');
    });
    const res = await reg.invoke('demo', {}, { caller: 'test' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('runtime-error');
      expect(res.error.message).toContain('demo');
      expect(res.error.message).toContain('handler exploded');
    }
  });

  it('NORMALIZES a thrown non-Error (e.g. a string) into err(runtime-error)', async () => {
    const reg = makeRegistry(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'string thrown';
    });
    const res = await reg.invoke('demo', {}, { caller: 'test' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('runtime-error');
      expect(res.error.message).toContain('string thrown');
    }
  });

  it('rejects an unknown tool name without invoking anything', async () => {
    const reg = makeRegistry(async () => ok({}));
    const res = await reg.invoke('nope', {}, { caller: 'test' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not-found');
  });

  it('rejects an aborted invocation without invoking the handler', async () => {
    let called = false;
    const reg = makeRegistry(async () => {
      called = true;
      return ok({});
    });
    const ac = new AbortController();
    ac.abort();
    const res = await reg.invoke('demo', {}, { caller: 'test', signal: ac.signal });
    expect(called).toBe(false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('aborted');
  });
});
