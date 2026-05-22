// FR-HITL-8: on a CAPTCHA/login wall the agent PAUSES and hands control to the
// human (Resume) rather than bypassing. We serve the trigger text via httpbin's
// base64 echo so a real page read trips the detector.
// Run with: npm run test:e2e:humangate  (needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent pauses for a human on a CAPTCHA wall', async ({ context, extensionId }) => {
  // Isolate the handoff: turn the plan gate off (covered by plan-gate.spec).
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ askBeforePlan: false }));

  // A real https page whose live DOM text trips the CAPTCHA detector.
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
  await site.evaluate(() => {
    document.body.textContent =
      'Please verify you are human to continue. Complete the security challenge below.';
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('Read this page and tell me what it says.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The agent reads the page, detects the wall, and hands off.
  const gate = panel.locator('.human-gate');
  await expect(gate).toBeVisible({ timeout: 60_000 });
  await expect(gate).toContainText(/CAPTCHA|challenge|verification/i);
  await expect(panel.getByRole('button', { name: 'Resume' })).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '44-human-gate.png') });
});
