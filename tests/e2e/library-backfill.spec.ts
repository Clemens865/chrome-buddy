// Library v1 commit 2 — auto-mirror + backfill. Verifies:
//   (a) Settings "Run backfill" walks IDB chats + notes and indexes them.
//     Status line surfaces the {indexed, skipped, total} counts.
//   (b) After backfill, search_library returns the seeded content.
//   (c) Re-running backfill is idempotent (everything skipped on round 2).
//
// Live — needs VITE_GEMINI_API_KEY for the embeddings.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Library backfill: indexes existing chats + notes; search returns them', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed one chat + one note directly into IDB through the SW so backfill
  // has something to pick up.
  await panel.evaluate(async () => {
    // Open the existing 'chrome-buddy' DB (already migrated by the SW boot).
    // Use the SW path via runtime messages where possible; for chats + notes
    // we just write directly to IDB from the panel, which shares the origin.
    const open = indexedDB.open('chrome-buddy');
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => resolve();
      open.onerror = () => reject(open.error);
    });
    const db = open.result;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['chats', 'notes'], 'readwrite');
      tx.objectStore('chats').put({
        id: 'c_test_kubernetes',
        title: 'Kubernetes pod scheduling',
        items: [
          { kind: 'user', id: 'u1', text: 'How do nodeSelectors work in Kubernetes?' },
          { kind: 'agent', id: 'a1', text: 'nodeSelector is the simplest pod scheduling primitive. You attach a label to a node and request it in the pod spec.' },
        ],
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now() - 60_000,
      });
      tx.objectStore('notes').put({
        key: 'aws-billing',
        content: '# AWS billing cheat sheet\n\nThe cheapest way to host static assets is S3 + CloudFront with a Price Class 100 distribution.',
        createdAt: Date.now() - 30_000,
        updatedAt: Date.now() - 30_000,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });

  // Open Settings, hit "Run backfill".
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const button = panel.getByTestId('library-backfill');
  await expect(button).toBeVisible({ timeout: 8_000 });
  await button.click();

  // Status surfaces counts: "2 indexed · 0 skipped (of 2 total)" once the
  // backfill finishes. The same testid carries the in-flight "Walking…" text
  // before the result lands, so we explicitly wait for the final shape.
  const status = panel.getByTestId('library-backfill-status');
  await expect(status).toContainText(/of 2 total/, { timeout: 60_000 });
  const text1 = (await status.textContent()) ?? '';
  expect(text1).toMatch(/2 indexed/);
  await panel.screenshot({ path: path.join(SHOTS, '91-library-backfill.png') });

  // Now ask search_library — both seeded docs should be retrievable.
  const k8s = await panel.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'search_library',
      args: { query: 'kubernetes pod scheduling and node selectors', k: 3 },
    });
  });
  type Hit = { title: string; source: string; score: number; snippet: string };
  const kr = k8s as { ok: boolean; result: { ok: boolean; data: { hits: Hit[] } } };
  expect(kr.ok).toBe(true);
  expect(kr.result.ok).toBe(true);
  expect(kr.result.data.hits[0].title).toBe('Kubernetes pod scheduling');
  expect(kr.result.data.hits[0].source).toBe('chat');

  const aws = await panel.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'search_library',
      args: { query: 'cheapest static asset hosting on AWS', k: 3 },
    });
  });
  const ar = aws as { ok: boolean; result: { ok: boolean; data: { hits: Hit[] } } };
  expect(ar.result.data.hits[0].title).toBe('aws-billing');
  expect(ar.result.data.hits[0].source).toBe('note');

  // Re-run backfill — should be fully skipped (idempotent on contentHash).
  await button.click();
  await expect(status).toContainText(/0 indexed/i, { timeout: 30_000 });
});
