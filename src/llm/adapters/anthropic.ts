// Anthropic Messages API adapter (https://docs.anthropic.com/en/api/messages).
//
// Added for the optional "power builder" path (Opus 4.8) in the Micro-App
// Builder. Anthropic is NOT OpenAI-compatible: `system` is a top-level field
// (not a message), auth is `x-api-key` + `anthropic-version`, `max_tokens` is
// REQUIRED, and content/tools use a block format. Browser/extension callers
// must send `anthropic-dangerous-direct-browser-access: true`.
//
// PURE adapter: builds requests + parses payloads only. No fetch, no storage —
// the key is injected by the client (resolved in the SW), exactly like the
// other adapters. Selected by `ProviderConfig.adapter: 'anthropic'`.
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

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Map Anthropic usage → normalized UsageStats. */
export function mapUsage(u: WireUsage | undefined): UsageStats {
  const inputTokens = u?.input_tokens ?? 0;
  const outputTokens = u?.output_tokens ?? 0;
  const cached = u?.cache_read_input_tokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
  };
}

/** Map Anthropic stop_reason → normalized FinishReason. */
export function mapStopReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return reason ? 'unknown' : 'stop';
  }
}

/** One Anthropic content block (text or image). */
type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_result'; tool_use_id: string; content: string };

function partsToBlocks(content: string | ContentPart[]): string | AnthropicBlock[] {
  if (typeof content === 'string') return content;
  const blocks: AnthropicBlock[] = [];
  for (const p of content) {
    if (p.type === 'text') {
      blocks.push({ type: 'text', text: p.text });
    } else if (p.type === 'image') {
      // ContentPart image carries a data URL or base64; parse defensively.
      const raw = (p as { image?: string; data?: string; mimeType?: string }).image ?? (p as { data?: string }).data ?? '';
      const m = /^data:([^;]+);base64,(.*)$/.exec(raw);
      const media_type = m?.[1] ?? (p as { mimeType?: string }).mimeType ?? 'image/png';
      const data = m?.[2] ?? raw;
      if (data) blocks.push({ type: 'image', source: { type: 'base64', media_type, data } });
    }
  }
  return blocks;
}

/** Split ChatMessages into Anthropic's top-level system string + messages[]. */
export function splitMessages(messages: ChatMessage[]): {
  system: string | undefined;
  msgs: { role: 'user' | 'assistant'; content: string | AnthropicBlock[] }[];
} {
  const systemParts: string[] = [];
  const msgs: { role: 'user' | 'assistant'; content: string | AnthropicBlock[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(typeof m.content === 'string' ? m.content : (partsToBlocks(m.content) as AnthropicBlock[]).map((b) => (b.type === 'text' ? b.text : '')).join('\n'));
    } else if (m.role === 'tool') {
      // A tool result becomes a user turn with a tool_result block.
      msgs.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: typeof m.content === 'string' ? m.content : '' }],
      });
    } else {
      msgs.push({ role: m.role, content: partsToBlocks(m.content) });
    }
  }
  return { system: systemParts.length ? systemParts.join('\n\n') : undefined, msgs };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic' as const;

  buildRequest(req: GenerateRequest, apiKey: string | undefined): WireRequest {
    const { provider, model, messages, tools, params, stream } = req;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for calls originating from a browser/extension context.
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-goog-api-client': BUDDY_UA, // harmless; identifies the client build
    };
    if (apiKey) headers[provider.auth.paramName ?? 'x-api-key'] = apiKey;

    const { system, msgs } = splitMessages(messages);
    const body: Record<string, unknown> = {
      model: model.id,
      max_tokens: params?.maxOutputTokens ?? model.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages: msgs,
    };
    // jsonMode: Anthropic has no response_format flag — steer via system.
    const sys = params?.jsonMode
      ? `${system ? system + '\n\n' : ''}Respond with ONLY valid JSON — no prose, no markdown fences.`
      : system;
    if (sys) body.system = sys;
    if (params?.temperature !== undefined) body.temperature = params.temperature;
    if (params?.topP !== undefined) body.top_p = params.topP;
    if (params?.stop !== undefined) body.stop_sequences = params.stop;
    if (tools && tools.length) body.tools = this.mapToolsToWire(tools);
    if (stream) body.stream = true;

    const base = provider.baseUrl.replace(/\/$/, '');
    return { url: `${base}/v1/messages`, method: 'POST', headers, body: JSON.stringify(body) };
  }

  parseResponse(payload: unknown, _model: ModelConfig): NormalizedResponse {
    const p = (payload ?? {}) as { content?: unknown[]; stop_reason?: string; usage?: WireUsage; model?: string };
    const blocks = Array.isArray(p.content) ? p.content : [];
    const text = blocks
      .filter((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      toolCalls: this.parseToolCalls(payload),
      finishReason: mapStopReason(p.stop_reason),
      usage: mapUsage(p.usage),
      model: p.model ?? _model.id,
      raw: payload,
    };
  }

  parseStreamChunk(rawChunk: unknown, _model: ModelConfig): NormalizedDelta | null {
    const c = (rawChunk ?? {}) as {
      type?: string;
      delta?: { type?: string; text?: string; stop_reason?: string };
      usage?: WireUsage;
    };
    if (c.type === 'content_block_delta' && c.delta?.type === 'text_delta') {
      return { textDelta: c.delta.text ?? '' };
    }
    if (c.type === 'message_delta') {
      return {
        finishReason: c.delta?.stop_reason ? mapStopReason(c.delta.stop_reason) : undefined,
        ...(c.usage ? { usage: mapUsage(c.usage) } : {}),
      };
    }
    if (c.type === 'message_stop') return { finishReason: 'stop' };
    return null; // message_start / content_block_start|stop / ping
  }

  mapToolsToWire(tools: ToolSpec[]): unknown {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  parseToolCalls(payload: unknown): NormalizedToolCall[] {
    const blocks = (payload as { content?: unknown[] })?.content;
    if (!Array.isArray(blocks)) return [];
    const out: NormalizedToolCall[] = [];
    for (const b of blocks) {
      const blk = b as { type?: string; id?: string; name?: string; input?: unknown };
      if (blk.type === 'tool_use') {
        out.push({
          id: blk.id ?? `call_${out.length}`,
          name: blk.name ?? '',
          arguments: (blk.input as Record<string, unknown>) ?? {},
        });
      }
    }
    return out;
  }
}

export const anthropicAdapter = new AnthropicAdapter();
