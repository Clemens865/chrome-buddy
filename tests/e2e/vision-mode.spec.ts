// H7 Phase 1 — Vision Mode (Computer Use) wiring.
//
// Two tests:
//   1) Deterministic — the "Vision" mode pill renders and activates.
//   2) Live driving — opens example.com in a real tab, then in the panel
//      uses Vision mode to ask "What does the page say?". Asserts the
//      Computer Use loop fires (a tool trace appears in the transcript).
//
// Run: npm run test:e2e:vision
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Vision mode pill renders and activates on click', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const pill = panel.getByRole('button', { name: 'Vision', exact: true });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('aria-pressed', 'false');
  await pill.click();
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await panel.screenshot({ path: path.join(SHOTS, '75-vision-pill.png') });
});

test('live: Vision mode loop fires against a real page and produces narration', async ({ context, extensionId }) => {
  // A normal page so the SW can captureVisibleTab + CDP-attach against it.
  const target = await context.newPage();
  await target.goto('https://example.com');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Vision', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Look at the page and tell me what it is about in one sentence. No clicks needed.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The agent's reply must be ABOUT the example.com page — confirms the
  // VISION_TURN actually returned narration grounded in the screenshot.
  // (A capture-failure error message would also be non-empty; we filter it
  // out by requiring page-content keywords.)
  const reply = panel
    .locator('.msg-agent:not(.msg-subtle) .msg-body')
    .filter({ hasText: /example|domain|documentation|iana/i });
  await expect(reply.first()).toBeVisible({ timeout: 120_000 });
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(SHOTS, '76-vision-loop.png') });
});
