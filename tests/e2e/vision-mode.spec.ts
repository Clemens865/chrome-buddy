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

// H7 P3 — Confirm-every-Vision-action toggle gates each action through HITL,
// the user approves, and the safety_acknowledgement round-trip is exercised.
test('live: visionConfirmAll=on gates an action; Approve continues the run', async ({ context, extensionId }) => {
  // Seed the toggle ON before the panel loads.
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ visionConfirmAll: true }));

  const target = await context.newPage();
  await target.goto('https://example.com');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Vision', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Open https://example.com (use the navigate action). Then summarize the page in one sentence.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // First action should hit our HITL gate (confirmAll forces it).
  const hitl = panel.locator('.hitl').first();
  await expect(hitl).toBeVisible({ timeout: 90_000 });
  await panel.screenshot({ path: path.join(SHOTS, '77-vision-hitl-gate.png') });

  // Approve and let the loop continue.
  await panel.getByRole('button', { name: 'Approve action' }).first().click();
  // The run eventually settles to a non-empty agent reply.
  const reply = panel
    .locator('.msg-agent:not(.msg-subtle) .msg-body')
    .filter({ hasText: /example|domain|documentation|iana/i });
  await expect(reply.first()).toBeVisible({ timeout: 120_000 });
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(SHOTS, '78-vision-hitl-done.png') });
});

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

  // Phase 2: Vision turns are now billed through the cost ledger, so the
  // session-cost chip appears in the composer after the run completes.
  await expect(panel.locator('.cost-chip').first()).toBeVisible({ timeout: 10_000 });

  // Phase 2: identical consecutive narrations are deduped — the same exact
  // text should not appear in two separate msg-agent bubbles.
  const narrations = await reply.allInnerTexts();
  const uniq = new Set(narrations.map((t) => t.trim()));
  expect(uniq.size).toBe(narrations.length);

  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(SHOTS, '76-vision-loop.png') });
});
