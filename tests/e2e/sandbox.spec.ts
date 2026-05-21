// Tier-2 sandbox: generated code runs in an opaque-origin sandboxed iframe with
// zero ambient authority. Test 1 (deterministic, no key) seeds a code app and
// runs it in the REAL sandbox. Test 2 (live) generates one from a description.
// Run with: npm run test:e2e:sandbox  (test 2 needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Tier-2 code app runs in the sandbox', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a sandboxed code app (word counter) directly in the store.
  await panel.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'APP_SAVE',
      app: {
        id: 'app_wc',
        name: 'Word Counter',
        description: 'Count words in text',
        inputs: [{ id: 'text', label: 'Text', type: 'textarea' }],
        tier: 2,
        code: 'return "words: " + inputs.text.trim().split(/\\s+/).filter(Boolean).length;',
        createdAt: Date.now(),
      },
    });
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(panel.getByText('Your generated apps')).toBeVisible();
  const card = panel.locator('.app-card-wrap', { has: panel.locator('.app-card-del') }).first();
  await card.locator('.app-card').click();

  await panel.locator('.apps .settings-input').first().fill('hello brave new world');
  await panel.getByRole('button', { name: 'Run app' }).click();

  // The sandbox executed the generated code and returned the count.
  await expect(panel.locator('.apps .msg-agent .msg-body')).toContainText('words: 4', { timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, '32-sandbox-run.png') });
});

test('live: generate a Tier-2 code app and run it', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: 'Generate app from a description' }).click();
  await panel.getByRole('button', { name: 'Code app (sandboxed)' }).click();
  await panel
    .getByLabel('App description')
    .fill('Reverse the characters of the input text and also report its length.');
  await panel.getByRole('button', { name: 'Generate app' }).click();

  await expect(panel.getByText('Your generated apps')).toBeVisible({ timeout: 45_000 });
  const card = panel.locator('.app-card-wrap', { has: panel.locator('.app-card-del') }).first();
  await card.locator('.app-card').click();

  const fields = panel.locator('.apps .settings-input');
  const n = await fields.count();
  for (let i = 0; i < n; i++) await fields.nth(i).fill('hello');
  await panel.getByRole('button', { name: 'Run app' }).click();

  await expect(panel.locator('.apps .msg-agent .msg-body')).not.toHaveText('', { timeout: 30_000 });
  await panel.screenshot({ path: path.join(SHOTS, '33-sandbox-generated.png') });
});
