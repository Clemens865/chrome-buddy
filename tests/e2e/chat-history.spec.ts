// Multi-session chat history: a slide-over "Chats" list (☰ in the chat header)
// lists past conversations, switching restores a transcript, and "New chat"
// starts fresh. Deterministic (no LLM key): we seed two conversations straight
// into the 'chats' IndexedDB store, then drive the UI.
// Run with: npm run test:e2e:chathistory
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('chat history lists, switches, starts new, and deletes conversations', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed two conversations directly into the 'chats' store. We open the DB at
  // the app's schema version with an idempotent upgrade so the store exists
  // whether or not the panel has opened the DB yet.
  await panel.evaluate(async () => {
    const now = Date.now();
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      // Match the app's current schema version (src/db.ts). Opening at a
      // lower version when the DB is already at the current version throws
      // VersionError, breaking the seed.
      const req = indexedDB.open('chrome-buddy', 12);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('chats')) {
          d.createObjectStore('chats', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const put = (conv: unknown) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction('chats', 'readwrite');
        tx.objectStore('chats').put(conv);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    // Titles match deriveTitle(first user message): the persist effect re-derives
    // the title whenever a restored conversation is re-saved, so seeding the
    // derived form keeps them stable across an open.
    await put({
      id: 'conv_a',
      title: 'Compare laptop prices across sites',
      items: [
        { kind: 'user', id: 'ua', text: 'Compare laptop prices across sites' },
        { kind: 'agent', id: 'aa', text: 'The Dell XPS 13 is cheapest at $999.' },
      ],
      createdAt: now - 100_000,
      updatedAt: now - 100_000,
    });
    await put({
      id: 'conv_b',
      title: 'Summarize this article for me',
      items: [
        { kind: 'user', id: 'ub', text: 'Summarize this article for me' },
        { kind: 'agent', id: 'ab', text: 'It argues that on-device AI improves privacy.' },
      ],
      createdAt: now - 50_000,
      updatedAt: now - 50_000,
    });
    db.close();
  });
  await panel.reload();

  // Fresh panel shows the greeting (no active conversation restored).
  await expect(panel.locator('.chat-greeting-title')).toBeVisible({ timeout: 10_000 });

  // Open the slide-over from the chat header's ☰ button.
  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  const overlay = panel.locator('.chats-over');
  await expect(overlay).toBeVisible();
  const rows = panel.locator('.chats-row');
  await expect(rows).toHaveCount(2);
  // Newest first (sorted by updatedAt desc).
  await expect(rows.nth(0).locator('.chats-row-title')).toHaveText('Summarize this article for me');
  await expect(rows.nth(1).locator('.chats-row-title')).toHaveText('Compare laptop prices across sites');
  await panel.screenshot({ path: path.join(SHOTS, '59-chat-history-list.png') });

  // Opening a conversation closes the overlay and restores its transcript.
  await rows.nth(0).locator('.chats-row-main').click();
  await expect(overlay).toBeHidden();
  await expect(panel.locator('.msg-user', { hasText: 'Summarize this article for me' })).toBeVisible();
  await expect(panel.locator('.msg-agent', { hasText: 'on-device AI improves privacy' })).toBeVisible();

  // "New chat" (header ＋) clears the transcript back to the greeting.
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(panel.locator('.chat-greeting-title')).toBeVisible();
  await expect(panel.locator('.msg-user')).toHaveCount(0);

  // Delete a conversation from the list; the row count drops to one.
  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(overlay).toBeVisible();
  await panel.getByRole('button', { name: 'Delete Compare laptop prices across sites' }).click();
  await expect(panel.locator('.chats-row')).toHaveCount(1);
  await expect(panel.locator('.chats-row-title')).toHaveText('Summarize this article for me');
});

// Live path: a real chat turn is auto-persisted (lazy id on first settled turn,
// title derived from the first user message) and shows up in the slide-over.
// Requires a built-in key (npm run build with VITE_GEMINI_API_KEY).
test('live: a completed chat turn is auto-saved to the chat list', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(panel.locator('.chat-greeting-title')).toBeVisible();
  const q = 'What is the capital of France? One short sentence.';
  await panel.getByPlaceholder('Message Buddy…').fill(q);
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.locator('.msg-agent .msg-body').last()).toContainText(/paris/i, { timeout: 30_000 });

  // The turn is now persisted — open the slide-over and find it by its title.
  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(panel.locator('.chats-over')).toBeVisible();
  await expect(panel.locator('.chats-row-title', { hasText: q })).toBeVisible({ timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, '60-chat-history-autosave.png') });
});
