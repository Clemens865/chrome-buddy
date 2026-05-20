// Native Gemini (generativelanguage REST) adapter — STUB.
//
// The OpenAI-compatible shim (openaiCompatible.ts) covers everyday Gemini chat
// and is the default. This adapter exists for the NATIVE wire shape
// (`…/v1beta/models/{model}:generateContent`) which exposes features the
// OpenAI shim drops: thinking budgets, native multimodal parts, search
// grounding, code execution, and the Computer Use loop. (research/07 §B,
// research/03 §1/§5.)
//
// =====================  TODO — NOT YET WIRED  ===============================
// This is a deliberate stub that satisfies the ProviderAdapter interface so
// the registry/router can reference `adapter: 'gemini-native'` once a model
// opts in. Native request/response mapping (contents[], parts[], thinkingConfig,
// usageMetadata, functionCall/functionResponse) is intentionally NOT
// implemented yet. When `@google/genai` is added as a dependency (currently
// planned, NOT installed — see PRD component #4), prefer routing native calls
// through the SDK rather than hand-rolling this REST shape, OR complete the
// fetch-based mapping below. Until then, callers should use the
// 'openai-compatible' adapter; selecting this adapter throws clearly.
// ============================================================================

import type {
  GenerateRequest,
  ModelConfig,
  NormalizedDelta,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
  ToolSpec,
  WireRequest,
} from '../types';

const NOT_IMPLEMENTED =
  "geminiNative adapter is a stub: native generateContent mapping is not implemented yet. " +
  "Use the 'openai-compatible' adapter, or finish geminiNative.ts / swap in @google/genai (TODO).";

export class GeminiNativeAdapter implements ProviderAdapter {
  readonly id = 'gemini-native' as const;

  // TODO: build `{contents:[{role,parts:[...]}], tools, generationConfig,
  //       thinkingConfig}` against `${baseUrl}/models/${model.id}:generateContent`
  //       (append `:streamGenerateContent` + `?alt=sse` when streaming).
  buildRequest(_req: GenerateRequest, _apiKey: string | undefined): WireRequest {
    throw new Error(NOT_IMPLEMENTED);
  }

  // TODO: read `candidates[0].content.parts[]` (text + functionCall) and
  //       `usageMetadata` (promptTokenCount/candidatesTokenCount/cachedContentTokenCount).
  parseResponse(_payload: unknown, _model: ModelConfig): NormalizedResponse {
    throw new Error(NOT_IMPLEMENTED);
  }

  // TODO: parse SSE chunks of streamGenerateContent (incremental parts).
  parseStreamChunk(_rawChunk: unknown, _model: ModelConfig): NormalizedDelta | null {
    throw new Error(NOT_IMPLEMENTED);
  }

  // TODO: map to native `tools:[{functionDeclarations:[{name,description,parameters}]}]`.
  mapToolsToWire(_tools: ToolSpec[]): unknown {
    throw new Error(NOT_IMPLEMENTED);
  }

  // TODO: extract `parts[].functionCall {name,args}` -> NormalizedToolCall.
  parseToolCalls(_payload: unknown): NormalizedToolCall[] {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/** Shared singleton instance (stub). */
export const geminiNativeAdapter = new GeminiNativeAdapter();
