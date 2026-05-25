// search_library / index_doc SW handlers. The library lives in IDB (owned by
// the SW), and embedding requires the Gemini API key, so both operations are
// SW-side. The UI calls these through TOOL_EXEC.

import { ok, err, type ToolResult } from '../types';
import { indexDoc, searchLibrary, type SearchHit, type LibrarySource } from '../library';

type GetKey = (provider: string) => Promise<string | undefined>;

const PROVIDER = 'google-gemini';

function geminiKey(getKey: GetKey): () => Promise<string | undefined> {
  return () => getKey(PROVIDER);
}

/**
 * search_library — public agent tool. The model passes a natural-language
 * query; we return the top-K chunks with their parent doc titles + sources
 * so the model can cite them in its answer.
 */
export async function executeSearchLibrary(
  args: Record<string, unknown>,
  getKey: GetKey,
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return err('invalid-args', 'search_library requires a `query` string.');
  const k = typeof args.k === 'number' && args.k > 0 ? Math.min(20, Math.floor(args.k)) : 5;
  const threshold = typeof args.threshold === 'number' ? args.threshold : 0;
  try {
    const hits: SearchHit[] = await searchLibrary(query, geminiKey(getKey), { k, threshold });
    return ok({
      query,
      count: hits.length,
      hits: hits.map((h) => ({
        docId: h.docId,
        title: h.docTitle,
        source: h.docSource,
        sourceRef: h.docSourceRef,
        chunkIdx: h.chunkIdx,
        score: Number(h.score.toFixed(4)),
        snippet: h.text,
      })),
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Internal SW helper used by the auto-mirror hooks + folder import + Settings.
 * Not exposed as an agent tool (the model shouldn't write to the library
 * directly — content flows in via mirror/import paths).
 */
export async function executeIndexDoc(
  args: { source: LibrarySource; sourceRef?: string; title: string; content: string },
  getKey: GetKey,
): Promise<ToolResult> {
  try {
    const r = await indexDoc(args, geminiKey(getKey));
    return ok(r);
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}
