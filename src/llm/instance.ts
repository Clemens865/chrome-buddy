// LLM client wiring + the UI/content escape hatch.
//
// TWO ENTRY POINTS, by execution context:
//
//   1. generateViaBackground(req)  — for UI (side panel, settings) and content
//      scripts. These contexts MUST NOT hold the API key, so they post an
//      LLM_GENERATE message to the background service worker, which runs the
//      real client and returns the normalized result. THIS is what app/UI code
//      should call.
//
//   2. getLlmClient(provider)      — for BACKGROUND-CONTEXT code ONLY. Builds a
//      real LlmClient wired to a getApiKey that reads the key from
//      chrome.storage.session (where the SW holds it). Calling this from a UI or
//      content context would either find no key or — worse — risk pulling a key
//      into a non-SW context, so don't.
//
// KEY CUSTODY (PRD NFR-SEC-1/2): the key never leaves chrome.storage.session and
// is only ever read inside the SW by the getApiKey injector below.

import { LlmClient } from './client';
import { DEFAULT_REGISTRY } from './registry.default';
import { effectiveRegistry } from './userRegistry';
import { resolveDefaultModel, resolveModel } from './router';
import type { GenerateResult } from './client';
import type { ModelRegistry } from './types';
import { apiKeyStorageKey } from '../key/messages';
import type {
  ErrorResponse,
  ImageGenerateMessage,
  ImageGenerateResponse,
  LlmGenerateMessage,
  LlmGenerateResponse,
} from '../key/messages';

/**
 * Resolve a provider's API key from chrome.storage.local (persists across SW
 * restarts and extension reloads, scoped to the Chrome profile, never synced).
 */
export async function readSessionApiKey(provider: string): Promise<string | undefined> {
  const store = chrome.storage?.local;
  if (store) {
    const storageKey = apiKeyStorageKey(provider);
    const res = await store.get(storageKey);
    const value = (res as Record<string, unknown>)[storageKey];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

// Effective registry = bundled floor + user overlay (FR-MR-1/8). Cached in the
// SW and refreshed on demand / storage change so user-added models resolve.
let effective: ModelRegistry = DEFAULT_REGISTRY;
export async function refreshEffectiveRegistry(): Promise<void> {
  effective = await effectiveRegistry();
}
export function currentRegistry(): ModelRegistry {
  return effective;
}

/**
 * Build an LlmClient for background-context use. The injected getApiKey reads
 * the key for `provider` from chrome.storage.session at request time, so the
 * key is resolved lazily and only inside the SW. Uses the effective registry so
 * user-added models work.
 */
export function getLlmClient(provider: string): LlmClient {
  return new LlmClient(effective, () => readSessionApiKey(provider));
}

/**
 * Resolve which provider id backs a model id (or the registry default). Used by
 * the SW to pick the right stored key for an LLM_GENERATE request.
 */
export function resolveProviderId(modelId: string | undefined): string | undefined {
  const resolved = modelId ? resolveModel(effective, modelId) : resolveDefaultModel(effective);
  return resolved?.provider.id;
}

/**
 * UI / content-script entry point: run a generation in the background SW. Posts
 * an LLM_GENERATE message and returns the normalized result. Throws on error.
 */
export async function generateViaBackground(
  req: Omit<LlmGenerateMessage, 'type'>,
): Promise<GenerateResult> {
  const message: LlmGenerateMessage = { type: 'LLM_GENERATE', ...req };
  const response = (await chrome.runtime.sendMessage(message)) as
    | LlmGenerateResponse
    | ErrorResponse
    | undefined;
  if (!response) throw new Error('No response from background service worker.');
  if (response.type === 'ERROR' || response.ok !== true) {
    throw new Error(
      response.type === 'ERROR' ? response.error : 'Background generation failed.',
    );
  }
  return response.result;
}

/**
 * UI / content-script entry point for IMAGE generation. Posts an IMAGE_GENERATE
 * message; the SW calls Gemini's native generateContent and returns a data URL.
 * Throws on error (callers map the message to a friendly state).
 */
export async function generateImageViaBackground(
  req: Omit<ImageGenerateMessage, 'type'>,
): Promise<string> {
  const message: ImageGenerateMessage = { type: 'IMAGE_GENERATE', ...req };
  const response = (await chrome.runtime.sendMessage(message)) as
    | ImageGenerateResponse
    | ErrorResponse
    | undefined;
  if (!response) throw new Error('No response from background service worker.');
  if (response.type === 'ERROR' || response.ok !== true) {
    throw new Error(response.type === 'ERROR' ? response.error : 'Image generation failed.');
  }
  return response.dataUrl;
}
