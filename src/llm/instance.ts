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
import { resolveDefaultModel, resolveModel } from './router';
import type { GenerateResult } from './client';
import { apiKeyStorageKey } from '../key/messages';
import type {
  ErrorResponse,
  LlmGenerateMessage,
  LlmGenerateResponse,
} from '../key/messages';

/** Read a provider's API key from chrome.storage.session (SW context only). */
export async function readSessionApiKey(provider: string): Promise<string | undefined> {
  const session = chrome.storage?.session;
  if (!session) return undefined;
  const storageKey = apiKeyStorageKey(provider);
  const res = await session.get(storageKey);
  const value = (res as Record<string, unknown>)[storageKey];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build an LlmClient for background-context use. The injected getApiKey reads
 * the key for `provider` from chrome.storage.session at request time, so the
 * key is resolved lazily and only inside the SW.
 */
export function getLlmClient(provider: string): LlmClient {
  return new LlmClient(DEFAULT_REGISTRY, () => readSessionApiKey(provider));
}

/**
 * Resolve which provider id backs a model id (or the registry default). Used by
 * the SW to pick the right stored key for an LLM_GENERATE request.
 */
export function resolveProviderId(modelId: string | undefined): string | undefined {
  const resolved = modelId
    ? resolveModel(DEFAULT_REGISTRY, modelId)
    : resolveDefaultModel(DEFAULT_REGISTRY);
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
