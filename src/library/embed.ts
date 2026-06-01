// Embedding + cosine similarity for the local Library RAG.
//
// embedText() calls Gemini's text-embedding-004 endpoint and returns the
// 768-dim vector as a plain number[] (IDB can't structured-clone Float32Array
// across all targets reliably; the cost of storing as number[] is a few extra
// bytes, well worth the portability).
//
// cosineSim / cosineSimAll are pure — no chrome, no I/O — so the math gets
// exhaustive unit tests separately from the network round-trip.

import { retryFetch } from '../llm/retry';
import { BUDDY_UA } from '../llm/ua';

// `gemini-embedding-001` is the stable text-only embedding model. The newer
// `gemini-embedding-2` is multimodal but we only need text for v1.
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;

/** Output vector size. 768 (vs the 3072 default) is 4× smaller storage + faster
 *  cosine at negligible quality loss (Matryoshka truncation). */
export const EMBED_DIM = 768;

/**
 * Embedding scheme version. Bump whenever the model, dimensionality, or taskType
 * usage changes so vectors from an older scheme count as stale and re-embed —
 * dim/space mismatches otherwise silently break cosine search.
 */
export const EMBED_VERSION = 2;

/** Gemini retrieval task types — the query/document asymmetry materially
 *  improves retrieval quality vs untyped embeddings. */
export type EmbedTaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'SEMANTIC_SIMILARITY';

/** L2-normalize a vector. gemini-embedding-001 does NOT auto-normalize truncated
 *  dimensions, so we do (canonical vectors; cosine is scale-invariant anyway,
 *  but this future-proofs any dot-product use). */
export function l2normalize(v: readonly number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : [...v];
}

/**
 * Embed a single text with gemini-embedding-001. `taskType` tunes the embedding
 * for its role (RETRIEVAL_DOCUMENT for indexed chunks, RETRIEVAL_QUERY for search
 * queries, SEMANTIC_SIMILARITY for doc-vs-doc). Returns an L2-normalized
 * EMBED_DIM vector. Caller supplies the API key. Throws on auth/network/parse.
 */
export async function embedText(
  text: string,
  apiKey: string,
  taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT',
): Promise<number[]> {
  if (!text?.trim()) throw new Error('embedText: empty text');
  if (!apiKey) throw new Error('embedText: missing API key');
  const url = `${EMBED_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const body = JSON.stringify({
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBED_DIM,
  });
  const res = await retryFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': BUDDY_UA },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`embedText: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { embedding?: { values?: number[] } };
  const v = json.embedding?.values;
  if (!Array.isArray(v) || v.length === 0) throw new Error('embedText: no embedding in response');
  return l2normalize(v);
}

/**
 * Embed a batch of texts in parallel with a concurrency cap. Indexing N
 * chunks one-at-a-time is slow; firing all N at once trips Gemini's QPS
 * limit. concurrency=8 is a safe default for the free tier.
 */
export async function embedBatch(
  texts: readonly string[],
  apiKey: string,
  concurrency = 8,
  taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT',
): Promise<number[][]> {
  const out = new Array<number[]>(texts.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= texts.length) return;
      out[i] = await embedText(texts[i], apiKey, taskType);
    }
  }
  const workers: Promise<void>[] = [];
  for (let k = 0; k < Math.min(concurrency, texts.length); k++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

/** Cosine similarity of two equal-length vectors. Pure. Range: [-1, 1]. */
export function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank a population by cosine similarity to the query. Returns indices
 * sorted by descending similarity. `threshold` filters out matches below the
 * given score (default 0, i.e. keep everything). Pure.
 */
export function cosineSimAll(
  query: readonly number[],
  pool: ReadonlyArray<{ embedding: readonly number[] }>,
  opts: { threshold?: number; k?: number } = {},
): Array<{ idx: number; score: number }> {
  // Default threshold of -Infinity means "no filtering" — keep every result
  // including negative-similarity ones. Callers wanting a quality cutoff
  // (e.g. RAG context) should pass an explicit threshold like 0.65.
  const threshold = opts.threshold ?? Number.NEGATIVE_INFINITY;
  const scored = pool.map((entry, idx) => ({ idx, score: cosineSim(query, entry.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  const filtered = scored.filter((s) => s.score >= threshold);
  return typeof opts.k === 'number' ? filtered.slice(0, opts.k) : filtered;
}
