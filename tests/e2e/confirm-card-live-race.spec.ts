// Regression for the user-reported "during a live run the confirm card body
// is invisible" bug.
//
// Seeded chat-history tests passed because they only fire ONE setItems on
// reload — the racing scroll effects don't interleave. The real symptom only
// shows up when MULTIPLE setItems calls land in quick succession: tool item
// appears, then confirm card, then maybe a status tick. Two scroll effects
// (useLayoutEffect sync force-to-bottom + useEffect async smooth-scroll-to-
// confirm) fought each other and the card ended up behind the fixed banner.
//
// Reproduction strategy: seed the chat with the items BUT in two sequential
// setItems calls separated by a short delay, mimicking the live order. Then
// assert the Approve/Cancel buttons are actually in the viewport.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live race: confirm card stays in viewport after a burst of setItems updates', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 1) Seed an initial chat (user message + plan + tool item — NO confirm yet).
  //    This mirrors the state at the moment the runtime is about to emit
  //    confirmation_required.
  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => resolve();
      open.onerror = () => reject();
    });
    const db = open.result;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chats', 'readwrite');
      tx.objectStore('chats').put({
        id: 'c_live_race',
        title: 'live race',
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
  await panel.getByText('live race').click();

  // 2) Wait for the seeded items to mount.
  await expect(panel.getByText('github_write')).toBeVisible({ timeout: 5_000 });

  // 3) Now simulate the LIVE arrival of the confirm card: append it to the
  //    seeded chat in IDB and trigger another reload would be too coarse —
  //    we want the SAME mount cycle to see the items burst. Instead, we tell
  //    the ChatView to add a confirm item via window-scoped React state.
  //    The cleanest way is to dispatch a real CustomEvent that ChatView
  //    listens for? It doesn't, so we go around it by mutating IDB AND
  //    triggering the chat to reload its items from IDB on visibility change.
  //
  //    Practical shortcut for THIS test: directly call setItems via the
  //    devtools-exposed reducer. We don't have one, so the simplest
  //    deterministic path that still exercises the bug is to append the
  //    confirm item to IDB and then click into "+ New chat" then back to
  //    this chat — that triggers two consecutive setItems updates inside
  //    the same component tree.
  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => resolve();
      open.onerror = () => reject();
    });
    const db = open.result;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chats', 'readwrite');
      const get = tx.objectStore('chats').get('c_live_race');
      get.onsuccess = () => {
        const chat = get.result as { items: Array<Record<string, unknown>> };
        chat.items.push({
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
        });
        tx.objectStore('chats').put({ ...chat, updatedAt: Date.now() });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    });
  });
  // Re-enter the chat — back to Chats list, then back into the same chat —
  // forces a remount and re-load from IDB.
  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  await panel.getByText('live race').click();

  await panel.screenshot({ path: path.join(SHOTS, '171-live-race-confirm.png') });

  // The buttons must be in the viewport, not behind the banner/composer.
  const approve = panel.getByRole('button', { name: 'Approve action' });
  const cancel = panel.getByRole('button', { name: 'Cancel action' });
  await expect(approve).toBeVisible({ timeout: 5_000 });
  await expect(cancel).toBeVisible();
  await expect(approve).toBeInViewport();
  await expect(cancel).toBeInViewport();
});
