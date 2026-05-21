// Typed message protocol between UI / content scripts and the background
// service worker (MV3).
//
// KEY CUSTODY (PRD NFR-SEC-1/2): API keys live ONLY in chrome.storage.session
// inside the service worker, and ALL cloud LLM calls originate in the SW. UI and
// content callers never hold a key — they exchange these messages with the SW:
//   - KEY_SET     : hand a key to the SW for in-memory (session) storage.
//   - KEY_STATUS  : ask whether a key exists (the key itself is never returned).
//   - KEY_VALIDATE: ask the SW to make a tiny test request with a candidate key.
//   - LLM_GENERATE: ask the SW to run a generation using the stored key.
//
// `provider` is a registry provider id (e.g. 'google-gemini'). The storage key
// is derived as `apiKey:<provider>` — see src/background/background.ts.

import type { ChatMessage, GenerationParams, ToolSpec } from '../llm/types';
import type { GenerateResult } from '../llm/client';
import type { ToolResult } from '../types';

/** chrome.storage.session key under which a provider's key is held. */
export function apiKeyStorageKey(provider: string): string {
  return `apiKey:${provider}`;
}

// ---- Requests ---------------------------------------------------------------

/** Store (or overwrite) a provider's API key in the SW session store. */
export interface KeySetMessage {
  type: 'KEY_SET';
  provider: string;
  /** Empty string clears the stored key. */
  key: string;
}

/** Ask whether a key is currently set for a provider. Never returns the key. */
export interface KeyStatusMessage {
  type: 'KEY_STATUS';
  provider: string;
}

/** Validate a candidate key with a tiny live request (does NOT store it). */
export interface KeyValidateMessage {
  type: 'KEY_VALIDATE';
  provider: string;
  key: string;
}

/** Run a generation in the SW using the stored key for the model's provider. */
export interface LlmGenerateMessage {
  type: 'LLM_GENERATE';
  /** Registry model id; omit to use the registry default. */
  model?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  params?: GenerationParams;
}

/**
 * Execute a page tool on the ACTIVE tab inside the SW (FR-TOOLS-2..6).
 *
 * DOM-first: read/act tools (read_dom, extract, screenshot, navigate, click,
 * type, scroll) run HERE, in the privileged background context, via the shared
 * src/page services (PageContext + Browser Control). The agent loop lives in the
 * UI and routes each proposed tool call through this message — UI/content code
 * never touches chrome.scripting / captureVisibleTab directly.
 *
 * SECURITY: the SW refuses restricted/undriveable URLs with a structured error,
 * and never executes a CONSEQUENTIAL tool here (the runtime's HITL gate fires
 * first, in the UI — see src/agent/runner.ts).
 */
export interface ToolExecMessage {
  type: 'TOOL_EXEC';
  /** Registry tool name (e.g. 'read_dom', 'navigate', 'click'). */
  tool: string;
  /** Tool arguments (already approved when consequential). */
  args: Record<string, unknown>;
}

/**
 * Generate an image via the native Gemini generateContent endpoint
 * (responseModalities: IMAGE). Image models can't go through the OpenAI-compatible
 * chat adapter, so they get their own message + handler. Runs in the SW (key custody).
 */
export interface ImageGenerateMessage {
  type: 'IMAGE_GENERATE';
  /** Image-capable registry model id (e.g. 'gemini-2.5-flash-image'). */
  model: string;
  prompt: string;
  /** Optional aspect ratio (e.g. '1:1', '16:9') → responseFormat.image.aspectRatio. */
  aspect?: string;
  /** Optional input image (data URL) for edit-with-AI. */
  inputImage?: string;
}

/** Discriminated union of every message the background SW understands. */
export type BuddyMessage =
  | KeySetMessage
  | KeyStatusMessage
  | KeyValidateMessage
  | LlmGenerateMessage
  | ToolExecMessage
  | ImageGenerateMessage;

// ---- Responses --------------------------------------------------------------

export interface KeySetResponse {
  type: 'KEY_SET';
  ok: true;
}

export interface KeyStatusResponse {
  type: 'KEY_STATUS';
  /** Whether a non-empty key is stored. The key value is never included. */
  hasKey: boolean;
}

export interface KeyValidateResponse {
  type: 'KEY_VALIDATE';
  ok: boolean;
  /** Present when ok === false. */
  error?: string;
}

export interface LlmGenerateResponse {
  type: 'LLM_GENERATE';
  ok: true;
  result: GenerateResult;
}

/**
 * Result of a TOOL_EXEC. The SW always wraps the tool outcome in a
 * discriminated ToolResult (it never throws across the message boundary):
 * `ok:true` carries the registry's ToolResult; `ok:false` carries a message.
 */
export interface ToolExecResponse {
  type: 'TOOL_EXEC';
  ok: true;
  result: ToolResult;
}

export interface ImageGenerateResponse {
  type: 'IMAGE_GENERATE';
  ok: true;
  /** Generated image as a data URL (data:image/...;base64,...). */
  dataUrl: string;
}

/** Uniform error envelope returned for any failed message handling. */
export interface ErrorResponse {
  type: 'ERROR';
  ok: false;
  error: string;
}

/** Response for a given request type (used to type sendMessage round-trips). */
export type ResponseFor<M extends BuddyMessage> = M extends KeySetMessage
  ? KeySetResponse | ErrorResponse
  : M extends KeyStatusMessage
    ? KeyStatusResponse | ErrorResponse
    : M extends KeyValidateMessage
      ? KeyValidateResponse | ErrorResponse
      : M extends LlmGenerateMessage
        ? LlmGenerateResponse | ErrorResponse
        : M extends ToolExecMessage
          ? ToolExecResponse | ErrorResponse
          : M extends ImageGenerateMessage
            ? ImageGenerateResponse | ErrorResponse
            : never;

export type BuddyResponse =
  | KeySetResponse
  | KeyStatusResponse
  | KeyValidateResponse
  | LlmGenerateResponse
  | ToolExecResponse
  | ImageGenerateResponse
  | ErrorResponse;

/** Type guard: is this an inbound message the SW should handle? */
export function isBuddyMessage(value: unknown): value is BuddyMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { type?: unknown }).type;
  return (
    t === 'KEY_SET' ||
    t === 'KEY_STATUS' ||
    t === 'KEY_VALIDATE' ||
    t === 'LLM_GENERATE' ||
    t === 'TOOL_EXEC' ||
    t === 'IMAGE_GENERATE'
  );
}
