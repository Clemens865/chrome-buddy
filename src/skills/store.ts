// SW-owned IndexedDB skill store (shared DB; see src/db.ts).
import { getDB } from '../db';
import type { Skill } from './types';

const STORE = 'skills';

export async function saveSkill(skill: Skill): Promise<void> {
  const d = await getDB();
  await d.put(STORE, skill);
}

export async function listSkills(): Promise<Skill[]> {
  const d = await getDB();
  const all = (await d.getAllFromIndex(STORE, 'createdAt')) as Skill[];
  return all.reverse(); // newest first
}

export async function deleteSkill(id: string): Promise<void> {
  const d = await getDB();
  await d.delete(STORE, id);
}
