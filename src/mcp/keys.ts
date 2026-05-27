// MCP server key vault — bearer tokens / API keys live in chrome.storage.session
// keyed by server id. The panel-side code is allowed to WRITE (when the user
// pastes a key in Settings) and DELETE; reads happen only inside the SW just
// before a fetch is dispatched. The key never enters the model context, never
// lands in IDB, and is cleared on browser restart (NFR-SEC-1).

const PREFIX = 'mcp_key_';

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
