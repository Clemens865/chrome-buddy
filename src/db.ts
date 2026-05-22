// Single IndexedDB owner for the extension (background SW context). Both run
// history (memory) and skills live here so there is one DB open with one
// upgrade path. Bump VERSION + add a store in upgrade() when adding a store.
import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'chrome-buddy';
const VERSION = 6;

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
      },
    });
  }
  return dbPromise;
}
