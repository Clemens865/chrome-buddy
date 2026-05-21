// Live test: Tier-1 app generation. Describe a tool -> Buddy emits a validated
// declarative app (form + prompt template) -> it appears in the grid -> we run
// it and get output. Run with: npm run test:e2e:appgen  (needs .env key).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: generate a Tier-1 app and run it', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: 'Generate app from a description' }).click();
  await panel
    .getByLabel('App description')
    .fill('An app that rewrites a piece of text in a tone the user chooses (e.g. formal, casual).');
  await panel.getByRole('button', { name: 'Generate app' }).click();

  // The generated app shows up in its own section.
  await expect(panel.getByText('Your generated apps')).toBeVisible({ timeout: 45_000 });
  await panel.screenshot({ path: path.join(SHOTS, '30-app-generated.png') });

  // Open it (generated cards carry a delete affordance).
  const genCard = panel.locator('.app-card-wrap', { has: panel.locator('.app-card-del') }).first();
  await genCard.locator('.app-card').click();

  // Fill every generated field, then run.
  const fields = panel.locator('.apps .settings-input');
  const n = await fields.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await fields.nth(i).fill(i === 0 ? 'Hey, can you send me that file when you get a sec?' : 'formal');
  }
  await panel.getByRole('button', { name: 'Run app' }).click();

  await expect(panel.locator('.apps .msg-agent .msg-body')).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '31-app-run.png') });
});
