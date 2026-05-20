// ToolRegistry — the single source of capabilities (FR-TOOLS-1).
// Holds tool definitions, emits Gemini function declarations, and enforces
// the per-caller allowedTools whitelist (FR-TOOLS-14) plus the consequential
// HITL gate (FR-TOOLS-12). Enforcement logic is pure/testable.

import { err, type ToolResult } from '../types';
import type {
  AllowedTools,
  GeminiFunctionDeclaration,
  ToolContext,
  ToolDefinition,
} from './types';

/**
 * Outcome of the pure pre-flight check the registry runs before executing a
 * tool. Exposed so callers (and tests) can reason about gating without side
 * effects.
 */
export type GateDecision =
  | { kind: 'allow'; def: ToolDefinition }
  | { kind: 'reject'; reason: 'unknown-tool' | 'not-allowed'; tool: string }
  | { kind: 'needs-confirmation'; def: ToolDefinition };

/**
 * Pure gate: given the registered defs, a tool name, the caller's allowlist,
 * and whether the action is already approved, decide what should happen.
 * No I/O, no mutation — safe to unit-test in isolation.
 */
export function evaluateGate(
  def: ToolDefinition | undefined,
  name: string,
  allowedTools: AllowedTools | undefined,
  approved: boolean,
): GateDecision {
  if (!def) return { kind: 'reject', reason: 'unknown-tool', tool: name };
  // An undefined allowlist means "no restriction"; an empty array means
  // "nothing allowed". Either way, when present it is enforced strictly.
  if (allowedTools !== undefined && !allowedTools.includes(name)) {
    return { kind: 'reject', reason: 'not-allowed', tool: name };
  }
  if (def.consequential && !approved) {
    return { kind: 'needs-confirmation', def };
  }
  return { kind: 'allow', def };
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /** Register a tool definition. Throws on duplicate name. */
  register(def: ToolDefinition): this {
    if (this.tools.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`);
    }
    this.tools.set(def.name, def);
    return this;
  }

  /** Look up a tool by name. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Whether a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List registered tools, optionally filtered to a caller's allowlist.
   * Off-list tools are stripped (FR-TOOLS-14).
   */
  list(allowedTools?: AllowedTools): ToolDefinition[] {
    const all = [...this.tools.values()];
    if (allowedTools === undefined) return all;
    return all.filter((d) => allowedTools.includes(d.name));
  }

  /**
   * Emit Gemini function declarations for the (optionally allow-listed) tools.
   * The `paramsSchema` is used directly as the declaration parameters
   * (FR-TOOLS-13).
   */
  toGeminiFunctionDeclarations(
    allowedTools?: AllowedTools,
  ): GeminiFunctionDeclaration[] {
    return this.list(allowedTools).map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.paramsSchema,
    }));
  }

  /**
   * Invoke a tool with whitelist + consequential enforcement.
   *
   * - Off-list or unknown calls are rejected without executing the handler.
   * - A consequential tool that has not yet been approved returns a
   *   `needs-confirmation` signal instead of executing.
   * - Otherwise the handler runs and its ToolResult is returned.
   */
  async invoke(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    allowedTools?: AllowedTools,
  ): Promise<ToolResult> {
    const decision = evaluateGate(
      this.tools.get(name),
      name,
      allowedTools,
      ctx.approved === true,
    );

    switch (decision.kind) {
      case 'reject':
        return decision.reason === 'unknown-tool'
          ? err('not-found', `Unknown tool "${name}"`)
          : err(
              'not-allowed',
              `Tool "${name}" is not in the caller's allowedTools whitelist`,
            );
      case 'needs-confirmation':
        return err(
          'needs-confirmation',
          `Tool "${name}" is consequential and requires explicit user approval`,
        );
      case 'allow':
        if (ctx.signal?.aborted) {
          return err('aborted', `Tool "${name}" aborted before execution`);
        }
        return decision.def.handler(args, ctx);
    }
  }
}
