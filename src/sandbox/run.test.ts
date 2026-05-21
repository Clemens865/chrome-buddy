import { describe, it, expect } from 'vitest';
import { runUserCode } from './run';

describe('runUserCode', () => {
  it('runs a transform over the inputs object', () => {
    const res = runUserCode('return inputs.text.toUpperCase();', { text: 'hi' });
    expect(res).toEqual({ ok: true, result: 'HI' });
  });

  it('supports multi-line logic', () => {
    const res = runUserCode('const n = Number(inputs.n);\nreturn n * n;', { n: '5' });
    expect(res.ok).toBe(true);
    expect(res.result).toBe(25);
  });

  it('captures runtime errors instead of throwing', () => {
    const res = runUserCode('return inputs.missing.foo;', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('rejects empty code', () => {
    expect(runUserCode('', {}).ok).toBe(false);
  });
});
