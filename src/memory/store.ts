// IndexedDB-backed run history, owned by the background service worker so the
// side panel and the in-page overlay (different origins) share one history.
// (PRD FR-MEM-1/3; the SW is the single owner of memory.)
import { openDB, type IDBPDatabase } from 'idb';
import type { RunRecord } from './types';

const DB_NAME = 'chrome-buddy';
const STORE = 'runs';
const MAX_RUNS = 500;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('startedAt', 'startedAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveRun(record: RunRecord): Promise<void> {
  const d = await db();
  await d.put(STORE, record);
  // Trim oldest beyond the cap.
  const all = await d.getAllFromIndex(STORE, 'startedAt');
  if (all.length > MAX_RUNS) {
    const tx = d.transaction(STORE, 'readwrite');
    for (const r of all.slice(0, all.length - MAX_RUNS)) await tx.store.delete((r as RunRecord).id);
    await tx.done;
  }
}

export async function listRuns(limit = 100): Promise<RunRecord[]> {
  const d = await db();
  const all = (await d.getAllFromIndex(STORE, 'startedAt')) as RunRecord[];
  return all.reverse().slice(0, limit); // newest first
}

export async function clearRuns(): Promise<void> {
  const d = await db();
  await d.clear(STORE);
}
