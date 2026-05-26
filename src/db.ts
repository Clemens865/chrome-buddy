// Single IndexedDB owner for the extension (background SW context). Both run
// history (memory) and skills live here so there is one DB open with one
// upgrade path. Bump VERSION + add a store in upgrade() when adding a store.
import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'chrome-buddy';
const VERSION = 10;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(d) {
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
      },
    });
  }
  return dbPromise;
}
