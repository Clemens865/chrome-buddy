// Scrape to Table — deterministic e2e. The app's two paths are exercised with
// a panel-side stub of chrome.runtime.sendMessage (same technique as
// console-fix-prompt.spec): read_dom returns a page with a real <table>, and
// LLM_GENERATE returns canned JSON for the AI-extract path. We then assert the
// table renders, sorts, filters, and exports CSV.
// Run with: npm run test:e2e:scrape
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

// Installs the SW-message stub on the panel page, then opens the Scrape app.
async function openScrape(panel: import('@playwright/test').Page) {
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error attaching a stub onto the typed handle
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'TOOL_EXEC' && msg.tool === 'read_dom') {
        return {
          type: 'TOOL_EXEC',
          ok: true,
          result: {
            ok: true,
            data: {
              url: 'https://shop.example.com/pricing',
              title: 'Pricing',
              text: 'Pro plan costs $9. Free plan costs $0.',
              interactiveElements: [],
              tables: [
                { id: 1, caption: 'Plans', headers: ['Plan', 'Price'], rows: [['Pro', '$9'], ['Free', '$0']], selector: 'table' },
              ],
              provenance: { url: 'https://shop.example.com/pricing', distilledAt: 0 },
            },
          },
        };
      }
      if (msg && msg.type === 'LLM_GENERATE') {
        return {
          type: 'LLM_GENERATE',
          ok: true,
          result: {
            text: '{"headers":["Name","Score"],"rows":[["Bravo","2"],["Alpha","10"]]}',
            toolCalls: [],
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            model: 'mock',
            cost: { totalCost: 0 },
          },
        };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Scrape to Table', { exact: true }).click();
  await expect(panel.locator('.micro')).toBeVisible({ timeout: 5_000 });
}

test('renders a page table, exports CSV', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openScrape(panel);

  // The page's <table> is offered as a one-tap chip; click it to render.
  await panel.getByRole('button', { name: /Plans · 2 rows/ }).click();
  await expect(panel.locator('.scrape-table')).toBeVisible();
  await expect(panel.locator('.scrape-table th').nth(0)).toHaveText(/Plan/);
  await expect(panel.locator('.scrape-table tbody tr')).toHaveCount(2);
  await panel.screenshot({ path: path.join(SHOTS, '290-scrape-page-table.png') });

  // CSV export streams a download with a slugified filename + the cell data.
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: /CSV/ }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('plans.csv');
});

test('AI-extracts columns, then sorts + filters the result', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openScrape(panel);

  await panel.getByLabel('Columns to extract').fill('name, score');
  await panel.getByRole('button', { name: 'Extract to table' }).click();
  await expect(panel.locator('.scrape-table')).toBeVisible({ timeout: 5_000 });
  await expect(panel.locator('.scrape-table tbody tr')).toHaveCount(2);

  // Default order is the model's order: Bravo, Alpha.
  await expect(panel.locator('.scrape-table tbody tr').first()).toContainText('Bravo');

  // Sort by Score ascending → numeric compare puts 2 (Bravo) before 10 (Alpha).
  await panel.locator('.scrape-table th', { hasText: 'Score' }).click();
  await expect(panel.locator('.scrape-table tbody tr').first()).toContainText('Bravo');
  // Descending → 10 (Alpha) first (proves numeric, not lexicographic, sort).
  await panel.locator('.scrape-table th', { hasText: 'Score' }).click();
  await expect(panel.locator('.scrape-table tbody tr').first()).toContainText('Alpha');

  // Filter narrows to matching rows only.
  await panel.getByLabel('Filter rows').fill('alpha');
  await expect(panel.locator('.scrape-table tbody tr')).toHaveCount(1);
  await expect(panel.locator('.scrape-table tbody tr').first()).toContainText('Alpha');
  await panel.screenshot({ path: path.join(SHOTS, '291-scrape-ai-extract.png') });
});
