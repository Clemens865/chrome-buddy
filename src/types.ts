// Shared cross-cutting types for Chrome_Buddy.
// Kept intentionally lean — only types that are broadly useful across surfaces
// (side panel UI, background service worker, tool registry, agent loop).

/**
 * The content views switchable from the side-panel icon rail.
 * Mirrors the union used by the panel shell (kept in sync deliberately;
 * this module owns no import of the UI to avoid coupling).
 */
export type View = 'chat' | 'apps' | 'skills' | 'flows' | 'history' | 'settings';

/**
 * Minimal JSON Schema subset sufficient to describe tool parameters as a
 * Gemini function declaration. Not a full JSON-Schema implementation — just the
 * shape the registry emits and Gemini accepts.
 */
export type JSONSchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[];
  description?: string;
  /** For `type: 'object'`. */
  properties?: Record<string, JSONSchema>;
  required?: string[];
  /** For `type: 'array'`. */
  items?: JSONSchema;
  /** Enumerated allowed values (commonly strings). */
  enum?: Array<string | number | boolean | null>;
  /** Disallow keys not declared in `properties`. */
  additionalProperties?: boolean;
  /** Default value hint surfaced to the model. */
  default?: unknown;
  /** Composition — rarely needed but cheap to allow. */
  anyOf?: JSONSchema[];
}

/** Lifecycle status shared by agent runs, workflow runs, and tool invocations. */
export type RunStatus =
  | 'idle'
  | 'planning'
  | 'running'
  | 'paused'
  | 'needs-confirmation'
  | 'needs-input'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled';

/** Discriminated result returned by every tool handler. */
export type ToolResult<T = unknown> =
  | { ok: true; data: T; meta?: ToolResultMeta }
  | { ok: false; error: ToolError; meta?: ToolResultMeta };

export interface ToolResultMeta {
  /** Source URL(s) the result was derived from, for provenance. */
  provenance?: string[];
  /** Whether the vision fallback tier was used to produce this result. */
  visionUsed?: boolean;
  /** Free-form notes surfaced to the UI (e.g. "merged cells expanded"). */
  notes?: string[];
  /** Set when the page is gated by a CAPTCHA/login wall (FR-HITL-8). */
  humanGate?: 'captcha' | 'login';
}

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  /** Optional underlying cause for logging/debugging. */
  cause?: unknown;
}

export type ToolErrorCode =
  | 'not-implemented'
  | 'not-allowed'
  | 'not-found'
  | 'invalid-args'
  | 'needs-confirmation'
  | 'undriveable'
  | 'aborted'
  | 'runtime-error';

/** Convenience constructors for tool handlers and the registry. */
export function ok<T>(data: T, meta?: ToolResultMeta): ToolResult<T> {
  return { ok: true, data, meta };
}

export function err(
  code: ToolErrorCode,
  message: string,
  cause?: unknown,
): ToolResult<never> {
  return { ok: false, error: { code, message, cause } };
}
