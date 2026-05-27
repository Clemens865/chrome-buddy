// SW-side MCP routes. The panel never opens an MCP session directly; it
// dispatches MCP_TEST (and later MCP_CALL_TOOL in Phase 2) and the SW does
// the fetch — so the bearer key lives only in chrome.storage.session and
// only the SW reads it before attaching the Authorization header.

import { McpClient } from '../mcp/client';
import { getKey } from '../mcp/keys';
import { getServer, recordTestResult } from '../mcp/store';
import type { TransportAuth } from '../mcp/transport';

export interface McpTestRequestMessage {
  type: 'MCP_TEST';
  serverId: string;
  /** Optional one-shot key — used during the Add-server form BEFORE the row
   *  is saved (so the user can verify before committing). When omitted, the
   *  SW reads chrome.storage.session via the saved server's authKind. */
  oneShotKey?: string;
}

export type McpTestResponse =
  | {
      type: 'MCP_TEST';
      ok: true;
      serverName: string;
      serverVersion: string;
      protocolVersion: string;
      toolCount: number;
      tools: { name: string; description?: string }[];
    }
  | { type: 'MCP_TEST'; ok: false; error: string };

/**
 * Open a session against a saved MCP server, perform the handshake, list the
 * tools, persist the result, and return a UI-friendly summary. Always closes
 * the session even on error.
 *
 * Pass `oneShotKey` to test a key the user typed in the Add form without
 * persisting it first — handy for "does this key work?" before Save.
 */
export async function executeMcpTest(msg: McpTestRequestMessage): Promise<McpTestResponse> {
  const srv = await getServer(msg.serverId);
  if (!srv) return { type: 'MCP_TEST', ok: false, error: `Server ${msg.serverId} not found.` };

  // Resolve auth: explicit one-shot key overrides the stored one.
  let auth: TransportAuth = { kind: 'none' };
  if (srv.authKind === 'bearer') {
    const token = msg.oneShotKey ?? (await getKey(srv.id));
    if (!token) {
      const err = 'Bearer auth selected but no key is set. Paste a key in Settings.';
      await recordTestResult(srv.id, 'error', err);
      return { type: 'MCP_TEST', ok: false, error: err };
    }
    auth = { kind: 'bearer', token };
  }

  const client = new McpClient({ endpoint: srv.url, auth });
  try {
    const info = await client.connect();
    const tools = await client.listTools();
    await recordTestResult(
      srv.id,
      'ok',
      `${info.serverName} ${info.serverVersion} · ${tools.length} tool${tools.length === 1 ? '' : 's'}`,
      tools,
    );
    return {
      type: 'MCP_TEST',
      ok: true,
      serverName: info.serverName,
      serverVersion: info.serverVersion,
      protocolVersion: info.protocolVersion,
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordTestResult(srv.id, 'error', message);
    return { type: 'MCP_TEST', ok: false, error: message };
  } finally {
    await client.close();
  }
}
