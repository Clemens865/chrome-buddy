import { describe, it, expect } from 'vitest';
import { AnthropicAdapter, mapUsage, mapStopReason, splitMessages } from './anthropic';
import type { GenerateRequest, ModelConfig, ProviderConfig } from '../types';

const adapter = new AnthropicAdapter();

const PROVIDER: ProviderConfig = {
  id: 'anthropic',
  displayName: 'Anthropic',
  adapter: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  auth: { method: 'header', paramName: 'x-api-key', keyRef: 'secret:anthropic' },
};
const MODEL: ModelConfig = {
  id: 'claude-opus-4-8',
  provider: 'anthropic',
  displayName: 'Claude Opus 4.8',
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  pricing: { inputPerMTok: 5, outputPerMTok: 25 },
  capabilities: { vision: true, tools: true, thinking: true, jsonMode: true, streaming: true },
};
const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  provider: PROVIDER,
  model: MODEL,
  messages: [{ role: 'user', content: 'hi' }],
  ...over,
});

describe('mapUsage', () => {
  it('maps input/output + total', () => {
    expect(mapUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
  it('captures cache_read_input_tokens', () => {
    expect(mapUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 70 }).cachedInputTokens).toBe(70);
  });
});

describe('mapStopReason', () => {
  it('maps anthropic reasons to normalized', () => {
    expect(mapStopReason('end_turn')).toBe('stop');
    expect(mapStopReason('max_tokens')).toBe('length');
    expect(mapStopReason('tool_use')).toBe('tool_calls');
    expect(mapStopReason('stop_sequence')).toBe('stop');
    expect(mapStopReason('weird')).toBe('unknown');
  });
});

describe('splitMessages', () => {
  it('hoists system messages to a top-level system string', () => {
    const { system, msgs } = splitMessages([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ]);
    expect(system).toBe('be terse');
    expect(msgs).toEqual([{ role: 'user', content: 'hello' }]);
  });
  it('maps a tool message to a user tool_result block', () => {
    const { msgs } = splitMessages([{ role: 'tool', content: '42', toolCallId: 'call_1' }]);
    expect(msgs[0]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '42' }] });
  });
  it('replays an assistant turn that called tools as tool_use blocks (agent loop)', () => {
    const { msgs } = splitMessages([
      { role: 'user', content: 'open reddit' },
      { role: 'assistant', content: 'On it.', toolCalls: [{ id: 'tu_1', name: 'navigate', arguments: { url: 'https://reddit.com' } }] },
      { role: 'tool', content: 'ok', toolCallId: 'tu_1' },
    ]);
    // assistant turn carries text + the tool_use block (id matches the result).
    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        { type: 'tool_use', id: 'tu_1', name: 'navigate', input: { url: 'https://reddit.com' } },
      ],
    });
    expect(msgs[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }]);
  });
  it('omits an empty text block when the assistant turn is tool-only', () => {
    const { msgs } = splitMessages([{ role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'read_dom', arguments: {} }] }]);
    expect(msgs[0].content).toEqual([{ type: 'tool_use', id: 't', name: 'read_dom', input: {} }]);
  });
});

describe('buildRequest', () => {
  it('targets /v1/messages with x-api-key + anthropic-version and required max_tokens', () => {
    const wire = adapter.buildRequest(req(), 'sk-ant-xyz');
    expect(wire.url).toBe('https://api.anthropic.com/v1/messages');
    expect(wire.headers['x-api-key']).toBe('sk-ant-xyz');
    expect(wire.headers['anthropic-version']).toBe('2023-06-01');
    expect(wire.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(wire.body);
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.max_tokens).toBe(32_000); // falls back to model.maxOutputTokens
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
  it('puts system at top level and steers JSON when jsonMode is set', () => {
    const wire = adapter.buildRequest(
      req({ messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'go' }], params: { jsonMode: true, maxOutputTokens: 1000 } }),
      'k',
    );
    const body = JSON.parse(wire.body);
    expect(body.max_tokens).toBe(1000);
    expect(body.system).toContain('sys');
    expect(body.system).toMatch(/ONLY valid JSON/);
  });
  it('omits x-api-key when no key is provided', () => {
    const wire = adapter.buildRequest(req(), undefined);
    expect(wire.headers['x-api-key']).toBeUndefined();
  });
});

describe('parseResponse', () => {
  it('concatenates text blocks + maps usage/stop_reason', () => {
    const r = adapter.parseResponse(
      { content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 }, model: 'claude-opus-4-8' },
      MODEL,
    );
    expect(r.text).toBe('Hello world');
    expect(r.finishReason).toBe('stop');
    expect(r.usage.totalTokens).toBe(5);
  });
  it('extracts tool_use blocks as tool calls', () => {
    const r = adapter.parseResponse({ content: [{ type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'cats' } }], stop_reason: 'tool_use' }, MODEL);
    expect(r.toolCalls).toEqual([{ id: 'tu_1', name: 'search', arguments: { q: 'cats' } }]);
    expect(r.finishReason).toBe('tool_calls');
  });
});

describe('parseStreamChunk', () => {
  it('reads text_delta', () => {
    expect(adapter.parseStreamChunk({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }, MODEL)).toEqual({ textDelta: 'hi' });
  });
  it('reads message_delta stop + usage', () => {
    const d = adapter.parseStreamChunk({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }, MODEL);
    expect(d?.finishReason).toBe('stop');
    expect(d?.usage?.outputTokens).toBe(7);
  });
  it('ignores non-data events', () => {
    expect(adapter.parseStreamChunk({ type: 'content_block_start' }, MODEL)).toBeNull();
  });
});

describe('mapToolsToWire', () => {
  it('maps to Anthropic input_schema format', () => {
    expect(adapter.mapToolsToWire([{ name: 'f', description: 'd', parameters: { type: 'object' } }])).toEqual([
      { name: 'f', description: 'd', input_schema: { type: 'object' } },
    ]);
  });
});
