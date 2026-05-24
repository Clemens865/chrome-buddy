// Notes — user-readable scratchpad / quick-capture store persisted in IndexedDB.
//
// First sink in the three-tier "where to save" routing (notes / disk / GitHub).
// Private to the extension, fast (no disk picker), non-consequential. Keyed by
// a short user-meaningful slug so the agent can recall by name.
import { getDB } from '../db';

export interface Note {
  /** Short, user-meaningful slug (e.g. "staging-url", "2026-05-25-meeting"). */
  key: string;
  /** Note body — markdown or plain text. */
  content: string;
  createdAt: number;
  updatedAt: number;
}

const STORE = 'notes';

/** Sanitise a user-supplied key into a safe slug. Returns '' for unusable input. */
export function normalizeKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Build the short snippet shown in note_list (first 120 chars, single-line). */
export function snippet(content: string, max = 120): string {
  const t = content.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function saveNote(key: string, content: string): Promise<Note> {
  const slug = normalizeKey(key);
  if (!slug) throw new Error('A non-empty key is required.');
  const now = Date.now();
  const db = await getDB();
  const prior = (await db.get(STORE, slug)) as Note | undefined;
  const note: Note = {
    key: slug,
    content,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };
  await db.put(STORE, note);
  return note;
}

export async function getNote(key: string): Promise<Note | null> {
  const slug = normalizeKey(key);
  if (!slug) return null;
  const db = await getDB();
  return ((await db.get(STORE, slug)) as Note | undefined) ?? null;
}

export async function listNotes(): Promise<Note[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as Note[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteNote(key: string): Promise<boolean> {
  const slug = normalizeKey(key);
  if (!slug) return false;
  const db = await getDB();
  const existed = !!(await db.get(STORE, slug));
  await db.delete(STORE, slug);
  return existed;
}
