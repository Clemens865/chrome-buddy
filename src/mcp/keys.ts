// MCP server key vault — bearer tokens / API keys live in chrome.storage.session
// keyed by server id. The panel-side code is allowed to WRITE (when the user
// pastes a key in Settings) and DELETE; reads happen only inside the SW just
// before a fetch is dispatched. The key never enters the model context, never
// lands in IDB, and is cleared on browser restart (NFR-SEC-1).

import type { TokenSet, OAuthConfig } from './oauth';
import { seal, open, isSealed } from './vault';

const PREFIX = 'mcp_key_';
// OAuth token custody (split by sensitivity + lifetime):
//   - access token  → storage.session (in-memory, short-lived, never on disk)
//   - refresh token → storage.local, AES-GCM sealed by the vault (survives
//     restart so reconnect is silent; ciphertext is useless off this profile)
//   - pending flow  → storage.session (verifier/state between BEGIN and COMPLETE;
//     survives SW idle-kills during the interactive authorize, dies on restart)
const OAUTH_AT = 'mcp_oauth_at_';
const OAUTH_RT = 'mcp_oauth_rt_';
const OAUTH_PENDING = 'mcp_oauth_pending_';

export async function setKey(serverId: string, token: string): Promise<void> {
  if (!serverId) throw new Error('setKey: serverId is required');
  if (!token) throw new Error('setKey: token is required (use clearKey to remove).');
  await chrome.storage.session.set({ [PREFIX + serverId]: token });
}

export async function getKey(serverId: string): Promise<string | undefined> {
  if (!serverId) return undefined;
  const r = (await chrome.storage.session.get(PREFIX + serverId)) as Record<string, unknown>;
  const v = r[PREFIX + serverId];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function clearKey(serverId: string): Promise<void> {
  if (!serverId) return;
  await chrome.storage.session.remove(PREFIX + serverId);
}

/** Has a key been stored for this server? Used by the Settings UI to decide
 *  whether to show "Replace key" vs "Add key" without revealing the value. */
export async function hasKey(serverId: string): Promise<boolean> {
  return (await getKey(serverId)) !== undefined;
}

// --- OAuth token custody (SW-only) ----------------------------------------

/** The non-secret-but-session-only half of a token set. */
export interface OAuthAccess {
  accessToken: string;
  /** Absolute epoch-ms expiry, or undefined for opaque/no-expiry tokens. */
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

/** Persist a freshly minted or refreshed token set: access half → session,
 *  refresh half → storage.local, sealed by the vault. Idempotent. */
export async function storeOAuthTokens(serverId: string, tokens: TokenSet): Promise<void> {
  if (!serverId) throw new Error('storeOAuthTokens: serverId is required');
  const access: OAuthAccess = {
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType,
    scope: tokens.scope,
  };
  await chrome.storage.session.set({ [OAUTH_AT + serverId]: access });
  if (tokens.refreshToken) {
    const sealed = await seal(tokens.refreshToken);
    await chrome.storage.local.set({ [OAUTH_RT + serverId]: sealed });
  }
}

/** Read the in-memory access token blob (undefined after a browser restart). */
export async function getOAuthAccess(serverId: string): Promise<OAuthAccess | undefined> {
  if (!serverId) return undefined;
  const r = (await chrome.storage.session.get(OAUTH_AT + serverId)) as Record<string, unknown>;
  const v = r[OAUTH_AT + serverId];
  return v && typeof v === 'object' ? (v as OAuthAccess) : undefined;
}

/** Read + decrypt the persisted refresh token (survives restart). Returns
 *  undefined when absent or undecryptable (key rotated / tampered). */
export async function getOAuthRefresh(serverId: string): Promise<string | undefined> {
  if (!serverId) return undefined;
  const r = (await chrome.storage.local.get(OAUTH_RT + serverId)) as Record<string, unknown>;
  const sealed = r[OAUTH_RT + serverId];
  if (!isSealed(sealed)) return undefined;
  try {
    return await open(sealed);
  } catch {
    return undefined;
  }
}

/** Wipe both halves of a server's OAuth tokens. Cascaded from deleteServer. */
export async function clearOAuth(serverId: string): Promise<void> {
  if (!serverId) return;
  await chrome.storage.session.remove(OAUTH_AT + serverId);
  await chrome.storage.local.remove(OAUTH_RT + serverId);
}

/** In-flight authorize state, parked between MCP_OAUTH_BEGIN and _COMPLETE. */
export interface OAuthPending {
  verifier: string;
  state: string;
  clientId: string;
  redirectUri: string;
  config: OAuthConfig;
}

export async function setOAuthPending(serverId: string, pending: OAuthPending): Promise<void> {
  await chrome.storage.session.set({ [OAUTH_PENDING + serverId]: pending });
}
export async function getOAuthPending(serverId: string): Promise<OAuthPending | undefined> {
  const r = (await chrome.storage.session.get(OAUTH_PENDING + serverId)) as Record<string, unknown>;
  const v = r[OAUTH_PENDING + serverId];
  return v && typeof v === 'object' ? (v as OAuthPending) : undefined;
}
export async function clearOAuthPending(serverId: string): Promise<void> {
  await chrome.storage.session.remove(OAUTH_PENDING + serverId);
}
