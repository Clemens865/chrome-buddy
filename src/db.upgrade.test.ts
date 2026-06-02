import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { getDB } from './db';

// Reproduce the upgrade-from-data path: seed an OLD-shape DB (pre-collections,
// library rows WITHOUT collectionId), then open via the real getDB() (v14) and
// confirm the open succeeds, legacy rows are backfilled to 'general', and IDB
// writes work afterward (the bug was: open rejects → every IDB write dies).
describe('v14 upgrade with existing library data', () => {
  it('opens, backfills legacy rows, and IDB stays writable', async () => {
    const old = await openDB('chrome-buddy', 13, {
      upgrade(d) {
        d.createObjectStore('libraryDocs', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        d.createObjectStore('libraryChunks', { keyPath: 'id' }).createIndex('docId', 'docId');
        d.createObjectStore('chats', { keyPath: 'id' });
        d.createObjectStore('apps', { keyPath: 'id' });
      },
    });
    await old.put('libraryDocs', { id: 'd1', title: 'Old', content: 'x', updatedAt: 1 });
    await old.put('libraryChunks', { id: 'd1#0', docId: 'd1', text: 'x', embedding: [1] });
    old.close();

    const db = await getDB(); // version 14 → upgrade + backfillAfterOpen

    expect((await db.get('libraryDocs', 'd1')).collectionId).toBe('general');
    expect((await db.get('libraryChunks', 'd1#0')).collectionId).toBe('general');

    await db.put('chats', { id: 'c1', title: 'Hi', updatedAt: 2 });
    await db.put('apps', { id: 'a1', name: 'App', createdAt: 3 });
    await db.put('collections', { id: 'acme', name: 'Acme', description: '', kind: 'project', autoContext: 'active', createdAt: 1, updatedAt: 1 });
    expect(await db.get('chats', 'c1')).toBeTruthy();
    expect(await db.get('apps', 'a1')).toBeTruthy();
    expect(await db.get('collections', 'acme')).toBeTruthy();
  });
});
