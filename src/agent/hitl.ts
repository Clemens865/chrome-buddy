// HITL confirmation gate (FR-HITL-1..7; NFR-SEC-6).
//
// The 100% gate, no bypass. Before ANY consequential action executes, the
// runtime calls `gateConsequentialAction`, which emits a `confirmation_required`
// event and AWAITS an approval resolver. Approve → run (optionally with edited
// args, FR-HITL-3/6); Deny → skip + record. This module is a pure resolver
// pattern: it owns no UI and performs no I/O beyond the injected callbacks.
//
// Page-derived content is untrusted and can never silently invoke a
// consequential tool — the gate always fires regardless of who proposed the
// call (NFR-SEC-6, prompt-injection guard).

import type { NormalizedToolCall } from '../llm';
import type { ToolDefinition } from '../tools';
import type { AgentEvent, ApprovalDecision } from './types';

/**
 * An async approval resolver supplied by the caller (panel UI, scheduled-run
 * pauser, etc.). It receives the pending call + a human summary and resolves
 * with the user's decision. For unattended runs this should hard-pause and
 * notify rather than auto-resolve (FR-HITL-5).
 */
export type ApprovalResolver = (request: {
  runId: string;
  step: number;
  call: NormalizedToolCall;
  summary: string;
}) => Promise<ApprovalDecision>;

/** Build a concise, human-readable summary of the action's payload/target. */
export function summarizeAction(call: NormalizedToolCall): string {
  let argsText: string;
  try {
    argsText = JSON.stringify(call.arguments);
  } catch {
    argsText = '[unserializable arguments]';
  }
  // Keep the summary bounded; the full payload is on the event for the card.
  const trimmed = argsText.length > 500 ? `${argsText.slice(0, 500)}…` : argsText;
  return `${call.name}(${trimmed})`;
}

/** The decision the gate returns to the runtime after evaluating a call. */
export type GateOutcome =
  | { kind: 'execute'; args: Record<string, unknown> }
  | { kind: 'skip-denied' }
  | { kind: 'pass-through' };

/**
 * Run the HITL gate for one proposed tool call.
 *
 * - Non-consequential tools pass straight through (no gate, no event).
 * - Consequential tools emit `confirmation_required` and AWAIT the resolver.
 *   Approve → `execute` (with any edited args). Deny → `skip-denied`.
 *
 * There is no code path that executes a consequential tool without first
 * awaiting an explicit approval (FR-HITL-1).
 */
export async function gateConsequentialAction(params: {
  runId: string;
  step: number;
  def: ToolDefinition | undefined;
  call: NormalizedToolCall;
  emit: (event: AgentEvent) => void;
  resolve: ApprovalResolver;
}): Promise<GateOutcome> {
  const { runId, step, def, call, emit, resolve } = params;

  // Unknown tool, or a non-side-effecting one: no confirmation needed here.
  // (The registry still independently enforces the gate on invoke.)
  if (!def || !def.consequential) {
    return { kind: 'pass-through' };
  }

  const summary = summarizeAction(call);
  emit({ type: 'confirmation_required', runId, step, call, summary });

  const decision = await resolve({ runId, step, call, summary });
  if (!decision.approved) {
    return { kind: 'skip-denied' };
  }
  return { kind: 'execute', args: decision.editedArgs ?? call.arguments };
}
