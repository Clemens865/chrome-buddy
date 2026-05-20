// Unit tests for runAgentTask: the no-key short-circuit and TOOL_EXEC routing.
// A mock `send` stands in for chrome.runtime.sendMessage so no real SW is hit.

import { describe, it, expect, vi } from 'vitest';
import { runAgentTask } from './runner';
import type { AgentEvent } from './types';

/** A minimal mock transport keyed by message type. */
function mockSend(handlers: Partial<Record<string, (msg: Record<string, unknown>) => unknown>>) {
  return vi.fn(async (msg: unknown) => {
    const type = (msg as { type?: string }).type ?? '';
    const handler = handlers[type];
    return handler ? handler(msg as Record<string, unknown>) : undefined;
  });
}

describe('runAgentTask', () => {
  it('returns outcome "no-key" and emits nothing when KEY_STATUS is unset', async () => {
    const send = mockSend({
      KEY_STATUS: () => ({ type: 'KEY_STATUS', hasKey: false }),
    });
    const events: AgentEvent[] = [];
    const result = await runAgentTask('do something', {
      onEvent: (e) => events.push(e),
      onConfirm: async () => ({ approved: false }),
      send,
    });
    expect(result.outcome).toBe('no-key');
    expect(events).toHaveLength(0);
    // Only the KEY_STATUS probe should have been sent.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('runs the loop and routes a page tool through TOOL_EXEC when a key is set', async () => {
    const send = mockSend({
      KEY_STATUS: () => ({ type: 'KEY_STATUS', hasKey: true }),
      LLM_GENERATE: (() => {
        let i = 0;
        const queue = [
          // plan
          { text: JSON.stringify({ steps: [{ intent: 'read the page' }] }), toolCalls: [] },
          // executor → propose read_dom
          { text: '', toolCalls: [{ id: 'c1', name: 'read_dom', arguments: {} }] },
        ];
        return () => {
          const r = queue[Math.min(i, queue.length - 1)];
          i += 1;
          return {
            type: 'LLM_GENERATE',
            ok: true,
            result: {
              ...r,
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              model: 'mock',
              cost: { totalCost: 0.001 },
            },
          };
        };
      })(),
      TOOL_EXEC: (msg) => ({
        type: 'TOOL_EXEC',
        ok: true,
        result: { ok: true, data: { tool: msg.tool }, meta: { provenance: ['https://acme.com'] } },
      }),
    });

    const events: AgentEvent[] = [];
    const result = await runAgentTask('summarize this page', {
      onEvent: (e) => events.push(e),
      onConfirm: async () => ({ approved: true }),
      send,
    });

    expect(result.outcome).not.toBe('no-key');
    expect(events.some((e) => e.type === 'plan')).toBe(true);
    expect(events.some((e) => e.type === 'tool_call' && e.call.name === 'read_dom')).toBe(true);
    // A TOOL_EXEC for read_dom must have been routed to the background.
    const toolExecCalls = send.mock.calls.filter(([m]) => (m as { type?: string }).type === 'TOOL_EXEC');
    expect(toolExecCalls.length).toBeGreaterThanOrEqual(1);
    expect((toolExecCalls[0][0] as { tool: string }).tool).toBe('read_dom');
  });
});
