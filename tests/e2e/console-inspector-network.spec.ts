// Network panel — waterfall + filters + HAR export + copy-as-cURL. probe_network
// is stubbed (a deterministic request set incl. a 404 + a slow request) so the
// waterfall, filters, and artifacts are reproducible.
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Network panel: waterfall, filters, HAR export, copy-as-cURL', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'probe_network') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          url: 'https://shop.example.com/',
          count: 3,
          requests: [
            { url: 'https://shop.example.com/app.js', host: 'shop.example.com', type: 'script', method: 'GET', status: 200, protocol: 'h2', startMs: 0, durationMs: 120, sizeBytes: 45000 },
            { url: 'https://api.example.com/slow.json', host: 'api.example.com', type: 'fetch', method: 'GET', status: 200, protocol: 'h2', startMs: 130, durationMs: 820, sizeBytes: 2000 },
            { url: 'https://cdn.example.com/missing.png', host: 'cdn.example.com', type: 'img', method: 'GET', status: 404, protocol: 'h2', startMs: 60, durationMs: 30, sizeBytes: 0 },
          ],
        } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-network').click();

  const list = panel.getByTestId('ci-network-list');
  await expect(list).toBeVisible({ timeout: 8_000 });
  // All three requests render, each with a waterfall bar.
  await expect(list.locator('.ci-net-row')).toHaveCount(3);
  await expect(list.locator('.ci-net-bar')).toHaveCount(3);
  // The 404 shows a bad status.
  await expect(list.getByText('404')).toBeVisible();
  // Summary reflects the byte total.
  await expect(panel.getByText(/3 req ·/)).toBeVisible();

  await panel.screenshot({ path: path.join(SHOTS, '92-ci-network.png') });

  // Filter: failed → only the 404 row.
  await panel.getByTestId('ci-net-filter-failed').click();
  await expect(list.locator('.ci-net-row')).toHaveCount(1);
  await expect(list.getByText(/missing\.png/)).toBeVisible();

  // Filter: slow → only the 820ms request.
  await panel.getByTestId('ci-net-filter-slow').click();
  await expect(list.locator('.ci-net-row')).toHaveCount(1);
  await expect(list.getByText(/slow\.json/)).toBeVisible();
  await panel.getByTestId('ci-net-filter-all').click();

  // Copy as cURL → clipboard gets a runnable curl command.
  await panel.getByTestId('ci-net-curl-0').click();
  const curl = await panel.evaluate(() => navigator.clipboard.readText());
  expect(curl).toBe("curl 'https://shop.example.com/app.js'");

  // Export HAR → a valid HAR 1.2 log with one entry per request.
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('ci-net-har').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('network.har');
  const har = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
  expect(har.log.version).toBe('1.2');
  expect(har.log.entries).toHaveLength(3);
  expect(har.log.entries[2].response.status).toBe(404);
});
