// search_library / index_doc SW handlers. The library lives in IDB (owned by
// the SW), and embedding requires the Gemini API key, so both operations are
// SW-side. The UI calls these through TOOL_EXEC.

import { ok, err, type ToolResult } from '../types';
import {
  indexDoc,
  searchLibrary,
  findSimilarDocs,
  deleteDoc,
  getDoc,
  makeDocId,
  type SearchHit,
  type LibrarySource,
  type IndexInput,
} from '../library';
import {
  consolidateAndIndex,
  type ConsolidateDeps,
  type ConsolidateResult,
} from '../library/consolidate';
import { getLlmClient } from '../llm/instance';
import { renderConversationAsMarkdown } from '../library/mirror';
import { getDB } from '../db';
import type { Conversation } from '../chat/store';
import type { Note } from '../notes/store';

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
    const maxDocs = await readMaxDocsSetting();
    // LLM-driven consolidation (opt-in): only for NEW, user-curated docs
    // (manual snippets + notes). Auto-mirrored chats are keyed by chat id and
    // update in place, so consolidating them is noise + cost.
    if ((args.source === 'manual' || args.source === 'note') && (await readConsolidateSetting())) {
      const existing = await getDoc(makeDocId(args.source, args.sourceRef));
      if (!existing) {
        const res = await consolidateIndex(args, geminiKey(getKey), maxDocs);
        return ok(res);
      }
    }
    const r = await indexDoc(args, geminiKey(getKey), { maxDocs });
    return ok(r);
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

/** Cheap SW-side judge for the consolidation decision (Gemini flash-lite, JSON). */
async function judgeConsolidation(system: string, user: string): Promise<string> {
  const client = getLlmClient(PROVIDER);
  const r = await client.generate({
    model: 'gemini-2.5-flash-lite',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    params: { jsonMode: true, thinking: 'low' },
  });
  return r.text ?? '';
}

/** Index `args` with consolidation against the most similar existing doc. */
async function consolidateIndex(
  args: { source: LibrarySource; sourceRef?: string; title: string; content: string },
  getKey: () => Promise<string | undefined>,
  maxDocs: number | undefined,
): Promise<ConsolidateResult> {
  const excludeId = makeDocId(args.source, args.sourceRef);
  const deps: ConsolidateDeps = {
    findSimilar: async (content) => {
      const sims = await findSimilarDocs(content, getKey, { k: 1, excludeId });
      return sims.map((s) => ({ id: s.doc.id, title: s.doc.title, content: s.doc.content, score: s.score }));
    },
    judge: judgeConsolidation,
    index: async (input) => {
      await indexDoc({ ...input, source: input.source as LibrarySource } as IndexInput, getKey, { maxDocs });
    },
    remove: async (id) => {
      await deleteDoc(id);
    },
  };
  return consolidateAndIndex(args, deps);
}

/** Read the opt-in "consolidate library on save" setting (default off). */
async function readConsolidateSetting(): Promise<boolean> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
    const r = await chrome.storage.local.get('libraryConsolidate');
    return r.libraryConsolidate === true;
  } catch {
    return false;
  }
}

/** Read the user's configured Library doc cap from chrome.storage.local.
 * Defaults to undefined (→ indexDoc falls back to DEFAULT_MAX_DOCS). */
async function readMaxDocsSetting(): Promise<number | undefined> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
    const r = (await chrome.storage.local.get('libraryMaxDocs')) as { libraryMaxDocs?: number };
    return typeof r.libraryMaxDocs === 'number' && r.libraryMaxDocs > 0 ? r.libraryMaxDocs : undefined;
  } catch {
    return undefined;
  }
}

export interface BackfillResult {
  total: number;
  indexed: number;
  skipped: number;
  failed: number;
}

/**
 * One-time backfill: walk every chat + note in IDB and index it. The library
 * pipeline is idempotent (skip on unchanged contentHash), so this is safe to
 * run repeatedly; subsequent runs only embed new / changed content.
 *
 * Errors on individual docs are counted, not thrown — the user may have one
 * bad doc; we still want the other 99 to land.
 */
export async function executeLibraryBackfill(getKey: GetKey): Promise<BackfillResult> {
  const db = await getDB();
  const chats = (await db.getAll('chats')) as Conversation[];
  const notes = (await db.getAll('notes')) as Note[];
  const out: BackfillResult = { total: chats.length + notes.length, indexed: 0, skipped: 0, failed: 0 };
  const key = geminiKey(getKey);

  for (const c of chats) {
    const content = renderConversationAsMarkdown(c);
    if (!content.trim()) {
      out.skipped += 1;
      continue;
    }
    try {
      const r = await indexDoc(
        { source: 'chat', sourceRef: c.id, title: c.title || 'Untitled chat', content },
        key,
      );
      if (r.reindexed) out.indexed += 1;
      else out.skipped += 1;
    } catch {
      out.failed += 1;
    }
  }
  for (const n of notes) {
    if (!n.content?.trim()) {
      out.skipped += 1;
      continue;
    }
    try {
      const r = await indexDoc(
        { source: 'note', sourceRef: n.key, title: n.key, content: n.content },
        key,
      );
      if (r.reindexed) out.indexed += 1;
      else out.skipped += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}
