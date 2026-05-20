// Computer Use vision-fallback hook — STUB / interface only (FR-AGENT-13;
// FR-BC-5; FR-LLM-9; FR-HITL-4).
//
// When DOM-first tools (`read_dom`/`extract`) yield nothing usable on a
// JS/canvas widget, the runtime escalates the step to the Computer Use loop:
// captureVisibleTab → model returns a 0–999 coordinate action → Browser Control
// executes it → screenshot back. A Computer Use response may carry
// `safety_decision: "require_confirmation"`, which MUST route through the HITL
// gate and only resend with `safety_acknowledgement: "true"` after approval.
//
// This wave defines the interface and a no-op fallback so the runtime can wire
// the escalation path; the real driver (capture, model loop, action mapping)
// lands in the Browser-Control wave. TODO(browser-control): implement.

import type { ToolResult } from '../types';

/** A single Computer Use action the vision model proposes. */
export interface ComputerUseAction {
  /** Action kind the Browser Control layer will execute. */
  kind: 'click' | 'type' | 'scroll' | 'key' | 'wait';
  /** Normalized 0–999 coordinate space, when positional. */
  x?: number;
  y?: number;
  /** Text to type, for `type`/`key`. */
  text?: string;
  /** Provider safety verdict; require_confirmation must hit the HITL gate. */
  safetyDecision?: 'allow' | 'require_confirmation';
}

/** Input handed to the Computer Use hook when DOM extraction is empty. */
export interface ComputerUseRequest {
  runId: string;
  step: number;
  tabId?: number;
  /** What the step was trying to achieve, for the vision prompt. */
  intent: string;
  signal?: AbortSignal;
}

/**
 * The escalation hook. Implementations capture the tab, run the vision/Computer
 * Use loop honoring `safety_decision`, and return a normalized ToolResult.
 */
export type ComputerUseHook = (req: ComputerUseRequest) => Promise<ToolResult>;

/**
 * Default fallback: not yet wired. Returns a typed `not-implemented` result so
 * the runtime can record the escalation attempt and fail the step gracefully
 * (FR-AGENT-11) rather than throwing. TODO(browser-control): replace with the
 * real capture→model→execute loop.
 */
export const computerUseStub: ComputerUseHook = async (_req) => {
  return {
    ok: false,
    error: {
      code: 'not-implemented',
      message: 'Computer Use vision fallback is not wired yet (TODO browser-control wave).',
    },
  };
};
