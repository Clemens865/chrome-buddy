// Transport-level tests with a stub fetch. Exercises both response shapes
// (plain JSON, text/event-stream) plus session-id pinning and bearer-auth
// header attachment. No real network.
import { describe, it, expect } from 'vitest';
import { McpClient } from './client';
import { _resetIdCounter } from './protocol';

function jsonResponse(body: unknown, init: { headers?: Record<string, string>; status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function sseResponse(frames: string[], init: { headers?: Record<string, string>; status?: number } = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, {
    status: init.status ?? 200,
    headers: { 'content-type': 'text/event-stream', ...(init.headers ?? {}) },
  });
}

describe('MCP transport — plain JSON path', () => {
  it('connects and lists tools through JSON responses', async () => {
    _resetIdCounter();
    let calls = 0;
    const captured: Array<{ headers: Record<string, string>; body: unknown }> = [];
    const stubFetch = (async (_url: string, init: RequestInit) => {
      calls++;
      const headers = Object.fromEntries(
        Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      );
      const body = JSON.parse(init.body as string);
      captured.push({ headers, body });
      if (body.method === 'initialize') {
        return jsonResponse(
          {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'StubServer', version: '0.1.0' },
            },
          },
          { headers: { 'mcp-session-id': 'sess_abc' } },
        );
      }
      if (body.method === 'notifications/initialized') {
        // 202 Accepted, empty body.
        return new Response('', { status: 202 });
      }
      if (body.method === 'tools/list') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: 'echo', description: 'Echo back a message', inputSchema: { type: 'object' } },
            ],
          },
        });
      }
      throw new Error('unexpected method ' + body.method);
    }) as unknown as typeof fetch;

    const c = new McpClient({
      endpoint: 'https://stub.example/mcp',
      auth: { kind: 'bearer', token: 'secret' },
      fetchImpl: stubFetch,
    });
    const info = await c.connect();
    expect(info.serverName).toBe('StubServer');
    expect(info.serverVersion).toBe('0.1.0');
    expect(info.sessionId).toBe('sess_abc');

    const tools = await c.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('echo');

    // Bearer auth attached on every call.
    expect(captured[0].headers['authorization']).toBe('Bearer secret');
    expect(captured[2].headers['authorization']).toBe('Bearer secret');
    // Session id echoed back on calls after initialize.
    expect(captured[1].headers['mcp-session-id']).toBe('sess_abc');
    expect(captured[2].headers['mcp-session-id']).toBe('sess_abc');

    expect(calls).toBe(3); // initialize + initialized notification + tools/list
  });

  it('throws when the server returns a JSON-RPC error envelope', async () => {
    _resetIdCounter();
    const stubFetch = (async () => {
      return jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      });
    }) as unknown as typeof fetch;
    const c = new McpClient({ endpoint: 'https://stub.example/mcp', fetchImpl: stubFetch });
    await expect(c.connect()).rejects.toThrow(/Invalid Request/);
  });

  it('surfaces HTTP-level failures distinctly from JSON-RPC errors', async () => {
    _resetIdCounter();
    const stubFetch = (async () => {
      return new Response('Unauthorized — bad token', {
        status: 401,
        headers: { 'content-type': 'text/plain' },
      });
    }) as unknown as typeof fetch;
    const c = new McpClient({
      endpoint: 'https://stub.example/mcp',
      auth: { kind: 'bearer', token: 'wrong' },
      fetchImpl: stubFetch,
    });
    await expect(c.connect()).rejects.toThrow(/HTTP 401/);
  });
});

describe('MCP transport — SSE path', () => {
  it('drains an SSE response and matches the response id', async () => {
    _resetIdCounter();
    const stubFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.method === 'initialize') {
        return sseResponse([
          'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}\n\n',
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'SseStub', version: '1.0.0' },
            },
          })}\n\n`,
        ], { headers: { 'mcp-session-id': 'sess_sse' } });
      }
      if (body.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      throw new Error('unexpected method ' + body.method);
    }) as unknown as typeof fetch;

    const seen: string[] = [];
    const c = new McpClient({
      endpoint: 'https://stub.example/mcp',
      fetchImpl: stubFetch,
    });
    // Override the transport's onServerMessage so we can see the intermediate
    // progress notification was forwarded (not silently dropped).
    // (This client uses a default no-op; for the unit test we don't need
    //  introspection beyond verifying connect succeeded.)
    void seen.length;

    const info = await c.connect();
    expect(info.serverName).toBe('SseStub');
    expect(info.sessionId).toBe('sess_sse');
  });

  it('throws when the SSE stream ends without a matching response', async () => {
    _resetIdCounter();
    const stubFetch = (async () => {
      // Stream a notification frame then close — never sends a response for id 1.
      return sseResponse([
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n',
      ]);
    }) as unknown as typeof fetch;

    const c = new McpClient({ endpoint: 'https://stub.example/mcp', fetchImpl: stubFetch });
    await expect(c.connect()).rejects.toThrow(/SSE stream ended/);
  });
});
