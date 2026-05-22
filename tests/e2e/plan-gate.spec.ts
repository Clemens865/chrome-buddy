// FR-AGENT-3: the agent surfaces its plan and waits for approval before acting.
// Run with: npm run test:e2e:plangate  (needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: plan gate cancels before any execution', async ({ context, extensionId }) => {
  // Opt into the plan gate (the fixture turns it off by default).
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ askBeforePlan: true }));

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('Search the web for AI news and summarise the top three items.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The plan-review card appears before execution.
  const card = panel.locator('.plan-review');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText('Review plan before running')).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '40-plan-gate.png') });

  // Cancel -> the run ends without executing.
  await card.getByText('Cancel').click();
  await expect(panel.getByText(/Plan cancelled before execution/)).toBeVisible({ timeout: 20_000 });
});

test('live: approving the plan runs it', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });

  // Opt into the plan gate (the fixture turns it off by default).
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ askBeforePlan: true }));

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('List the titles of the top 3 stories on this page.');
  await panel.getByRole('button', { name: 'Send' }).click();

  await expect(panel.locator('.plan-review')).toBeVisible({ timeout: 60_000 });
  await panel.getByRole('button', { name: 'Approve plan' }).click();

  // After approval the agent executes and produces an answer.
  await expect(panel.locator('.msg-agent:not(.msg-subtle) .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '41-plan-approved.png') });
});
