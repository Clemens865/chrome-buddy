// Data Visualizer — deterministic e2e. Paste CSV → render a real SVG bar chart,
// switch chart types, toggle value series, and export SVG. No LLM key needed
// (the Explain button is optional and not exercised here).
// Run with: npm run test:e2e:viz
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function openViz(panel: import('@playwright/test').Page) {
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Data Visualizer', { exact: true }).click();
  await expect(panel.locator('.micro')).toBeVisible({ timeout: 5_000 });
}

test('renders a chart from pasted CSV, switches types, exports SVG', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openViz(panel);

  await panel.getByLabel('Data input').fill('month,sales,profit\nJan,120,30\nFeb,180,50\nMar,90,20');
  await panel.getByRole('button', { name: 'Visualize' }).click();

  // A real SVG bar chart is drawn (3 points × 2 numeric series = 6 bars).
  await expect(panel.locator('.viz-svg')).toBeVisible();
  await expect(panel.locator('.viz-svg rect')).toHaveCount(6);
  await expect(panel.getByRole('img', { name: 'Bar chart' })).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '292-viz-bar.png') });

  // Switch to line → polylines (one per series), no bars.
  await panel.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(panel.locator('.viz-svg polyline')).toHaveCount(2);

  // Switch to pie → one slice per label of the first series.
  await panel.getByRole('button', { name: 'Pie', exact: true }).click();
  await expect(panel.locator('.viz-svg path')).toHaveCount(3);
  await panel.screenshot({ path: path.join(SHOTS, '293-viz-pie.png') });

  // Back to bar, drop one value series → 3 bars.
  await panel.getByRole('button', { name: 'Bar', exact: true }).click();
  await panel.getByRole('button', { name: 'profit', exact: true }).click();
  await expect(panel.locator('.viz-svg rect')).toHaveCount(3);

  // Export SVG streams a download.
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: /SVG/ }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('chart.svg');
});

test('Use page table: marks every table, auto-picks the numeric one', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openViz(panel);

  // Reproduces statistik.at: a long non-numeric downloads table (more rows)
  // alongside the real data table (nbsp thousands separators, U+00A0).
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub onto typed handle
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'TOOL_EXEC' && msg.tool === 'read_dom') {
        const downloads = {
          id: 1, caption: 'Downloads', headers: ['Date', 'Title', 'PDF'],
          rows: Array.from({ length: 12 }, (_, i) => [`2026-0${i % 9}`, `Report ${i}`, 'pdf']), selector: 'table',
        };
        const data = {
          id: 2, caption: 'Arrivals', headers: ['Region', 'Arrivals', 'Change'],
          rows: [['Burgenland', '65 619', '8.3'], ['Vienna', '640 704', '8.6'], ['Austria total', '3 459 758', '-1.6']],
          selector: 'table',
        };
        return {
          type: 'TOOL_EXEC', ok: true,
          result: { ok: true, data: { url: 'https://statistik.at', title: 'Stats', text: '', interactiveElements: [], tables: [downloads, data], provenance: { url: 'https://statistik.at', distilledAt: 0 } } },
        };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Use page table' }).click();

  // Both tables are marked as chips (the downloads one is disabled — 0 numeric).
  await expect(panel.getByTestId('viz-page-tables').locator('.scrape-chip')).toHaveCount(2);
  await expect(panel.getByRole('button', { name: /Downloads · 12r · 0 num/ })).toBeDisabled();
  // The numeric data table is auto-selected and charted. Arrivals (~1e5) and
  // Change% (~1e0) are different scales, so only the primary series is shown by
  // default (1 series × 3 rows = 3 bars) with a hint to add the other.
  await expect(panel.locator('.viz-svg rect')).toHaveCount(3);
  await expect(panel.getByText(/similar scale/)).toBeVisible();
  await expect(panel.getByText(/No numeric columns/)).toHaveCount(0);
  await panel.screenshot({ path: path.join(SHOTS, '295-viz-page-table-pick.png') });
});

test('rejects data with no numeric column', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openViz(panel);

  await panel.getByLabel('Data input').fill('name,city\nAda,London\nGrace,NYC');
  await panel.getByRole('button', { name: 'Visualize' }).click();
  await expect(panel.getByText(/No numeric columns/)).toBeVisible();
  await expect(panel.locator('.viz-svg')).toHaveCount(0);
});
