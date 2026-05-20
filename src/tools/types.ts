// Core types for the single shared Tool Registry (FR-TOOLS-1, FR-TOOLS-13).
// One registry consumed three ways: micro-apps, the agent loop, and skills.

import type { JSONSchema, ToolResult } from '../types';

/** Who is invoking a tool — drives audit/log context, not authorization. */
export type ToolCaller = 'agent' | 'app' | 'skill';

/**
 * Context passed to every tool handler. The registry threads this through;
 * handlers read only what they need. Kept minimal and surface-agnostic.
 */
export interface ToolContext {
  /** Who triggered this invocation. */
  caller: ToolCaller;
  /** Identifier of the caller (skill id, app id, or run id) for audit logs. */
  callerId?: string;
  /** Target tab for DOM-acting / page-reading tools. */
  tabId?: number;
  /** Abort signal so long-running tools can be cancelled (budget/stop). */
  signal?: AbortSignal;
  /**
   * Set true once the user has explicitly approved a consequential action via
   * the HITL confirmation gate (FR-HITL-1). The registry will not execute a
   * consequential tool unless this is true.
   */
  approved?: boolean;
}

/**
 * A tool handler. Receives validated args and the invocation context.
 * Always resolves to a discriminated ToolResult (never throws for expected
 * failure modes — throwing is reserved for not-yet-wired stubs).
 */
export type ToolHandler<
  Args = Record<string, unknown>,
  Data = unknown,
> = (args: Args, ctx: ToolContext) => Promise<ToolResult<Data>>;

/**
 * A single capability in the registry. `paramsSchema` is a JSON-Schema object
 * that doubles as the Gemini function declaration's `parameters` (FR-TOOLS-13).
 */
export interface ToolDefinition<
  Args = Record<string, unknown>,
  Data = unknown,
> {
  /** Unique tool name; also the Gemini function name. */
  name: string;
  /** Short description used in the function declaration and for relevance. */
  description: string;
  /** JSON-Schema (object) describing the tool's parameters. */
  paramsSchema: JSONSchema;
  /**
   * Whether this tool sends/buys/deletes/auths or otherwise has external side
   * effects (FR-TOOLS-12). Consequential tools must pass the HITL gate.
   */
  consequential: boolean;
  /** The implementation. */
  handler: ToolHandler<Args, Data>;
}

/**
 * The minimal shape of a Gemini function declaration the registry emits.
 * (We avoid depending on @google/genai types here to keep this module
 * dependency-free; the shape is structurally compatible.)
 */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/** A whitelist of tool names a given caller is permitted to use (FR-TOOLS-14). */
export type AllowedTools = readonly string[];
