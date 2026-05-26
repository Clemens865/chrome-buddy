// LIVE end-to-end for the Webhook Flows app — creates a flow targeting the
// real eager-star-65.webhook.cool endpoint and runs it. Stubs ONLY
// `read_dom` (so we don't need a real http(s) tab in this isolated extension
// context); the send_webhook path goes through the real SW → real fetch.
// Skips offline runs gracefully because the SW will surface a network error.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');
const TEST_URL = 'https://eager-star-65.webhook.cool';

test('live: Webhook Flows app runs a flow against the real endpoint', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Save the live webhook in Settings first.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('webhooks-editor')).toBeVisible({ timeout: 8_000 });
  await panel.getByTestId('webhook-name').fill('Flow Live');
  await panel.getByTestId('webhook-url').fill(TEST_URL);
  await panel.getByTestId('webhook-add').click();
  await expect(panel.locator('.webhooks-row', { hasText: 'Flow Live' })).toBeVisible();

  // Open the Webhook Flows app and create a flow.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Webhook Flows', { exact: true }).click();
  await panel.getByTestId('wf-new-flow').click();
  await panel.getByTestId('wf-name').fill('Live ping');
  await panel.getByTestId('wf-category').fill('Live');
  await panel.getByTestId('wf-save').click();

  // Stub ONLY the read_dom path (no real tab in this context); send_webhook
  // remains a real POST through the SW + fetch.
  await panel.evaluate(() => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime) as (msg: unknown) => Promise<unknown>;
    // @ts-expect-error override
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'read_dom') {
        return {
          ok: true,
          result: {
            ok: true,
            data: {
              url: 'https://example.com/live-test',
              title: 'Live test from Chrome Buddy',
              text: 'Sent via Webhook Flows app at ' + new Date().toISOString(),
            },
          },
        };
      }
      return orig(msg);
    };
  });

  const row = panel.getByTestId('wf-row-Live ping');
  await row.getByTestId('wf-run-Live ping').click();

  // Preview modal appears → approve.
  await expect(panel.getByTestId('wf-preview')).toBeVisible({ timeout: 5_000 });
  await panel.getByTestId('wf-preview-approve').click();

  // The row's status pill should settle on ✓ HTTP 2xx within the live round-trip.
  await expect(row).toContainText(/HTTP\s*2\d{2}/, { timeout: 15_000 });
  const meta = await row.textContent();
  // eslint-disable-next-line no-console
  console.log('Live flow run:', meta);

  await panel.screenshot({ path: path.join(SHOTS, '122-webhook-flow-live.png') });
});
