// FR-BC-4/5: the agent can SEE the page — it screenshots the tab and the image
// is fed to the vision model, which answers about what's visible. (Browser-scoped
// "computer use": navigate/click/type already work; this adds sight.)
// Run with: npm run test:e2e:vision  (needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent screenshots the page and answers from the image', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Take a screenshot of this page and tell me exactly what the big heading says.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The agent used the screenshot tool…
  await expect(panel.getByText('screenshot', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  // …and answered from what's visible.
  await expect(panel.locator('.msg-agent:not(.msg-subtle) .msg-body').last()).toContainText(/Example Domain/i, {
    timeout: 60_000,
  });
  await panel.screenshot({ path: path.join(SHOTS, '50-vision.png') });
});
