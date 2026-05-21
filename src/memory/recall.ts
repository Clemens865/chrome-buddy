// Learned-flow recall (FR-MEM): when the user starts a new task, look for a
// past successful run that did something similar so we can offer to reuse it.
// Pure + dependency-free so it's trivially testable; the UI reads runs from the
// store and renders the suggestion.
import type { RunRecord } from './types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'this',
  'that', 'is', 'are', 'be', 'me', 'my', 'it', 'as', 'at', 'by', 'from', 'into',
  'please', 'can', 'you', 'i', 'we', 'do', 'get', 'all',
]);

/** Lowercased, de-stopworded, length>=3 token set for similarity scoring. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Jaccard overlap of two token sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export interface RecallMatch {
  run: RunRecord;
  score: number;
}

/**
 * Best past run similar to `task`, or null. Considers only runs that actually
 * produced an answer, requires a minimally specific query, and returns the top
 * match at or above `threshold`.
 */
export function findSimilarRun(
  task: string,
  runs: RunRecord[],
  { threshold = 0.4 }: { threshold?: number } = {},
): RecallMatch | null {
  const q = tokenize(task);
  if (q.size < 2) return null;
  let best: RecallMatch | null = null;
  for (const run of runs) {
    if (!run.answer.trim()) continue;
    const score = jaccard(q, tokenize(run.task));
    if (score >= threshold && (!best || score > best.score)) best = { run, score };
  }
  return best;
}
