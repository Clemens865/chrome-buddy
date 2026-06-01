// Persistence for Voice Transcriber sessions (IndexedDB 'transcriptSessions').
// A session = one recording's transcript + metadata (date/time/length) + any
// post-processing outputs. Mirrors the chats/runs eviction-friendly pattern.
import { getDB } from '../db';
import type { TransformKind } from './transforms';

const STORE = 'transcriptSessions';

export interface TranscriptSession {
  id: string;
  title: string;
  /** Epoch ms when the recording started. */
  createdAt: number;
  /** Recording length in ms. */
  durationMs: number;
  /** The transcribed text. */
  transcript: string;
  /** Post-processing outputs keyed by transform (summary/cleaned/notes/speakers). */
  transforms: Partial<Record<TransformKind, string>>;
  updatedAt: number;
}

export async function saveSession(s: TranscriptSession): Promise<void> {
  const db = await getDB();
  await db.put(STORE, s);
}

export async function listSessions(): Promise<TranscriptSession[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as TranscriptSession[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSession(id: string): Promise<TranscriptSession | null> {
  const db = await getDB();
  return ((await db.get(STORE, id)) as TranscriptSession | undefined) ?? null;
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}
