// OpenAI-compatible chat/completions adapter.
//
// Covers any provider that speaks the OpenAI `/chat/completions` shape:
// Gemini's OpenAI endpoint (…/v1beta/openai), OpenRouter, Groq, Together,
// Ollama, LM Studio, vLLM. Selected by the registry `adapter: 'openai-compatible'`
// field. (research/07 §B "provider abstraction".)
//
// PURE adapter: builds requests and parses payloads only. No fetch, no storage
// access — the API key is injected by the client (resolved in the SW).

import type {
  ChatMessage,
  ContentPart,
  FinishReason,
  GenerateRequest,
  ModelConfig,
  NormalizedDelta,
  NormalizedResponse,
  NormalizedToolCall,
  ProviderAdapter,
  ToolSpec,
  UsageStats,
  WireRequest,
} from '../types';
import { BUDDY_UA } from '../ua';
import { thinkingConfigFor } from '../thinking';

// ---- Wire shapes (only the fields we read/write; parsed defensively) -------

interface WireToolCall {
  id?: string;
  index?: number;
  function?: { name?: string; arguments?: string };
  // Gemini 3 surfaces the (opaque, mandatory-echo) thought signature here on
  // the OpenAI-compat shim. openai.md L1097-1123, thought-signatures.md L562-578.
  extra_content?: { google?: { thought_signature?: string } };
}

interface WireMessage {
  role?: string;
  content?: string | null;
  tool_calls?: WireToolCall[];
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  // Gemini surfaces thinking tokens through OpenAI's reasoning-tokens shape.
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface WireChoice {
  message?: WireMessage;
  delta?: WireMessage;
  finish_reason?: string | null;
}

interface WireCompletion {
  model?: string;
  choices?: WireChoice[];
  usage?: WireUsage;
}

// ---- Helpers ----------------------------------------------------------------

function mapFinishReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    case null:
    case undefined:
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Parse a tool-call argument string into an object, defensively. */
function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Convert a normalized content value to the OpenAI wire content shape. */
function toWireContent(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    return { type: 'image_url', image_url: { url: part.imageUrl } };
  });
}

/** Convert a normalized message to an OpenAI wire message. */
function toWireMessage(msg: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: msg.role };
  out.content = toWireContent(msg.content);
  // F4: every tool-role message MUST carry both `name` and `tool_call_id` so
  // Gemini 3 can pair the response to the originating call
  // (function-calling.md L209-212). If the caller omits name, mirror toolCallId
  // as a last-resort identifier so the request doesn't 400.
  if (msg.toolCallId) {
    out.tool_call_id = msg.toolCallId;
    out.name = msg.name ?? msg.toolCallId;
  } else if (msg.name) {
    out.name = msg.name;
  }
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    out.tool_calls = msg.toolCalls.map((tc) => {
      const wire: Record<string, unknown> = {
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      };
      // F3: echo the thought signature back on the same tool-call object when
      // sending the assistant's prior turn as history (thought-signatures.md
      // L18-22, L60-72 — mandatory on Gemini 3).
      if (tc.thoughtSignature) {
        wire.extra_content = { google: { thought_signature: tc.thoughtSignature } };
      }
      return wire;
    });
  }
  return out;
}

/** Apply declarative paramMap renames to a wire body. */
function applyParamMap(body: Record<string, unknown>, paramMap: Record<string, string> | undefined): void {
  if (!paramMap) return;
  for (const [from, to] of Object.entries(paramMap)) {
    if (from === to) continue;
    if (Object.prototype.hasOwnProperty.call(body, from)) {
      body[to] = body[from];
      delete body[from];
    }
  }
}

// ---- Adapter ----------------------------------------------------------------

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id = 'openai-compatible' as const;

  buildRequest(req: GenerateRequest, apiKey: string | undefined): WireRequest {
    const { provider, model, messages, tools, params, stream } = req;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // x-goog-api-client identifies our extension to Google (partner-integration.md L132-177).
      'x-goog-api-client': BUDDY_UA,
    };
    if (apiKey) {
      const auth = provider.auth;
      if (auth.method === 'bearer') {
        headers.Authorization = `Bearer ${apiKey}`;
      } else if (auth.method === 'header' && auth.paramName) {
        headers[auth.paramName] = apiKey;
      }
      // 'query'/'none' handled in URL below or skipped.
    }

    const body: Record<string, unknown> = {
      model: model.id,
      messages: messages.map(toWireMessage),
    };
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    // Merge model defaults under caller params.
    const defaults = model.defaultParams ?? {};
    if (defaults.temperature !== undefined && params?.temperature === undefined) {
      body.temperature = defaults.temperature;
    }

    if (params) {
      if (params.temperature !== undefined) body.temperature = params.temperature;
      if (params.topP !== undefined) body.top_p = params.topP;
      if (params.maxOutputTokens !== undefined) body.max_tokens = params.maxOutputTokens;
      if (params.stop !== undefined) body.stop = params.stop;
      if (params.jsonMode) body.response_format = { type: 'json_object' };
      if (params.responseSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'response', schema: params.responseSchema, strict: true },
        };
      }
      // NOTE: thinking/topK are native-only knobs the OpenAI shim drops; use
      // the gemini-native adapter when those are required.
    }

    if (tools && tools.length > 0) {
      body.tools = this.mapToolsToWire(tools);
      body.tool_choice = 'auto';
    }

    // NOTE: safety settings travel on the NATIVE generateContent endpoint
    // (used by search/image/audio in the SW, see safety.ts). The Gemini
    // OpenAI-compat shim rejects extra_body.google.safety_settings, so the
    // chat path stays without explicit safety until the geminiNative adapter
    // is wired (docs/gemini/action-items.md F2 + F3).

    // H2 — thinking_config via extra_body.google. Only when the caller asks
    // for a level (so we don't change behavior for any call site that hasn't
    // been opted in). The mapping (level vs budget) depends on the model id.
    // thinking.md L374-382.
    if (params?.thinking) {
      const cfg = thinkingConfigFor(model.id, params.thinking);
      if (cfg) {
        const eb = (body.extra_body ?? {}) as Record<string, unknown>;
        const google = (eb.google ?? {}) as Record<string, unknown>;
        google.thinking_config = cfg;
        eb.google = google;
        body.extra_body = eb;
      }
    }

    applyParamMap(body, model.paramMap);

    let url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
    if (apiKey && provider.auth.method === 'query' && provider.auth.paramName) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}${encodeURIComponent(provider.auth.paramName)}=${encodeURIComponent(apiKey)}`;
    }

    return { url, method: 'POST', headers, body: JSON.stringify(body) };
  }

  parseResponse(payload: unknown, model: ModelConfig): NormalizedResponse {
    const data = (payload ?? {}) as WireCompletion;
    const choice = data.choices?.[0];
    const message = choice?.message ?? {};
    const text = typeof message.content === 'string' ? message.content : '';
    const toolCalls = this.parseToolCalls(payload);

    let finishReason = mapFinishReason(choice?.finish_reason);
    if (toolCalls.length > 0 && finishReason === 'unknown') finishReason = 'tool_calls';

    return {
      text,
      toolCalls,
      finishReason,
      usage: mapUsage(data.usage),
      model: data.model ?? model.id,
      raw: payload,
    };
  }

  parseStreamChunk(rawChunk: unknown, _model: ModelConfig): NormalizedDelta | null {
    if (rawChunk === null || rawChunk === undefined) return null;
    if (typeof rawChunk === 'string' && rawChunk.trim() === '[DONE]') return null;

    const data = rawChunk as WireCompletion;
    const choice = data.choices?.[0];
    const delta: NormalizedDelta = {};

    if (choice?.delta?.content) delta.textDelta = choice.delta.content;

    const wireCall = choice?.delta?.tool_calls?.[0];
    if (wireCall) {
      const partial: NormalizedDelta['toolCallDelta'] = { index: wireCall.index };
      if (wireCall.id) partial.id = wireCall.id;
      if (wireCall.function?.name) partial.name = wireCall.function.name;
      if (wireCall.function?.arguments) {
        // Stream arguments arrive as string fragments; surface incrementally
        // by parsing only when complete. Here we pass the fragment object.
        partial.arguments = parseArgs(wireCall.function.arguments);
      }
      // F3: thought_signature may arrive on any chunk; preserve when seen.
      const sig = wireCall.extra_content?.google?.thought_signature;
      if (typeof sig === 'string' && sig.length > 0) partial.thoughtSignature = sig;
      delta.toolCallDelta = partial;
    }

    if (choice?.finish_reason) delta.finishReason = mapFinishReason(choice.finish_reason);
    if (data.usage) delta.usage = mapUsage(data.usage);

    // Skip truly empty heartbeat chunks.
    if (
      delta.textDelta === undefined &&
      delta.toolCallDelta === undefined &&
      delta.finishReason === undefined &&
      delta.usage === undefined
    ) {
      return null;
    }
    return delta;
  }

  mapToolsToWire(tools: ToolSpec[]): unknown {
    return tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  parseToolCalls(payload: unknown): NormalizedToolCall[] {
    const data = (payload ?? {}) as WireCompletion;
    const message = data.choices?.[0]?.message;
    const wireCalls = message?.tool_calls;
    if (!Array.isArray(wireCalls)) return [];
    return wireCalls.map((tc, i) => {
      const out: NormalizedToolCall = {
        id: tc.id ?? `call_${i}`,
        name: tc.function?.name ?? '',
        arguments: parseArgs(tc.function?.arguments),
      };
      // F3: preserve Gemini 3 thought_signature (mandatory echo on next turn).
      const sig = tc.extra_content?.google?.thought_signature;
      if (typeof sig === 'string' && sig.length > 0) out.thoughtSignature = sig;
      return out;
    });
  }
}

export function mapUsage(usage: WireUsage | undefined): UsageStats {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens;
  const thoughts = usage?.completion_tokens_details?.reasoning_tokens;
  const stats: UsageStats = {
    inputTokens: input,
    outputTokens: output,
    totalTokens: usage?.total_tokens ?? input + output,
  };
  if (cached !== undefined) stats.cachedInputTokens = cached;
  if (thoughts !== undefined) stats.thoughtsTokens = thoughts;
  return stats;
}

/** Shared singleton instance. */
export const openAICompatibleAdapter = new OpenAICompatibleAdapter();
