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
import { callSkillTool } from '../tools/defs';
import type { ToolDefinition } from '../tools/types';
import { ok, err, type ToolResult } from '../types';
import { getRootHandle, readFromRoot, writeToRoot } from '../fs/root';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import type { Skill } from '../skills/types';
import type {
  ErrorResponse,
  KeyStatusMessage,
  KeyStatusResponse,
  LlmGenerateMessage,
  LlmGenerateResponse,
  SkillListMessage,
  SkillListResponse,
  ToolExecMessage,
  ToolExecResponse,
} from '../key/messages';

/** Page read/act tools that execute in the SW via TOOL_EXEC. */
const PAGE_TOOLS = new Set(['read_dom', 'extract', 'screenshot', 'navigate', 'click', 'type', 'scroll']);

/** Tools the agent may use: page tools + search_web + file + consequential (HITL-gated) tools. */
const AGENT_TOOLS = new Set([...PAGE_TOOLS, 'search_web', 'send_webhook', 'write_file', 'read_file']);

/** File tools run in the UI (they hold the File System Access handle, which the
 * SW can't). read_file requires a root folder; write_file uses the root folder
 * when set, else falls back to the SW download path. */
function fileToolHandler(name: string, send: (m: unknown) => Promise<unknown>) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const path = typeof args.path === 'string' ? args.path : '';
    try {
      if (name === 'read_file') {
        const contents = await readFromRoot(path);
        return ok({ path, contents });
      }
      // write_file
      const contents = typeof args.contents === 'string' ? args.contents : '';
      if (await getRootHandle()) {
        const written = await writeToRoot(path, contents);
        return ok({ path: written, bytes: contents.length, target: 'root-folder' });
      }
      // No root folder chosen — fall back to a Downloads save (SW).
      return execPageTool(send, 'write_file', args);
    } catch (e) {
      return err('runtime-error', e instanceof Error ? e.message : String(e));
    }
  };
}

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
  /** Expose call_skill (saved skills) to the model. Off for nested skill runs. */
  exposeSkills?: boolean;
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

/** Fetch saved skills from the SW (SKILL_LIST). Skills are data, not code. */
async function listSavedSkills(send: (m: unknown) => Promise<unknown>): Promise<Skill[]> {
  const msg: SkillListMessage = { type: 'SKILL_LIST' };
  try {
    const res = (await send(msg)) as SkillListResponse | ErrorResponse | undefined;
    return res && res.type === 'SKILL_LIST' ? res.skills : [];
  } catch {
    return [];
  }
}

/** Deps that let call_skill EXECUTE a skill (nested run) rather than just echo it. */
export interface CallSkillDeps {
  send: (m: unknown) => Promise<unknown>;
  onConfirm: ConfirmHandler;
}

/**
 * Build a call_skill tool bound to the user's saved skills: its description
 * enumerates the available skills (id — name: description). When `deps` are
 * supplied the handler EXECUTES the matched skill as a bounded nested run
 * (agent loop for agent skills, plain chat for chat skills) and returns its
 * answer; the nested run does not re-expose call_skill, so it can't recurse.
 * Without deps (unit tests) it returns the skill's prompt as `instructions`.
 * Skills are DATA — call_skill runs saved prompts, never arbitrary code.
 */
export function buildCallSkillTool(skills: Skill[], deps?: CallSkillDeps): ToolDefinition {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const catalog = skills.map((s) => `- ${s.id} — ${s.name}: ${s.description}`).join('\n');
  return {
    ...callSkillTool,
    description: `${callSkillTool.description}\n\nAvailable saved skills:\n${catalog}`,
    handler: async (args) => {
      const id = (args as { skillId?: string }).skillId;
      const skill = id ? byId.get(id) : undefined;
      if (!skill) {
        return err('invalid-args', `No saved skill with id "${id ?? ''}". Pick one of the listed ids.`);
      }
      if (!deps) return ok({ name: skill.name, kind: skill.kind, instructions: skill.prompt });

      if (skill.kind === 'chat') {
        const r = await runPlainChat(skill.prompt, { send: deps.send });
        if (r.outcome === 'no-key') return err('runtime-error', 'No API key set for the skill run.');
        return ok({ name: skill.name, answer: r.text ?? '' });
      }
      // Agent skill: run the loop with skills suppressed (no recursion).
      const result = await runAgentTask(skill.prompt, {
        onEvent: () => {},
        onConfirm: deps.onConfirm,
        send: deps.send,
        exposeSkills: false,
      });
      if (result.outcome === 'no-key') return err('runtime-error', 'No API key set for the skill run.');
      return ok({ name: skill.name, answer: result.state?.finalAnswer ?? '', outcome: result.outcome });
    },
  };
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
function wireRegistry(
  send: (m: unknown) => Promise<unknown>,
  factory: () => ToolRegistry,
  skills: Skill[] = [],
  callSkillDeps?: CallSkillDeps,
): ToolRegistry {
  const base = factory();
  const wired = new (base.constructor as typeof ToolRegistry)();
  for (const def of base.list()) {
    // Only expose tools the agent can actually run: the page tools plus
    // search_web, send_webhook, and write_file, all executed in the SW via
    // TOOL_EXEC. send_webhook/write_file keep their `consequential` flag, so the
    // runtime's HITL gate fires before they run. Remaining stubs (read_file,
    // ask_user) are NOT declared, so the model can't pick a tool that fails.
    if (AGENT_TOOLS.has(def.name)) {
      const handler =
        def.name === 'read_file' || def.name === 'write_file'
          ? fileToolHandler(def.name, send)
          : (args: Record<string, unknown>) => execPageTool(send, def.name, args);
      wired.register({ ...def, handler });
    }
  }
  // call_skill is only exposed when the user actually has saved skills; its
  // handler resolves locally (skills are data) rather than via TOOL_EXEC.
  if (skills.length > 0) {
    wired.register(buildCallSkillTool(skills, callSkillDeps));
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
  const skills = options.exposeSkills === false ? [] : await listSavedSkills(send);
  const registry = wireRegistry(send, options.makeRegistry ?? createDefaultRegistry, skills, {
    send,
    onConfirm: options.onConfirm,
  });

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
