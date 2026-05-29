// App-scoped persistent storage for Tier-3 apps (P2). Each app gets its own
// namespaced key-value bag in chrome.storage.local — isolated per app id, so
// one app can't read another's data. The reducer here is PURE (testable); the
// bridge broker loads the bag, applies the op, and persists the new state.

/** chrome.storage.local key holding one app's KV bag. */
export function appDataKey(appId: string): string {
  return `appData:${appId}`;
}

export type StorageAction = 'get' | 'set' | 'remove' | 'keys' | 'clear';
export interface StorageArgs {
  action?: StorageAction;
  key?: string;
  value?: unknown;
}

/** Cap a bag so a runaway app can't bloat storage (keys × value size). */
export const MAX_KEYS = 100;

/**
 * Apply one storage op to an app's KV bag. Returns the (possibly new) state and
 * the op result. Pure — no I/O. Unknown actions are no-ops returning null.
 */
export function applyStorageOp(
  state: Record<string, unknown>,
  args: StorageArgs,
): { state: Record<string, unknown>; result: unknown } {
  const key = typeof args.key === 'string' ? args.key : '';
  switch (args.action) {
    case 'get':
      return { state, result: key in state ? state[key] : null };
    case 'keys':
      return { state, result: Object.keys(state) };
    case 'set': {
      if (!key) return { state, result: { ok: false, error: 'storage.set needs a key' } };
      if (!(key in state) && Object.keys(state).length >= MAX_KEYS) {
        return { state, result: { ok: false, error: `storage is full (${MAX_KEYS} keys max)` } };
      }
      return { state: { ...state, [key]: args.value ?? null }, result: { ok: true } };
    }
    case 'remove': {
      if (!(key in state)) return { state, result: { ok: true } };
      const next = { ...state };
      delete next[key];
      return { state: next, result: { ok: true } };
    }
    case 'clear':
      return { state: {}, result: { ok: true } };
    default:
      return { state, result: null };
  }
}
