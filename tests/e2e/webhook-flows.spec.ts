// Deterministic e2e for the Webhook Flows app — opens the app from the grid,
// adds a webhook in Settings first (so the picker is non-empty), creates a
// flow, runs it, and asserts the confirm modal shows the snake_case payload.
// Stubs chrome.runtime.sendMessage on the panel side for TOOL_EXEC send_webhook
// so this stays offline; the live-POST path is covered by webhook-flows-live.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Webhook Flows app: create + preview + send', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 1) Add a webhook in Settings first (the flow picker reads from this list).
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('webhooks-editor')).toBeVisible({ timeout: 8_000 });
  await panel.getByTestId('webhook-name').fill('Local Receiver');
  await panel.getByTestId('webhook-url').fill('https://example.com/hook');
  await panel.getByTestId('webhook-add').click();
  await expect(panel.locator('.webhooks-row', { hasText: 'Local Receiver' })).toBeVisible();

  // 2) Open the Webhook Flows app from the grid.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Webhook Flows', { exact: true }).click();
  await expect(panel.getByTestId('webhook-flows-app')).toBeVisible({ timeout: 5_000 });

  // 3) Empty state should be visible (no flows yet).
  await expect(panel.getByText('No flows yet')).toBeVisible();

  // 4) Create a flow.
  await panel.getByTestId('wf-new-flow').click();
  await expect(panel.getByTestId('wf-editor')).toBeVisible();
  await panel.getByTestId('wf-name').fill('Send to local');
  await panel.getByTestId('wf-category').fill('Test');
  // The webhook dropdown should be auto-populated; just confirm.
  await panel.getByTestId('wf-save').click();
  await expect(panel.getByTestId('wf-editor')).toBeHidden({ timeout: 3_000 });

  // 5) Flow row appears in the grouped list.
  const row = panel.getByTestId('wf-row-Send to local');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Local Receiver');

  // 6) Stub the SW message channel BEFORE clicking Run so reads and send work
  //    without an actual active tab + without a real POST. read_dom returns a
  //    canned page; send_webhook returns HTTP 200.
  await panel.evaluate(() => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime) as (msg: unknown) => Promise<unknown>;
    // @ts-expect-error override
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string; args?: Record<string, unknown> }) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'read_dom') {
        return {
          ok: true,
          result: {
            ok: true,
            data: {
              url: 'https://example.com/article',
              title: 'Example article',
              text: 'Hello world.',
            },
          },
        };
      }
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'send_webhook') {
        // Capture the outgoing payload so the test can inspect it.
        // @ts-expect-error stash
        globalThis.__wfLastPost = msg.args;
        return {
          ok: true,
          result: { ok: true, data: { status: 200, ok: true, url: 'https://example.com/hook' } },
        };
      }
      return orig(msg);
    };
  });

  // 7) Click Run → confirm modal shows the payload preview.
  await panel.getByTestId('wf-run-Send to local').click();
  await expect(panel.getByTestId('wf-preview')).toBeVisible({ timeout: 5_000 });

  // The preview JSON must use our snake_case shape (NOT WebhookBuddy's camelCase).
  const previewText = await panel.getByTestId('wf-preview').textContent();
  expect(previewText).toContain('"source": "chrome-buddy"');
  expect(previewText).toContain('"version": 1');
  expect(previewText).toContain('"category": "Test"');
  expect(previewText).toContain('"url": "https://example.com/article"');

  await panel.screenshot({ path: path.join(SHOTS, '120-webhook-flow-preview.png') });

  // 8) Approve → send completes → row shows ✓ HTTP 200.
  await panel.getByTestId('wf-preview-approve').click();
  await expect(panel.getByTestId('wf-preview')).toBeHidden({ timeout: 5_000 });
  await expect(row).toContainText('HTTP 200', { timeout: 5_000 });

  // The stub captured the args that went to send_webhook.
  const sentArgs = await panel.evaluate(() => (globalThis as unknown as { __wfLastPost?: { name?: string; payload?: { source?: string } } }).__wfLastPost);
  expect(sentArgs?.name).toBe('Local Receiver');
  expect(sentArgs?.payload?.source).toBe('chrome-buddy');

  await panel.screenshot({ path: path.join(SHOTS, '121-webhook-flow-sent.png') });
});
