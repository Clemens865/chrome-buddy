// SW-owned persistence for Tier-1 apps (IndexedDB 'apps' store).
import { getDB } from '../db';
import type { AppConfig } from './types';

const STORE = 'apps';

export async function saveApp(app: AppConfig): Promise<void> {
  const db = await getDB();
  await db.put(STORE, app);
}

export async function listApps(): Promise<AppConfig[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as AppConfig[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteApp(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}
