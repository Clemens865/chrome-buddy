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
import type { RunRecord } from '../memory/types';
import type { Skill } from '../skills/types';
import type { Workflow } from '../workflows/types';
import type { AppConfig } from '../apps/types';

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

/**
 * Transcribe audio via the native Gemini generateContent endpoint (audio
 * inlineData → text). Like image gen, audio can't go through the OpenAI-compat
 * chat adapter. Runs in the SW (key custody).
 */
export interface AudioTranscribeMessage {
  type: 'AUDIO_TRANSCRIBE';
  /** Audio-capable registry model id; omit to use a sensible default. */
  model?: string;
  /** Base64 audio payload (no data: prefix). */
  audioBase64: string;
  /** MIME type, e.g. 'audio/wav', 'audio/mp3', 'audio/webm'. */
  mimeType: string;
  /** Optional instruction (default: verbatim transcription). */
  prompt?: string;
}

/** Capture a compact summary of a page (for attaching to chat). Defaults to the
 *  active tab; pass tabId to capture a specific open tab (multi-tab context). */
export interface PageContextMessage {
  type: 'PAGE_CONTEXT';
  tabId?: number;
}

/** Run history (FR-MEM): owned by the SW so panel + overlay share one store. */
export interface MemorySaveRunMessage {
  type: 'MEMORY_SAVE_RUN';
  run: RunRecord;
}
export interface MemoryListRunsMessage {
  type: 'MEMORY_LIST_RUNS';
  limit?: number;
}
export interface MemoryClearMessage {
  type: 'MEMORY_CLEAR';
}

/** Skills store (FR-SKILL): SW-owned so panel + overlay share it. */
export interface SkillSaveMessage {
  type: 'SKILL_SAVE';
  skill: Skill;
}
export interface SkillListMessage {
  type: 'SKILL_LIST';
}
export interface SkillDeleteMessage {
  type: 'SKILL_DELETE';
  id: string;
}

/** Workflow store (FR-WF): SW-owned. */
export interface WorkflowSaveMessage {
  type: 'WORKFLOW_SAVE';
  workflow: Workflow;
}
export interface WorkflowListMessage {
  type: 'WORKFLOW_LIST';
}
export interface WorkflowDeleteMessage {
  type: 'WORKFLOW_DELETE';
  id: string;
}

/** Tier-1 app store (FR-APP): SW-owned. */
export interface AppSaveMessage {
  type: 'APP_SAVE';
  app: AppConfig;
}
export interface AppListMessage {
  type: 'APP_LIST';
}
export interface AppDeleteMessage {
  type: 'APP_DELETE';
  id: string;
}

/** Library v1 — index one doc into the local RAG library. Used by the chat
 * auto-mirror, note auto-mirror, folder import flow, and tests. */
export interface LibraryIndexMessage {
  type: 'LIBRARY_INDEX';
  source: 'chat' | 'note' | 'folder' | 'manual' | 'file' | 'page';
  sourceRef?: string;
  title: string;
  content: string;
  /** Target collection (defaults to 'general'). */
  collectionId?: string;
  /** Optional user framing surfaced with retrieved snippets. */
  note?: string;
}

/** Library v1 — one-time backfill. Walks IDB chats + notes and indexes any
 * that aren't yet in the library (or whose contentHash changed). Returns
 * counts so the UI can render a progress notice. */
export interface LibraryBackfillMessage {
  type: 'LIBRARY_BACKFILL';
}

/** Library collections — list / save / delete (panel ↔ SW). */
export interface LibraryCollectionsMessage {
  type: 'LIBRARY_COLLECTIONS';
}
export interface LibraryCollectionSaveMessage {
  type: 'LIBRARY_COLLECTION_SAVE';
  collection: {
    id?: string;
    name: string;
    description: string;
    kind: 'profile' | 'project' | 'general';
    autoContext: 'always' | 'active' | 'manual';
  };
}
export interface LibraryCollectionDeleteMessage {
  type: 'LIBRARY_COLLECTION_DELETE';
  id: string;
  /** Reassign the collection's docs to this collection instead of deleting them. */
  reassignTo?: string;
}

/** One-click "add the active page to a collection" — SW distills the active tab
 *  then indexes it. */
export interface LibraryCapturePageMessage {
  type: 'LIBRARY_CAPTURE_PAGE';
  collectionId: string;
  note?: string;
}

/** Vision Mode (Computer Use) — one model turn. Stateless: caller passes the
 *  full `contents` array each turn (the SW only adds the system instruction +
 *  the computer_use tool config). Returns the model's text + function calls. */
export interface VisionTurnMessage {
  type: 'VISION_TURN';
  contents: { role: 'user' | 'model'; parts: Record<string, unknown>[] }[];
}

/** Vision Mode — execute one Computer Use action (CDP-backed) on the given tab
 *  and return the post-action screenshot + URL + title. */
export interface VisionActionMessage {
  type: 'VISION_ACTION';
  tabId: number;
  call: { name: string; args: Record<string, unknown> };
}

/** Vision Mode — capture the active tab's current screenshot + URL + title. */
export interface VisionCaptureMessage {
  type: 'VISION_CAPTURE';
  tabId?: number;
}

/** MCP — run a saved server's handshake + tools/list and return a summary.
 *  Phase 1 surface; Phase 2 adds MCP_CALL_TOOL for the agent dispatcher. */
export interface McpTestMessage {
  type: 'MCP_TEST';
  serverId: string;
  /** Optional un-saved key for "Test before Save" in the Add form. */
  oneShotKey?: string;
}

/** Discriminated union of every message the background SW understands. */
export type BuddyMessage =
  | KeySetMessage
  | KeyStatusMessage
  | KeyValidateMessage
  | LlmGenerateMessage
  | ToolExecMessage
  | VisionTurnMessage
  | VisionActionMessage
  | VisionCaptureMessage
  | ImageGenerateMessage
  | AudioTranscribeMessage
  | PageContextMessage
  | MemorySaveRunMessage
  | MemoryListRunsMessage
  | MemoryClearMessage
  | SkillSaveMessage
  | SkillListMessage
  | SkillDeleteMessage
  | WorkflowSaveMessage
  | WorkflowListMessage
  | WorkflowDeleteMessage
  | AppSaveMessage
  | AppListMessage
  | AppDeleteMessage
  | LibraryIndexMessage
  | LibraryBackfillMessage
  | LibraryCollectionsMessage
  | LibraryCollectionSaveMessage
  | LibraryCollectionDeleteMessage
  | LibraryCapturePageMessage
  | McpTestMessage;

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

export interface AudioTranscribeResponse {
  type: 'AUDIO_TRANSCRIBE';
  ok: true;
  /** The transcript text. */
  text: string;
}

export interface PageContextResponse {
  type: 'PAGE_CONTEXT';
  ok: true;
  /** null when there is no driveable active tab (e.g. chrome:// page). */
  page: { url: string; title: string; text: string } | null;
}

export interface MemorySaveRunResponse {
  type: 'MEMORY_SAVE_RUN';
  ok: true;
}
export interface MemoryListRunsResponse {
  type: 'MEMORY_LIST_RUNS';
  ok: true;
  runs: RunRecord[];
}
export interface MemoryClearResponse {
  type: 'MEMORY_CLEAR';
  ok: true;
}

export interface SkillSaveResponse {
  type: 'SKILL_SAVE';
  ok: true;
}
export interface SkillListResponse {
  type: 'SKILL_LIST';
  ok: true;
  skills: Skill[];
}
export interface SkillDeleteResponse {
  type: 'SKILL_DELETE';
  ok: true;
}

export interface WorkflowSaveResponse {
  type: 'WORKFLOW_SAVE';
  ok: true;
}
export interface WorkflowListResponse {
  type: 'WORKFLOW_LIST';
  ok: true;
  workflows: Workflow[];
}
export interface WorkflowDeleteResponse {
  type: 'WORKFLOW_DELETE';
  ok: true;
}

export interface AppSaveResponse {
  type: 'APP_SAVE';
  ok: true;
}
export interface AppListResponse {
  type: 'APP_LIST';
  ok: true;
  apps: AppConfig[];
}
export interface AppDeleteResponse {
  type: 'APP_DELETE';
  ok: true;
}

export interface LibraryIndexResponse {
  type: 'LIBRARY_INDEX';
  ok: true;
  result: ToolResult;
}

export interface LibraryCollectionRecord {
  id: string;
  name: string;
  description: string;
  kind: 'profile' | 'project' | 'general';
  autoContext: 'always' | 'active' | 'manual';
  createdAt: number;
  updatedAt: number;
  /** Number of docs in this collection (for the UI). */
  docCount?: number;
}
export interface LibraryCollectionsResponse {
  type: 'LIBRARY_COLLECTIONS';
  ok: true;
  collections: LibraryCollectionRecord[];
}
export interface LibraryCollectionSaveResponse {
  type: 'LIBRARY_COLLECTION_SAVE';
  ok: true;
  collection: LibraryCollectionRecord;
}
export interface LibraryCollectionDeleteResponse {
  type: 'LIBRARY_COLLECTION_DELETE';
  ok: true;
}
export interface LibraryCapturePageResponse {
  type: 'LIBRARY_CAPTURE_PAGE';
  ok: true;
  result: ToolResult;
  /** The captured page's title + url for a friendly confirmation. */
  title: string;
  url: string;
}

export interface LibraryBackfillResponse {
  type: 'LIBRARY_BACKFILL';
  ok: true;
  /** How many docs were freshly indexed (skipped/unchanged not counted). */
  indexed: number;
  /** How many were skipped because contentHash was unchanged. */
  skipped: number;
  /** How many failed (couldn't embed, etc.). */
  failed: number;
  /** Total docs considered (chats + notes). */
  total: number;
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
            : M extends PageContextMessage
              ? PageContextResponse | ErrorResponse
              : never;

export interface VisionTurnResponse {
  type: 'VISION_TURN';
  ok: true;
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  modelTurn: { role: 'user' | 'model'; parts: Record<string, unknown>[] };
  /** Token usage for this turn (Computer Use is billed per-turn at the
   *  preview model's pricing). The panel aggregates across turns. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    thoughtsTokens?: number;
  };
}

export interface VisionActionResponse {
  type: 'VISION_ACTION';
  ok: boolean;
  screenshot?: string;
  url?: string;
  title?: string;
  error?: string;
}

export interface VisionCaptureResponse {
  type: 'VISION_CAPTURE';
  ok: boolean;
  tabId?: number;
  screenshot?: string;
  url?: string;
  title?: string;
  error?: string;
}

export type McpTestResponse =
  | {
      type: 'MCP_TEST';
      ok: true;
      serverName: string;
      serverVersion: string;
      protocolVersion: string;
      toolCount: number;
      tools: { name: string; description?: string }[];
    }
  | { type: 'MCP_TEST'; ok: false; error: string };

export type BuddyResponse =
  | KeySetResponse
  | KeyStatusResponse
  | KeyValidateResponse
  | LlmGenerateResponse
  | ToolExecResponse
  | ImageGenerateResponse
  | AudioTranscribeResponse
  | PageContextResponse
  | VisionTurnResponse
  | VisionActionResponse
  | VisionCaptureResponse
  | MemorySaveRunResponse
  | MemoryListRunsResponse
  | MemoryClearResponse
  | SkillSaveResponse
  | SkillListResponse
  | SkillDeleteResponse
  | WorkflowSaveResponse
  | WorkflowListResponse
  | WorkflowDeleteResponse
  | AppSaveResponse
  | AppListResponse
  | AppDeleteResponse
  | LibraryIndexResponse
  | LibraryBackfillResponse
  | LibraryCollectionsResponse
  | LibraryCollectionSaveResponse
  | LibraryCollectionDeleteResponse
  | LibraryCapturePageResponse
  | McpTestResponse
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
    t === 'IMAGE_GENERATE' ||
    t === 'AUDIO_TRANSCRIBE' ||
    t === 'PAGE_CONTEXT' ||
    t === 'MEMORY_SAVE_RUN' ||
    t === 'MEMORY_LIST_RUNS' ||
    t === 'MEMORY_CLEAR' ||
    t === 'SKILL_SAVE' ||
    t === 'SKILL_LIST' ||
    t === 'SKILL_DELETE' ||
    t === 'WORKFLOW_SAVE' ||
    t === 'WORKFLOW_LIST' ||
    t === 'WORKFLOW_DELETE' ||
    t === 'APP_SAVE' ||
    t === 'APP_LIST' ||
    t === 'APP_DELETE' ||
    t === 'VISION_TURN' ||
    t === 'VISION_ACTION' ||
    t === 'VISION_CAPTURE' ||
    t === 'LIBRARY_INDEX' ||
    t === 'LIBRARY_BACKFILL' ||
    t === 'MCP_TEST'
  );
}
