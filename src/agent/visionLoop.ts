// Vision Mode driver (panel-side).
//
// Computer Use is a "see the page → act → see again" loop:
//
//   capture screenshot → VISION_TURN (model) → for each functionCall:
//     [optional HITL on safety_decision] → VISION_ACTION (CDP) → new screenshot
//   → next VISION_TURN with functionResponse parts including the new screenshot
//   → repeat until the model returns no functionCalls (task done)
//
// The full message history is held in the panel and posted to the SW each turn
// (the model is stateless). See computer-use.md L37-50 + L191-244.

import type {
  VisionTurnMessage,
  VisionActionMessage,
  VisionCaptureMessage,
  VisionTurnResponse,
  VisionActionResponse,
  VisionCaptureResponse,
  ErrorResponse,
} from '../key/messages';
import type { ApprovalDecision } from './types';
import type { UsageStats } from '../llm/types';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { estimateCost } from '../llm/router';

const VISION_MODEL_ID = 'gemini-2.5-computer-use-preview-10-2025';

const MAX_TURNS = 24;

export interface VisionLoopOptions {
  task: string;
  /** Resolves when the user accepts/denies a confirmation gate (either a model
   *  safety_decision = require_confirmation OR confirmAll = true). */
  onConfirm: (req: { call: { name: string; args: Record<string, unknown> }; summary: string }) => Promise<ApprovalDecision>;
  /** Live progress callback — useful for streaming each step to the chat UI. */
  onEvent?: (e: VisionEvent) => void;
  /** Cancellation. */
  signal?: AbortSignal;
  /** When true, gate EVERY action through HITL (not just safety_decision).
   *  Default is the docs' recommendation: only on require_confirmation. */
  confirmAll?: boolean;
}

/** Pure: does this action need a HITL gate before execution?
 *  - The model can mark an action as `safety_decision.decision = 'require_confirmation'`
 *    (per ToS we MUST honor that and never bypass — computer-use.md L615-618).
 *  - The user may opt to confirm every action via the Settings toggle. */
export function requiresConfirmation(
  args: Record<string, unknown>,
  confirmAll: boolean,
): { gated: boolean; explanation?: string } {
  const sd = (args as { safety_decision?: { decision?: string; explanation?: string } }).safety_decision;
  if (sd?.decision === 'require_confirmation') {
    return { gated: true, explanation: sd.explanation };
  }
  if (confirmAll) return { gated: true };
  return { gated: false };
}

export type VisionEvent =
  | { kind: 'narration'; text: string }
  | { kind: 'action'; call: { name: string; args: Record<string, unknown> } }
  | { kind: 'action-result'; ok: boolean; url?: string; error?: string }
  | { kind: 'denied' };

export interface VisionLoopResult {
  outcome: 'completed' | 'budget-exceeded' | 'cancelled' | 'denied' | 'failed';
  finalAnswer: string;
  /** Number of model turns the loop made. */
  turns: number;
  /** Aggregated token usage across all turns. */
  usage: UsageStats;
  /** Estimated USD cost for the whole run (Computer Use preview pricing). */
  costUsd: number;
}

export async function runVisionTask(opts: VisionLoopOptions): Promise<VisionLoopResult> {
  const { task, onConfirm, onEvent, signal, confirmAll = false } = opts;

  const usage: UsageStats = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const model = DEFAULT_REGISTRY.models[VISION_MODEL_ID];

  const finalize = (
    outcome: VisionLoopResult['outcome'],
    finalAnswer: string,
    turns: number,
  ): VisionLoopResult => {
    const costUsd = model ? estimateCost(usage, model).totalCost : 0;
    return { outcome, finalAnswer, turns, usage, costUsd };
  };

  // Capture initial state from the active tab.
  const initCap = (await chrome.runtime.sendMessage({ type: 'VISION_CAPTURE' } as VisionCaptureMessage)) as
    | VisionCaptureResponse
    | ErrorResponse;
  if (!initCap || (initCap.type === 'VISION_CAPTURE' && !initCap.ok) || initCap.type === 'ERROR') {
    const why =
      !initCap
        ? 'No response from background SW.'
        : initCap.type === 'ERROR'
          ? initCap.error
          : (initCap.error ?? 'unknown');
    return finalize('failed', `Could not capture the active tab: ${why}`, 0);
  }
  const cap = initCap;
  const tabId = cap.tabId as number;

  // contents starts with the user's task + the initial screenshot.
  const contents: VisionTurnMessage['contents'] = [
    {
      role: 'user',
      parts: [
        { text: `${task}\n\nCurrent URL: ${cap.url}\nCurrent title: ${cap.title}` },
        { inlineData: { mimeType: 'image/png', data: cap.screenshot ?? '' } },
      ],
    },
  ];

  let lastText = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) return finalize('cancelled', lastText || 'Cancelled.', turn);

    // 1) Ask the model what to do next.
    const turnRes = (await chrome.runtime.sendMessage({ type: 'VISION_TURN', contents } as VisionTurnMessage)) as
      | VisionTurnResponse
      | ErrorResponse;
    if (!turnRes || turnRes.type === 'ERROR') {
      return finalize('failed', turnRes?.type === 'ERROR' ? turnRes.error : 'Vision turn failed.', turn);
    }
    const { text, functionCalls, modelTurn, usage: turnUsage } = turnRes as VisionTurnResponse;
    // Accumulate token usage.
    usage.inputTokens += turnUsage.inputTokens;
    usage.outputTokens += turnUsage.outputTokens;
    usage.totalTokens += turnUsage.totalTokens;
    if (turnUsage.cachedInputTokens) {
      usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + turnUsage.cachedInputTokens;
    }
    if (turnUsage.thoughtsTokens) {
      usage.thoughtsTokens = (usage.thoughtsTokens ?? 0) + turnUsage.thoughtsTokens;
    }

    // Dedup: skip identical consecutive narration so we don't bubble the same
    // sentence twice when the model emits two text-only turns in a row.
    if (text && text !== lastText) {
      lastText = text;
      onEvent?.({ kind: 'narration', text });
    }
    contents.push(modelTurn);

    // 2) No function calls → the model is done.
    if (functionCalls.length === 0) {
      return finalize('completed', text || lastText || 'Done.', turn + 1);
    }

    // 3) Execute each function call; collect FunctionResponse parts (each
    //    includes the post-action screenshot).
    const responseParts: Record<string, unknown>[] = [];
    for (const call of functionCalls) {
      if (signal?.aborted) return finalize('cancelled', lastText, turn);

      const gate = requiresConfirmation(call.args, confirmAll);
      const extra: Record<string, unknown> = {};
      if (gate.gated) {
        const summary = `${call.name}(${JSON.stringify(call.args).slice(0, 200)})${
          gate.explanation ? `\n\nWhy: ${gate.explanation}` : ''
        }`;
        const decision = await onConfirm({ call, summary });
        if (!decision.approved) {
          onEvent?.({ kind: 'denied' });
          return finalize('denied', lastText || 'Cancelled at safety gate.', turn + 1);
        }
        // Per docs: when the model required confirmation, we MUST include
        // safety_acknowledgement="true" in the FunctionResponse after the user
        // confirms. confirmAll-only gates don't need the ack field.
        if (gate.explanation !== undefined || (call.args as { safety_decision?: unknown }).safety_decision) {
          extra.safety_acknowledgement = 'true';
        }
      }

      onEvent?.({ kind: 'action', call });
      const actRes = (await chrome.runtime.sendMessage({
        type: 'VISION_ACTION',
        tabId,
        call,
      } as VisionActionMessage)) as VisionActionResponse | ErrorResponse;
      const ok = actRes && actRes.type === 'VISION_ACTION' && actRes.ok;
      onEvent?.({
        kind: 'action-result',
        ok: !!ok,
        url: (actRes as VisionActionResponse)?.url,
        error: ok ? undefined : (actRes as VisionActionResponse)?.error ?? (actRes as ErrorResponse)?.error,
      });

      const screenshot = ok ? (actRes as VisionActionResponse).screenshot ?? '' : '';
      const url = ok ? (actRes as VisionActionResponse).url ?? '' : '';
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: { url, ...extra, ...(ok ? {} : { error: (actRes as VisionActionResponse)?.error ?? 'action failed' }) },
          parts: screenshot
            ? [{ inlineData: { mimeType: 'image/png', data: screenshot } }]
            : undefined,
        },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return finalize('budget-exceeded', lastText || `Hit the ${MAX_TURNS}-turn cap.`, MAX_TURNS);
}
