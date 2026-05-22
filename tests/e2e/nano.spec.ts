// FR-LLM-8 / NFR-PRIV-2: on-device (Nano) preference with mandatory cloud
// fallback. Headless Chromium has no on-device model, so we verify the toggle
// and that chat still works (falls back to cloud) when Nano is unavailable.
// Run: npm run test:e2e:nano  (the chat test needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Settings exposes the on-device (Nano) preference', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();

  const row = panel.locator('.settings-row', { hasText: 'Prefer on-device (Nano)' });
  await expect(row).toBeVisible();
  const toggle = row.locator('.toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await panel.screenshot({ path: path.join(SHOTS, '58-nano-toggle.png') });
});

test('live: with Nano on but unavailable, chat falls back to the cloud', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Turn the preference on.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.locator('.settings-row', { hasText: 'Prefer on-device (Nano)' }).locator('.toggle').click();

  // Ask a question — headless has no on-device model, so it must use the cloud.
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('Reply with exactly one word: pong');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
});
