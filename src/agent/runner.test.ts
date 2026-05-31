// Unit tests for runAgentTask: the no-key short-circuit and TOOL_EXEC routing.
// A mock `send` stands in for chrome.runtime.sendMessage so no real SW is hit.

import { describe, it, expect, vi } from 'vitest';
import { runAgentTask, runPlainChat, buildCallSkillTool, askUserToolHandler, buildVisionFallback, classifyFileError } from './runner';
import type { AgentEvent } from './types';
import type { Skill } from '../skills/types';

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

  // Decompose phase (Phase 2). The decomposer is gated behind decompose:true.
  const llmResult = (text: string, toolCalls: unknown[] = []) => ({
    type: 'LLM_GENERATE',
    ok: true,
    result: { text, toolCalls, finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0.001 } },
  });

  it('decompose:true but the floor opts out → runs the single loop unchanged', async () => {
    let decomposerCalls = 0;
    const send = mockSend({
      KEY_STATUS: () => ({ type: 'KEY_STATUS', hasKey: true }),
      SKILL_LIST: () => ({ type: 'SKILL_LIST', skills: [] }),
      LLM_GENERATE: (msg) => {
        const sys = String((msg.messages as { role: string; content: string }[])?.[0]?.content ?? '');
        if (sys.includes('Decomposer')) { decomposerCalls += 1; return llmResult(JSON.stringify({ subtasks: [] })); }
        if (sys.includes('Planner')) return llmResult(JSON.stringify({ steps: [{ intent: 'read the page' }] }));
        return llmResult('', [{ id: 'c1', name: 'read_dom', arguments: {} }]);
      },
      TOOL_EXEC: (msg) => ({ type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { tool: msg.tool }, meta: { provenance: ['https://acme.com'] } } }),
    });
    const events: AgentEvent[] = [];
    const result = await runAgentTask('summarize this page', {
      onEvent: (e) => events.push(e), onConfirm: async () => ({ approved: true }), send, decompose: true,
    });
    expect(decomposerCalls).toBe(1); // the decompose call DID run…
    expect(result.outcome).not.toBe('no-key');
    expect(events.some((e) => e.type === 'tool_call' && e.call.name === 'read_dom')).toBe(true); // …then floored to the single loop
  });

  it('decompose:true with 2 sub-tasks drains them sequentially and composes one answer', async () => {
    const subtaskGoals: string[] = [];
    const send = mockSend({
      KEY_STATUS: () => ({ type: 'KEY_STATUS', hasKey: true }),
      SKILL_LIST: () => ({ type: 'SKILL_LIST', skills: [] }),
      LLM_GENERATE: (msg) => {
        const messages = (msg.messages as { role: string; content: string }[]) ?? [];
        const sys = String(messages[0]?.content ?? '');
        const user = String(messages[messages.length - 1]?.content ?? '');
        if (sys.includes('Decomposer')) return llmResult(JSON.stringify({ subtasks: [{ goal: 'research', role: 'researcher' }, { goal: 'compile', role: 'summarizer' }] }));
        if (sys.includes('Composer')) return llmResult('FINAL: research + compile combined');
        if (sys.includes('Planner')) { subtaskGoals.push(user); return llmResult(JSON.stringify({ steps: [{ intent: 'do it' }] })); }
        // Sub-task executor: answer directly (no tool) so the step synthesizes.
        return llmResult('sub-result');
      },
      TOOL_EXEC: () => ({ type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {} } }),
    });
    const events: AgentEvent[] = [];
    const result = await runAgentTask('research pricing then compile a table', {
      onEvent: (e) => events.push(e), onConfirm: async () => ({ approved: true }), send, decompose: true,
    });
    expect(result.state?.finalAnswer).toBe('FINAL: research + compile combined');
    // Both sub-tasks ran (two planner calls), carrying their role + goal.
    expect(subtaskGoals.some((g) => g.includes('research'))).toBe(true);
    expect(subtaskGoals.some((g) => g.includes('compile'))).toBe(true);
    // Exactly one top-level done (the composed answer), not one per sub-task.
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
  });
});

describe('buildCallSkillTool', () => {
  const skill: Skill = {
    id: 'skill_1',
    name: 'Headline grabber',
    description: 'Extract the main headline of the page',
    kind: 'agent',
    prompt: 'Read the page and return its main headline.',
    createdAt: 1,
  };

  it('lists available skills in the description', () => {
    const tool = buildCallSkillTool([skill]);
    expect(tool.name).toBe('call_skill');
    expect(tool.description).toContain('skill_1');
    expect(tool.description).toContain('Headline grabber');
  });

  it('returns the matched skill prompt as instructions', async () => {
    const tool = buildCallSkillTool([skill]);
    const res = await tool.handler({ skillId: 'skill_1' }, {} as never);
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.data as { instructions: string }).instructions).toContain('main headline');
  });

  it('errors for an unknown skill id', async () => {
    const tool = buildCallSkillTool([skill]);
    const res = await tool.handler({ skillId: 'nope' }, {} as never);
    expect(res.ok).toBe(false);
  });
});

describe('askUserToolHandler', () => {
  it('passes the question/choices to the resolver and returns the answer', async () => {
    let seen: { question: string; choices?: string[] } | undefined;
    const handler = askUserToolHandler(async (req) => {
      seen = req;
      return 'blue';
    });
    const res = await handler({ question: 'Which color?', choices: ['red', 'blue'] });
    expect(seen).toEqual({ question: 'Which color?', choices: ['red', 'blue'] });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.data as { answer: string }).answer).toBe('blue');
  });

  it('errors when no resolver or no question', async () => {
    expect((await askUserToolHandler(undefined)({ question: 'x' })).ok).toBe(false);
    expect((await askUserToolHandler(async () => 'a')({})).ok).toBe(false);
  });
});

describe('buildVisionFallback', () => {
  it('captures the tab and sends the screenshot as an image to the model', async () => {
    let llmMsg: { messages?: { role: string; content: unknown }[] } | undefined;
    const send = vi.fn(async (m: unknown) => {
      const t = (m as { type?: string }).type;
      if (t === 'TOOL_EXEC') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { dataUrl: 'data:image/png;base64,AAAA' } } };
      }
      if (t === 'LLM_GENERATE') {
        llmMsg = m as { messages: { role: string; content: unknown }[] };
        return { type: 'LLM_GENERATE', ok: true, result: { text: 'I can see a login form.', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'm', cost: { totalCost: 0.001 } } };
      }
      return undefined;
    });

    const hook = buildVisionFallback(send, 'gemini-2.5-flash');
    const res = await hook({ runId: 'r', step: 1, intent: 'Find the login form' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.data as { text: string }).text).toContain('login form');
      expect(res.meta?.visionUsed).toBe(true);
    }
    // The LLM call carried an image content part (the screenshot).
    const userMsg = llmMsg?.messages?.find((m) => m.role === 'user');
    const parts = userMsg?.content as { type: string; imageUrl?: string }[];
    expect(parts.some((p) => p.type === 'image' && p.imageUrl?.startsWith('data:image'))).toBe(true);
  });

  it('errors when the screenshot fails', async () => {
    const send = vi.fn(async () => ({ type: 'TOOL_EXEC', ok: true, result: { ok: false, error: { code: 'undriveable', message: 'no' } } }));
    const res = await buildVisionFallback(send, 'm')({ runId: 'r', step: 1, intent: 'x' });
    expect(res.ok).toBe(false);
  });
});

describe('runPlainChat history injection', () => {
  // Regression guard for the "amnesic chat" bug — prior turns must be
  // forwarded as proper chat messages so follow-ups can reference earlier
  // context. The non-streaming fallback path is exercised here (no Port).
  it('inserts prior user/assistant turns between system messages and the new user prompt', async () => {
    let captured: { role: string; content: unknown }[] | undefined;
    const send = vi.fn(async (msg: unknown) => {
      const m = msg as { type?: string; messages?: { role: string; content: unknown }[] };
      if (m.type === 'KEY_STATUS') return { type: 'KEY_STATUS', hasKey: true };
      if (m.type === 'LLM_GENERATE') {
        captured = m.messages;
        return {
          type: 'LLM_GENERATE',
          ok: true,
          result: { text: 'ack', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } },
        };
      }
      return undefined;
    });

    const res = await runPlainChat('and what about Y?', {
      send,
      context: 'page: https://acme.com — Acme homepage',
      history: [
        { role: 'user', content: 'tell me about X' },
        { role: 'assistant', content: 'X is a thing.' },
      ],
    });

    expect(res.outcome).toBe('ok');
    expect(captured).toBeDefined();
    const roles = captured!.map((m) => m.role);
    // Order: system (PLAIN_CHAT_SYSTEM), system (context), user (prior), assistant (prior), user (new).
    expect(roles).toEqual(['system', 'system', 'user', 'assistant', 'user']);
    expect(captured![2].content).toBe('tell me about X');
    expect(captured![3].content).toBe('X is a thing.');
    expect(captured![4].content).toBe('and what about Y?');
  });

  it('drops empty history entries (streaming placeholders mid-flight should not pollute history)', async () => {
    let captured: { role: string; content: unknown }[] | undefined;
    const send = vi.fn(async (msg: unknown) => {
      const m = msg as { type?: string; messages?: { role: string; content: unknown }[] };
      if (m.type === 'KEY_STATUS') return { type: 'KEY_STATUS', hasKey: true };
      if (m.type === 'LLM_GENERATE') {
        captured = m.messages;
        return { type: 'LLM_GENERATE', ok: true, result: { text: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return undefined;
    });

    await runPlainChat('hello again', {
      send,
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: '   ' }, // whitespace-only — drop
        { role: 'assistant', content: '' },    // empty — drop
      ],
    });

    expect(captured!.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(captured![1].content).toBe('first');
    expect(captured![2].content).toBe('hello again');
  });
});

describe('classifyFileError', () => {
  // Locks the rule that prevents the agent from infinitely retrying
  // missing-config errors. 'not-found' → validator returns 'failed' → no
  // retry. 'runtime-error' → validator returns 'needs-retry' → retry.
  it('maps "No root folder set" to not-found (no retry)', () => {
    expect(classifyFileError('No root folder set. Choose one in Settings.')).toBe('not-found');
  });
  it('maps "access expired" (any phrasing) to not-found (no retry)', () => {
    expect(classifyFileError('Folder access expired. Open Settings and reconnect.')).toBe('not-found');
    expect(classifyFileError('ACCESS EXPIRED — re-approve.')).toBe('not-found');
  });
  it('falls back to runtime-error for genuinely transient failures', () => {
    expect(classifyFileError('Network timeout while reading file')).toBe('runtime-error');
    expect(classifyFileError('TypeError: x is undefined')).toBe('runtime-error');
  });
});
