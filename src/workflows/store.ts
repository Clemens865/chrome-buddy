// SW-owned IndexedDB workflow store (shared DB; see src/db.ts).
import { getDB } from '../db';
import type { Workflow } from './types';

const STORE = 'workflows';

export async function saveWorkflow(wf: Workflow): Promise<void> {
  const d = await getDB();
  await d.put(STORE, wf);
}

export async function listWorkflows(): Promise<Workflow[]> {
  const d = await getDB();
  const all = (await d.getAllFromIndex(STORE, 'createdAt')) as Workflow[];
  return all.reverse();
}

export async function deleteWorkflow(id: string): Promise<void> {
  const d = await getDB();
  await d.delete(STORE, id);
}
