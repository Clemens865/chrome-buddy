// Unit tests for the AgentRuntime loop, HITL gate, and budget caps.
// Drives the runtime with a MOCK LlmClient (scripted plan + tool calls then a
// final answer) and a real ToolRegistry holding MOCK tools.

import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../tools';
import { ok } from '../types';
import type { NormalizedResponse, NormalizedToolCall } from '../llm';
import { AgentRuntime } from './runtime';
import type { RuntimeLlm } from './runtime';
import type { ApprovalResolver } from './hitl';
import type { AgentEvent } from './types';

type Gen = NormalizedResponse & { cost: { totalCost: number } };

function resp(partial: Partial<Gen>): Gen {
  return {
    text: '',
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: 'mock',
    cost: { totalCost: 0.001 },
    ...partial,
  };
}

function call(name: string, args: Record<string, unknown> = {}, id = name): NormalizedToolCall {
  return { id, name, arguments: args };
}

/** A scripted LLM that returns queued responses in order. */
function scriptedLlm(queue: Gen[]): RuntimeLlm {
  let i = 0;
  return {
    generate: vi.fn(async () => {
      const next = queue[Math.min(i, queue.length - 1)];
      i += 1;
      return next;
    }),
  };
}

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const readHandler = vi.fn(async () => ok({ text: 'page content' }, { provenance: ['https://acme.com'] }));
  const sendHandler = vi.fn(async () => ok({ sent: true }));
  registry.register({
    name: 'read_dom',
    description: 'Read the page DOM.',
    paramsSchema: { type: 'object', properties: {} },
    consequential: false,
    handler: readHandler,
  });
  registry.register({
    name: 'send_webhook',
    description: 'POST to an external webhook.',
    paramsSchema: { type: 'object', properties: {} },
    consequential: true,
    handler: sendHandler,
  });
  return registry;
}

const planResp = (intents: string[]) =>
  resp({ text: JSON.stringify({ steps: intents.map((intent) => ({ intent })) }) });

describe('AgentRuntime', () => {
  it('runs the plan→act→observe loop and completes', async () => {
    const registry = makeRegistry();
    const llm = scriptedLlm([
      planResp(['Read the page', 'Finish']),
      resp({ toolCalls: [call('read_dom')] }), // step 1 proposes a tool call
      resp({ text: 'done' }), // step 2 proposes no tool → succeeds
    ]);
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime({
      llm,
      registry,
      approve: async () => ({ approved: true }),
      onEvent: (e) => events.push(e),
      newRunId: () => 'run_test',
    });

    const state = await runtime.run('test task', { stepBudget: 20, costBudget: 1 });

    expect(state.outcome).toBe('completed');
    expect(events.find((e) => e.type === 'plan')).toBeTruthy();
    expect(events.filter((e) => e.type === 'step_start')).toHaveLength(2);
    expect(events.some((e) => e.type === 'tool_call')).toBe(true);
    expect(state.scratchpad.completedSteps).toEqual([1, 2]);
    expect(state.scratchpad.provenance).toContain('https://acme.com');
  });

  it('fires confirmation_required for consequential tools and does NOT execute until approved', async () => {
    const registry = makeRegistry();
    const sendDef = registry.get('send_webhook')!;
    const sendHandler = sendDef.handler as ReturnType<typeof vi.fn>;

    const llm = scriptedLlm([
      planResp(['Send the webhook']),
      resp({ toolCalls: [call('send_webhook', { url: 'https://x.test' })] }),
    ]);

    const order: string[] = [];
    const approve: ApprovalResolver = vi.fn(async () => {
      // The handler must NOT have run before approval resolves.
      order.push('approve-called');
      expect(sendHandler).not.toHaveBeenCalled();
      return { approved: true };
    });

    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime({
      llm,
      registry,
      approve,
      onEvent: (e) => events.push(e),
    });

    await runtime.run('send it', { stepBudget: 10, costBudget: 1 });

    const confirm = events.find((e) => e.type === 'confirmation_required');
    expect(confirm).toBeTruthy();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(sendHandler).toHaveBeenCalledTimes(1); // executed only AFTER approval
    expect(order).toEqual(['approve-called']);
  });

  it('denies a consequential action: skips execution and records denial', async () => {
    const registry = makeRegistry();
    const sendHandler = registry.get('send_webhook')!.handler as ReturnType<typeof vi.fn>;

    const llm = scriptedLlm([
      planResp(['Send the webhook']),
      resp({ toolCalls: [call('send_webhook')] }),
    ]);
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime({
      llm,
      registry,
      approve: async () => ({ approved: false }),
      onEvent: (e) => events.push(e),
    });

    const state = await runtime.run('send it', { stepBudget: 10, costBudget: 1 });

    expect(sendHandler).not.toHaveBeenCalled();
    expect(state.scratchpad.actions.some((a) => a.denied)).toBe(true);
    expect(state.outcome).toBe('partial');
    const denied = events.find((e) => e.type === 'step_result' && e.denied);
    expect(denied).toBeTruthy();
  });

  it('caps the run when the cost budget is exceeded', async () => {
    const registry = makeRegistry();
    // Each generate costs 0.6; planning alone already exceeds a 0.5 budget.
    const expensive = (g: Gen): Gen => ({ ...g, cost: { totalCost: 0.6 } });
    const llm = scriptedLlm([
      expensive(planResp(['Step one', 'Step two'])),
      expensive(resp({ toolCalls: [call('read_dom')] })),
    ]);
    const runtime = new AgentRuntime({
      llm,
      registry,
      approve: async () => ({ approved: true }),
    });

    const state = await runtime.run('task', { stepBudget: 50, costBudget: 0.5 });

    expect(state.outcome).toBe('budget-exceeded');
    expect(state.costUsed).toBeGreaterThanOrEqual(0.5);
  });

  it('caps the run when the step budget is exhausted', async () => {
    const registry = makeRegistry();
    const llm = scriptedLlm([
      planResp(['a', 'b', 'c', 'd']),
      resp({ toolCalls: [call('read_dom')] }),
    ]);
    const runtime = new AgentRuntime({
      llm,
      registry,
      approve: async () => ({ approved: true }),
    });

    const state = await runtime.run('task', { stepBudget: 2, costBudget: 100 });

    expect(state.outcome).toBe('budget-exceeded');
    expect(state.stepsUsed).toBeLessThanOrEqual(3);
  });

  it('rejects a tool not in allowedTools without executing it', async () => {
    const registry = makeRegistry();
    const readHandler = registry.get('read_dom')!.handler as ReturnType<typeof vi.fn>;
    const llm = scriptedLlm([
      planResp(['Read']),
      resp({ toolCalls: [call('read_dom')] }),
    ]);
    const runtime = new AgentRuntime({
      llm,
      registry,
      approve: async () => ({ approved: true }),
    });

    const state = await runtime.run('task', {
      stepBudget: 10,
      costBudget: 1,
      allowedTools: ['send_webhook'], // read_dom not allowed
    });

    expect(readHandler).not.toHaveBeenCalled();
    expect(state.outcome).toBe('partial');
  });
});
