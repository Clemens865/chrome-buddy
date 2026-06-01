// Library RAG — public surface used by the SW handler + future Library UI.
//
// indexDoc(input): chunk → embed (in concurrent batches) → store the doc and
//                  its chunks atomically; idempotent on unchanged content
//                  (cheap re-saves do nothing).
// searchLibrary(query, k): embed query, cosine-rank ALL chunks, return top-K
//                  with their parent doc info attached for the caller.
//
// All side-effectful work (Gemini API + IDB) is in this orchestration layer;
// the chunker / embedder / store stay pure / single-purpose for testability.

import { chunkMarkdown, type ChunkOptions } from './chunk';
import { embedBatch, embedText, cosineSim, cosineSimAll, EMBED_VERSION } from './embed';
import {
  saveDoc,
  getDoc,
  listDocs,
  replaceChunks,
  getAllChunks,
  evictOldestDocs,
  hashContent,
  makeDocId,
  DEFAULT_MAX_DOCS,
  type LibraryDoc,
  type LibraryChunk,
  type LibrarySource,
} from './store';
import { DEFAULT_COLLECTION_ID } from './collections';

export interface IndexInput {
  /** Stable identifier within the source (chat.id, note.key, file path). */
  sourceRef?: string;
  source: LibrarySource;
  title: string;
  content: string;
  /** Target collection. Defaults to 'general' when omitted. */
  collectionId?: string;
  /** Optional user-supplied framing surfaced with every retrieved snippet
   *  ("is a competitor", "about our new product") so the model has context the
   *  raw text doesn't carry. */
  note?: string;
}

export interface IndexResult {
  docId: string;
  /** True when re-indexing; false when the content hash matched and we skipped. */
  reindexed: boolean;
  chunkCount: number;
}

export interface SearchHit {
  docId: string;
  docTitle: string;
  docSource: LibrarySource;
  docSourceRef?: string;
  /** The doc's collection, so callers can show/group provenance. */
  docCollectionId: string;
  /** User-supplied framing for this doc, if any (surfaced with the snippet). */
  docNote?: string;
  chunkIdx: number;
  /** Cosine similarity, in [-1, 1]. */
  score: number;
  /** The matched chunk text, ready to surface in a RAG context or UI. */
  text: string;
  charStart: number;
  charEnd: number;
}

export interface SearchOptions {
  k?: number;
  /** Minimum cosine score to include. Default 0 (no negatives). */
  threshold?: number;
  /** Restrict the search to these collections. Omit to search everything. */
  collectionIds?: readonly string[];
}

/**
 * Index a single doc into the library. Idempotent: if the doc id + contentHash
 * already exist, we skip both the chunker and embedder (zero API calls). On
 * change, we re-chunk and re-embed the whole doc and replace its chunks
 * atomically — partial-update semantics aren't worth the complexity at the
 * library size we target (low thousands of docs).
 */
export async function indexDoc(
  input: IndexInput,
  getKey: () => Promise<string | undefined>,
  opts: { chunk?: ChunkOptions; concurrency?: number; maxDocs?: number } = {},
): Promise<IndexResult> {
  if (!input.content?.trim()) {
    throw new Error('indexDoc: empty content');
  }
  const id = makeDocId(input.source, input.sourceRef);
  const contentHash = hashContent(input.content);
  const existing = await getDoc(id);
  // Skip only when content is unchanged AND the embeddings are the current
  // scheme — a stale embedVersion forces a re-embed even on identical content.
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.status === 'indexed' &&
    existing.embedVersion === EMBED_VERSION
  ) {
    return { docId: id, reindexed: false, chunkCount: existing.chunkCount };
  }

  const apiKey = await getKey();
  if (!apiKey) throw new Error('indexDoc: no API key available — set one in Settings');

  // Preserve an existing doc's collection on re-save unless the caller moves it.
  const collectionId = input.collectionId ?? existing?.collectionId ?? DEFAULT_COLLECTION_ID;
  // Mark as indexing so the UI can show a spinner if we crash mid-embed.
  const now = Date.now();
  const placeholder: LibraryDoc = {
    id,
    title: input.title,
    source: input.source,
    sourceRef: input.sourceRef,
    collectionId,
    note: input.note ?? existing?.note,
    content: input.content,
    contentHash,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    chunkCount: 0,
    status: 'indexing',
    embedVersion: EMBED_VERSION,
  };
  await saveDoc(placeholder);

  try {
    const pieces = chunkMarkdown(input.content, opts.chunk);
    if (pieces.length === 0) {
      // Empty after chunking — store as indexed with 0 chunks so it doesn't
      // get retried infinitely on every save.
      await saveDoc({ ...placeholder, status: 'indexed', chunkCount: 0 });
      return { docId: id, reindexed: true, chunkCount: 0 };
    }
    const vectors = await embedBatch(
      pieces.map((p) => p.text),
      apiKey,
      opts.concurrency ?? 8,
    );
    const chunks: LibraryChunk[] = pieces.map((p, i) => ({
      id: `${id}#${p.chunkIdx}`,
      docId: id,
      collectionId,
      chunkIdx: p.chunkIdx,
      text: p.text,
      embedding: vectors[i],
      embedVersion: EMBED_VERSION,
      charStart: p.charStart,
      charEnd: p.charEnd,
    }));
    await replaceChunks(id, chunks);
    await saveDoc({ ...placeholder, status: 'indexed', chunkCount: chunks.length });
    // Enforce the doc cap AFTER saving so the just-indexed doc isn't itself
    // evicted; older docs (by updatedAt) get dropped first.
    await evictOldestDocs(opts.maxDocs ?? DEFAULT_MAX_DOCS);
    return { docId: id, reindexed: true, chunkCount: chunks.length };
  } catch (e) {
    await saveDoc({ ...placeholder, status: 'failed' });
    throw e;
  }
}

/**
 * Search the library for the top-K chunks most similar to `query`. Returns
 * results enriched with the parent doc's title/source for the caller. The
 * cosine threshold defaults to 0 (filter clearly negative matches); auto-
 * context callers typically pass a stricter ~0.65.
 */
export async function searchLibrary(
  query: string,
  getKey: () => Promise<string | undefined>,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  if (!query?.trim()) return [];
  const apiKey = await getKey();
  if (!apiKey) throw new Error('searchLibrary: no API key available');
  // RETRIEVAL_QUERY: the query is embedded asymmetrically to the documents
  // (RETRIEVAL_DOCUMENT) — Gemini's recommended pairing for search quality.
  const queryVec = await embedText(query, apiKey, 'RETRIEVAL_QUERY');
  const chunks = await getAllChunks(opts.collectionIds);
  if (chunks.length === 0) return [];
  const ranked = cosineSimAll(queryVec, chunks, {
    k: opts.k ?? 5,
    threshold: opts.threshold ?? 0,
  });
  if (ranked.length === 0) return [];

  // Resolve parent docs once (avoid N round-trips when multiple hits share a doc).
  const docIds = Array.from(new Set(ranked.map((r) => chunks[r.idx].docId)));
  const docs = new Map<string, LibraryDoc | null>();
  await Promise.all(
    docIds.map(async (id) => {
      docs.set(id, await getDoc(id));
    }),
  );

  return ranked.map<SearchHit>(({ idx, score }) => {
    const c = chunks[idx];
    const d = docs.get(c.docId);
    return {
      docId: c.docId,
      docTitle: d?.title ?? '(deleted)',
      docSource: d?.source ?? 'manual',
      docSourceRef: d?.sourceRef,
      docCollectionId: d?.collectionId ?? c.collectionId,
      docNote: d?.note,
      chunkIdx: c.chunkIdx,
      score,
      text: c.text,
      charStart: c.charStart,
      charEnd: c.charEnd,
    };
  });
}

export interface SimilarDocHit {
  doc: LibraryDoc;
  /** Max cosine similarity of any of this doc's chunks to the query content. */
  score: number;
}

/**
 * Find existing docs most similar to `content` (for consolidation). Embeds a
 * representative slice of the content, then ranks each OTHER doc by its single
 * best-matching chunk (max-pool) — cheap and good enough to surface a likely
 * duplicate. `excludeId` keeps a re-save of one doc from matching itself.
 */
export async function findSimilarDocs(
  content: string,
  getKey: () => Promise<string | undefined>,
  opts: { k?: number; excludeId?: string; collectionIds?: readonly string[] } = {},
): Promise<SimilarDocHit[]> {
  if (!content?.trim()) return [];
  const apiKey = await getKey();
  if (!apiKey) return [];
  // Doc-vs-doc comparison → SEMANTIC_SIMILARITY (symmetric).
  const vec = await embedText(content.slice(0, 8000), apiKey, 'SEMANTIC_SIMILARITY');
  // Consolidation only makes sense within the same collection — a competitor
  // doc shouldn't merge into a profile doc just because they're similar.
  const chunks = await getAllChunks(opts.collectionIds);
  if (chunks.length === 0) return [];
  const best = new Map<string, number>();
  for (const c of chunks) {
    if (opts.excludeId && c.docId === opts.excludeId) continue;
    const s = cosineSim(vec, c.embedding);
    const prev = best.get(c.docId);
    if (prev === undefined || s > prev) best.set(c.docId, s);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, opts.k ?? 3);
  const out: SimilarDocHit[] = [];
  for (const [docId, score] of ranked) {
    const d = await getDoc(docId);
    if (d) out.push({ doc: d, score });
  }
  return out;
}

export interface ReembedProgress {
  total: number;
  done: number;
  reembedded: number;
  failed: number;
}

/**
 * Re-embed every doc whose chunks were built with an older embedding scheme
 * (stale `embedVersion`). Re-indexes from each doc's STORED content — no source
 * re-fetch — so it heals a dim/taskType migration. Idempotent: docs already on
 * EMBED_VERSION aren't touched; per-doc errors are counted, not thrown.
 */
export async function reembedStaleDocs(
  getKey: () => Promise<string | undefined>,
  onProgress?: (p: ReembedProgress) => void,
): Promise<ReembedProgress> {
  const docs = await listDocs();
  const stale = docs.filter((d) => d.embedVersion !== EMBED_VERSION);
  const progress: ReembedProgress = { total: stale.length, done: 0, reembedded: 0, failed: 0 };
  for (const d of stale) {
    try {
      if (d.content?.trim()) {
        await indexDoc(
          {
            source: d.source,
            sourceRef: d.sourceRef,
            title: d.title,
            content: d.content,
            collectionId: d.collectionId,
            note: d.note,
          },
          getKey,
        );
        progress.reembedded += 1;
      }
    } catch {
      progress.failed += 1;
    }
    progress.done += 1;
    onProgress?.({ ...progress });
  }
  return progress;
}

/** True when the library has any docs on an older embedding scheme. */
export async function hasStaleEmbeddings(): Promise<boolean> {
  const docs = await listDocs();
  return docs.some((d) => d.embedVersion !== EMBED_VERSION);
}

// Re-export the public types so the SW handler + UI don't need to import
// from store.ts directly.
export type { LibraryDoc, LibraryChunk, LibrarySource } from './store';
export { listDocs, deleteDoc, clearLibrary, getDoc, makeDocId } from './store';
export {
  DEFAULT_COLLECTION_ID,
  PROFILE_COLLECTION_ID,
  listCollections,
  getCollection,
  saveCollection,
  deleteCollection,
  ensureDefaultCollections,
  isProtectedCollection,
  slugify,
  makeCollectionId,
  validateCollectionName,
  type Collection,
  type CollectionKind,
  type AutoContextMode,
} from './collections';
