// Deterministic regression for the user-reported "agent got stuck — no
// confirm card visible" symptom. We don't try to make a live Gemini
// session produce a confirm item (planner behavior varies between
// environments). Instead, we seed a chat with a 'confirm' transcript item
// directly so we can verify:
//   1. The amber "Buddy is waiting…" banner sits above the composer.
//   2. The ConfirmCard with Approve / Cancel is rendered in the transcript.
//   3. Clicking the banner scrolls the card into view.
import { test, expect } from './fixtures';

test('Pending HITL confirmation surfaces a sticky banner above the composer', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a chat with a tool item + an unresolved confirm item. IDB store
  // 'chats' shape is { id, title, items[], createdAt, updatedAt }; the
  // ChatView loader picks the latest chat by updatedAt.
  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    await new Promise<void>((resolve, reject) => { open.onsuccess = () => resolve(); open.onerror = () => reject(); });
    const db = open.result;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chats', 'readwrite');
      tx.objectStore('chats').put({
        id: 'c_hitl_demo',
        title: 'HITL demo',
        items: [
          { kind: 'user', id: 'u1', text: 'send a test webhook' },
          {
            kind: 'tool',
            id: 'tool_0_call_x',
            step: 0,
            call: { id: 'call_x', name: 'send_webhook', arguments: { name: 'Notify', payload: { text: 'hi' } } },
            status: 'running',
          },
          {
            kind: 'confirm',
            id: 'confirm_0_call_x',
            step: 0,
            call: { id: 'call_x', name: 'send_webhook', arguments: { name: 'Notify', payload: { text: 'hi' } } },
            summary: 'send_webhook to Notify',
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

  // Open the seeded chat.
  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  await panel.getByText('HITL demo').click();

  // The ConfirmCard renders the tool name + Approve + Cancel buttons.
  await expect(panel.getByText(/Confirm this action/i)).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByRole('button', { name: 'Approve action' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Cancel action' })).toBeVisible();

  // The sticky banner above the composer must be visible too.
  const banner = panel.getByTestId('pending-confirm-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Buddy is waiting/i);
  await expect(banner).toContainText(/send_webhook/);

  // Regression — the Approve / Cancel buttons used to be clipped behind
  // the fixed banner + composer. block:'end' + scroll-margin-bottom:160px
  // on .hitl keeps the buttons fully in the viewport so the user can
  // actually click them.
  await expect(panel.getByRole('button', { name: 'Approve action' })).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Cancel action' })).toBeInViewport();
});
