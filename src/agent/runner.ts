// runAgentTask — the UI-side driver that wires the AgentRuntime to the real
// Gemini LLM and to real page tools, both via the background service worker.
//
// ── SECURITY POSTURE (reviewed) ───────────────────────────────────────────
// • KEY CUSTODY: the API key lives ONLY in chrome.storage.session inside the SW.
//   This runner runs in the UI; it NEVER reads the key. LLM calls go through
//   generateViaBackground (an LLM_GENERATE message); the SW injects the key.
// • TOOL EXECUTION: page reads/actions run in the SW too (a TOOL_EXEC message),
//   using chrome.scripting / captureVisibleTab via src/page. The UI never
//   scripts a tab or captures the screen directly.
// • UNTRUSTED PAGE CONTENT: anything returned from a page tool is data, never
//   instructions. It flows back as a ToolResult and is shown/observed, not run.
// • HITL GATE: consequential tools (send_webhook, write_file, …) ALWAYS pass
//   through the runtime's HITL gate before any execution — even if the model
//   was steered to request them by page content. There is no path that runs a
//   consequential tool without an explicit user approval (FR-HITL-1).
// • RESTRICTED URLS: the SW refuses chrome://, Web Store, view-source, etc. with
//   a structured `undriveable` error; the runtime treats that as a retry/fail.
//
// The runtime itself is surface-agnostic (emits AgentEvents, mutates a
// scratchpad). This module supplies the deps and forwards events to the caller.

import { AgentRuntime } from './runtime';
import type { RuntimeLlm } from './runtime';
import type { ApprovalResolver } from './hitl';
import type { AgentEvent, ApprovalDecision, RunOutcome, RunState } from './types';
import { createDefaultRegistry, type ToolRegistry } from '../tools';
import { err, type ToolResult } from '../types';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import type {
  ErrorResponse,
  KeyStatusMessage,
  KeyStatusResponse,
  LlmGenerateMessage,
  LlmGenerateResponse,
  ToolExecMessage,
  ToolExecResponse,
} from '../key/messages';

/** Page read/act tools that execute in the SW via TOOL_EXEC. */
const PAGE_TOOLS = new Set(['read_dom', 'extract', 'screenshot', 'navigate', 'click', 'type', 'scroll']);

/** Tools the agent may use: page tools + send_webhook (consequential, HITL-gated). */
const AGENT_TOOLS = new Set([...PAGE_TOOLS, 'send_webhook']);

/** Provider id whose key custody backs the default model. */
const GEMINI_PROVIDER = 'google-gemini';

/** Default per-run caps (FR-AGENT-9; NFR-COST-1). */
const DEFAULT_STEP_BUDGET = 24;
const DEFAULT_COST_BUDGET = 0.5;

/** The decision the UI returns when the HITL gate fires. */
export type ConfirmHandler = (request: {
  runId: string;
  step: number;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}) => Promise<ApprovalDecision>;

export interface RunAgentTaskOptions {
  /** Forwards every AgentEvent to the caller for live rendering. */
  onEvent: (event: AgentEvent) => void;
  /** Resolves the HITL confirmation card. Required for consequential tools. */
  onConfirm: ConfirmHandler;
  /** Registry model id; defaults to the registry default (gemini-3.5-flash). */
  model?: string;
  /** Cancellation signal for the whole run. */
  signal?: AbortSignal;
  /** Overridable transport for tests (defaults to chrome.runtime.sendMessage). */
  send?: (message: unknown) => Promise<unknown>;
  /** Overridable registry factory (defaults to the shared default registry). */
  makeRegistry?: () => ToolRegistry;
}

/** Terminal result of a run, plus a clean no-key signal for the UI. */
export interface RunAgentTaskResult {
  /** 'no-key' is surfaced cleanly so the UI can prompt for a Settings key. */
  outcome: RunOutcome | 'no-key';
  state?: RunState;
}

function defaultSend(message: unknown): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return Promise.reject(new Error('Extension messaging unavailable.'));
  }
  return chrome.runtime.sendMessage(message);
}

/** Probe whether a Gemini key is set in the SW (KEY_STATUS; never returns it). */
async function hasKey(send: (m: unknown) => Promise<unknown>): Promise<boolean> {
  const msg: KeyStatusMessage = { type: 'KEY_STATUS', provider: GEMINI_PROVIDER };
  try {
    const res = (await send(msg)) as KeyStatusResponse | ErrorResponse | undefined;
    return !!res && res.type === 'KEY_STATUS' && res.hasKey === true;
  } catch {
    return false;
  }
}

/** Post a TOOL_EXEC for a page tool and unwrap the SW's ToolResult. */
async function execPageTool(
  send: (m: unknown) => Promise<unknown>,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const msg: ToolExecMessage = { type: 'TOOL_EXEC', tool, args };
  const res = (await send(msg)) as ToolExecResponse | ErrorResponse | undefined;
  if (!res) return err('runtime-error', 'No response from background for TOOL_EXEC.');
  if (res.type === 'ERROR' || res.ok !== true) {
    return err('runtime-error', res.type === 'ERROR' ? res.error : 'Tool execution failed.');
  }
  return res.result;
}

/**
 * Build a registry whose PAGE tools route through TOOL_EXEC (SW execution) and
 * whose non-page tools keep their default handlers. The runtime's HITL gate
 * still fires for consequential tools before any handler runs.
 */
function wireRegistry(send: (m: unknown) => Promise<unknown>, factory: () => ToolRegistry): ToolRegistry {
  const base = factory();
  const wired = new (base.constructor as typeof ToolRegistry)();
  for (const def of base.list()) {
    // Only expose tools the agent can actually run: the page tools and
    // send_webhook, all executed in the SW via TOOL_EXEC. send_webhook keeps its
    // `consequential` flag, so the runtime's HITL gate fires before it runs.
    // Other stubs (call_skill, read/write_file, ask_user) are NOT declared, so
    // the model can't pick a tool that fails the step.
    if (AGENT_TOOLS.has(def.name)) {
      wired.register({
        ...def,
        handler: (args) => execPageTool(send, def.name, args as Record<string, unknown>),
      });
    }
  }
  return wired;
}

/**
 * LLM surface that posts LLM_GENERATE to the SW (which holds the key and runs
 * the real Gemini call) over the same injectable transport as the tools. The
 * key never reaches this UI context.
 */
function makeLlm(send: (m: unknown) => Promise<unknown>, model: string | undefined): RuntimeLlm {
  return {
    generate: async (a) => {
      const msg: LlmGenerateMessage = {
        type: 'LLM_GENERATE',
        model: a.model ?? model,
        messages: a.messages,
        tools: a.tools,
        params: a.params,
      };
      const res = (await send(msg)) as LlmGenerateResponse | ErrorResponse | undefined;
      if (!res) throw new Error('No response from background for LLM_GENERATE.');
      if (res.type === 'ERROR' || res.ok !== true) {
        throw new Error(res.type === 'ERROR' ? res.error : 'Background generation failed.');
      }
      const result = res.result;
      return { ...result, cost: { totalCost: result.cost.totalCost } };
    },
  };
}

/**
 * Run an agentic task end-to-end. Probes KEY_STATUS first and returns
 * `{ outcome: 'no-key' }` (emitting nothing) when no key is set, so the UI can
 * render the "add a key in Settings" state. Otherwise builds an AgentRuntime
 * wired to Gemini + page tools (both via the background SW), forwards every
 * AgentEvent to `onEvent`, and resolves the HITL gate via `onConfirm`.
 */
export async function runAgentTask(
  prompt: string,
  options: RunAgentTaskOptions,
): Promise<RunAgentTaskResult> {
  const send = options.send ?? defaultSend;

  if (!(await hasKey(send))) {
    return { outcome: 'no-key' };
  }

  const model = options.model ?? DEFAULT_REGISTRY.defaultModel;
  const registry = wireRegistry(send, options.makeRegistry ?? createDefaultRegistry);

  const approve: ApprovalResolver = (request) =>
    options.onConfirm({
      runId: request.runId,
      step: request.step,
      tool: request.call.name,
      args: request.call.arguments,
      summary: request.summary,
    });

  const runtime = new AgentRuntime({
    llm: makeLlm(send, model),
    registry,
    approve,
    onEvent: options.onEvent,
  });

  const state = await runtime.run(prompt, {
    model,
    stepBudget: DEFAULT_STEP_BUDGET,
    costBudget: DEFAULT_COST_BUDGET,
    signal: options.signal,
  });

  return { outcome: state.outcome ?? 'failed', state };
}

/** Cheap, fast model for plain (non-agentic) chat answers — token-efficient. */
const PLAIN_CHAT_MODEL = 'gemini-2.5-flash-lite';

const PLAIN_CHAT_SYSTEM =
  "You are Buddy, a concise, helpful AI assistant inside the user's browser. " +
  'Answer directly and briefly. If the request actually needs you to read or act ' +
  'on the current web page, say it can be run in Agent mode.';

export interface PlainChatResult {
  outcome: 'ok' | 'no-key';
  text?: string;
}

/**
 * Plain chat: a single, tool-less LLM call on a cheap model — no plan/observe
 * loop and no tool declarations, so simple Q&A stays token-efficient. Routed
 * through the background SW (key custody) like every other cloud call.
 */
export async function runPlainChat(
  prompt: string,
  options: { model?: string; context?: string; send?: (m: unknown) => Promise<unknown> } = {},
): Promise<PlainChatResult> {
  const send = options.send ?? defaultSend;
  if (!(await hasKey(send))) return { outcome: 'no-key' };

  const messages: LlmGenerateMessage['messages'] = [{ role: 'system', content: PLAIN_CHAT_SYSTEM }];
  // Page content / user profile attached by the UI (FR: chat sees the page
  // without an agentic read_dom round-trip).
  if (options.context && options.context.trim()) {
    messages.push({ role: 'system', content: options.context });
  }
  messages.push({ role: 'user', content: prompt });

  const msg: LlmGenerateMessage = {
    type: 'LLM_GENERATE',
    model: options.model ?? PLAIN_CHAT_MODEL,
    messages,
    // No tools attached — that's the whole point of the cheap path.
  };
  const res = (await send(msg)) as LlmGenerateResponse | ErrorResponse | undefined;
  if (!res) throw new Error('No response from background for LLM_GENERATE.');
  if (res.type === 'ERROR' || res.ok !== true) {
    throw new Error(res.type === 'ERROR' ? res.error : 'Background generation failed.');
  }
  return { outcome: 'ok', text: res.result.text };
}

// Re-export the page-tool set so tests and the UI can reason about routing.
export { PAGE_TOOLS, PLAIN_CHAT_MODEL };
export type { ToolResult };
