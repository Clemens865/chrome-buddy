// Agent Runtime types (PRD component #2; FR-AGENT-1..17, FR-HITL-1..8).
//
// These describe the plan→act→observe→reflect loop's data: the events it emits,
// the resumable scratchpad it accumulates, the per-run knobs/budgets, and the
// in-flight run state. Pure data + function signatures — no I/O lives here.

import type { NormalizedToolCall, UsageStats } from '../llm';
import type { CostEstimate } from '../llm';
import type { AllowedTools } from '../tools';
import type { ToolResult } from '../types';

/** A single numbered step in the Planner's visible plan (FR-AGENT-2). */
export interface PlanStep {
  /** 1-based step index as shown to the user. */
  index: number;
  /** Human-readable intent the Validator scores results against (FR-AGENT-6). */
  intent: string;
}

/** Validator verdict for an executed step (FR-AGENT-6). */
export type StepVerdict = 'succeeded' | 'failed' | 'needs-retry';

/**
 * One executed tool call plus its outcome, appended to the scratchpad
 * (FR-AGENT-5/7). Captures enough to detect loops (FR-AGENT-12) and to
 * produce a partial-completion report (FR-AGENT-11).
 */
export interface ActionRecord {
  /** The step this action belongs to (1-based). */
  step: number;
  /** Provider call id correlating the tool result (FR-AGENT-4). */
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** The registry's typed result, or undefined when skipped (e.g. denied). */
  result?: ToolResult;
  /** Validator verdict for the action's step. */
  verdict?: StepVerdict;
  /** True when a consequential action was denied at the HITL gate. */
  denied?: boolean;
  /** Source URL(s) for provenance (FR-AGENT-7). */
  provenance?: string[];
}

/**
 * The resumable run scratchpad (FR-AGENT-7/8). Designed to be JSON-serializable
 * so it can be checkpointed to IndexedDB after each step and rehydrated after a
 * service-worker restart (NFR-PERF-7, NFR-REL-3). This module persists nothing
 * itself — persistence is the caller's concern.
 */
export interface Scratchpad {
  /** The originating task prompt. */
  task: string;
  /** The Planner's numbered plan (FR-AGENT-2). */
  plan: PlanStep[];
  /** Chronological action history fed back to avoid loops (FR-AGENT-12). */
  actions: ActionRecord[];
  /** Free-form observations/notes accumulated during the run. */
  notes: string[];
  /** Distinct source URLs gathered, for the final provenance list. */
  provenance: string[];
  /** Steps fully completed, used to skip them on resume (FR-AGENT-8). */
  completedSteps: number[];
}

/** Per-run configuration and caps (FR-AGENT-9; NFR-COST-1). */
export interface RunOptions {
  /** Registry model id for the planner/reflection LLM calls. */
  model?: string;
  /** Hard cap on executed loop steps; on reach, stop and report. */
  stepBudget: number;
  /** Hard cap on accumulated USD spend; on reach, stop and report. */
  costBudget: number;
  /** Per-caller whitelist threaded into every tool invocation (FR-TOOLS-14). */
  allowedTools?: AllowedTools;
  /** Max bounded retries per step before failing it (FR-AGENT-10). */
  maxRetriesPerStep?: number;
  /** Optional cancellation signal for the whole run. */
  signal?: AbortSignal;
  /** Resume a previous run from its checkpointed state (FR-AGENT-8): the saved
   *  plan is reused and already-completed steps are skipped. */
  resume?: RunState;
}

/** Why a run finished. */
export type RunOutcome = 'completed' | 'partial' | 'failed' | 'cancelled' | 'budget-exceeded';

/** Live, mutable state of an in-flight run. */
export interface RunState {
  /** Unique run id (also used as the tool ctx callerId for audit). */
  runId: string;
  scratchpad: Scratchpad;
  /** Steps executed so far (increments per loop iteration). */
  stepsUsed: number;
  /** Accumulated USD spend across all LLM calls this run. */
  costUsed: number;
  /** Accumulated token usage across all LLM calls this run. */
  usage: UsageStats;
  /** Set once the run terminates. */
  outcome?: RunOutcome;
  /** Final assistant answer text, when the run completes. */
  finalAnswer?: string;
}

/**
 * Events streamed to the panel as the run progresses (FR-AGENT-14, FR-UI-5/7).
 * A discriminated union so the UI can switch exhaustively. The runtime emits
 * these via an injected `onEvent` callback (no UI coupling here).
 */
export type AgentEvent =
  | { type: 'plan'; runId: string; plan: PlanStep[] }
  | { type: 'step_start'; runId: string; step: number; intent: string }
  | { type: 'tool_call'; runId: string; step: number; call: NormalizedToolCall }
  | {
      type: 'confirmation_required';
      runId: string;
      step: number;
      call: NormalizedToolCall;
      /** Human description of the exact payload/target (FR-HITL-2). */
      summary: string;
    }
  | {
      type: 'step_result';
      runId: string;
      step: number;
      verdict: StepVerdict;
      result?: ToolResult;
      /** True when the action was denied at the HITL gate. */
      denied?: boolean;
    }
  | { type: 'human_gate'; runId: string; step: number; kind: 'captcha' | 'login' }
  | { type: 'partial'; runId: string; text: string }
  | {
      type: 'done';
      runId: string;
      outcome: RunOutcome;
      finalAnswer: string;
      cost: number;
      usage: UsageStats;
    }
  | { type: 'error'; runId: string; step?: number; message: string };

/** Callback the runtime invokes for every emitted event. */
export type EventSink = (event: AgentEvent) => void;

/**
 * Resolver the HITL gate awaits before executing a consequential action
 * (FR-HITL-1). Returns the user's decision; `approve` may edit the args
 * (FR-HITL-3) / supply a missing target (FR-HITL-6).
 */
export type ApprovalDecision =
  | { approved: true; editedArgs?: Record<string, unknown> }
  | { approved: false };

/**
 * Plan-approval gate (FR-AGENT-3): the runtime surfaces the proposed plan and
 * waits for the user to approve, run an edited plan, or cancel — before any
 * execution begins. Optional: when no approver is supplied the plan auto-runs.
 */
export interface PlanApprovalRequest {
  runId: string;
  plan: PlanStep[];
}
export type PlanDecision =
  | { approved: true; editedPlan?: PlanStep[] }
  | { approved: false };
export type PlanApprover = (req: PlanApprovalRequest) => Promise<PlanDecision>;

/** Re-exported for convenience to consumers of the agent barrel. */
export type { CostEstimate };
