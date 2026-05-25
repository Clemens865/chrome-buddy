// Multi-session chat history. Each conversation is a saved transcript the user
// can reopen or delete. Persisted in IndexedDB ('chats' store), accessed from
// the panel (UI) directly. Heavy tool-result payloads (e.g. screenshots) are
// stripped before saving so storage stays small; the readable conversation
// (messages, plans, tool traces) is preserved.
import { getDB } from '../db';
import type { TranscriptItem } from '../agent';

export interface Conversation {
  id: string;
  title: string;
  items: TranscriptItem[];
  createdAt: number;
  updatedAt: number;
}

const STORE = 'chats';
/** Bound the history so IDB doesn't grow without limit on heavy users.
 * Eviction is by `updatedAt` (oldest-touched first), preserving recent chats. */
const MAX_CHATS = 100;

/** A short title from the first user message (or a default). */
export function deriveTitle(items: TranscriptItem[]): string {
  const firstUser = items.find((i) => i.kind === 'user');
  const text = firstUser && firstUser.kind === 'user' ? firstUser.text.trim() : '';
  return text ? text.slice(0, 60) : 'New chat';
}

/** Strip transient/heavy fields so saved conversations stay small + replayable. */
export function trimItems(items: TranscriptItem[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  for (const it of items) {
    switch (it.kind) {
      case 'user':
      case 'agent':
      case 'error':
      case 'plan':
        out.push(it);
        break;
      case 'tool':
        // Keep the trace (name + outcome), drop the (possibly large) result data.
        out.push({ kind: 'tool', id: it.id, step: it.step, call: it.call, status: it.status, verdict: it.verdict });
        break;
      // 'confirm' cards are transient (mid-run) — skip.
    }
  }
  return out;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await getDB();
  await db.put(STORE, { ...conv, items: trimItems(conv.items) });
  await evictOldestChats(db);
}

/** Drop the oldest-updatedAt chats once the store grows past MAX_CHATS. Pure
 * housekeeping — exported for tests + can be called manually if needed. */
export async function evictOldestChats(
  db?: Awaited<ReturnType<typeof getDB>>,
): Promise<number> {
  const d = db ?? (await getDB());
  const all = (await d.getAll(STORE)) as Conversation[];
  if (all.length <= MAX_CHATS) return 0;
  // Sort oldest-first by updatedAt and drop the excess.
  all.sort((a, b) => a.updatedAt - b.updatedAt);
  const toDrop = all.length - MAX_CHATS;
  const tx = d.transaction(STORE, 'readwrite');
  for (let i = 0; i < toDrop; i++) await tx.store.delete(all[i].id);
  await tx.done;
  return toDrop;
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as Conversation[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = await getDB();
  return ((await db.get(STORE, id)) as Conversation | undefined) ?? null;
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}
