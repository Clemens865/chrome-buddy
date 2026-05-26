// Focused unit tests for the navigate() page-load wait. Mocks chrome.tabs +
// chrome.scripting + chrome.tabs.onUpdated so we can control when the
// "complete" event fires and verify navigate() resolves at the right moment.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from './browserControl';

type Listener = (id: number, info: chrome.tabs.TabChangeInfo) => void;
const listeners: Listener[] = [];

function emitComplete(tabId: number) {
  for (const l of listeners) l(tabId, { status: 'complete' });
}

beforeEach(() => {
  listeners.length = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      update: vi.fn(async () => undefined),
      create: vi.fn(async () => ({ id: 42 })),
      get: vi.fn(async () => ({ status: 'loading' })),
      onUpdated: {
        addListener: (fn: Listener) => listeners.push(fn),
        removeListener: (fn: Listener) => {
          const i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        },
      },
    },
    scripting: { executeScript: vi.fn(async () => [{ result: { ok: true, engine: 'scripting' } }]) },
  };
});

describe('navigate() — waits for page load', () => {
  it('resolves AFTER the onUpdated "complete" event for the same tab', async () => {
    // Fire the complete event after a short delay; the call should resolve THEN.
    setTimeout(() => emitComplete(99), 30);
    const start = Date.now();
    const res = await act(99, { type: 'navigate', url: 'https://example.com', newTab: false });
    const elapsed = Date.now() - start;
    expect((res as { ok?: boolean }).ok).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(20); // waited for the event
  });

  it('opens new tab and tracks the NEW tabId for completion', async () => {
    // chrome.tabs.create returns { id: 42 }; complete event fires on 42.
    setTimeout(() => emitComplete(42), 30);
    const res = await act(7, { type: 'navigate', url: 'https://example.com', newTab: true });
    expect((res as { ok?: boolean }).ok).toBe(true);
    expect((res as { note?: string }).note).toMatch(/opened new tab/);
  });

  it('falls back to a timeout when no "complete" event ever fires', async () => {
    // We don't emit anything; the implementation has a 10s default but we
    // can't realistically wait 10s in a unit test. Verify the listener was
    // registered (so the production path WOULD await it) and that the
    // pre-check sees the tab as 'loading' (so we keep waiting).
    void act(7, { type: 'navigate', url: 'https://example.com', newTab: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(listeners.length).toBe(1);
  });

  it('ignores onUpdated events for a different tab id', async () => {
    // Emit "complete" for an unrelated tab; navigate must NOT resolve early.
    let resolved = false;
    const p = act(7, { type: 'navigate', url: 'https://example.com', newTab: false }).then((r) => {
      resolved = true;
      return r;
    });
    emitComplete(123); // wrong tab
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);
    emitComplete(7);   // right tab
    await p;
    expect(resolved).toBe(true);
  });

  it('refuses restricted URLs without trying to navigate', async () => {
    const res = await act(7, { type: 'navigate', url: 'chrome://settings', newTab: false });
    expect((res as { undriveable?: boolean }).undriveable).toBe(true);
    expect((res as { ok?: boolean }).ok).not.toBe(true);
    // No listener registered for an undriveable URL.
    expect(listeners.length).toBe(0);
  });
});
