// Bundled-default model/provider registry.
//
// This is the FLOOR (PRD FR-MR-2): it ships in the package and is always
// available offline, even before any signed remote update merges over it.
// It is pure, inert data — adding a model later is a one-line edit here or a
// remote config push, with zero code change (LOCKED #6; research/07 §B).
//
// Prices/IDs/context windows are sourced from docs/research/03-gemini-models.md
// (May 2026). The Gemini lineup moves fast — treat these as data to be edited.

import type { ModelRegistry } from './types';

export const DEFAULT_REGISTRY: ModelRegistry = {
  schemaVersion: '1.0',
  defaultModel: 'gemini-3.5-flash',
  providers: {
    'google-gemini': {
      id: 'google-gemini',
      displayName: 'Google Gemini',
      // Gemini exposes an OpenAI-compatible endpoint, so the bundled
      // openai-compatible adapter covers it (and OpenRouter / Ollama).
      adapter: 'openai-compatible',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      auth: { method: 'bearer', keyRef: 'secret:gemini' },
      enabled: true,
    },
  },
  models: {
    // ⭐ Recommended default workhorse (GA): frontier reasoning, 1M context,
    // multimodal, ~4x faster output. (research/03 §1, §8)
    'gemini-3.5-flash': {
      id: 'gemini-3.5-flash',
      provider: 'google-gemini',
      displayName: 'Gemini 3.5 Flash',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 1.5, outputPerMTok: 9.0, cachedInputPerMTok: 0.15 },
      capabilities: {
        vision: true,
        tools: true,
        thinking: true,
        jsonMode: true,
        streaming: true,
      },
      defaultParams: { temperature: 0.7 },
      paramMap: {},
      tier: 'standard',
      enabled: true,
    },

    // Cheapest budget / lowest-latency cloud (legacy 2.5 line, paid-only).
    'gemini-2.5-flash-lite': {
      id: 'gemini-2.5-flash-lite',
      provider: 'google-gemini',
      displayName: 'Gemini 2.5 Flash-Lite',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
      capabilities: {
        vision: true,
        tools: true,
        thinking: false,
        jsonMode: true,
        streaming: true,
      },
      defaultParams: { temperature: 0.7 },
      paramMap: {},
      tier: 'lite',
      enabled: true,
    },

    // Flagship reasoning — reserve for hard requests (8x output cost, 2M ctx).
    'gemini-3.1-pro': {
      id: 'gemini-3.1-pro',
      provider: 'google-gemini',
      displayName: 'Gemini 3.1 Pro',
      contextWindow: 2_000_000,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 2.0, outputPerMTok: 12.0, cachedInputPerMTok: 0.2 },
      capabilities: {
        vision: true,
        tools: true,
        thinking: true,
        jsonMode: true,
        streaming: true,
      },
      defaultParams: { temperature: 0.7 },
      paramMap: {},
      tier: 'pro',
      enabled: true,
    },

    // Purpose-built browser automation: sees a screen, performs UI actions.
    'gemini-2.5-computer-use': {
      id: 'gemini-2.5-computer-use',
      provider: 'google-gemini',
      displayName: 'Gemini 2.5 Computer Use',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 1.25, outputPerMTok: 10.0 },
      capabilities: {
        vision: true,
        tools: true,
        thinking: false,
        jsonMode: false,
        streaming: true,
        computerUse: true,
      },
      defaultParams: { temperature: 0.7 },
      paramMap: {},
      tier: 'specialized',
      enabled: true,
    },

    // Nano Banana — native image generation/editing. Uses the native
    // generateContent endpoint (responseModalities: IMAGE), not the chat adapter.
    'gemini-2.5-flash-image': {
      id: 'gemini-2.5-flash-image',
      provider: 'google-gemini',
      displayName: 'Nano Banana (image)',
      contextWindow: 32_768,
      maxOutputTokens: 8_192,
      pricing: { inputPerMTok: 0.3, outputPerMTok: 30.0 },
      capabilities: {
        vision: true,
        tools: false,
        thinking: false,
        jsonMode: false,
        streaming: false,
      },
      defaultParams: {},
      paramMap: {},
      tier: 'specialized',
      enabled: true,
    },
  },
};
