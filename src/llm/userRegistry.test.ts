import { describe, it, expect } from 'vitest';
import { mergeRegistry } from './userRegistry';
import { DEFAULT_REGISTRY } from './registry.default';
import type { ModelConfig } from './types';

const custom: ModelConfig = {
  id: 'gemini-x-custom',
  provider: 'google-gemini',
  displayName: 'Custom X',
  contextWindow: 1000,
  maxOutputTokens: 100,
  pricing: { inputPerMTok: 1, outputPerMTok: 2 },
  capabilities: { tools: true },
  enabled: true,
};

describe('mergeRegistry', () => {
  it('adds a user model over the bundled floor', () => {
    const merged = mergeRegistry(DEFAULT_REGISTRY, { models: { [custom.id]: custom } });
    expect(merged.models[custom.id]).toEqual(custom);
    // Bundled models survive.
    expect(merged.models['gemini-2.5-flash']).toBeTruthy();
    expect(merged.defaultModel).toBe(DEFAULT_REGISTRY.defaultModel);
  });

  it('lets a user entry override a bundled one of the same id', () => {
    const override = { ...custom, id: 'gemini-2.5-flash', displayName: 'My Flash' };
    const merged = mergeRegistry(DEFAULT_REGISTRY, { models: { 'gemini-2.5-flash': override } });
    expect(merged.models['gemini-2.5-flash'].displayName).toBe('My Flash');
  });

  it('merges providers too', () => {
    const merged = mergeRegistry(DEFAULT_REGISTRY, {
      providers: { custom: { id: 'custom', displayName: 'Custom', adapter: 'openai-compatible', baseUrl: 'https://x', auth: { method: 'bearer', keyRef: 'secret:custom' } } },
    });
    expect(merged.providers.custom).toBeTruthy();
    expect(merged.providers['google-gemini']).toBeTruthy();
  });
});
