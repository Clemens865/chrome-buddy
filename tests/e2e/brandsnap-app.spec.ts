// BrandSnap AI renders + runs in the opaque-origin sandbox. Seeds the exact
// catalog bundle (the file users install) into the apps store, opens it, and
// asserts its cb-* UI mounted and the `ui` ran (populated the style select).
// Run: npm run test:e2e:brandsnap
import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bundle = JSON.parse(readFileSync(join(process.cwd(), 'docs/catalog-seed/apps/brandsnap-ai.json'), 'utf8')) as {
  apps: Record<string, unknown>[];
};
const app = { ...bundle.apps[0], reviewed: true }; // trusted seed → skip the review gate

test('BrandSnap AI mounts its cb-* UI in the sandbox and the ui runs', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(async (a) => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('apps', 'readwrite');
      tx.objectStore('apps').put(a);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, app);
  await panel.reload();

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('BrandSnap AI').first().click();

  // The sandboxed app frame loads and renders BrandSnap's own UI.
  const frame = panel.frameLocator('.sandbox-app-frame');
  await expect(frame.getByRole('button', { name: 'Generate' })).toBeVisible({ timeout: 15_000 });
  // The `ui` function ran: it populated the Style <select> with presets.
  await expect(frame.locator('#style option', { hasText: 'Lifestyle' })).toHaveCount(1);
  await expect(frame.getByRole('button', { name: 'Download' })).toBeHidden(); // hidden until a generation exists
  await panel.screenshot({ path: join(process.cwd(), 'screenshots', 'brandsnap-app.png') });
});
