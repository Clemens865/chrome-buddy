// High-level MCP client. Wraps the Streamable HTTP transport in the three
// methods Phase 1 needs:
//   - connect()    → handshake (initialize + notifications/initialized)
//   - listTools()  → fetch the tool catalog
//   - callTool()   → invoke a tool (used in Phase 2; declared now so we don't
//                    have to revisit this file)
// Errors are thrown as Error instances with the JSON-RPC message text; the
// caller maps them to UI states.

import { openSession, type OpenSession, type TransportAuth } from './transport';
import {
  MCP_CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  isError,
  makeNotification,
  makeRequest,
  type InitializeParams,
  type InitializeResult,
  type McpServerCapabilities,
  type McpTool,
  type ToolsCallResult,
  type ToolsListResult,
} from './protocol';

export interface ConnectInfo {
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  capabilities: McpServerCapabilities;
  instructions?: string;
  sessionId?: string;
}

export interface McpClientOptions {
  endpoint: string;
  auth?: TransportAuth;
  fetchImpl?: typeof fetch;
}

export class McpClient {
  private session: OpenSession;
  private info: ConnectInfo | null = null;

  constructor(opts: McpClientOptions) {
    this.session = openSession({
      endpoint: opts.endpoint,
      auth: opts.auth,
      fetchImpl: opts.fetchImpl,
    });
  }

  /** Perform the MCP handshake. Resolves with server info + capabilities. */
  async connect(): Promise<ConnectInfo> {
    const params: InitializeParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {}, // Phase 1 advertises no client capabilities.
      clientInfo: MCP_CLIENT_INFO,
    };
    const req = makeRequest('initialize', params);
    const res = await this.session.request<InitializeResult>(req);
    if (isError(res)) {
      throw new Error(`MCP initialize failed: ${res.error.message}`);
    }
    const r = res.result;
    // Per spec, after a successful initialize we send the initialized notification.
    await this.session.notify(makeNotification('notifications/initialized'));
    this.info = {
      protocolVersion: r.protocolVersion,
      serverName: r.serverInfo.name,
      serverVersion: r.serverInfo.version,
      capabilities: r.capabilities,
      instructions: r.instructions,
      sessionId: this.session.sessionId(),
    };
    return this.info;
  }

  /** Fetch the server's tool catalog. Must be called after connect(). */
  async listTools(): Promise<McpTool[]> {
    if (!this.info) throw new Error('listTools: not connected.');
    const req = makeRequest('tools/list');
    const res = await this.session.request<ToolsListResult>(req);
    if (isError(res)) {
      throw new Error(`MCP tools/list failed: ${res.error.message}`);
    }
    return res.result.tools ?? [];
  }

  /** Phase 2 will use this from the agent dispatcher. Already implemented so
   *  the Phase 1 tests can exercise it against the stub server. */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolsCallResult> {
    if (!this.info) throw new Error('callTool: not connected.');
    const req = makeRequest('tools/call', { name, arguments: args });
    const res = await this.session.request<ToolsCallResult>(req);
    if (isError(res)) {
      throw new Error(`MCP tools/call(${name}) failed: ${res.error.message}`);
    }
    return res.result;
  }

  /** Best-effort termination. Always safe to call even if connect failed. */
  async close(): Promise<void> {
    await this.session.close();
  }
}
