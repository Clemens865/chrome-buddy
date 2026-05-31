// PURE AgentEvent → chat transcript reducer (FR-UI-5/7).
//
// The runtime emits a stream of AgentEvents; the chat needs an ordered list of
// renderable items. This module owns NO React and NO I/O — it is a pure fold so
// it can be unit-tested in isolation and reused by any surface.

import type { AgentEvent, PlanStep, StepVerdict } from './types';
import type { NormalizedToolCall } from '../llm';
import type { ToolResult } from '../types';

/** A renderable chat item derived from the user prompt + the event stream. */
export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'plan'; id: string; plan: PlanStep[] }
  | {
      kind: 'tool';
      id: string;
      step: number;
      call: NormalizedToolCall;
      status: 'running' | 'done' | 'denied';
      verdict?: StepVerdict;
      result?: ToolResult;
    }
  | {
      kind: 'confirm';
      id: string;
      /** Owning run — lets the card resolve back to the exact pending call
       *  without colliding across concurrent/nested runs. */
      runId: string;
      step: number;
      call: NormalizedToolCall;
      summary: string;
      /** Set once the user resolves the gate (drives the card's resolved UI). */
      resolution?: 'approved' | 'denied';
    }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'error'; id: string; text: string };

/** A correlation key for a tool item: a tool call is unique by step + callId. */
function toolKey(step: number, callId: string): string {
  return `tool_${step}_${callId}`;
}
/** Confirm cards are correlated by runId + step + callId so concurrent or
 *  nested runs (sub-agents) can't collide on the same key and mis-route an
 *  approval to the wrong pending action. */
function confirmKey(runId: string, step: number, callId: string): string {
  return `confirm_${runId}_${step}_${callId}`;
}

/**
 * Fold an AgentEvent into the running transcript. Returns a NEW array (no
 * mutation) so React state updates stay referentially honest. The optional
 * leading user bubble is seeded by the caller via {@link userItem}.
 */
export function reduceTranscript(items: TranscriptItem[], event: AgentEvent): TranscriptItem[] {
  switch (event.type) {
    case 'plan':
      return [...items, { kind: 'plan', id: `plan_${event.runId}`, plan: event.plan }];

    case 'step_start':
      // Step boundaries are implicit in tool items; no standalone item needed.
      return items;

    case 'tool_call': {
      const id = toolKey(event.step, event.call.id);
      const item: TranscriptItem = {
        kind: 'tool',
        id,
        step: event.step,
        call: event.call,
        status: 'running',
      };
      // De-dupe: a re-proposed identical call replaces its prior pending item.
      return upsert(items, id, item);
    }

    case 'confirmation_required': {
      const id = confirmKey(event.runId, event.step, event.call.id);
      const item: TranscriptItem = {
        kind: 'confirm',
        id,
        runId: event.runId,
        step: event.step,
        call: event.call,
        summary: event.summary,
      };
      return upsert(items, id, item);
    }

    case 'step_result': {
      // Attach the verdict/result to the matching pending tool item, if any.
      const next = items.map((it) => {
        if (it.kind !== 'tool' || it.step !== event.step || it.status !== 'running') return it;
        return {
          ...it,
          status: event.denied ? ('denied' as const) : ('done' as const),
          verdict: event.verdict,
          result: event.result,
        };
      });
      return next;
    }

    case 'partial':
      return [...items, { kind: 'agent', id: `partial_${event.runId}_${items.length}`, text: event.text }];

    case 'done':
      // `partial` already emitted the body for a partial run; avoid duplicating.
      if (lastAgentText(items) === event.finalAnswer) return items;
      return [...items, { kind: 'agent', id: `done_${event.runId}`, text: event.finalAnswer }];

    case 'error':
      return [...items, { kind: 'error', id: `err_${event.runId}_${items.length}`, text: event.message }];

    case 'human_gate':
      // The handoff prompt is rendered by ChatView from the onHumanGate resolver;
      // leave a subtle trace in the transcript for context.
      return [
        ...items,
        {
          kind: 'error',
          id: `gate_${event.runId}_${items.length}`,
          text: `Paused for human ${event.kind === 'captcha' ? 'verification' : 'sign-in'}.`,
        },
      ];

    default: {
      const exhaustive: never = event;
      void exhaustive;
      return items;
    }
  }
}

/** Mark a pending confirmation item resolved (called when the user decides). */
export function resolveConfirmation(
  items: TranscriptItem[],
  runId: string,
  step: number,
  callId: string,
  resolution: 'approved' | 'denied',
): TranscriptItem[] {
  const id = confirmKey(runId, step, callId);
  return items.map((it) => (it.kind === 'confirm' && it.id === id ? { ...it, resolution } : it));
}

/** Build the leading user bubble item for a run. */
export function userItem(id: string, text: string): TranscriptItem {
  return { kind: 'user', id, text };
}

/** Build a plain agent reply item (used by the cheap, tool-less chat path). */
export function agentItem(id: string, text: string): TranscriptItem {
  return { kind: 'agent', id, text };
}

function upsert(items: TranscriptItem[], id: string, item: TranscriptItem): TranscriptItem[] {
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return [...items, item];
  const next = items.slice();
  next[idx] = item;
  return next;
}

function lastAgentText(items: TranscriptItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'agent') return it.text;
  }
  return undefined;
}
