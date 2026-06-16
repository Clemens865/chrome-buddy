// Streamable HTTP transport for MCP (2025-03-26 spec).
//
// Wire shape:
//  - Client → server: POST <endpoint> with a JSON-RPC envelope as the body.
//    Response Content-Type tells us how to read the body:
//      * application/json         → single response object (or array)
//      * text/event-stream        → SSE stream; each `data:` line is one
//        JSON-RPC message; the stream ends when the server closes the
//        connection. Used when the server needs to stream intermediate
//        messages (progress notifications, sampling requests, etc.) before
//        the final response.
//  - Session id: the server returns an `Mcp-Session-Id` header on the
//    initialize response; we echo it on every subsequent request.
//
// This transport handles ONE request at a time per session. Each call to
// request() opens a fetch, drains the response (JSON or SSE), and returns the
// final result matching the request id. Server-initiated requests + non-result
// notifications that arrive on the SSE stream are surfaced via the
// `onServerMessage` callback for the client to handle.

import type {
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcServerMessage,
} from './protocol';
import { isNotification, isResponse, isServerRequest } from './protocol';
import { parseSseFrames } from './sse';

export type TransportAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'header'; name: string; value: string };

/** Thrown when the server answers a non-2xx HTTP status (distinct from a
 *  JSON-RPC error envelope). Carries `status` so callers can react — e.g. a 401
 *  triggers an OAuth token refresh + retry in the dispatcher. */
export class McpHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'McpHttpError';
  }
}

export interface TransportOptions {
  endpoint: string;
  auth?: TransportAuth;
  /** Listener for server-pushed messages that aren't responses (notifications,
   *  server-initiated requests). Defaults to a no-op. */
  onServerMessage?: (msg: JsonRpcServerMessage) => void;
  /** Override for tests / non-DOM contexts. */
  fetchImpl?: typeof fetch;
}

export interface OpenSession {
  /** Send a JSON-RPC request and wait for its response. */
  request<R>(req: JsonRpcRequest): Promise<JsonRpcResponse<R>>;
  /** Send a JSON-RPC notification (no response expected). */
  notify(n: JsonRpcNotification): Promise<void>;
  /** Server-issued session id, available after the first successful POST. */
  sessionId(): string | undefined;
  /** Best-effort termination: tells the server to drop the session if it
   *  honors DELETE per spec. Errors are swallowed. */
  close(): Promise<void>;
}

export function openSession(opts: TransportOptions): OpenSession {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const onServerMessage = opts.onServerMessage ?? (() => {});
  let mcpSessionId: string | undefined;

  function buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (mcpSessionId) h['mcp-session-id'] = mcpSessionId;
    const a = opts.auth;
    if (a?.kind === 'bearer') h.authorization = `Bearer ${a.token}`;
    else if (a?.kind === 'header') h[a.name.toLowerCase()] = a.value;
    return h;
  }

  async function postOne(body: unknown): Promise<Response> {
    const res = await fetchImpl(opts.endpoint, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
    // The server issues the session id on the FIRST response (initialize).
    // We pin it for subsequent requests.
    const headerSid = res.headers.get('mcp-session-id') ?? res.headers.get('Mcp-Session-Id');
    if (!mcpSessionId && headerSid) mcpSessionId = headerSid;
    return res;
  }

  /** Drain a response into a single JSON-RPC response matching `id`. Both the
   *  application/json and text/event-stream cases land here. */
  async function drainResponse(res: Response, waitForId: JsonRpcId): Promise<JsonRpcResponse> {
    if (!res.ok && res.status !== 200) {
      // The body may still be JSON-RPC ({error:...}) or plain text.
      const text = await res.text().catch(() => '');
      throw new McpHttpError(
        res.status,
        `MCP transport: HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      );
    }
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('text/event-stream') && res.body) {
      return drainSse(res.body, waitForId);
    }
    // Plain JSON. May be a single response or an array of them (batched).
    const text = await res.text();
    const parsed = text.trim().length ? (JSON.parse(text) as unknown) : null;
    if (Array.isArray(parsed)) {
      // Forward notifications / server requests; return the response matching id.
      let matched: JsonRpcResponse | undefined;
      for (const m of parsed as JsonRpcServerMessage[]) {
        if (isResponse(m) && m.id === waitForId) matched = m;
        else onServerMessage(m);
      }
      if (!matched) throw new Error(`MCP transport: batched response had no message for id ${String(waitForId)}.`);
      return matched;
    }
    if (parsed && typeof parsed === 'object' && isResponse(parsed as JsonRpcServerMessage)) {
      return parsed as JsonRpcResponse;
    }
    throw new Error('MCP transport: response was not a JSON-RPC response object.');
  }

  async function drainSse(body: ReadableStream<Uint8Array>, waitForId: JsonRpcId): Promise<JsonRpcResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buf);
        buf = rest;
        for (const frame of frames) {
          if (frame.event && frame.event !== 'message') continue;
          if (!frame.data) continue;
          let msg: JsonRpcServerMessage;
          try {
            msg = JSON.parse(frame.data) as JsonRpcServerMessage;
          } catch {
            continue; // tolerate non-JSON keepalive frames
          }
          if (isResponse(msg) && msg.id === waitForId) {
            return msg;
          }
          if (isNotification(msg) || isServerRequest(msg)) {
            onServerMessage(msg);
          }
        }
      }
      throw new Error(`MCP transport: SSE stream ended without a response for id ${String(waitForId)}.`);
    } finally {
      reader.releaseLock();
    }
  }

  return {
    async request<R>(req: JsonRpcRequest): Promise<JsonRpcResponse<R>> {
      const res = await postOne(req);
      return (await drainResponse(res, req.id)) as JsonRpcResponse<R>;
    },
    async notify(n: JsonRpcNotification): Promise<void> {
      // Notifications get a 202 Accepted per spec; the body (if any) is ignored.
      const res = await postOne(n);
      // Drain so the connection can be released; ignore the contents.
      try { await res.text(); } catch { /* noop */ }
    },
    sessionId() {
      return mcpSessionId;
    },
    async close(): Promise<void> {
      if (!mcpSessionId) return;
      try {
        await fetchImpl(opts.endpoint, {
          method: 'DELETE',
          headers: buildHeaders(),
        });
      } catch {
        /* best-effort */
      }
    },
  };
}
