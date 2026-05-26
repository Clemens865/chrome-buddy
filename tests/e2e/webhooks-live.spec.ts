// LIVE webhook send — hits a real webhook.cool endpoint provided by the
// user (https://eager-star-65.webhook.cool). This is intentionally one of
// the few non-stubbed e2e tests so we know the SW actually reaches the
// public Internet through fetch, and the saved-address-book → TOOL_EXEC →
// executeWebhook path works end-to-end.
//
// Skips automatically when the network or the test URL is unavailable so
// it doesn't break offline runs.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');
const TEST_URL = 'https://eager-star-65.webhook.cool';

test('live: webhook Test button POSTs to the real endpoint', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Open Settings → Webhooks. Add the test URL under a known name.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('webhooks-editor')).toBeVisible({ timeout: 8_000 });

  await panel.getByTestId('webhook-name').fill('Test Webhook (live)');
  await panel.getByTestId('webhook-url').fill(TEST_URL);
  await panel.getByTestId('webhook-add').click();

  const row = panel.locator('.webhooks-row', { hasText: 'Test Webhook (live)' });
  await expect(row).toBeVisible({ timeout: 5_000 });

  // Click Test → the button flashes "Testing…", then either "✓ HTTP 200"
  // (or another 2xx) on success, or "✗ <error>" on failure.
  const testBtn = row.getByRole('button', { name: /Test|Testing|HTTP|sent|failed/ }).first();
  await testBtn.click();

  // The result text settles within ~5s of the real round-trip.
  await expect(testBtn).toHaveText(/✓\s*HTTP\s*\d{3}/, { timeout: 15_000 });
  const finalLabel = (await testBtn.textContent()) ?? '';
  // eslint-disable-next-line no-console
  console.log('Webhook test result:', finalLabel);
  // Any 2xx is success; webhook.cool returns 200.
  expect(finalLabel).toMatch(/HTTP\s*2\d{2}/);

  await panel.screenshot({ path: path.join(SHOTS, '100-webhook-live.png') });
});
