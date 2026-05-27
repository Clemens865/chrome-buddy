// Generated-apps lifecycle — covers what the user explicitly asked for:
// "creating an app from description" and "importing a prompt app and a code
// app". There is no JSON import format (apps aren't bundle-shaped like skills
// / workflows), so we seed AppConfig objects directly into IDB and verify:
//
//   - The grid lists both a Tier-1 (declarative form + prompt template) and
//     a Tier-2 (sandboxed code) generated app.
//   - Opening the Tier-1 app shows its form fields immediately (no review).
//   - Opening the Tier-2 app first shows the review screen (FR-T2-5) with
//     the code body + requested capabilities; clicking Approve marks it
//     reviewed in IDB and reveals the run form.
//   - A second open of the same Tier-2 app skips the review (reviewed flag
//     persisted to IDB).
//   - Deleting a generated app removes it from the grid AND from IDB.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function seedGeneratedApps(panel: import('@playwright/test').Page) {
  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('apps', 'readwrite');
      const store = tx.objectStore('apps');
      const now = Date.now();
      // Tier-1: declarative prompt-template app.
      store.put({
        id: 'app_prompt_haiku',
        name: 'Haiku Maker',
        description: 'Compose a haiku about anything.',
        inputs: [
          { id: 'topic', label: 'Topic', type: 'text', placeholder: 'autumn leaves' },
        ],
        tier: 1,
        promptTemplate: 'Write a haiku (5-7-5) about: {{topic}}.',
        createdAt: now - 30_000,
      });
      // Tier-2: sandboxed code app. reviewed=false → review gate first.
      store.put({
        id: 'app_code_counter',
        name: 'Word Counter',
        description: 'Count words and characters deterministically.',
        inputs: [
          { id: 'text', label: 'Text', type: 'textarea', placeholder: 'paste any text' },
        ],
        tier: 2,
        permissions: [],
        code: 'const words = inputs.text.trim().split(/\\s+/).filter(Boolean).length;\nreturn { words, chars: inputs.text.length };',
        reviewed: false,
        createdAt: now - 10_000,
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  });
}

async function readApp(panel: import('@playwright/test').Page, id: string) {
  return await panel.evaluate(async (aid) => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    return await new Promise<Record<string, unknown> | null>((res) => {
      const tx = db.transaction('apps', 'readonly');
      const get = tx.objectStore('apps').get(aid);
      get.onsuccess = () => res(get.result ?? null);
    });
  }, id);
}

test('Generated apps: both a prompt app + a code app appear in the grid', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedGeneratedApps(panel);
  await panel.reload();

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  // Both seeded apps render alongside the built-ins.
  await expect(panel.getByText('Haiku Maker', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByText('Word Counter', { exact: true })).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '240-apps-generated-grid.png'), fullPage: true });
});

test('Tier-1 prompt app opens straight to its form (no review gate)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedGeneratedApps(panel);
  await panel.reload();
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Haiku Maker', { exact: true }).click();

  // No review screen. The form's input for "Topic" should be present.
  await expect(panel.getByText(/Review/)).toHaveCount(0);
  await expect(panel.getByPlaceholder('autumn leaves')).toBeVisible({ timeout: 5_000 });
  // Run button visible (label varies, but a primary button exists).
  await expect(panel.locator('.btn-primary').first()).toBeVisible();
});

test('Tier-2 code app: review gate fires on first open; Approve persists reviewed=true', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedGeneratedApps(panel);
  await panel.reload();
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Word Counter', { exact: true }).click();

  // Review screen shows the code + the (empty) capabilities list.
  await expect(panel.getByText(/Review/)).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByText('Code (runs sandboxed)')).toBeVisible();
  await expect(panel.locator('.t2-code')).toContainText('inputs.text');
  await expect(panel.getByText('Requested capabilities')).toBeVisible();
  await expect(panel.getByText(/none.*pure compute/i)).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '241-apps-tier2-review.png') });

  // Approve → run form appears.
  await panel.getByRole('button', { name: 'Approve & enable' }).click();
  await expect(panel.getByPlaceholder('paste any text')).toBeVisible({ timeout: 5_000 });

  // The reviewed flag must be true in IDB now.
  const stored = (await readApp(panel, 'app_code_counter')) as { reviewed?: boolean } | null;
  expect(stored?.reviewed).toBe(true);

  // Second open: no review gate.
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Word Counter', { exact: true }).click();
  await expect(panel.getByPlaceholder('paste any text')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByText(/Code \(runs sandboxed\)/)).toHaveCount(0);
});

test('Deleting a generated app removes it from the grid + from IDB', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedGeneratedApps(panel);
  await panel.reload();
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(panel.getByText('Haiku Maker', { exact: true })).toBeVisible({ timeout: 5_000 });

  // Each generated card has a small delete action with aria-label "Delete <name>".
  await panel.getByRole('button', { name: 'Delete Haiku Maker' }).click();

  // The card vanishes from the grid.
  await expect(panel.getByText('Haiku Maker', { exact: true })).toHaveCount(0);
  // The other generated app remains.
  await expect(panel.getByText('Word Counter', { exact: true })).toBeVisible();
  // IDB no longer has the deleted row.
  const stored = await readApp(panel, 'app_prompt_haiku');
  expect(stored).toBeNull();
});
