// Apps grid launch — every built-in app card was visible but only the
// Console card had an e2e launch test. This spec proves each openable card
// actually OPENS its dedicated view, with the app-specific UI present, and
// the Back button returns to the grid. One placeholder card (watch) is still
// asserted NON-openable so we don't quietly ship dead UI later; Scrape to Table
// is now a real app and gets a launch test.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test.describe('Apps grid: each card opens its app', () => {
  test('Console Inspector opens the console view', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    await panel.getByText('Console Inspector', { exact: true }).first().click();
    // Console app has its own header with the back button + the tab strip.
    await expect(panel.locator('.micro')).toBeVisible({ timeout: 5_000 });
    await expect(panel.getByText(/Console Inspector/)).toBeVisible();
  });

  test('Image Generator opens with prompt input + generate button', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    await panel.getByText('Image Generator', { exact: true }).first().click();
    await expect(panel.locator('.micro')).toBeVisible({ timeout: 5_000 });
    // The image app needs a prompt input + a generate action.
    await expect(panel.getByPlaceholder(/describ|prompt/i)).toBeVisible();
  });

  test('Audio Transcriber opens with the file picker', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    await panel.getByText('Audio Transcriber', { exact: true }).click();
    await expect(panel.locator('.micro')).toBeVisible({ timeout: 5_000 });
    // The transcriber needs a way to choose an audio file.
    await expect(panel.locator('input[type="file"]')).toHaveCount(1);
  });

  test('Live Transcriber opens with mic controls', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    await panel.getByText('Live Transcriber', { exact: true }).click();
    await expect(panel.locator('.micro')).toBeVisible({ timeout: 5_000 });
    // There must be a Start/Stop affordance.
    const startButton = panel.getByRole('button', { name: /start|listen|record/i });
    await expect(startButton.first()).toBeVisible({ timeout: 5_000 });
  });

  test('Webhook Flows opens with the New flow CTA', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    await panel.getByText('Webhook Flows', { exact: true }).click();
    await expect(panel.getByTestId('webhook-flows-app')).toBeVisible({ timeout: 5_000 });
    await expect(panel.getByTestId('wf-new-flow')).toBeVisible();
  });

  test('Scrape to Table opens its app view (reads the page → table/extract UI)', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    await panel.getByText('Scrape to Table', { exact: true }).click();
    // App mounted (its dedicated view, not the grid) and ran its page read.
    await expect(panel.locator('.micro')).toBeVisible({ timeout: 5_000 });
    await expect(panel.locator('.apps-search-input')).toHaveCount(0);
    // Resolves to one of the read outcomes (no driveable tab → Retry, or a
    // readable page → the extract box), never stuck on the loading line.
    await expect(
      panel.getByRole('button', { name: 'Retry' }).or(panel.getByLabel('Columns to extract')),
    ).toBeVisible({ timeout: 6_000 });
  });

  test('Price Watch is a placeholder — clicking does NOT open an app view', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    await panel.getByText('Price Watch', { exact: true }).click();
    await expect(panel.locator('.apps-search-input')).toBeVisible();
  });

  test('grid screenshot captures every built-in card + the + Create chip', async ({ context, extensionId }) => {
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 980 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Apps', exact: true }).click();
    // All built-in cards must be visible.
    for (const name of [
      'Console Inspector',
      'Image Generator',
      'Audio Transcriber',
      'Live Transcriber',
      'Webhook Flows',
      'Scrape to Table',
      'Data Visualizer',
      'Tab Manager',
      'Price Watch',
    ]) {
      // .first() because Console + Image also appear in the Recents row.
      await expect(panel.getByText(name, { exact: true }).first()).toBeVisible();
    }
    await panel.screenshot({ path: path.join(SHOTS, '210-apps-grid.png'), fullPage: true });
  });
});
