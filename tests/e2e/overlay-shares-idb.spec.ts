// Locks the architectural fix: the overlay runs in an iframe at the
// extension origin (chrome-extension://EXT_ID/overlay.html), NOT in the
// page's origin. Therefore its IndexedDB is the SAME one the side panel
// uses — chats / library / notes / skills / workflows survive across the
// two surfaces.
//
// Previously the overlay rendered React directly in the content-script
// context, which ran at the PAGE'S origin → per-site IDB, separate from
// the side panel. The regression we're locking here is that the iframe
// approach restores shared persistence.
import { test, expect } from './fixtures';

test('overlay iframe IDB is the same instance as the side panel IDB', async ({ context, extensionId }) => {
  // Enable the overlay so the content script mounts the iframe.
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ overlayEnabled: true }));

  // Open the side panel and write a probe row into 'chats'.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const probeChat = {
    id: 'probe_shared_idb',
    title: 'Probe for shared IDB',
    items: [{ kind: 'user', id: 'u1', text: 'hello from the side panel' }],
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now(),
  };
  await panel.evaluate(async (chat) => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('chats', 'readwrite');
      tx.objectStore('chats').put(chat);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, probeChat);

  // Open a web page so the content script injects the iframe.
  const page = await context.newPage();
  await page.goto('https://example.com', { waitUntil: 'load' });

  // Wait for the iframe to mount.
  const overlayHost = page.locator('#chrome-buddy-overlay-host');
  await expect(overlayHost).toHaveCount(1, { timeout: 15_000 });
  const iframeEl = overlayHost.locator('iframe');
  await expect(iframeEl).toHaveAttribute('src', /chrome-extension:\/\/.+\/overlay\.html$/);

  // From INSIDE the iframe (which runs at the extension origin), read the
  // chats store and verify the probe row we wrote from the side panel is
  // visible. If the overlay ran in the page origin (the OLD bug) this read
  // would either fail or return an empty list.
  const overlayFrame = page.frameLocator('#chrome-buddy-overlay-host iframe');
  await overlayFrame.locator('body').waitFor({ timeout: 10_000 });
  const probeVisibleInOverlay = await overlayFrame.locator('html').evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    return await new Promise<boolean>((res) => {
      const tx = db.transaction('chats', 'readonly');
      const get = tx.objectStore('chats').get('probe_shared_idb');
      get.onsuccess = () => res(get.result !== undefined);
      get.onerror = () => res(false);
    });
  });
  expect(probeVisibleInOverlay).toBe(true);
});
