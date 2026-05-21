// Single IndexedDB owner for the extension (background SW context). Both run
// history (memory) and skills live here so there is one DB open with one
// upgrade path. Bump VERSION + add a store in upgrade() when adding a store.
import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'chrome-buddy';
const VERSION = 4;

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
      },
    });
  }
  return dbPromise;
}
