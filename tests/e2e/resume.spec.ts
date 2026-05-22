// FR-AGENT-8 / NFR-REL-3: an interrupted run is offered for resume (skipping
// completed steps). Deterministic — we seed a checkpoint in IndexedDB and reload.
// Run: npm run test:e2e:resume
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('an interrupted run can be resumed', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a non-terminal checkpoint (2-step plan, step 1 done) into the DB.
  await panel.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('chrome-buddy');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('runState', 'readwrite');
      tx.objectStore('runState').put(
        {
          task: 'Extract the top headlines',
          savedAt: Date.now(),
          state: {
            runId: 'r1',
            scratchpad: {
              task: 'Extract the top headlines',
              plan: [{ index: 1, intent: 'read' }, { index: 2, intent: 'list' }],
              actions: [],
              notes: [],
              provenance: [],
              completedSteps: [1],
            },
            stepsUsed: 1,
            costUsed: 0,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          },
        },
        'active',
      );
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  });

  await panel.reload();

  // The resume banner appears with the task + progress.
  const card = panel.locator('.resume-card');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText('Extract the top headlines');
  await expect(card).toContainText('1/2 steps done');
  await panel.screenshot({ path: path.join(SHOTS, '49-resume.png') });

  // Dismiss clears it (and the checkpoint).
  await card.getByText('Dismiss').click();
  await expect(panel.locator('.resume-card')).toHaveCount(0);
});
