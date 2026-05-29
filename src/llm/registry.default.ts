// Bundled-default model/provider registry.
//
// This is the FLOOR (PRD FR-MR-2): it ships in the package and is always
// available offline, even before any signed remote update merges over it.
// It is pure, inert data — adding a model later is a one-line edit here or a
// remote config push, with zero code change (LOCKED #6; research/07 §B).
//
// Model IDs are the EXACT API strings from the official source
// (https://ai.google.dev/gemini-api/docs/models, verified 2026-05-21).
// Preview models keep their `-preview[-MM-YYYY]` suffix exactly as documented.
// Default is a stable GA model so chat works out of the box; pick others in
// Settings (or via remote config) as needed.

import type { ModelRegistry } from './types';

const GEMINI = 'google-gemini';
const ANTHROPIC = 'anthropic';

export const DEFAULT_REGISTRY: ModelRegistry = {
  schemaVersion: '1.1',
  // H1 — Default to Gemini 3.5 Flash (GA 2026-05-19; 2.5 Flash shuts down
  // 2026-10-16). The flip was deferred earlier because synthesis-step
  // interaction with 3.5's default `medium` thinking regressed multi-step
  // agent flows. H2 (thinking_level plumbing) now sets per-call-site levels
  // (planner=low, executor=medium, replan=low, synthesis=low) so this flip
  // is being retried. Users can still pick 2.5 via Settings → Model.
  defaultModel: 'gemini-3.5-flash',
  providers: {
    'google-gemini': {
      id: 'google-gemini',
      displayName: 'Google Gemini',
      // Chat/text goes through Gemini's OpenAI-compatible endpoint; image gen
      // uses the native generateContent endpoint (handled in the background SW).
      adapter: 'openai-compatible',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      auth: { method: 'bearer', keyRef: 'secret:gemini' },
      enabled: true,
    },
    // Optional "power builder" provider for the Micro-App Builder. BYO Anthropic
    // key (stored SW-side in chrome.storage.session under apiKey:anthropic);
    // never the default. Uses the native Anthropic Messages API (own adapter).
    anthropic: {
      id: 'anthropic',
      displayName: 'Anthropic (Claude)',
      adapter: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      auth: { method: 'header', paramName: 'x-api-key', keyRef: 'secret:anthropic' },
      enabled: true,
    },
  },
  models: {
    // Opus 4.8 — optional, user-keyed builder model (not selectable until the
    // user adds an Anthropic key). Strong at substantial codegen + iteration.
    'claude-opus-4-8': {
      id: 'claude-opus-4-8',
      provider: ANTHROPIC,
      displayName: 'Claude Opus 4.8',
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      pricing: { inputPerMTok: 5.0, outputPerMTok: 25.0 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      tier: 'pro',
      enabled: true,
    },
    // Sonnet = the "Best" chat tier (fast + strong, far cheaper than Opus) so
    // basic chat stays responsive when Best is selected; Haiku = cheapest Claude.
    'claude-sonnet-4-6': {
      id: 'claude-sonnet-4-6',
      provider: ANTHROPIC,
      displayName: 'Claude Sonnet 4.6',
      contextWindow: 200_000,
      maxOutputTokens: 16_000,
      pricing: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      tier: 'standard',
      enabled: true,
    },
    'claude-haiku-4-5-20251001': {
      id: 'claude-haiku-4-5-20251001',
      provider: ANTHROPIC,
      displayName: 'Claude Haiku 4.5',
      contextWindow: 200_000,
      maxOutputTokens: 8_000,
      pricing: { inputPerMTok: 1.0, outputPerMTok: 5.0 },
      capabilities: { vision: true, tools: true, jsonMode: true, streaming: true },
      tier: 'lite',
      enabled: true,
    },
    // ── Gemini 2.5 (stable GA — reliable workhorses) ─────────────────────────
    'gemini-2.5-flash': {
      id: 'gemini-2.5-flash',
      provider: GEMINI,
      displayName: 'Gemini 2.5 Flash',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 0.3, outputPerMTok: 2.5 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      defaultParams: { temperature: 0.7 },
      tier: 'standard',
      enabled: true,
    },
    'gemini-2.5-pro': {
      id: 'gemini-2.5-pro',
      provider: GEMINI,
      displayName: 'Gemini 2.5 Pro',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 1.25, outputPerMTok: 10.0 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      defaultParams: { temperature: 0.7 },
      tier: 'pro',
      enabled: true,
    },
    'gemini-2.5-flash-lite': {
      id: 'gemini-2.5-flash-lite',
      provider: GEMINI,
      displayName: 'Gemini 2.5 Flash-Lite',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
      capabilities: { vision: true, tools: true, thinking: false, jsonMode: true, streaming: true },
      defaultParams: { temperature: 0.7 },
      tier: 'lite',
      enabled: true,
    },

    // ── Gemini 3 (newer; 3.5-flash stable, others preview) ───────────────────
    // NOTE: Gemini 3 models require the default temperature (1.0). Setting
    // lower values causes looping/degradation in reasoning tasks
    // (troubleshooting.md L76; text-generation.md L468-469). Leave defaultParams
    // empty so the API uses its own default.
    'gemini-3.5-flash': {
      id: 'gemini-3.5-flash',
      provider: GEMINI,
      displayName: 'Gemini 3.5 Flash',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 1.5, outputPerMTok: 9.0, cachedInputPerMTok: 0.15 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      tier: 'standard',
      enabled: true,
    },
    'gemini-3.1-pro-preview': {
      id: 'gemini-3.1-pro-preview',
      provider: GEMINI,
      displayName: 'Gemini 3.1 Pro (preview)',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 2.0, outputPerMTok: 12.0 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      tier: 'pro',
      enabled: true,
    },
    'gemini-3-flash-preview': {
      id: 'gemini-3-flash-preview',
      provider: GEMINI,
      displayName: 'Gemini 3 Flash (preview)',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 0.5, outputPerMTok: 3.0 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      tier: 'standard',
      enabled: true,
    },
    'gemini-3.1-flash-lite': {
      id: 'gemini-3.1-flash-lite',
      provider: GEMINI,
      displayName: 'Gemini 3.1 Flash-Lite',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 0.25, outputPerMTok: 1.5 },
      capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
      tier: 'lite',
      enabled: true,
    },

    // ── Browser automation ───────────────────────────────────────────────────
    'gemini-2.5-computer-use-preview-10-2025': {
      id: 'gemini-2.5-computer-use-preview-10-2025',
      provider: GEMINI,
      displayName: 'Gemini 2.5 Computer Use (preview)',
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      pricing: { inputPerMTok: 1.25, outputPerMTok: 10.0 },
      capabilities: { vision: true, tools: true, thinking: false, jsonMode: false, streaming: true, computerUse: true },
      defaultParams: { temperature: 0.7 },
      tier: 'specialized',
      enabled: true,
    },

    // ── Image generation (Nano Banana family; native generateContent) ────────
    'gemini-2.5-flash-image': {
      id: 'gemini-2.5-flash-image',
      provider: GEMINI,
      displayName: 'Nano Banana — image (2.5 Flash)',
      contextWindow: 32_768,
      maxOutputTokens: 8_192,
      pricing: { inputPerMTok: 0.3, outputPerMTok: 30.0 },
      capabilities: { vision: true, imageOutput: true },
      tier: 'specialized',
      enabled: true,
    },
    'gemini-3.1-flash-image-preview': {
      id: 'gemini-3.1-flash-image-preview',
      provider: GEMINI,
      displayName: 'Nano Banana 2 — image (3.1 Flash, preview)',
      contextWindow: 32_768,
      maxOutputTokens: 8_192,
      pricing: { inputPerMTok: 0.5, outputPerMTok: 30.0 },
      capabilities: { vision: true, imageOutput: true },
      tier: 'specialized',
      enabled: true,
    },
    'gemini-3-pro-image-preview': {
      id: 'gemini-3-pro-image-preview',
      provider: GEMINI,
      displayName: 'Nano Banana Pro — image (3 Pro, preview)',
      contextWindow: 32_768,
      maxOutputTokens: 8_192,
      pricing: { inputPerMTok: 2.0, outputPerMTok: 60.0 },
      capabilities: { vision: true, imageOutput: true },
      tier: 'specialized',
      enabled: true,
    },

    // ── Embeddings (embedContent endpoint; not used by chat) ─────────────────
    'gemini-embedding-001': {
      id: 'gemini-embedding-001',
      provider: GEMINI,
      displayName: 'Gemini Embedding 001',
      contextWindow: 2_048,
      maxOutputTokens: 1,
      pricing: { inputPerMTok: 0.15, outputPerMTok: 0 },
      capabilities: { embedding: true },
      tier: 'specialized',
      enabled: true,
    },
    'gemini-embedding-2': {
      id: 'gemini-embedding-2',
      provider: GEMINI,
      displayName: 'Gemini Embedding 2 (multimodal)',
      contextWindow: 8_192,
      maxOutputTokens: 1,
      pricing: { inputPerMTok: 0.2, outputPerMTok: 0 },
      capabilities: { embedding: true },
      tier: 'specialized',
      enabled: true,
    },
  },
};
