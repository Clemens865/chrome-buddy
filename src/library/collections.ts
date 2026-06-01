// Library collections — named buckets of RAG content (a personal-profile
// collection, a work collection, one per project…). Every LibraryDoc carries a
// collectionId; search can scope to one or more collections; each collection
// declares an auto-context mode so the chat knows when to pull from it.
//
// IDB CRUD is thin (covered by e2e); the pure helpers (slug, validation,
// defaults) are unit-tested.
import { getDB } from '../db';

const STORE = 'collections';

export type CollectionKind = 'profile' | 'project' | 'general';

/** When should the chat auto-retrieve from this collection?
 *  - always: every message pulls relevant snippets (e.g. personal profile)
 *  - active: only when the user toggles this collection on for the session
 *  - manual: never auto; the model may still call search_library explicitly */
export type AutoContextMode = 'always' | 'active' | 'manual';

export interface Collection {
  id: string;
  name: string;
  /** Shown to the model so it knows what's inside + when to search it. */
  description: string;
  kind: CollectionKind;
  autoContext: AutoContextMode;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_COLLECTION_ID = 'general';
export const PROFILE_COLLECTION_ID = 'personal-profile';

/** Seeded on first run. The profile collection is always-on so Buddy always
 *  knows the user; General is the catch-all default, manual by design. */
export const DEFAULT_COLLECTIONS: ReadonlyArray<Omit<Collection, 'createdAt' | 'updatedAt'>> = [
  {
    id: DEFAULT_COLLECTION_ID,
    name: 'General',
    description: 'Default catch-all collection for saved snippets, notes and pages.',
    kind: 'general',
    autoContext: 'manual',
  },
  {
    id: PROFILE_COLLECTION_ID,
    name: 'Personal Profile',
    description: 'Facts about the user — who they are, preferences, how they work, ongoing projects. Search this whenever the answer depends on knowing the user.',
    kind: 'profile',
    autoContext: 'always',
  },
];

/** Default collections that must always exist and cannot be deleted. */
export function isProtectedCollection(id: string): boolean {
  return id === DEFAULT_COLLECTION_ID || id === PROFILE_COLLECTION_ID;
}

/** URL/id-safe slug from a display name. Pure. */
export function slugify(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** A stable collection id from a name, with a fallback when the slug is empty
 *  (e.g. a name of only symbols). `seed` keeps the fallback deterministic in
 *  tests/callers that supply one. */
export function makeCollectionId(name: string, seed?: string): string {
  const slug = slugify(name);
  if (slug) return slug;
  return `col-${seed ?? Math.random().toString(36).slice(2, 10)}`;
}

/** Validate a proposed collection name. Returns an error string, or null if ok. */
export function validateCollectionName(name: string, existing: readonly Collection[] = []): string | null {
  const trimmed = (name ?? '').trim();
  if (trimmed.length < 2) return 'Name must be at least 2 characters.';
  if (trimmed.length > 60) return 'Name must be 60 characters or fewer.';
  const id = makeCollectionId(trimmed, 'x');
  if (existing.some((c) => c.id === id)) return 'A collection with a similar name already exists.';
  return null;
}

// --- CRUD ------------------------------------------------------------------

export async function listCollections(): Promise<Collection[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as Collection[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getCollection(id: string): Promise<Collection | null> {
  const db = await getDB();
  return ((await db.get(STORE, id)) as Collection | undefined) ?? null;
}

export async function saveCollection(c: Collection): Promise<void> {
  const db = await getDB();
  await db.put(STORE, c);
}

/** Create the seed collections if they're missing. Idempotent — safe to call
 *  on every SW startup. Uses a fixed timestamp so ordering is stable. */
export async function ensureDefaultCollections(now: number): Promise<void> {
  const db = await getDB();
  for (let i = 0; i < DEFAULT_COLLECTIONS.length; i++) {
    const def = DEFAULT_COLLECTIONS[i];
    const existing = await db.get(STORE, def.id);
    if (!existing) {
      // Stagger createdAt by index so General sorts before Personal Profile.
      await db.put(STORE, { ...def, createdAt: now + i, updatedAt: now + i });
    }
  }
}

/** Delete a (non-protected) collection. Caller is responsible for reassigning
 *  or deleting its docs first; this only removes the collection record. */
export async function deleteCollection(id: string): Promise<void> {
  if (isProtectedCollection(id)) throw new Error(`Cannot delete the protected collection "${id}".`);
  const db = await getDB();
  await db.delete(STORE, id);
}
