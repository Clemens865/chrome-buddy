// Visual verification that the iframe is sized to the panel's footprint
// (not full-viewport) — so the underlying page is visible + clickable.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('overlay iframe collapsed: narrow strip on right edge, page visible behind', async ({
  context,
  extensionId,
}) => {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() =>
    chrome.storage.local.set({ overlayEnabled: true, overlayCollapsed: true }),
  );
  void extensionId;

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('https://example.com', { waitUntil: 'load' });
  const host = page.locator('#chrome-buddy-overlay-host');
  await expect(host).toHaveCount(1, { timeout: 10_000 });

  // The iframe must be NARROW (collapsed footprint), not full-viewport.
  const iframe = host.locator('iframe');
  const box = await iframe.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(150); // collapsed rail is ~76px
  expect(box!.height).toBeLessThan(500); // collapsed card is ~420px
  expect(box!.x).toBeGreaterThan(1000); // anchored to the right edge

  // The example.com page text must STILL be visible (proves the iframe
  // doesn't cover the page).
  await expect(page.getByRole('heading', { name: 'Example Domain' })).toBeVisible();

  await page.screenshot({ path: path.join(SHOTS, '290-overlay-collapsed.png'), fullPage: false });
});

test('overlay iframe expanded: ~440px on right edge, page still visible to the left', async ({
  context,
  extensionId,
}) => {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() =>
    chrome.storage.local.set({ overlayEnabled: true, overlayCollapsed: false }),
  );
  void extensionId;

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('https://example.com', { waitUntil: 'load' });
  const host = page.locator('#chrome-buddy-overlay-host');
  await expect(host).toHaveCount(1, { timeout: 10_000 });

  const iframe = host.locator('iframe');
  const box = await iframe.boundingBox();
  expect(box).not.toBeNull();
  // Expanded panel ~440px on the right.
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.width).toBeLessThan(500);
  expect(box!.x).toBeGreaterThan(700); // still anchored right; not full-viewport

  // Page heading is still visible to the left of the iframe.
  await expect(page.getByRole('heading', { name: 'Example Domain' })).toBeVisible();

  await page.screenshot({ path: path.join(SHOTS, '291-overlay-expanded.png'), fullPage: false });
});
