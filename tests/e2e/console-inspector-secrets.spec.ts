// Secrets panel — allowlist (dismiss false positives), per-provider rotation
// guidance, and redacted CSV export. scan_sensitive_data is stubbed.
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Secrets panel: rotation guidance, allowlist (ignore/restore), CSV export', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'scan_sensitive_data') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          url: 'https://shop.example.com/', scanned: 2,
          hits: [
            { id: 'openai-key', category: 'API Key', severity: 'critical', description: 'OpenAI "sk-" API key.', preview: 'sk-1…6789', source: 'localStorage:OPENAI_KEY', count: 1 },
            { id: 'email', category: 'PII', severity: 'low', description: 'Email address.', preview: 'jo…@x.com', source: 'dom', count: 4 },
          ],
        } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-sensitive').click();

  const list = panel.getByTestId('ci-sensitive');
  await expect(list).toBeVisible({ timeout: 8_000 });
  await expect(list.locator('.ci-card')).toHaveCount(2);
  // Provider rotation link for the OpenAI key.
  await expect(list.getByText(/Rotate OpenAI key/)).toBeVisible();

  await panel.screenshot({ path: path.join(SHOTS, '95-ci-secrets.png') });

  // CSV export (both active hits).
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('ci-sec-csv').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('secrets.csv');
  const csv = readFileSync((await dl.path())!, 'utf8');
  expect(csv.split('\n')[0]).toBe('category,id,severity,source,redacted_preview,count');
  expect(csv).toContain('openai-key');
  expect(csv).toContain('jo…@x.com');

  // Allowlist: ignore the email (2nd card) → it leaves the active set.
  await panel.getByTestId('ci-sec-ignore-1').click();
  await expect(list.locator('.ci-card')).toHaveCount(1);
  await expect(panel.getByText('1 active · 1 ignored · 2 source(s)')).toBeVisible();

  // Review ignored → it reappears (muted), then restore it.
  await panel.getByTestId('ci-sec-show-ignored').click();
  await expect(list.locator('.ci-card')).toHaveCount(2);
  await expect(list.locator('.ci-card-muted')).toHaveCount(1);
});
