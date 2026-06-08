// Storage panel — quota bar, IndexedDB + Cache Storage sections, key search, and
// JSON snapshot export. read_storage + probe_storage_extra are stubbed.
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Storage panel: quota bar, IndexedDB + Cache sections, search, JSON export', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'read_storage') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          total: { keys: 3, bytes: 1200 },
          byArea: { localStorage: { keys: 2, bytes: 1000 }, sessionStorage: { keys: 1, bytes: 200 }, cookies: { keys: 0, bytes: 0 } },
          flagged: [],
          top: [
            { area: 'localStorage', key: 'theme', preview: 'string (5)', bytes: 40 },
            { area: 'localStorage', key: 'cart_items', preview: 'json-ish 800 chars', bytes: 960 },
          ],
        } } };
      }
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'probe_storage_extra') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          quota: { usage: 5_000_000, quota: 50_000_000 },
          idb: [{ name: 'app-db', version: 3, stores: [{ name: 'todos', count: 42 }, { name: 'meta', count: 1 }] }],
          caches: [{ name: 'workbox-precache', entries: 18 }],
        } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-storage').click();

  const storage = panel.getByTestId('ci-storage');
  await expect(storage).toBeVisible({ timeout: 8_000 });
  // Quota bar (5MB / 50MB = 10%).
  await expect(panel.getByTestId('ci-storage-quota')).toContainText('10%');
  // IndexedDB section: db name + a store with its record count.
  const idb = panel.getByTestId('ci-storage-idb');
  await expect(idb.getByText('app-db')).toBeVisible();
  await expect(idb.getByText(/todos \(42\)/)).toBeVisible();
  // Cache Storage section.
  await expect(panel.getByTestId('ci-storage-caches').getByText(/workbox-precache/)).toBeVisible();
  await expect(panel.getByTestId('ci-storage-caches').getByText(/18 entries/)).toBeVisible();

  await panel.screenshot({ path: path.join(SHOTS, '96-ci-storage.png') });

  // Search filters the entries list.
  await expect(storage.locator('.ci-storage-row')).toHaveCount(2);
  await panel.getByTestId('ci-storage-search').fill('cart');
  await expect(storage.locator('.ci-storage-row')).toHaveCount(1);
  await expect(storage.getByText('cart_items')).toBeVisible();
  await panel.getByTestId('ci-storage-search').fill('');

  // Export → JSON snapshot incl. IndexedDB + quota.
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('ci-storage-export').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('storage-snapshot.json');
  const snap = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
  expect(snap.indexedDB[0].name).toBe('app-db');
  expect(snap.quota.quota).toBe(50_000_000);
  expect(snap.cacheStorage[0].entries).toBe(18);
});
