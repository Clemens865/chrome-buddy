// MCP (Model Context Protocol) wire types — narrow subset we need for Phase 1.
// References:
//  - JSON-RPC 2.0: https://www.jsonrpc.org/specification
//  - MCP 2025-03-26 spec: https://modelcontextprotocol.io/specification/2025-03-26
//
// Only Phase 1 surface: initialize handshake, tools/list, tools/call. We model
// the message envelopes as discriminated unions so the transport can route by
// presence-of-id (request/response) vs missing-id (notification).

/** Latest MCP protocol revision we'll claim to speak. Server may negotiate
 *  down — we accept any version the server returns in its initialize result. */
export const MCP_PROTOCOL_VERSION = '2025-03-26';

/** What we tell the server about ourselves in initialize. */
export const MCP_CLIENT_INFO = {
  name: 'chrome-buddy',
  version: '1.0.0',
};

// ----- JSON-RPC envelopes --------------------------------------------------

export type JsonRpcId = number | string;

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: '2.0';
  /** Notifications have NO id (omitted). */
  method: string;
  params?: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: R;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: JsonRpcErrorBody;
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcFailure;

/** Anything the server can put on the wire — request to us (sampling/etc.),
 *  notification (logging/progress), or a response to one of our requests. */
export type JsonRpcServerMessage =
  | JsonRpcRequest<unknown>
  | JsonRpcNotification<unknown>
  | JsonRpcResponse<unknown>;

// ----- MCP-specific message shapes ----------------------------------------

export interface McpClientCapabilities {
  /** We don't implement these yet; sending an empty object is the spec
   *  recommendation for "no capabilities advertised." */
  roots?: { listChanged?: boolean };
  sampling?: Record<string, unknown>;
}

export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { listChanged?: boolean; subscribe?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
}

export interface McpImplementation {
  name: string;
  version: string;
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: McpClientCapabilities;
  clientInfo: McpImplementation;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: McpServerCapabilities;
  serverInfo: McpImplementation;
  /** Optional server-supplied notice the panel can render verbatim. */
  instructions?: string;
}

/** One tool exposed by an MCP server. The schema is JSON Schema, which we'll
 *  pass straight through to Gemini's function declaration list (with the same
 *  sanitization we already apply to function declarations in src/background/live.ts). */
export interface McpTool {
  name: string;
  description?: string;
  /** JSON Schema for the call arguments. */
  inputSchema: Record<string, unknown>;
}

export interface ToolsListResult {
  tools: McpTool[];
  /** Cursor-based pagination per spec; if present, we'd page. Not in Phase 1. */
  nextCursor?: string;
}

/** Content block returned by tools/call — text or image, mirroring the spec. */
export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string; mimeType?: string } };

export interface ToolsCallResult {
  content: McpContentBlock[];
  /** Server-side error flag — distinct from a JSON-RPC error. The call
   *  succeeded but the TOOL itself failed (e.g. "no such row"). The UI surfaces
   *  this differently from a transport/protocol error. */
  isError?: boolean;
}

// ----- Pure helpers (tested directly) -------------------------------------

let nextId = 1;
export function makeRequest<P>(method: string, params?: P): JsonRpcRequest<P> {
  return { jsonrpc: '2.0', id: nextId++, method, ...(params !== undefined ? { params } : {}) };
}
export function makeNotification<P>(method: string, params?: P): JsonRpcNotification<P> {
  return { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
}

/** Reset the in-module id counter — test-only. (Production: monotonically
 *  increasing across an open session is fine; reuse across sessions is OK
 *  because each session is its own JSON-RPC scope.) */
export function _resetIdCounter(): void {
  nextId = 1;
}

/** Type guard: this server message is a response to one of our requests. */
export function isResponse(m: JsonRpcServerMessage): m is JsonRpcResponse {
  return 'id' in m && ('result' in m || 'error' in m);
}

/** Type guard: this is a request FROM the server (sampling, elicitation, etc.).
 *  Phase 1 doesn't service these — we just log and ignore them. */
export function isServerRequest(m: JsonRpcServerMessage): m is JsonRpcRequest {
  return 'id' in m && 'method' in m && !('result' in m) && !('error' in m);
}

/** Type guard: notification (no id). */
export function isNotification(m: JsonRpcServerMessage): m is JsonRpcNotification {
  return !('id' in m) && 'method' in m;
}

/** True when a JSON-RPC response carries an error body. */
export function isError(r: JsonRpcResponse): r is JsonRpcFailure {
  return 'error' in r;
}
