// Reproduce the user's screenshot — github_write confirm card body invisible
// between the tool item and the pending-confirm banner. Seeds a chat with
// the exact args shape the user hit, opens it, and screenshots the rendered
// DOM. The test asserts the Approve / Cancel buttons are in the viewport;
// failure proves the visual bug.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('repro: github_write confirm card must render with visible Approve/Cancel', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    await new Promise<void>((resolve, reject) => { open.onsuccess = () => resolve(); open.onerror = () => reject(); });
    const db = open.result;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chats', 'readwrite');
      tx.objectStore('chats').put({
        id: 'c_gh_repro',
        title: 'github_write repro',
        items: [
          { kind: 'user', id: 'u1', text: 'Create a file called HELLO.md in Clemens865/Buddy-Knowledge with the content "Hello from Chrome Buddy".' },
          {
            kind: 'plan',
            id: 'p1',
            plan: [{ index: 1, intent: 'Commit the file HELLO.md to the Clemens865/Buddy-Knowledge repo' }],
          },
          {
            kind: 'tool',
            id: 'tool_0_call_gh',
            step: 0,
            call: {
              id: 'call_gh',
              name: 'github_write',
              arguments: {
                message: 'Create HELLO.md',
                path: 'HELLO.md',
                content: 'Hello from Chrome Buddy',
                repo: 'Clemens865/Buddy-Knowledge',
              },
            },
            status: 'running',
          },
          {
            kind: 'confirm',
            id: 'confirm_0_call_gh',
            step: 0,
            call: {
              id: 'call_gh',
              name: 'github_write',
              arguments: {
                message: 'Create HELLO.md',
                path: 'HELLO.md',
                content: 'Hello from Chrome Buddy',
                repo: 'Clemens865/Buddy-Knowledge',
              },
            },
            summary: 'github_write to Clemens865/Buddy-Knowledge',
          },
        ],
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    });
  });
  await panel.reload();

  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  await panel.getByText('github_write repro').click();

  // Screenshot what's actually rendered — compare with the user's screenshot.
  await panel.screenshot({ path: path.join(SHOTS, '170-github-confirm-repro.png') });

  // The card must be present in the DOM.
  const card = panel.locator('.hitl');
  await expect(card).toBeVisible({ timeout: 5_000 });
  // And its action buttons must be in the viewport (not clipped behind the
  // banner+composer).
  const approve = panel.getByRole('button', { name: 'Approve action' });
  const cancel = panel.getByRole('button', { name: 'Cancel action' });
  await expect(approve).toBeInViewport();
  await expect(cancel).toBeInViewport();
});
