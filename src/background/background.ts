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
import { getLlmClient, resolveProviderId, readSessionApiKey } from '../llm/instance';
import { LlmClient } from '../llm/client';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { executePageTool, capturePageContext } from './pageTools';

chrome.runtime.onInstalled.addListener(() => {
  // Allow clicking the toolbar icon to toggle the side panel open.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[chrome-buddy] setPanelBehavior failed', err));
});

/**
 * Generate an image via Gemini's NATIVE generateContent endpoint
 * (responseModalities: IMAGE). Image models can't go through the OpenAI-compatible
 * chat adapter, so this calls the native endpoint directly and parses the inline
 * image bytes. The key stays in the SW.
 */
async function generateImageNative(
  providerId: string,
  model: string,
  prompt: string,
  aspect?: string,
  inputImage?: string,
): Promise<BuddyResponse> {
  const key = await getStoredKey(providerId);
  if (!key) return { type: 'ERROR', ok: false, error: `No API key set for provider '${providerId}'.` };

  const provider = DEFAULT_REGISTRY.providers[providerId];
  // Derive the native base from the OpenAI-compat base by stripping /openai.
  const base =
    (provider?.baseUrl ?? '').replace(/\/openai\/?$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${model}:generateContent`;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  if (inputImage) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(inputImage);
    if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  }

  const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] };
  if (aspect) generationConfig.responseFormat = { image: { aspectRatio: aspect } };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
  } catch (err) {
    return { type: 'ERROR', ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { type: 'ERROR', ok: false, error: `Image API ${resp.status}: ${body.slice(0, 300)}` };
  }

  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  };
  const respParts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of respParts) {
    const inline = p.inlineData;
    if (inline?.data) {
      const mime = inline.mimeType ?? 'image/png';
      return { type: 'IMAGE_GENERATE', ok: true, dataUrl: `data:${mime};base64,${inline.data}` };
    }
  }
  return { type: 'ERROR', ok: false, error: 'The model did not return an image.' };
}

/**
 * Resolve a provider's key: in-app key (storage.local) → DEV .env fallback.
 * Delegates to the single resolver in instance.ts so KEY_STATUS, LLM_GENERATE
 * and IMAGE_GENERATE all honor the same lookup.
 */
async function getStoredKey(provider: string): Promise<string | undefined> {
  return readSessionApiKey(provider);
}

/**
 * Handle one inbound message and produce a response. Exported (and pure w.r.t.
 * the chrome.* it touches) so it is unit-testable with mocked chrome.* APIs.
 */
export async function handleBuddyMessage(message: BuddyMessage): Promise<BuddyResponse> {
  try {
    switch (message.type) {
      case 'KEY_SET': {
        const store = chrome.storage?.local;
        const storageKey = apiKeyStorageKey(message.provider);
        if (message.key.length === 0) {
          await store?.remove(storageKey);
        } else {
          await store?.set({ [storageKey]: message.key });
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

      case 'TOOL_EXEC': {
        // DOM-first: run page read/act tools in the SW against the active tab.
        // Restricted URLs are refused inside executePageTool with a structured
        // error. Consequential side-effecting tools are NOT routed here — the
        // runtime's HITL gate (UI side) precedes any TOOL_EXEC for those.
        const result = await executePageTool(message.tool, message.args);
        return { type: 'TOOL_EXEC', ok: true, result };
      }

      case 'PAGE_CONTEXT': {
        const page = await capturePageContext();
        return { type: 'PAGE_CONTEXT', ok: true, page };
      }

      case 'IMAGE_GENERATE': {
        const providerId = resolveProviderId(message.model);
        if (!providerId) {
          return { type: 'ERROR', ok: false, error: 'Unknown or disabled model.' };
        }
        const key = await getStoredKey(providerId);
        if (!key) {
          return { type: 'ERROR', ok: false, error: `No API key set for provider '${providerId}'.` };
        }
        return generateImageNative(
          providerId,
          message.model,
          message.prompt,
          message.aspect,
          message.inputImage,
        );
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
