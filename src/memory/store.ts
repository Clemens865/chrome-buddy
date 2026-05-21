// IndexedDB-backed run history, owned by the background service worker so the
// side panel and the in-page overlay (different origins) share one history.
// (PRD FR-MEM-1/3.) DB lifecycle is centralized in src/db.ts.
import { getDB } from '../db';
import type { RunRecord } from './types';

const STORE = 'runs';
const MAX_RUNS = 500;

export async function saveRun(record: RunRecord): Promise<void> {
  const d = await getDB();
  await d.put(STORE, record);
  const all = await d.getAllFromIndex(STORE, 'startedAt');
  if (all.length > MAX_RUNS) {
    const tx = d.transaction(STORE, 'readwrite');
    for (const r of all.slice(0, all.length - MAX_RUNS)) await tx.store.delete((r as RunRecord).id);
    await tx.done;
  }
}

export async function listRuns(limit = 100): Promise<RunRecord[]> {
  const d = await getDB();
  const all = (await d.getAllFromIndex(STORE, 'startedAt')) as RunRecord[];
  return all.reverse().slice(0, limit); // newest first
}

export async function clearRuns(): Promise<void> {
  const d = await getDB();
  await d.clear(STORE);
}
