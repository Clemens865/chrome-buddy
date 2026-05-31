// Unit tests for the PURE AgentEvent → transcript reducer.

import { describe, it, expect } from 'vitest';
import { reduceTranscript, resolveConfirmation, userItem, type TranscriptItem } from './transcript';
import type { AgentEvent } from './types';
import type { NormalizedToolCall } from '../llm';
import { ok } from '../types';

const call = (name: string, args: Record<string, unknown> = {}, id = name): NormalizedToolCall => ({
  id,
  name,
  arguments: args,
});

function fold(events: AgentEvent[], seed: TranscriptItem[] = []): TranscriptItem[] {
  return events.reduce(reduceTranscript, seed);
}

describe('reduceTranscript', () => {
  it('seeds a user bubble and appends a plan', () => {
    const items = fold([{ type: 'plan', runId: 'r', plan: [{ index: 1, intent: 'do it' }] }], [
      userItem('u1', 'hello'),
    ]);
    expect(items[0]).toMatchObject({ kind: 'user', text: 'hello' });
    expect(items[1]).toMatchObject({ kind: 'plan' });
  });

  it('renders a tool call as running, then resolves it to done on step_result', () => {
    const items = fold([
      { type: 'tool_call', runId: 'r', step: 1, call: call('read_dom') },
      { type: 'step_result', runId: 'r', step: 1, verdict: 'succeeded', result: ok({}) },
    ]);
    const tool = items.find((i) => i.kind === 'tool');
    expect(tool).toMatchObject({ kind: 'tool', status: 'done', verdict: 'succeeded' });
  });

  it('marks a denied step_result as denied', () => {
    const items = fold([
      { type: 'tool_call', runId: 'r', step: 2, call: call('send_webhook') },
      { type: 'step_result', runId: 'r', step: 2, verdict: 'failed', denied: true },
    ]);
    const tool = items.find((i) => i.kind === 'tool');
    expect(tool).toMatchObject({ status: 'denied' });
  });

  it('emits a confirmation item and lets resolveConfirmation mark it resolved', () => {
    let items = fold([
      {
        type: 'confirmation_required',
        runId: 'r',
        step: 1,
        call: call('send_webhook', {}, 'c1'),
        summary: 'send_webhook({})',
      },
    ]);
    const confirm = items.find((i) => i.kind === 'confirm');
    expect(confirm).toMatchObject({ kind: 'confirm' });
    expect(confirm && confirm.kind === 'confirm' ? confirm.resolution : 'x').toBeUndefined();

    items = resolveConfirmation(items, 'r', 1, 'c1', 'approved');
    expect(items.find((i) => i.kind === 'confirm')).toMatchObject({ resolution: 'approved' });

    // A different run's approval at the SAME step/callId must NOT resolve this card.
    items = resolveConfirmation(items, 'other-run', 1, 'c1', 'denied');
    expect(items.find((i) => i.kind === 'confirm')).toMatchObject({ resolution: 'approved' });
  });

  it('renders a sub-task section header and flips it to done on result', () => {
    let items = fold([
      { type: 'subtask_start', runId: 'dec1', subId: 'st1', goal: 'research pricing', role: 'researcher' },
    ]);
    const sub = items.find((i) => i.kind === 'subtask');
    expect(sub).toMatchObject({ kind: 'subtask', goal: 'research pricing', role: 'researcher', status: 'running' });

    items = fold(
      [{ type: 'subtask_result', runId: 'dec1', subId: 'st1', status: 'done', digest: 'found it' }],
      items,
    );
    expect(items.filter((i) => i.kind === 'subtask')).toHaveLength(1); // updated, not duplicated
    expect(items.find((i) => i.kind === 'subtask')).toMatchObject({ status: 'done' });
  });

  it('appends the final answer on done without duplicating a prior partial body', () => {
    const final = 'all done';
    const items = fold([
      { type: 'partial', runId: 'r', text: final },
      {
        type: 'done',
        runId: 'r',
        outcome: 'partial',
        finalAnswer: final,
        cost: 0,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    ]);
    expect(items.filter((i) => i.kind === 'agent')).toHaveLength(1);
  });

  it('appends an error item', () => {
    const items = fold([{ type: 'error', runId: 'r', message: 'boom' }]);
    expect(items[0]).toMatchObject({ kind: 'error', text: 'boom' });
  });
});
