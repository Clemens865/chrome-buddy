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
  listDocs,
  listCollections,
  getCollection,
  saveCollection,
  deleteCollection,
  ensureDefaultCollections,
  makeCollectionId,
  validateCollectionName,
  reembedStaleDocs,
  hasStaleEmbeddings,
  DEFAULT_COLLECTION_ID,
  type SearchHit,
  type LibrarySource,
  type IndexInput,
  type Collection,
  type CollectionKind,
  type AutoContextMode,
} from '../library';
import { capturePageContext } from './pageTools';
import { EMBED_VERSION } from '../library/embed';
import {
  consolidateAndIndex,
  type ConsolidateDeps,
  type ConsolidateResult,
} from '../library/consolidate';
import { getLlmClient } from '../llm/instance';
import { renderConversationAsMarkdown } from '../library/mirror';
import { setDocCollection } from '../library/store';
import type { LibraryCollectionRecord } from '../key/messages';
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
  // Self-heal: kick a background re-embed if any docs are on an older embedding
  // scheme. Fire-and-forget + guarded — never blocks the search.
  void maybeMigrateEmbeddings(getKey);
  const k = typeof args.k === 'number' && args.k > 0 ? Math.min(20, Math.floor(args.k)) : 5;
  const threshold = typeof args.threshold === 'number' ? args.threshold : 0;
  // Optional collection scoping — accept an explicit collectionIds array (used
  // by always-on auto-context) or a single `collection` arg the model passes
  // (resolved by id or name).
  const explicitIds = Array.isArray(args.collectionIds)
    ? (args.collectionIds.filter((x) => typeof x === 'string') as string[])
    : undefined;
  const collectionIds = explicitIds && explicitIds.length ? explicitIds : await resolveCollectionArg(args.collection);
  try {
    const hits: SearchHit[] = await searchLibrary(query, geminiKey(getKey), { k, threshold, collectionIds });
    return ok({
      query,
      count: hits.length,
      hits: hits.map((h) => ({
        docId: h.docId,
        title: h.docTitle,
        source: h.docSource,
        sourceRef: h.docSourceRef,
        collection: h.docCollectionId,
        note: h.docNote,
        chunkIdx: h.chunkIdx,
        score: Number(h.score.toFixed(4)),
        snippet: h.text,
      })),
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// --- Embedding scheme migration (auto-heal) --------------------------------
let embedMigrationInFlight = false;
const EMBED_MIGRATED_KEY = 'embedMigratedVersion';

/**
 * Once per EMBED_VERSION, re-embed any docs left on an older embedding scheme so
 * a dimensionality/taskType upgrade self-heals. Guarded (in-memory + a
 * storage.local flag) so it runs at most once and only when a key is available;
 * fire-and-forget — never blocks the caller. Retries on the next search if there
 * was no key yet.
 */
async function maybeMigrateEmbeddings(getKey: GetKey): Promise<void> {
  if (embedMigrationInFlight) return;
  const local = chrome.storage?.local;
  if (!local) return;
  try {
    const flag = (await local.get(EMBED_MIGRATED_KEY)) as Record<string, number>;
    if (flag[EMBED_MIGRATED_KEY] === EMBED_VERSION) return;
    if (!(await hasStaleEmbeddings())) {
      await local.set({ [EMBED_MIGRATED_KEY]: EMBED_VERSION });
      return;
    }
    const keyFn = geminiKey(getKey);
    if (!(await keyFn())) return; // no key yet — try again next search
    embedMigrationInFlight = true;
    await reembedStaleDocs(keyFn);
    await local.set({ [EMBED_MIGRATED_KEY]: EMBED_VERSION });
  } catch {
    /* best-effort — will retry on the next search */
  } finally {
    embedMigrationInFlight = false;
  }
}

/** Resolve a model-supplied `collection` arg (id or display name) to a concrete
 *  collectionId list, or undefined to search everything. Lenient: matches by id
 *  first, then by slugified name, so the model can pass either. */
async function resolveCollectionArg(arg: unknown): Promise<string[] | undefined> {
  const raw = typeof arg === 'string' ? arg.trim() : '';
  if (!raw) return undefined;
  const cols = await listCollections();
  const byId = cols.find((c) => c.id === raw);
  if (byId) return [byId.id];
  const slug = makeCollectionId(raw, 'x');
  const byName = cols.find((c) => c.id === slug || c.name.toLowerCase() === raw.toLowerCase());
  return byName ? [byName.id] : [raw]; // fall back to the raw value as an id
}

/**
 * Internal SW helper used by the auto-mirror hooks + folder import + Settings.
 * Not exposed as an agent tool (the model shouldn't write to the library
 * directly — content flows in via mirror/import paths).
 */
export async function executeIndexDoc(
  args: { source: LibrarySource; sourceRef?: string; title: string; content: string; collectionId?: string; note?: string },
  getKey: GetKey,
): Promise<ToolResult> {
  try {
    const maxDocs = await readMaxDocsSetting();
    const collectionId = args.collectionId ?? DEFAULT_COLLECTION_ID;
    const input: IndexInput = { ...args, collectionId };
    // LLM-driven consolidation (opt-in): only for NEW, user-curated docs
    // (manual snippets + notes). Auto-mirrored chats are keyed by chat id and
    // update in place, so consolidating them is noise + cost. Consolidation is
    // scoped to the SAME collection (don't merge a competitor into a profile).
    if ((args.source === 'manual' || args.source === 'note') && (await readConsolidateSetting())) {
      const existing = await getDoc(makeDocId(args.source, args.sourceRef));
      if (!existing) {
        const res = await consolidateIndex(input, geminiKey(getKey), maxDocs);
        return ok(res);
      }
    }
    const r = await indexDoc(input, geminiKey(getKey), { maxDocs });
    return ok(r);
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

// --- Collections -----------------------------------------------------------

/** List collections (seeding defaults first) with per-collection doc counts. */
export async function executeListCollections(now: number): Promise<LibraryCollectionRecord[]> {
  await ensureDefaultCollections(now);
  const [cols, docs] = await Promise.all([listCollections(), listDocs()]);
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.collectionId, (counts.get(d.collectionId) ?? 0) + 1);
  return cols.map((c) => ({ ...c, docCount: counts.get(c.id) ?? 0 }));
}

/** Create (validated) or update a collection. */
export async function executeSaveCollection(
  input: { id?: string; name: string; description: string; kind: CollectionKind; autoContext: AutoContextMode },
  now: number,
): Promise<{ ok: true; collection: Collection } | { ok: false; error: string }> {
  const name = (input.name ?? '').trim();
  const existing = await listCollections();
  if (!input.id) {
    const msg = validateCollectionName(name, existing);
    if (msg) return { ok: false, error: msg };
  } else if (name.length < 2) {
    return { ok: false, error: 'Name must be at least 2 characters.' };
  }
  const id = input.id ?? makeCollectionId(name, now.toString(36));
  const prior = input.id ? await getCollection(input.id) : null;
  const collection: Collection = {
    id,
    name,
    description: (input.description ?? '').trim(),
    kind: input.kind,
    autoContext: input.autoContext,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };
  await saveCollection(collection);
  return { ok: true, collection };
}

/** Delete a collection, reassigning its docs to `reassignTo` (default General). */
export async function executeDeleteCollection(
  id: string,
  reassignTo: string,
  now: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const target = reassignTo || DEFAULT_COLLECTION_ID;
    const docs = (await listDocs()).filter((d) => d.collectionId === id);
    for (const d of docs) await setDocCollection(d.id, target, now);
    await deleteCollection(id); // throws on protected collections
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One-click capture: distill the active tab and index it into a collection. */
export async function executeCapturePage(
  collectionId: string,
  note: string | undefined,
  getKey: GetKey,
): Promise<{ ok: true; result: ToolResult; title: string; url: string } | { ok: false; error: string }> {
  // Larger cap than chat-context capture — whitepapers/articles are long.
  const page = await capturePageContext(60_000);
  if (!page || !page.text.trim()) {
    return { ok: false, error: 'No readable content in the active tab (restricted page, PDF viewer, or empty).' };
  }
  const result = await executeIndexDoc(
    {
      source: 'page',
      sourceRef: page.url,
      title: page.title || page.url,
      content: page.text,
      collectionId: collectionId || DEFAULT_COLLECTION_ID,
      note,
    },
    getKey,
  );
  return { ok: true, result, title: page.title || page.url, url: page.url };
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

/** Index `args` with consolidation against the most similar existing doc in the
 *  SAME collection. */
async function consolidateIndex(
  args: IndexInput,
  getKey: () => Promise<string | undefined>,
  maxDocs: number | undefined,
): Promise<ConsolidateResult> {
  const excludeId = makeDocId(args.source, args.sourceRef);
  const collectionId = args.collectionId ?? DEFAULT_COLLECTION_ID;
  const deps: ConsolidateDeps = {
    findSimilar: async (content) => {
      const sims = await findSimilarDocs(content, getKey, { k: 1, excludeId, collectionIds: [collectionId] });
      return sims.map((s) => ({ id: s.doc.id, title: s.doc.title, content: s.doc.content, score: s.score }));
    },
    judge: judgeConsolidation,
    index: async (input) => {
      // Keep the merged doc in this collection + carry the user note forward.
      await indexDoc(
        { ...input, source: input.source as LibrarySource, collectionId, note: args.note } as IndexInput,
        getKey,
        { maxDocs },
      );
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
