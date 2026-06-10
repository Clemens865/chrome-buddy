// SW-side MCP routes. The panel never opens an MCP session directly; it
// dispatches MCP_TEST (and later MCP_CALL_TOOL in Phase 2) and the SW does
// the fetch — so the bearer key lives only in chrome.storage.session and
// only the SW reads it before attaching the Authorization header.

import { McpClient } from '../mcp/client';
import {
  getKey,
  getOAuthAccess,
  getOAuthRefresh,
  storeOAuthTokens,
  setOAuthPending,
  getOAuthPending,
  clearOAuthPending,
} from '../mcp/keys';
import {
  getServer,
  listServers,
  recordTestResult,
  setOAuthRecord,
  type McpServer,
} from '../mcp/store';
import { collectMcpBindings, parseNamespacedToolName, type McpToolBinding } from '../mcp/merger';
import {
  discoverOAuthConfig,
  registerClient,
  generatePkce,
  randomState,
  buildAuthorizeUrl,
  parseRedirect,
  exchangeCode,
  refreshAccessToken,
  isExpired,
} from '../mcp/oauth';
import { makeRequest, MCP_PROTOCOL_VERSION, MCP_CLIENT_INFO } from '../mcp/protocol';
import { McpHttpError, type TransportAuth } from '../mcp/transport';
import type {
  McpOAuthBeginMessage,
  McpOAuthBeginResponse,
  McpOAuthCompleteMessage,
  McpOAuthCompleteResponse,
} from '../key/messages';
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

  // Resolve auth: explicit one-shot key overrides the stored one; 'oauth'
  // resolves (and refreshes if needed) the access token from the vault.
  let auth: TransportAuth;
  try {
    auth = await resolveAuth(srv, msg.oneShotKey);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordTestResult(srv.id, 'error', message);
    return { type: 'MCP_TEST', ok: false, error: message };
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

  const auth = await resolveAuth(srv);
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

  // Shape one successful call into the standard ToolResult.
  const callOnce = async (): Promise<ToolResult> => {
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
  };

  try {
    return await callOnce();
  } catch (e) {
    // Drop the pooled client on any error — if the session id is no longer
    // recognised by the server, leaving it pooled means every subsequent call
    // fails the same way until the SW restarts. Best-effort close, then evict.
    evictSession(serverId);

    // OAuth refresh-on-401: a token we thought valid was rejected (clock skew,
    // server-side revocation, or an opaque no-expiry token). Refresh once from
    // the stored refresh token and retry the call exactly once.
    if (e instanceof McpHttpError && e.status === 401) {
      const srv = await getServer(serverId);
      if (srv?.authKind === 'oauth') {
        try {
          await refreshOAuthNow(srv);
          return await callOnce();
        } catch (e2) {
          evictSession(serverId);
          return err('runtime-error', e2 instanceof Error ? e2.message : String(e2));
        }
      }
    }
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

/** Best-effort close + remove a pooled session. */
function evictSession(serverId: string): void {
  const pooled = sessionPool.get(serverId);
  if (pooled) {
    sessionPool.delete(serverId);
    void pooled.close().catch(() => {
      /* pool eviction is best-effort */
    });
  }
}

// --- Auth resolution (bearer + oauth) -----------------------------------

/** Build the TransportAuth for a server. Bearer reads the vault (or a one-shot
 *  key during pre-save testing); OAuth resolves a valid access token, silently
 *  refreshing via the stored refresh token when the access token has expired.
 *  Throws a user-facing Error when credentials are missing. */
async function resolveAuth(srv: McpServer, oneShotKey?: string): Promise<TransportAuth> {
  if (srv.authKind === 'bearer') {
    const token = oneShotKey ?? (await getKey(srv.id));
    if (!token) throw new Error('Bearer auth selected but no key is set. Paste a key in Settings.');
    return { kind: 'bearer', token };
  }
  if (srv.authKind === 'oauth') {
    return { kind: 'bearer', token: await resolveOAuthBearer(srv) };
  }
  return { kind: 'none' };
}

/** Return a valid OAuth access token for the server, proactively refreshing if
 *  the current one is missing or (near-)expired. Throws "needs reconnect" when
 *  no usable refresh token remains. */
async function resolveOAuthBearer(srv: McpServer): Promise<string> {
  if (!srv.oauth) {
    throw new Error(`"${srv.name}" isn't connected — use Connect with OAuth in Settings.`);
  }
  const access = await getOAuthAccess(srv.id);
  if (access && !isExpired(access)) return access.accessToken;
  return refreshOAuthNow(srv);
}

/** Force a token refresh from the stored refresh token, persist the result, and
 *  return the new access token. Used both for proactive expiry refresh and for
 *  the reactive refresh-on-401 retry. Throws "needs reconnect" when no refresh
 *  token remains (e.g. the refresh token itself expired or was revoked). */
async function refreshOAuthNow(srv: McpServer): Promise<string> {
  if (!srv.oauth) {
    throw new Error(`"${srv.name}" isn't connected — use Connect with OAuth in Settings.`);
  }
  const refresh = await getOAuthRefresh(srv.id);
  if (!refresh) {
    throw new Error(`"${srv.name}" needs reconnect — no valid OAuth token. Reconnect in Settings.`);
  }
  const next = await refreshAccessToken(srv.oauth.tokenEndpoint, {
    refreshToken: refresh,
    clientId: srv.oauth.clientId,
    resource: srv.oauth.resource,
    scopes: srv.oauth.scopes,
  });
  await storeOAuthTokens(srv.id, next);
  return next.accessToken;
}

// --- OAuth authorize flow (BEGIN / COMPLETE) ----------------------------

/** Best-effort probe for the RFC 9728 `WWW-Authenticate` challenge: an
 *  unauthenticated initialize POST; an OAuth-protected server answers 401 with
 *  a `resource_metadata` pointer. Returns the header (or null) — discovery falls
 *  back to the well-known path derivation when it's absent. */
async function probeWwwAuthenticate(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(
        makeRequest('initialize', {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: MCP_CLIENT_INFO,
        }),
      ),
    });
    return res.headers.get('www-authenticate');
  } catch {
    return null;
  }
}

/**
 * MCP_OAUTH_BEGIN — run discovery + dynamic client registration, mint a PKCE
 * pair + state, park them in storage.session, and return the authorize URL the
 * PANEL opens via chrome.identity.launchWebAuthFlow (the SW has no window).
 */
export async function executeMcpOAuthBegin(
  msg: McpOAuthBeginMessage,
): Promise<McpOAuthBeginResponse> {
  try {
    const srv = await getServer(msg.serverId);
    if (!srv) return { type: 'MCP_OAUTH_BEGIN', ok: false, error: `Server ${msg.serverId} not found.` };

    const redirectUri = chrome.identity.getRedirectURL();
    const wwwAuthenticate = await probeWwwAuthenticate(srv.url);
    const config = await discoverOAuthConfig(srv.url, { wwwAuthenticate });

    // Reuse an existing public client id when we already registered one;
    // otherwise dynamically register (RFC 7591). A server without a
    // registration endpoint and without a pre-set clientId can't proceed.
    let clientId = srv.oauth?.clientId;
    if (!clientId) {
      if (!config.registrationEndpoint) {
        return {
          type: 'MCP_OAUTH_BEGIN',
          ok: false,
          error:
            'This server needs a pre-registered OAuth client but offers no dynamic registration endpoint.',
        };
      }
      const client = await registerClient(config.registrationEndpoint, {
        redirectUri,
        scopes: config.scopes,
      });
      clientId = client.clientId;
    }

    const pkce = await generatePkce();
    const state = randomState();
    await setOAuthPending(msg.serverId, { verifier: pkce.verifier, state, clientId, redirectUri, config });

    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: config.authorizationEndpoint,
      clientId,
      redirectUri,
      codeChallenge: pkce.challenge,
      state,
      resource: config.resource,
      scopes: config.scopes,
    });
    return { type: 'MCP_OAUTH_BEGIN', ok: true, authorizeUrl, redirectUri };
  } catch (e) {
    return { type: 'MCP_OAUTH_BEGIN', ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * MCP_OAUTH_COMPLETE — the panel returns the redirect URL from
 * launchWebAuthFlow. Verify state, exchange the code for tokens, store them in
 * the vault, persist the non-secret config on the server row, and populate the
 * tool list via a normal Test round-trip.
 */
export async function executeMcpOAuthComplete(
  msg: McpOAuthCompleteMessage,
): Promise<McpOAuthCompleteResponse> {
  try {
    const pending = await getOAuthPending(msg.serverId);
    if (!pending) {
      return { type: 'MCP_OAUTH_COMPLETE', ok: false, error: 'No pending OAuth flow — start Connect again.' };
    }
    const { code } = parseRedirect(msg.redirectUrl, pending.state);
    const tokens = await exchangeCode(pending.config.tokenEndpoint, {
      code,
      codeVerifier: pending.verifier,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      resource: pending.config.resource,
    });
    await storeOAuthTokens(msg.serverId, tokens);
    await setOAuthRecord(msg.serverId, {
      resource: pending.config.resource,
      issuer: pending.config.issuer,
      authorizationEndpoint: pending.config.authorizationEndpoint,
      tokenEndpoint: pending.config.tokenEndpoint,
      registrationEndpoint: pending.config.registrationEndpoint,
      clientId: pending.clientId,
      scopes: pending.config.scopes,
      connectedAt: Date.now(),
    });
    await clearOAuthPending(msg.serverId);

    // Populate the tool catalog now that we can authenticate.
    const test = await executeMcpTest({ type: 'MCP_TEST', serverId: msg.serverId });
    if (!test.ok) {
      return { type: 'MCP_OAUTH_COMPLETE', ok: false, error: `Connected, but tool discovery failed: ${test.error}` };
    }
    return { type: 'MCP_OAUTH_COMPLETE', ok: true, serverName: test.serverName, toolCount: test.toolCount };
  } catch (e) {
    return { type: 'MCP_OAUTH_COMPLETE', ok: false, error: e instanceof Error ? e.message : String(e) };
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
