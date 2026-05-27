// Library docs view — list + delete. The folder-import surface uses the FSA
// showDirectoryPicker, which Playwright can't drive, so we exercise the
// view's deterministic surface by seeding docs directly into the libraryDocs
// IDB store and asserting the list rendering + delete mechanics.
//
// User asked for "import a folder to index" coverage. Live import requires
// a real user gesture — we cover the OBSERVABLE outcome (docs appear in the
// list, can be removed) which is what the folder-import flow ultimately
// produces.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function seedLibraryDocs(panel: import('@playwright/test').Page) {
  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('libraryDocs', 'readwrite');
      const store = tx.objectStore('libraryDocs');
      const now = Date.now();
      store.put({
        id: 'lib_doc_a',
        title: 'Vienna travel notes',
        source: 'folder',
        sourceRef: 'travel/vienna.md',
        chunkCount: 3,
        contentHash: 'sha_a',
        bytes: 1500,
        createdAt: now - 30_000,
        updatedAt: now - 30_000,
      });
      store.put({
        id: 'lib_doc_b',
        title: 'Project roadmap',
        source: 'chat',
        sourceRef: 'chat_42',
        chunkCount: 7,
        contentHash: 'sha_b',
        bytes: 3200,
        createdAt: now - 20_000,
        updatedAt: now - 20_000,
      });
      store.put({
        id: 'lib_doc_c',
        title: 'Inbox sweep',
        source: 'note',
        sourceRef: 'note_inbox',
        chunkCount: 1,
        contentHash: 'sha_c',
        bytes: 280,
        createdAt: now - 5_000,
        updatedAt: now - 5_000,
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  });
}

test('Library: seeded docs render with source pill + chunk count', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedLibraryDocs(panel);
  await panel.reload();

  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByTestId('library-view')).toBeVisible({ timeout: 5_000 });

  // All three seeded docs render with their source pill + chunk count.
  await expect(panel.getByText('Vienna travel notes')).toBeVisible();
  await expect(panel.getByText('Project roadmap')).toBeVisible();
  await expect(panel.getByText('Inbox sweep')).toBeVisible();
  // Source pills indicate the three different sources.
  await expect(panel.locator('.library-source-folder').filter({ hasText: 'folder' })).toBeVisible();
  await expect(panel.locator('.library-source-chat').filter({ hasText: 'chat' })).toBeVisible();
  await expect(panel.locator('.library-source-note').filter({ hasText: 'note' })).toBeVisible();
  // Chunk-count meta shows for each row.
  await expect(panel.getByText('3 chunk(s)')).toBeVisible();
  await expect(panel.getByText('7 chunk(s)')).toBeVisible();
  await expect(panel.getByText('1 chunk(s)')).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '270-library-docs.png') });
});

test('Library: deleting a doc removes the row + the IDB entry', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedLibraryDocs(panel);
  await panel.reload();
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByText('Vienna travel notes')).toBeVisible({ timeout: 5_000 });

  // Each row has aria-label "Delete <title>".
  await panel.getByRole('button', { name: 'Delete Vienna travel notes' }).click();
  await expect(panel.getByText('Vienna travel notes')).toHaveCount(0);
  // The other two remain.
  await expect(panel.getByText('Project roadmap')).toBeVisible();
  await expect(panel.getByText('Inbox sweep')).toBeVisible();

  // IDB confirms.
  const stillThere = await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    return await new Promise<number>((res) => {
      const tx = db.transaction('libraryDocs', 'readonly');
      const all = tx.objectStore('libraryDocs').getAll();
      all.onsuccess = () => res((all.result as Array<{ id: string }>).length);
    });
  });
  expect(stillThere).toBe(2);
});

test('Library: empty state when no docs are indexed', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByTestId('library-view')).toBeVisible({ timeout: 5_000 });
  // The Import folder button is the way out of the empty state.
  await expect(panel.getByTestId('library-import-folder')).toBeVisible();
});
