// Run checkpointing (FR-AGENT-8 / NFR-REL-3). The agent runtime emits its
// JSON-serialisable RunState after the plan and after each step; we persist the
// latest snapshot to IndexedDB so a panel that's closed/reloaded mid-run can
// offer to resume — skipping completed steps so consequential actions never run
// twice. A single 'active' checkpoint is tracked; it's cleared when the run ends.
import { getDB } from '../db';
import type { RunState } from './types';

const STORE = 'runState';
const KEY = 'active';

/** A persisted checkpoint: the run scratchpad/state + the task + when. */
export interface RunCheckpoint {
  task: string;
  state: RunState;
  savedAt: number;
}

export async function saveCheckpoint(task: string, state: RunState): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE, { task, state, savedAt: Date.now() } satisfies RunCheckpoint, KEY);
  } catch {
    /* checkpointing is best-effort — never break a run on a write failure */
  }
}

export async function loadCheckpoint(): Promise<RunCheckpoint | null> {
  try {
    const db = await getDB();
    return ((await db.get(STORE, KEY)) as RunCheckpoint | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE, KEY);
  } catch {
    /* ignore */
  }
}
