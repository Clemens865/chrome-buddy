// Single IndexedDB owner for the extension (background SW context). Both run
// history (memory) and skills live here so there is one DB open with one
// upgrade path. Bump VERSION + add a store in upgrade() when adding a store.
import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'chrome-buddy';
const VERSION = 14;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      // MUST stay synchronous. An IndexedDB versionchange transaction
      // auto-commits across `await` boundaries on real Chrome, so doing async
      // cursor work here throws TransactionInactiveError on upgrade-with-data
      // installs (which then poisons the cached dbPromise → all IDB dies). Do
      // schema changes ONLY here; defer any row backfill to backfillAfterOpen().
      upgrade(d, oldVersion, _newVersion, tx) {
        if (!d.objectStoreNames.contains('runs')) {
          d.createObjectStore('runs', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
        }
        if (!d.objectStoreNames.contains('skills')) {
          d.createObjectStore('skills', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        }
        if (!d.objectStoreNames.contains('workflows')) {
          d.createObjectStore('workflows', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        }
        if (!d.objectStoreNames.contains('apps')) {
          d.createObjectStore('apps', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        }
        // Out-of-line store for the File System Access root folder handle
        // (a structured-cloneable FileSystemDirectoryHandle, keyed 'root').
        if (!d.objectStoreNames.contains('fsroot')) {
          d.createObjectStore('fsroot');
        }
        // Out-of-line store for the in-flight agent run checkpoint (FR-AGENT-8),
        // a JSON-serialisable RunState keyed 'active'. Cleared when the run ends.
        if (!d.objectStoreNames.contains('runState')) {
          d.createObjectStore('runState');
        }
        // Chat conversations (multi-session chat history); sorted by updatedAt.
        if (!d.objectStoreNames.contains('chats')) {
          d.createObjectStore('chats', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        }
        // Agent-savable notes (user-readable scratchpad / quick-capture store).
        // Routing layer 1 default sink — see docs/gemini/action-items.md.
        if (!d.objectStoreNames.contains('notes')) {
          d.createObjectStore('notes', { keyPath: 'key' }).createIndex('updatedAt', 'updatedAt');
        }
        // Library v1 — RAG index. One store for docs (display unit, user-
        // visible records), one for chunks (search unit, embedded vectors).
        // Cascade-on-delete is enforced in code (deleteDoc removes chunks).
        if (!d.objectStoreNames.contains('libraryDocs')) {
          const docs = d.createObjectStore('libraryDocs', { keyPath: 'id' });
          docs.createIndex('updatedAt', 'updatedAt');
          docs.createIndex('source', 'source');
        }
        if (!d.objectStoreNames.contains('libraryChunks')) {
          d.createObjectStore('libraryChunks', { keyPath: 'id' }).createIndex('docId', 'docId');
        }
        // Webhook address book (v10) — friendly names → URL + default headers.
        // The agent uses send_webhook(name) to POST without re-typing the URL;
        // the HITL gate ALWAYS fires regardless of saved/named status.
        if (!d.objectStoreNames.contains('webhooks')) {
          d.createObjectStore('webhooks', { keyPath: 'id' }).createIndex('name', 'name', { unique: true });
        }
        // Webhook flows (v11) — saved one-tap automations from the
        // WebhookBuddy port. Each flow references a saved webhook by `name`
        // (so URL/headers stay in the address book, never duplicated) and
        // describes WHAT to snapshot from the current page before POSTing.
        // Categories are derived from the flow row's `categoryName` string —
        // no separate categories store so deletes can never orphan one.
        if (!d.objectStoreNames.contains('webhookFlows')) {
          const flows = d.createObjectStore('webhookFlows', { keyPath: 'id' });
          flows.createIndex('updatedAt', 'updatedAt');
          flows.createIndex('categoryName', 'categoryName');
        }
        // MCP servers (v12) — config only. The bearer token / API key for
        // each server NEVER lives here; it lives in chrome.storage.session
        // (see src/mcp/keys.ts) so it's wiped on browser restart and is
        // unreachable from the panel JS context (NFR-SEC-1).
        if (!d.objectStoreNames.contains('mcpServers')) {
          const m = d.createObjectStore('mcpServers', { keyPath: 'id' });
          m.createIndex('name', 'name', { unique: true });
          m.createIndex('updatedAt', 'updatedAt');
        }
        // v13: Voice Transcriber sessions (recording → transcript + transforms).
        if (!d.objectStoreNames.contains('transcriptSessions')) {
          d.createObjectStore('transcriptSessions', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        }
        // v14: Library collections — named RAG buckets. Add a 'collections'
        // store + index libraryDocs/libraryChunks by collectionId for scoped
        // search. The DATA backfill (stamping legacy rows with 'general') runs
        // post-open in backfillAfterOpen() — NOT here (see the sync note above).
        if (oldVersion < 14) {
          if (!d.objectStoreNames.contains('collections')) {
            d.createObjectStore('collections', { keyPath: 'id' }).createIndex('kind', 'kind');
          }
          for (const name of ['libraryDocs', 'libraryChunks']) {
            if (!d.objectStoreNames.contains(name)) continue;
            const store = tx.objectStore(name);
            if (!store.indexNames.contains('collectionId')) {
              store.createIndex('collectionId', 'collectionId');
            }
          }
        }
      },
    })
      .then(async (db) => {
        await backfillAfterOpen(db);
        return db;
      })
      .catch((e) => {
        // Never cache a rejected open — a transient failure would otherwise
        // poison every subsequent IDB call for the SW's lifetime.
        dbPromise = null;
        throw e;
      });
  }
  return dbPromise;
}

/**
 * One-time data migrations that can't run inside the versionchange transaction
 * (which auto-commits across awaits on Chrome). Stamps any libraryDocs /
 * libraryChunks rows missing a collectionId with 'general'. Uses a single
 * bulk-put transaction (all puts issued synchronously, then await tx.done) —
 * the safe idb pattern that keeps the transaction alive. Idempotent + cheap
 * (no-op when nothing is stale).
 */
async function backfillAfterOpen(db: IDBPDatabase): Promise<void> {
  for (const name of ['libraryDocs', 'libraryChunks']) {
    if (!db.objectStoreNames.contains(name)) continue;
    try {
      const all = (await db.getAll(name)) as Array<{ collectionId?: string }>;
      const stale = all.filter((r) => r && r.collectionId === undefined);
      if (stale.length === 0) continue;
      const tx = db.transaction(name, 'readwrite');
      for (const r of stale) tx.store.put({ ...r, collectionId: 'general' });
      await tx.done;
    } catch {
      // Best-effort — a backfill hiccup must never block opening the DB.
    }
  }
}
