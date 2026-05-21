// FR-LLM-10 / NFR-COST-2: a running spend total shows in the UI after a call.
// Run with: npm run test:e2e:cost  (needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: running cost appears after a chat turn', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // No cost shown before any call.
  await expect(panel.locator('.cost-chip')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('Reply with exactly one word: hi');
  await panel.getByRole('button', { name: 'Send' }).click();

  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  // The running total appears with a dollar figure.
  const chip = panel.locator('.cost-chip');
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await expect(chip).toContainText('$');
  await panel.screenshot({ path: path.join(SHOTS, '36-cost.png') });
});
