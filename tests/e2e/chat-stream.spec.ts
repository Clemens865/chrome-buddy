// H4 — Streaming plain-chat reply. The agent bubble appears almost immediately
// with the first chunk, then grows as more chunks arrive. Run: npm run test:e2e:stream
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: plain-chat reply streams into a growing bubble (not one-shot)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Install a MutationObserver BEFORE we send — it'll count incremental updates
  // to whichever agent bubble appears. This is deterministic evidence of
  // streaming (a one-shot reply produces 1 update; streaming produces many).
  await panel.evaluate(() => {
    (window as unknown as { __streamUpdates: number }).__streamUpdates = 0;
    const root = document.querySelector('.chat-scroller');
    if (!root) return;
    const obs = new MutationObserver((muts) => {
      // Count mutations whose target is INSIDE an agent bubble (not a tool
      // trace, not the user bubble). characterData and childList both count.
      for (const m of muts) {
        const node = m.target as HTMLElement;
        const bubble = node.nodeType === 1 ? (node.closest?.('.msg-agent:not(.msg-subtle) .msg-body') as HTMLElement | null) : null;
        if (bubble) {
          (window as unknown as { __streamUpdates: number }).__streamUpdates += 1;
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
  });

  // Force the cheap chat path (no tools). Ask for a longer reply so multi-chunk
  // streaming is more likely (still works for short replies — we only need >1).
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Describe the city of Vienna in five sentences: history, architecture, food, music, and modern life.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The bubble appears.
  const bubble = panel.locator('.msg-agent:not(.msg-subtle) .msg-body').last();
  await expect(bubble).toBeVisible({ timeout: 30_000 });

  // Mid-stream snapshot (likely partial text).
  await panel.waitForFunction(
    () => {
      const el = document.querySelector('.msg-agent:not(.msg-subtle) .msg-body');
      return !!el && (el.textContent ?? '').length > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  await panel.screenshot({ path: path.join(SHOTS, '80-stream-mid.png') });

  // Wait for the bubble to settle.
  let stableSince = Date.now();
  let lastLen = 0;
  while (Date.now() - stableSince < 1500) {
    await panel.waitForTimeout(250);
    const cur = await bubble.evaluate((el) => (el.textContent ?? '').length);
    if (cur !== lastLen) {
      lastLen = cur;
      stableSince = Date.now();
    }
  }

  await panel.screenshot({ path: path.join(SHOTS, '81-stream-done.png') });

  // Final reply is non-trivial.
  expect(lastLen).toBeGreaterThan(40);
  // Streaming evidence: multiple text-mutations on the bubble. One-shot
  // rendering produces ~1; SSE streaming produces many.
  const updateCount = await panel.evaluate(() => (window as unknown as { __streamUpdates: number }).__streamUpdates);
  expect(updateCount).toBeGreaterThan(1);
});
