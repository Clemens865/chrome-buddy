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
import { embedBatch, embedText, cosineSimAll } from './embed';
import {
  saveDoc,
  getDoc,
  replaceChunks,
  getAllChunks,
  hashContent,
  makeDocId,
  type LibraryDoc,
  type LibraryChunk,
  type LibrarySource,
} from './store';

export interface IndexInput {
  /** Stable identifier within the source (chat.id, note.key, file path). */
  sourceRef?: string;
  source: LibrarySource;
  title: string;
  content: string;
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
  opts: { chunk?: ChunkOptions; concurrency?: number } = {},
): Promise<IndexResult> {
  if (!input.content?.trim()) {
    throw new Error('indexDoc: empty content');
  }
  const id = makeDocId(input.source, input.sourceRef);
  const contentHash = hashContent(input.content);
  const existing = await getDoc(id);
  if (existing && existing.contentHash === contentHash && existing.status === 'indexed') {
    return { docId: id, reindexed: false, chunkCount: existing.chunkCount };
  }

  const apiKey = await getKey();
  if (!apiKey) throw new Error('indexDoc: no API key available — set one in Settings');

  // Mark as indexing so the UI can show a spinner if we crash mid-embed.
  const now = Date.now();
  const placeholder: LibraryDoc = {
    id,
    title: input.title,
    source: input.source,
    sourceRef: input.sourceRef,
    content: input.content,
    contentHash,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    chunkCount: 0,
    status: 'indexing',
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
      chunkIdx: p.chunkIdx,
      text: p.text,
      embedding: vectors[i],
      charStart: p.charStart,
      charEnd: p.charEnd,
    }));
    await replaceChunks(id, chunks);
    await saveDoc({ ...placeholder, status: 'indexed', chunkCount: chunks.length });
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
  const queryVec = await embedText(query, apiKey);
  const chunks = await getAllChunks();
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
      chunkIdx: c.chunkIdx,
      score,
      text: c.text,
      charStart: c.charStart,
      charEnd: c.charEnd,
    };
  });
}

// Re-export the public types so the SW handler + UI don't need to import
// from store.ts directly.
export type { LibraryDoc, LibraryChunk, LibrarySource } from './store';
export { listDocs, deleteDoc, clearLibrary } from './store';
