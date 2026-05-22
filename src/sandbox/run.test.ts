import { describe, it, expect, vi } from 'vitest';
import { runUserCode } from './run';

describe('runUserCode', () => {
  it('runs a transform over the inputs object', async () => {
    expect(await runUserCode('return inputs.text.toUpperCase();', { text: 'hi' })).toEqual({ ok: true, result: 'HI' });
  });

  it('supports multi-line logic', async () => {
    const res = await runUserCode('const n = Number(inputs.n);\nreturn n * n;', { n: '5' });
    expect(res.ok).toBe(true);
    expect(res.result).toBe(25);
  });

  it('captures runtime errors instead of throwing', async () => {
    const res = await runUserCode('return inputs.missing.foo;', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('rejects empty code', async () => {
    expect((await runUserCode('', {})).ok).toBe(false);
  });

  it('can await a capability bridge op (FR-T2-3)', async () => {
    const gemini = vi.fn(async (p: unknown) => `echo: ${String(p)}`);
    const res = await runUserCode('return await bridge.gemini(inputs.q);', { q: 'hello' }, { gemini });
    expect(gemini).toHaveBeenCalledWith('hello');
    expect(res).toEqual({ ok: true, result: 'echo: hello' });
  });
});
