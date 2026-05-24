// Notes — Agent-savable scratchpad in IndexedDB. End-to-end:
//   1) "Remember this for me: ..." → note_save fires, content persisted.
//   2) New chat (fresh transcript) → "what did I save about ..." → note_get fires
//      → answer references the saved content.
// Run with: npm run test:e2e:notes
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent saves a note, then recalls it in a new chat', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Start clean — wipe any prior notes from a previous run.
  await panel.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('chrome-buddy', 8);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('notes')) {
          d.createObjectStore('notes', { keyPath: 'key' }).createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  // 1) Save a note in Agent mode.
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Remember this for me as "staging-url": the new staging URL is https://staging-v2.example.com');
  await panel.getByRole('button', { name: 'Send' }).click();

  // note_save fires and settles.
  await expect(panel.locator('.tc-mini-name', { hasText: 'note_save' }).first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.tc-meta').first()).toBeVisible({ timeout: 60_000 });

  // Wait for the final reply (agent confirms it saved something).
  await expect(panel.locator('.msg-agent:not(.msg-subtle) .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '73-note-saved.png') });

  // Ground truth — the note is in IndexedDB with the expected content.
  const stored = await panel.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('chrome-buddy', 8);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const r = tx.objectStore('notes').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return all;
  });
  expect(stored.length).toBeGreaterThan(0);
  const note = stored[0] as { key: string; content: string };
  expect(note.content).toMatch(/staging-v2\.example\.com/);

  // 2) New chat — recall by key.
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(panel.locator('.chat-greeting-title')).toBeVisible();
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('What did I save under "staging-url"?');
  await panel.getByRole('button', { name: 'Send' }).click();

  // note_get fires, and the synthesized answer mentions the saved URL.
  await expect(panel.locator('.tc-mini-name', { hasText: 'note_get' }).first()).toBeVisible({ timeout: 60_000 });
  await expect(
    panel.locator('.msg-agent:not(.msg-subtle) .msg-body').filter({ hasText: /staging-v2\.example\.com/ }).first(),
  ).toBeVisible({ timeout: 90_000 });
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(SHOTS, '74-note-recalled.png') });
});
