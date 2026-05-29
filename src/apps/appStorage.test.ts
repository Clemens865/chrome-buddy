import { describe, it, expect } from 'vitest';
import { appDataKey, applyStorageOp, MAX_KEYS } from './appStorage';

describe('appDataKey', () => {
  it('namespaces per app id', () => {
    expect(appDataKey('app_1')).toBe('appData:app_1');
  });
});

describe('applyStorageOp', () => {
  it('get returns the value or null', () => {
    expect(applyStorageOp({ a: 1 }, { action: 'get', key: 'a' }).result).toBe(1);
    expect(applyStorageOp({ a: 1 }, { action: 'get', key: 'missing' }).result).toBeNull();
  });
  it('set adds/updates and returns ok', () => {
    const { state, result } = applyStorageOp({}, { action: 'set', key: 'x', value: 42 });
    expect(state).toEqual({ x: 42 });
    expect(result).toEqual({ ok: true });
  });
  it('set without a key errors', () => {
    expect(applyStorageOp({}, { action: 'set', value: 1 }).result).toMatchObject({ ok: false });
  });
  it('set is immutable (does not mutate input)', () => {
    const input = { a: 1 };
    applyStorageOp(input, { action: 'set', key: 'b', value: 2 });
    expect(input).toEqual({ a: 1 });
  });
  it('remove deletes a key', () => {
    expect(applyStorageOp({ a: 1, b: 2 }, { action: 'remove', key: 'a' }).state).toEqual({ b: 2 });
  });
  it('keys lists the bag keys', () => {
    expect(applyStorageOp({ a: 1, b: 2 }, { action: 'keys' }).result).toEqual(['a', 'b']);
  });
  it('clear empties the bag', () => {
    expect(applyStorageOp({ a: 1 }, { action: 'clear' }).state).toEqual({});
  });
  it('enforces the key cap on new keys', () => {
    const full: Record<string, number> = {};
    for (let i = 0; i < MAX_KEYS; i++) full[`k${i}`] = i;
    const { result } = applyStorageOp(full, { action: 'set', key: 'overflow', value: 1 });
    expect(result).toMatchObject({ ok: false });
    // updating an existing key is still allowed when full
    expect(applyStorageOp(full, { action: 'set', key: 'k0', value: 9 }).result).toEqual({ ok: true });
  });
  it('unknown action is a no-op returning null', () => {
    expect(applyStorageOp({ a: 1 }, {}).result).toBeNull();
  });
});
