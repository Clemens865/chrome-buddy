// MCP server registry — saved servers (URL + name + auth mode + tool prefs).
//
// IDB store 'mcpServers' (chrome-buddy DB, v12+). The actual bearer/API key
// for each server is NEVER stored here — it lives in chrome.storage.session
// keyed by the server id, so it's wiped on browser restart and the panel JS
// context can't touch it (the SW reads it before each fetch). See keys.ts.
//
// Phase 1: list + add + delete + the discovered tool catalog as a separate
// `tools` field that the Settings UI can render. Trust toggles + per-tool
// enabled flags ship in Phase 2 when the agent dispatcher uses them.

import { getDB } from '../db';
import type { McpTool } from './protocol';

const STORE = 'mcpServers';

export type AuthKind = 'none' | 'bearer';

export interface McpServer {
  /** Stable id; the storage.session key uses `mcp_key_${id}` so the key dies
   *  with the IDB row on delete. */
  id: string;
  /** Friendly name shown in the UI. Unique. */
  name: string;
  /** Streamable HTTP endpoint URL (https only — http allowed for localhost). */
  url: string;
  /** How we authenticate to this server. Phase 1: none or bearer. Phase 3
   *  adds 'oauth' with token storage in storage.session by the OAuth flow. */
  authKind: AuthKind;
  /** Optional user-supplied note. */
  note?: string;
  /** Most recently discovered tool list. Refreshed on a successful Test. */
  tools?: McpTool[];
  /** Last successful Test result (HTTP / handshake / tool count). */
  lastTestAt?: number;
  lastTestStatus?: 'ok' | 'error';
  lastTestMessage?: string;
  /** Phase 2 routing: gate between 'connected' and 'visible to the agent'.
   *  Default false — newly added servers are silent until the user opts in,
   *  to prevent context bloat from a 50-tool server appearing automatically. */
  enabledInAgent?: boolean;
  /** Phase 2 routing: per-tool include map. Default behavior (entry missing
   *  or true) is to include the tool. Setting false suppresses it from the
   *  function-declaration list without un-enabling the whole server. */
  toolFilter?: Record<string, boolean>;
  /** Per-tool trust map. 'always' = skip HITL confirm for this tool;
   *  'confirm' (or missing) = require confirm. Per-(server,tool), so trusting
   *  github.list_issues doesn't trust github.delete_repo. */
  trust?: Record<string, 'always' | 'confirm'>;
  createdAt: number;
  updatedAt: number;
}

export type NewServerInput = Omit<
  McpServer,
  'id' | 'createdAt' | 'updatedAt' | 'tools' | 'lastTestAt' | 'lastTestStatus' | 'lastTestMessage' | 'trust'
> & { id?: string };

function genId(): string {
  return `mcp_${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveServer(input: NewServerInput): Promise<McpServer> {
  const db = await getDB();
  const now = Date.now();
  const existing = input.id ? ((await db.get(STORE, input.id)) as McpServer | undefined) : undefined;
  const record: McpServer = {
    id: input.id ?? genId(),
    name: input.name.trim(),
    url: input.url.trim(),
    authKind: input.authKind,
    note: input.note?.trim() || undefined,
    tools: existing?.tools,
    lastTestAt: existing?.lastTestAt,
    lastTestStatus: existing?.lastTestStatus,
    lastTestMessage: existing?.lastTestMessage,
    trust: existing?.trust,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (!record.name) throw new Error('saveServer: name is required');
  if (!isAllowedUrl(record.url)) {
    throw new Error('saveServer: url must be https:// (http allowed for localhost only).');
  }
  await db.put(STORE, record);
  return record;
}

export async function listServers(): Promise<McpServer[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as McpServer[];
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getServer(id: string): Promise<McpServer | null> {
  if (!id) return null;
  const db = await getDB();
  const match = (await db.get(STORE, id)) as McpServer | undefined;
  return match ?? null;
}

export async function deleteServer(id: string): Promise<void> {
  // Cascade: remove the stored key too. clearKey is idempotent.
  const { clearKey } = await import('./keys');
  await clearKey(id);
  const db = await getDB();
  await db.delete(STORE, id);
}

/** Flip the server's enabledInAgent flag — exposes (or hides) its tools from
 *  the agent's function-declaration list on the next chat turn. */
export async function setServerEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE, id)) as McpServer | undefined;
  if (!existing) return;
  await db.put(STORE, { ...existing, enabledInAgent: enabled, updatedAt: Date.now() });
}

/** Toggle a single tool's inclusion under one server. Falls back to writing
 *  `false` (and reading absent-or-true as enabled) so the model gets every
 *  tool by default when a server is freshly enabled. */
export async function setToolEnabled(
  id: string,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE, id)) as McpServer | undefined;
  if (!existing) return;
  const filter = { ...(existing.toolFilter ?? {}) };
  if (enabled) delete filter[toolName];
  else filter[toolName] = false;
  await db.put(STORE, { ...existing, toolFilter: filter, updatedAt: Date.now() });
}

/** Set the trust level for a single (server, tool) pair. 'always' skips the
 *  HITL confirm; 'confirm' restores the default. */
export async function setToolTrust(
  id: string,
  toolName: string,
  level: 'always' | 'confirm',
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE, id)) as McpServer | undefined;
  if (!existing) return;
  const trust = { ...(existing.trust ?? {}) };
  if (level === 'confirm') delete trust[toolName];
  else trust[toolName] = level;
  await db.put(STORE, { ...existing, trust, updatedAt: Date.now() });
}

/** Persist the result of a Test Connection round-trip. */
export async function recordTestResult(
  id: string,
  status: 'ok' | 'error',
  message: string,
  tools?: McpTool[],
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE, id)) as McpServer | undefined;
  if (!existing) return;
  await db.put(STORE, {
    ...existing,
    lastTestAt: Date.now(),
    lastTestStatus: status,
    lastTestMessage: message.slice(0, 240),
    ...(tools ? { tools } : {}),
    updatedAt: Date.now(),
  });
}

// --- Pure helpers (unit-tested) ------------------------------------------

/** Reject endpoint URLs that point at non-http(s) schemes; require https
 *  except for localhost (so dev MCP servers on localhost:NNNN work). */
export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Pretty host for the row meta line (e.g. 'mcp.cloudflare.com'). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
