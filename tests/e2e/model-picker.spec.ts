// Live test: picking a model in Settings updates the chat header AND is used for
// the next chat turn. Run with: npm run test:e2e:modelpicker (needs .env key).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: model picker switches the active model', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Settings: the Balanced intent resolves to the registry default (3.5 Flash).
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Balanced', exact: true }).click();
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(panel.locator('.panel-hd-sub')).toContainText('Gemini 3.5 Flash');

  // Pick an exact model (advanced) → the header reflects it.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByLabel('Exact model').selectOption({ label: 'Gemini 2.5 Pro' });
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(panel.locator('.panel-hd-sub')).toContainText('Gemini 2.5 Pro');
  await panel.screenshot({ path: path.join(SHOTS, '23-model-picker.png') });

  // And a chat turn succeeds on the picked model.
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('Reply with exactly one word: pong');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
});
