// Unit tests for the key-custody message protocol and the background handlers.
//
// We mock chrome.* (storage.session + runtime) so no real network/key is needed.
// Coverage:
//   - KEY_SET stores the key in chrome.storage.session under apiKey:<provider>.
//   - KEY_STATUS reports existence and NEVER leaks the key value.
//   - LLM_GENERATE without a stored key returns an ERROR (key custody intact).
//   - generateViaBackground posts a well-formed LLM_GENERATE message.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiKeyStorageKey, isBuddyMessage } from './messages';

/** A minimal in-memory chrome.storage.session double. */
function makeSessionStore() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete data[key];
    }),
    setAccessLevel: vi.fn(async () => {}),
  };
}

let session: ReturnType<typeof makeSessionStore>;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Keep tests deterministic regardless of a contributor's local .env key.
  vi.stubEnv('VITE_GEMINI_API_KEY', '');
  session = makeSessionStore();
  sendMessage = vi.fn();
  (globalThis as { chrome?: unknown }).chrome = {
    storage: { session },
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}) },
  };
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('message protocol', () => {
  it('isBuddyMessage accepts protocol messages and rejects others', () => {
    expect(isBuddyMessage({ type: 'KEY_SET', provider: 'google-gemini', key: 'x' })).toBe(true);
    expect(isBuddyMessage({ type: 'KEY_STATUS', provider: 'google-gemini' })).toBe(true);
    expect(isBuddyMessage({ type: 'LLM_GENERATE', messages: [] })).toBe(true);
    expect(isBuddyMessage({ type: 'SOMETHING_ELSE' })).toBe(false);
    expect(isBuddyMessage(null)).toBe(false);
    expect(isBuddyMessage('KEY_SET')).toBe(false);
  });

  it('apiKeyStorageKey namespaces by provider', () => {
    expect(apiKeyStorageKey('google-gemini')).toBe('apiKey:google-gemini');
  });
});

describe('handleBuddyMessage (background handlers)', () => {
  it('KEY_SET stores the key in chrome.storage.session', async () => {
    const { handleBuddyMessage } = await import('../background/background');
    const res = await handleBuddyMessage({
      type: 'KEY_SET',
      provider: 'google-gemini',
      key: 'sk-secret-123',
    });
    expect(res).toEqual({ type: 'KEY_SET', ok: true });
    expect(session.set).toHaveBeenCalledWith({ 'apiKey:google-gemini': 'sk-secret-123' });
    expect(session.data['apiKey:google-gemini']).toBe('sk-secret-123');
  });

  it('KEY_SET with empty key removes the stored key', async () => {
    session.data['apiKey:google-gemini'] = 'existing';
    const { handleBuddyMessage } = await import('../background/background');
    await handleBuddyMessage({ type: 'KEY_SET', provider: 'google-gemini', key: '' });
    expect(session.remove).toHaveBeenCalledWith('apiKey:google-gemini');
    expect(session.data['apiKey:google-gemini']).toBeUndefined();
  });

  it('KEY_STATUS reports existence but NEVER leaks the key', async () => {
    const { handleBuddyMessage } = await import('../background/background');

    const unset = await handleBuddyMessage({ type: 'KEY_STATUS', provider: 'google-gemini' });
    expect(unset).toEqual({ type: 'KEY_STATUS', hasKey: false });

    session.data['apiKey:google-gemini'] = 'sk-secret-123';
    const set = await handleBuddyMessage({ type: 'KEY_STATUS', provider: 'google-gemini' });
    expect(set).toEqual({ type: 'KEY_STATUS', hasKey: true });
    // Critical: the response object must not contain the key value anywhere.
    expect(JSON.stringify(set)).not.toContain('sk-secret-123');
  });

  it('LLM_GENERATE without a stored key returns an ERROR (key custody)', async () => {
    const { handleBuddyMessage } = await import('../background/background');
    const res = await handleBuddyMessage({
      type: 'LLM_GENERATE',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.type).toBe('ERROR');
    if (res.type === 'ERROR') expect(res.ok).toBe(false);
  });
});

describe('generateViaBackground (UI/content entry point)', () => {
  it('posts a well-formed LLM_GENERATE message and returns the result', async () => {
    const fakeResult = { text: 'hello', toolCalls: [], finishReason: 'stop' };
    sendMessage.mockResolvedValueOnce({ type: 'LLM_GENERATE', ok: true, result: fakeResult });

    const { generateViaBackground } = await import('../llm/instance');
    const result = await generateViaBackground({
      model: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'LLM_GENERATE',
      model: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toBe(fakeResult);
  });

  it('throws when the background returns an ERROR', async () => {
    sendMessage.mockResolvedValueOnce({ type: 'ERROR', ok: false, error: 'no key' });
    const { generateViaBackground } = await import('../llm/instance');
    await expect(
      generateViaBackground({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('no key');
  });
});
