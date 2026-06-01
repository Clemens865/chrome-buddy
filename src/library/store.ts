// Library RAG — IndexedDB CRUD for docs + chunks.
//
// libraryDocs : user-visible records (one note = one doc, one chat = one doc,
//               one .md file = one doc). Indexed by updatedAt + source.
// libraryChunks: search units. Each chunk holds its embedding vector. Indexed
//               by docId so cascade-on-delete is a single index scan.
//
// Both stores live in the shared chrome-buddy IDB (see src/db.ts, version 9+).

import { getDB } from '../db';

export type LibrarySource = 'chat' | 'note' | 'folder' | 'manual' | 'file' | 'page';

export interface LibraryDoc {
  /** Stable id — hash(source + sourceRef) keeps the row idempotent on re-save. */
  id: string;
  title: string;
  source: LibrarySource;
  sourceRef?: string;
  /** Which collection this doc belongs to (e.g. 'general', 'personal-profile').
   *  Defaults to 'general' for legacy docs (backfilled in db v14). */
  collectionId: string;
  /** Optional user-supplied framing ("is a competitor", "about our product")
   *  surfaced with retrieved snippets so the model has context the text lacks. */
  note?: string;
  /** Full text — kept so we can re-chunk later if the chunker changes. */
  content: string;
  /** Content fingerprint — used to skip re-indexing when unchanged. */
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  chunkCount: number;
  status: 'indexed' | 'indexing' | 'failed';
  /** Embedding scheme version the chunks were built with (see embed.ts
   *  EMBED_VERSION). A mismatch marks the doc stale for re-embedding. */
  embedVersion?: number;
}

export interface LibraryChunk {
  /** `${docId}#${chunkIdx}` — stable across re-indexes for the same doc. */
  id: string;
  docId: string;
  /** Denormalized from the parent doc so search can scope to a collection
   *  without a doc join. */
  collectionId: string;
  chunkIdx: number;
  text: string;
  /** Gemini embedding vector. Stored as number[] for IDB portability. */
  embedding: number[];
  /** Embedding scheme version (see embed.ts EMBED_VERSION). */
  embedVersion?: number;
  charStart: number;
  charEnd: number;
}

const DOCS = 'libraryDocs';
const CHUNKS = 'libraryChunks';
/** Bound the library so a power user importing everything doesn't blow IDB.
 * Matches the chats(100) / runs(500) pattern: oldest-updatedAt evicted first
 * once the count exceeds the cap. Configurable via Settings. */
export const DEFAULT_MAX_DOCS = 1000;

// --- Doc CRUD --------------------------------------------------------------

export async function saveDoc(doc: LibraryDoc): Promise<void> {
  const db = await getDB();
  await db.put(DOCS, doc);
}

export async function getDoc(id: string): Promise<LibraryDoc | null> {
  const db = await getDB();
  return ((await db.get(DOCS, id)) as LibraryDoc | undefined) ?? null;
}

export async function listDocs(): Promise<LibraryDoc[]> {
  const db = await getDB();
  const all = (await db.getAll(DOCS)) as LibraryDoc[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Drop a doc and ALL of its chunks. Single transaction so we don't leak
 * orphan chunks if the call is interrupted. */
export async function deleteDoc(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([DOCS, CHUNKS], 'readwrite');
  const chunks = (await tx.objectStore(CHUNKS).index('docId').getAll(id)) as LibraryChunk[];
  for (const c of chunks) await tx.objectStore(CHUNKS).delete(c.id);
  await tx.objectStore(DOCS).delete(id);
  await tx.done;
}

// --- Chunk CRUD ------------------------------------------------------------

/** Replace ALL chunks for a doc in one transaction. Used after re-chunking. */
export async function replaceChunks(docId: string, chunks: LibraryChunk[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(CHUNKS, 'readwrite');
  const store = tx.objectStore(CHUNKS);
  // Wipe existing chunks for this doc before writing the new set.
  const existing = (await store.index('docId').getAll(docId)) as LibraryChunk[];
  for (const c of existing) await store.delete(c.id);
  for (const c of chunks) await store.put(c);
  await tx.done;
}

export async function getChunks(docId: string): Promise<LibraryChunk[]> {
  const db = await getDB();
  const all = (await db.getAllFromIndex(CHUNKS, 'docId', docId)) as LibraryChunk[];
  return all.sort((a, b) => a.chunkIdx - b.chunkIdx);
}

/** Load every chunk across every doc — used by the search path to score
 * against the full corpus. The chunk count is bounded by user content size;
 * for typical libraries (1-2K docs × ~10 chunks each) this is ~10-20K rows,
 * well within IDB's getAll() comfort zone. */
export async function getAllChunks(collectionIds?: readonly string[]): Promise<LibraryChunk[]> {
  const db = await getDB();
  // Scoped search: union the chunks of just the requested collections via the
  // collectionId index — avoids loading the whole corpus into memory when the
  // user only wants one collection. No ids → the full corpus (legacy behavior).
  if (collectionIds && collectionIds.length > 0) {
    const seen = new Set<string>();
    const out: LibraryChunk[] = [];
    for (const cid of collectionIds) {
      const rows = (await db.getAllFromIndex(CHUNKS, 'collectionId', cid)) as LibraryChunk[];
      for (const r of rows) {
        if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
      }
    }
    return out;
  }
  return (await db.getAll(CHUNKS)) as LibraryChunk[];
}

/** Move a doc (and all its chunks) to a different collection in one tx. Used
 *  when a collection is deleted and its docs are reassigned. */
export async function setDocCollection(docId: string, collectionId: string, now: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([DOCS, CHUNKS], 'readwrite');
  const doc = (await tx.objectStore(DOCS).get(docId)) as LibraryDoc | undefined;
  if (doc) await tx.objectStore(DOCS).put({ ...doc, collectionId, updatedAt: now });
  const chunks = (await tx.objectStore(CHUNKS).index('docId').getAll(docId)) as LibraryChunk[];
  for (const c of chunks) await tx.objectStore(CHUNKS).put({ ...c, collectionId });
  await tx.done;
}

export async function clearLibrary(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([DOCS, CHUNKS], 'readwrite');
  await tx.objectStore(DOCS).clear();
  await tx.objectStore(CHUNKS).clear();
  await tx.done;
}

/**
 * Drop the oldest-updatedAt docs (and their chunks) once the library grows
 * past `max`. Pure housekeeping — exported for tests + the indexer to call
 * after each saveDoc. Returns how many docs were evicted.
 */
export async function evictOldestDocs(max: number = DEFAULT_MAX_DOCS): Promise<number> {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const db = await getDB();
  const all = (await db.getAll(DOCS)) as LibraryDoc[];
  if (all.length <= max) return 0;
  all.sort((a, b) => a.updatedAt - b.updatedAt);
  const toDrop = all.slice(0, all.length - max);
  const tx = db.transaction([DOCS, CHUNKS], 'readwrite');
  const docStore = tx.objectStore(DOCS);
  const chunkStore = tx.objectStore(CHUNKS);
  for (const d of toDrop) {
    const chunks = (await chunkStore.index('docId').getAll(d.id)) as LibraryChunk[];
    for (const c of chunks) await chunkStore.delete(c.id);
    await docStore.delete(d.id);
  }
  await tx.done;
  return toDrop.length;
}

// --- Utilities -------------------------------------------------------------

/** Deterministic content hash (FNV-1a 32-bit, hex). Cheap, no crypto needed
 * for our use case (skip re-index when text unchanged; not security-sensitive). */
export function hashContent(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Build the stable doc id from source + ref. Chats / notes always have a
 * ref; folder imports use the path; manual entries get a random suffix. */
export function makeDocId(source: LibrarySource, sourceRef?: string): string {
  if (sourceRef) return `${source}:${hashContent(sourceRef)}`;
  return `${source}:${Math.random().toString(36).slice(2, 10)}`;
}
