// Background service worker (MV3).
//
// Two jobs:
//   1. Open the side panel on toolbar-action click (unchanged from v0).
//   2. Own API-key custody and ALL cloud LLM calls (PRD NFR-SEC-1/2):
//      - Keys live ONLY in chrome.storage.session (in-memory; cleared when the
//        browser session ends). They are never persisted to disk and never
//        returned to a caller.
//      - LLM_GENERATE runs the LlmClient HERE, using the stored key, so the key
//        never reaches a content script or page context.
//
// The message protocol lives in src/key/messages.ts; the client wiring in
// src/llm/instance.ts.

import {
  apiKeyStorageKey,
  isBuddyMessage,
  type BuddyMessage,
  type BuddyResponse,
} from '../key/messages';
import { getLlmClient, resolveProviderId } from '../llm/instance';
import { LlmClient } from '../llm/client';
import { DEFAULT_REGISTRY } from '../llm/registry.default';

chrome.runtime.onInstalled.addListener(() => {
  // Allow clicking the toolbar icon to toggle the side panel open.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[chrome-buddy] setPanelBehavior failed', err));
});

/** Read the message type for a stored key from chrome.storage.session. */
async function getStoredKey(provider: string): Promise<string | undefined> {
  const session = chrome.storage?.session;
  if (!session) return undefined;
  const storageKey = apiKeyStorageKey(provider);
  const res = await session.get(storageKey);
  const value = (res as Record<string, unknown>)[storageKey];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Handle one inbound message and produce a response. Exported (and pure w.r.t.
 * the chrome.* it touches) so it is unit-testable with mocked chrome.* APIs.
 */
export async function handleBuddyMessage(message: BuddyMessage): Promise<BuddyResponse> {
  try {
    switch (message.type) {
      case 'KEY_SET': {
        const session = chrome.storage?.session;
        const storageKey = apiKeyStorageKey(message.provider);
        if (message.key.length === 0) {
          await session?.remove(storageKey);
        } else {
          await session?.set({ [storageKey]: message.key });
        }
        return { type: 'KEY_SET', ok: true };
      }

      case 'KEY_STATUS': {
        const key = await getStoredKey(message.provider);
        // SECURITY: report existence only — never echo the key itself.
        return { type: 'KEY_STATUS', hasKey: key !== undefined };
      }

      case 'KEY_VALIDATE': {
        // Build a one-off client that uses the CANDIDATE key (not the stored
        // one) and make a tiny request. Nothing is persisted.
        const client = new LlmClient(DEFAULT_REGISTRY, async () => message.key);
        try {
          await client.generate({
            messages: [{ role: 'user', content: 'ping' }],
            params: { maxOutputTokens: 1 },
          });
          return { type: 'KEY_VALIDATE', ok: true };
        } catch (err) {
          return {
            type: 'KEY_VALIDATE',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      case 'LLM_GENERATE': {
        const providerId = resolveProviderId(message.model);
        if (!providerId) {
          return { type: 'ERROR', ok: false, error: 'Unknown or disabled model.' };
        }
        const key = await getStoredKey(providerId);
        if (!key) {
          return {
            type: 'ERROR',
            ok: false,
            error: `No API key set for provider '${providerId}'.`,
          };
        }
        const client = getLlmClient(providerId);
        const result = await client.generate({
          model: message.model,
          messages: message.messages,
          tools: message.tools,
          params: message.params,
        });
        return { type: 'LLM_GENERATE', ok: true, result };
      }

      default: {
        const exhaustive: never = message;
        return { type: 'ERROR', ok: false, error: `Unhandled message: ${String(exhaustive)}` };
      }
    }
  } catch (err) {
    return { type: 'ERROR', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Register the message listener. We respond asynchronously, so we keep the
// channel open by returning `true` and resolving via sendResponse.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isBuddyMessage(message)) return false;
  handleBuddyMessage(message).then(sendResponse, (err: unknown) =>
    sendResponse({
      type: 'ERROR',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return true; // keep the message channel open for the async response
});

export {};
