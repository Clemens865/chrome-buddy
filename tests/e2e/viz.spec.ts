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
