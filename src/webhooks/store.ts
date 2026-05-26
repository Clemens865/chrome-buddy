// Webhook address book — saved endpoints the agent can POST to by NAME.
//
// IDB store 'webhooks' (chrome-buddy DB, v10+). Each row maps a friendly name
// (e.g. "Slack — design") to a target URL + default headers. The HITL gate
// in src/agent/runtime.ts always fires on send_webhook regardless of saved
// status — saving an endpoint reduces TYPING, not safety.
//
// URLs can carry secrets in the path (Slack incoming-webhooks, Zapier hooks,
// etc.) — the UI masks them by default; the SW + agent of course see the
// full URL when actually sending.

import { getDB } from '../db';

const STORE = 'webhooks';

export interface Webhook {
  /** Stable id (random); name is unique but the user can rename, so we don't
   *  key by name. */
  id: string;
  /** Friendly name — what the agent uses in send_webhook({ name }). Unique. */
  name: string;
  /** Target URL (http or https). */
  url: string;
  /** Default headers merged with any per-call overrides at execution time. */
  headers?: Record<string, string>;
  /** Optional description shown in the picker / HITL card. */
  note?: string;
  createdAt: number;
  /** Updated when the agent POSTs successfully via this entry. */
  lastUsedAt?: number;
}

export async function saveWebhook(w: Omit<Webhook, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): Promise<Webhook> {
  const db = await getDB();
  const record: Webhook = {
    id: w.id ?? `wh_${Math.random().toString(36).slice(2, 10)}`,
    name: w.name.trim(),
    url: w.url.trim(),
    headers: w.headers,
    note: w.note?.trim() || undefined,
    createdAt: w.createdAt ?? Date.now(),
    lastUsedAt: w.lastUsedAt,
  };
  if (!record.name) throw new Error('saveWebhook: name is required');
  if (!/^https?:\/\//i.test(record.url)) throw new Error('saveWebhook: url must start with http:// or https://');
  await db.put(STORE, record);
  return record;
}

export async function listWebhooks(): Promise<Webhook[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as Webhook[];
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getWebhookByName(name: string): Promise<Webhook | null> {
  if (!name) return null;
  const db = await getDB();
  const match = (await db.getFromIndex(STORE, 'name', name)) as Webhook | undefined;
  return match ?? null;
}

export async function deleteWebhook(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function touchWebhookLastUsed(id: string): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE, id)) as Webhook | undefined;
  if (!existing) return;
  await db.put(STORE, { ...existing, lastUsedAt: Date.now() });
}

// --- Pure helpers (no chrome / no I/O — unit-tested directly) -------------

/**
 * Mask a webhook URL for display: keep host + path-shape, redact id segments.
 * Slack T01ABC/B01DEF/abc123 → T01xxx/B01xxx/abcxxx style (each long segment
 * past the first one shows its first 3 chars then asterisks).
 * Keeps host visible so the user can still verify the destination.
 */
export function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return `${u.origin}/`;
    const masked = segs.map((s, i) =>
      i === 0 || s.length <= 4 ? s : `${s.slice(0, 3)}${'*'.repeat(Math.max(3, s.length - 3))}`,
    );
    return `${u.origin}/${masked.join('/')}`;
  } catch {
    return url.length > 32 ? `${url.slice(0, 24)}…` : url;
  }
}

/** Just the host of a webhook URL (for HITL card display). */
export function webhookHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
