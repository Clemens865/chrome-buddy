// SW-side MCP routes. The panel never opens an MCP session directly; it
// dispatches MCP_TEST (and later MCP_CALL_TOOL in Phase 2) and the SW does
// the fetch — so the bearer key lives only in chrome.storage.session and
// only the SW reads it before attaching the Authorization header.

import { McpClient } from '../mcp/client';
import { getKey } from '../mcp/keys';
import { getServer, listServers, recordTestResult } from '../mcp/store';
import { collectMcpBindings, parseNamespacedToolName, type McpToolBinding } from '../mcp/merger';
import type { TransportAuth } from '../mcp/transport';
import { ok, err, type ToolResult } from '../types';

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

// --- Phase 2: tool-call dispatch ----------------------------------------

/** Resolve the full list of enabled MCP tool bindings. Each binding carries
 *  enough context (server id, original tool name, trust level) for the
 *  dispatcher to route a model call back to the right server and for the
 *  HITL gate to make the right decision.
 *
 *  No cache: panel-side Settings writes don't go through the SW, so a stale
 *  cache would let just-disabled tools keep dispatching for one turn. The
 *  IDB read is sub-millisecond — premature optimization avoided. */
export async function collectEnabledMcpBindings(): Promise<McpToolBinding[]> {
  const servers = await listServers();
  return collectMcpBindings(servers);
}

/** Session pool — one open McpClient per server, kept warm so the model
 *  can chain calls without paying the initialize+initialized handshake on
 *  every tool call. Cleared on SW restart; explicit close via closeAllMcp(). */
const sessionPool = new Map<string, McpClient>();

async function getOrOpenSession(serverId: string): Promise<McpClient> {
  const existing = sessionPool.get(serverId);
  if (existing) return existing;

  const srv = await getServer(serverId);
  if (!srv) throw new Error(`MCP server ${serverId} no longer exists.`);

  let auth: TransportAuth = { kind: 'none' };
  if (srv.authKind === 'bearer') {
    const token = await getKey(srv.id);
    if (!token) throw new Error(`No key set for MCP server "${srv.name}".`);
    auth = { kind: 'bearer', token };
  }

  const client = new McpClient({ endpoint: srv.url, auth });
  await client.connect();
  sessionPool.set(serverId, client);
  return client;
}

/** Close every pooled MCP session. Called from the SW message dispatcher
 *  on chat end / extension shutdown so server-side sessions can be freed. */
export async function closeAllMcp(): Promise<void> {
  const closes: Promise<void>[] = [];
  for (const [id, client] of sessionPool) {
    closes.push(
      client.close().catch(() => {
        // best-effort; the server may have already closed the session
      }),
    );
    sessionPool.delete(id);
  }
  await Promise.all(closes);
}

/** Dispatch a model-issued tool call whose name is namespaced mcp_<serverId>_<toolName>.
 *  Returns a ToolResult shaped the same way every other agent tool returns —
 *  ok({content, isError}) for normal calls, err(kind, message) on transport
 *  / config faults. */
export async function executeMcpToolCall(
  namespacedName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseNamespacedToolName(namespacedName);
  if (!parsed) return err('not-found', `Tool "${namespacedName}" is not an MCP tool.`);
  const { serverId, toolName } = parsed;

  // Verify the tool is still ENABLED before dispatching. The cache might lag
  // by one turn after a Settings edit; this re-check guarantees a disabled
  // tool can't be called even if the model still has it in its tool list.
  const bindings = await collectEnabledMcpBindings();
  const match = bindings.find((b) => b.serverId === serverId && b.toolName === toolName);
  if (!match) {
    return err(
      'not-found',
      `MCP tool "${toolName}" on server "${serverId}" is not enabled. Toggle it on in Settings → MCP Servers.`,
    );
  }

  try {
    const client = await getOrOpenSession(serverId);
    const result = await client.callTool(toolName, args);
    // The MCP spec distinguishes "the call succeeded but the tool reported a
    // domain error" (result.isError === true) from a transport/protocol error
    // (throw). Both paths land here as ok({...}) so the agent can decide how
    // to recover — but we tag isError so the UI can render it differently.
    const text = flattenContent(result.content);
    return ok(
      {
        text,
        isError: result.isError === true,
        server: { id: match.serverId, name: match.serverName },
        tool: toolName,
        rawContent: result.content,
      },
      { provenance: [`mcp://${match.serverName}/${toolName}`] },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err('runtime-error', message);
  }
}

/** Collapse the MCP content array into a single string for the model context.
 *  Phase 2 only handles text + image (as a data URL). Resources are flattened
 *  to their inline text or a URI line. */
function flattenContent(blocks: Array<{ type: string; [k: string]: unknown }>): string {
  const parts: string[] = [];
  for (const b of blocks ?? []) {
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'image' && typeof b.data === 'string') {
      parts.push(`[image:${b.mimeType ?? 'image/png'}:${(b.data as string).length}b]`);
    } else if (b.type === 'resource') {
      const r = b.resource as { uri?: string; text?: string };
      if (r?.text) parts.push(r.text);
      else if (r?.uri) parts.push(`[resource: ${r.uri}]`);
    }
  }
  return parts.join('\n');
}
