import { describe, it, expect } from 'vitest';
import { mapUsage, OpenAICompatibleAdapter } from './openaiCompatible';
import type { GenerateRequest, ModelConfig } from '../types';

describe('mapUsage', () => {
  it('maps prompt/completion/total tokens', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it('captures cached_tokens via prompt_tokens_details', () => {
    const out = mapUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 70 },
    });
    expect(out.cachedInputTokens).toBe(70);
  });

  it('captures thinking tokens via completion_tokens_details.reasoning_tokens', () => {
    const out = mapUsage({
      prompt_tokens: 50,
      completion_tokens: 120,
      total_tokens: 170,
      completion_tokens_details: { reasoning_tokens: 80 },
    });
    expect(out.thoughtsTokens).toBe(80);
    // Thinking tokens are INCLUDED in the output total (billed at output rate);
    // we just surface them separately for the ledger UI.
    expect(out.outputTokens).toBe(120);
  });

  it('handles missing usage cleanly', () => {
    expect(mapUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });
});

// Minimal ModelConfig fixture for adapter tests.
const TEST_MODEL = {
  id: 'gemini-3.5-flash',
  provider: { id: 'google-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', auth: { method: 'bearer' } },
  pricing: { inputPerMTok: 1.5, outputPerMTok: 9 },
  capabilities: {},
} as unknown as ModelConfig;

describe('OpenAICompatibleAdapter — Gemini 3 thought-signature round-trip (F3)', () => {
  const adapter = new OpenAICompatibleAdapter();

  it('parseToolCalls captures extra_content.google.thought_signature', () => {
    const payload = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'tc_1',
                function: { name: 'click', arguments: '{"selector":"#btn"}' },
                extra_content: { google: { thought_signature: 'SIG-OPAQUE-1' } },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const res = adapter.parseResponse(payload, TEST_MODEL);
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].id).toBe('tc_1');
    expect(res.toolCalls[0].thoughtSignature).toBe('SIG-OPAQUE-1');
  });

  it('buildRequest echoes thoughtSignature back on prior assistant tool_calls', () => {
    const req: GenerateRequest = {
      provider: TEST_MODEL.provider as unknown as GenerateRequest['provider'],
      model: TEST_MODEL,
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'click', arguments: { selector: '#btn' }, thoughtSignature: 'SIG-OPAQUE-1' }],
        },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'tc_1', name: 'click' },
      ],
    };
    const wire = adapter.buildRequest(req, 'fake-key');
    const body = JSON.parse(wire.body as string) as { messages: Array<Record<string, unknown>> };
    const assistant = body.messages[0] as { tool_calls?: Array<{ id: string; extra_content?: { google?: { thought_signature?: string } } }> };
    expect(assistant.tool_calls?.[0]?.extra_content?.google?.thought_signature).toBe('SIG-OPAQUE-1');
  });
});

describe('OpenAICompatibleAdapter — thinking-level plumbing (H2)', () => {
  const adapter = new OpenAICompatibleAdapter();

  it('attaches extra_body.google.thinking_config (thinking_level) for Gemini 3 ids', () => {
    const req: GenerateRequest = {
      provider: TEST_MODEL.provider as unknown as GenerateRequest['provider'],
      model: TEST_MODEL, // id: 'gemini-3.5-flash'
      messages: [{ role: 'user', content: 'hi' }],
      params: { thinking: 'low' },
    };
    const wire = adapter.buildRequest(req, 'k');
    const body = JSON.parse(wire.body as string) as { extra_body?: { google?: { thinking_config?: Record<string, unknown> } } };
    expect(body.extra_body?.google?.thinking_config).toEqual({ thinking_level: 'low' });
  });

  it('attaches thinking_budget for Gemini 2.5 ids (level → int)', () => {
    const model25 = { ...TEST_MODEL, id: 'gemini-2.5-flash' } as unknown as ModelConfig;
    const req: GenerateRequest = {
      provider: TEST_MODEL.provider as unknown as GenerateRequest['provider'],
      model: model25,
      messages: [{ role: 'user', content: 'hi' }],
      params: { thinking: 'minimal' },
    };
    const wire = adapter.buildRequest(req, 'k');
    const body = JSON.parse(wire.body as string) as { extra_body?: { google?: { thinking_config?: Record<string, unknown> } } };
    expect(body.extra_body?.google?.thinking_config).toEqual({ thinking_budget: 0 });
  });

  it('omits extra_body entirely when no thinking level is set', () => {
    const req: GenerateRequest = {
      provider: TEST_MODEL.provider as unknown as GenerateRequest['provider'],
      model: TEST_MODEL,
      messages: [{ role: 'user', content: 'hi' }],
    };
    const wire = adapter.buildRequest(req, 'k');
    const body = JSON.parse(wire.body as string) as { extra_body?: unknown };
    expect(body.extra_body).toBeUndefined();
  });
});

describe('OpenAICompatibleAdapter — id+name pairing on tool messages (F4)', () => {
  const adapter = new OpenAICompatibleAdapter();
  it('tool-role messages carry BOTH tool_call_id and name', () => {
    const req: GenerateRequest = {
      provider: TEST_MODEL.provider as unknown as GenerateRequest['provider'],
      model: TEST_MODEL,
      messages: [{ role: 'tool', content: '{"ok":true}', toolCallId: 'tc_42', name: 'read_file' }],
    };
    const wire = adapter.buildRequest(req, 'fake-key');
    const body = JSON.parse(wire.body as string) as { messages: Array<{ tool_call_id?: string; name?: string }> };
    expect(body.messages[0].tool_call_id).toBe('tc_42');
    expect(body.messages[0].name).toBe('read_file');
  });

  it('falls back to mirroring the id as name when the caller omits it (no 400)', () => {
    const req: GenerateRequest = {
      provider: TEST_MODEL.provider as unknown as GenerateRequest['provider'],
      model: TEST_MODEL,
      messages: [{ role: 'tool', content: '{}', toolCallId: 'tc_99' }],
    };
    const wire = adapter.buildRequest(req, 'fake-key');
    const body = JSON.parse(wire.body as string) as { messages: Array<{ tool_call_id?: string; name?: string }> };
    expect(body.messages[0].tool_call_id).toBe('tc_99');
    expect(body.messages[0].name).toBe('tc_99');
  });
});
