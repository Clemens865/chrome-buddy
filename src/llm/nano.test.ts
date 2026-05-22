import { describe, it, expect, vi, afterEach } from 'vitest';
import { isNanoSupported, nanoAvailability, nanoPrompt } from './nano';

afterEach(() => vi.unstubAllGlobals());

describe('nano feature detection', () => {
  it('is unsupported when LanguageModel is absent', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    vi.stubGlobal('ai', undefined);
    expect(isNanoSupported()).toBe(false);
    expect(await nanoAvailability()).toBe('unavailable');
    expect(await nanoPrompt('hi')).toBeNull();
  });
});

describe('nanoPrompt', () => {
  it('runs on-device when available', async () => {
    const prompt = vi.fn(async (t: string) => `nano: ${t}`);
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({ prompt, destroy: () => {} }),
    });
    expect(await nanoPrompt('summarize this')).toBe('nano: summarize this');
    expect(prompt).toHaveBeenCalled();
  });

  it('returns null (→ cloud fallback) when only downloadable', async () => {
    vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create: async () => ({ prompt: async () => 'x' }) });
    expect(await nanoPrompt('hi')).toBeNull();
  });

  it('returns null on error', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => { throw new Error('no model'); },
    });
    expect(await nanoPrompt('hi')).toBeNull();
  });
});
