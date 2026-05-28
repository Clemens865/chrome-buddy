// FR-MR-8/12/13: in-app model editor (add a model → picker shows it) and a Test
// button (tiny live call → latency / status). Run: npm run test:e2e:registry
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('add a custom model — it appears in the picker (FR-MR-8)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();

  await panel.getByRole('button', { name: '+ Add', exact: true }).click();
  await panel.getByLabel('Model id').fill('gemini-custom-test');
  await panel.getByLabel('Model display name').fill('My Test Model');
  await panel.getByRole('button', { name: 'Add model' }).click();

  // The new model is now an option in the Active-model picker.
  await expect(panel.getByLabel('Active model').locator('option', { hasText: 'My Test Model' })).toHaveCount(1);
  await panel.screenshot({ path: path.join(SHOTS, '54-model-editor.png') });
});

test('live: Test button validates the active model (FR-MR-12)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();

  await panel.getByRole('button', { name: 'Test', exact: true }).click();
  // Green latency pill on success (the default model is valid).
  await expect(panel.getByText(/✓ \d+ ms/)).toBeVisible({ timeout: 30_000 });
  await panel.screenshot({ path: path.join(SHOTS, '55-model-test.png') });
});
