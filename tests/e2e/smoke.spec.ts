import { test, expect } from './fixtures';

test('service worker registers (extension loads)', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

test('side panel renders the shell', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Header + rail nav from BuddyPanel.
  await expect(page.getByText('Chat with Buddy')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apps', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();

  // Empty-state greeting (no mock data).
  await expect(page.getByText("Hi, I'm Buddy.")).toBeVisible();
});

test('navigating the rail switches views', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await page.getByRole('button', { name: 'Apps' }).click();
  await expect(page.getByPlaceholder('Search apps…')).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Appearance', { exact: true })).toBeVisible();
  await expect(page.getByText('Profile', { exact: true })).toBeVisible();
});

test('overlay injects on a web page WHEN overlayEnabled is explicitly true', async ({ context }) => {
  // Overlay default is OFF — opt in by setting overlayEnabled=true in storage
  // BEFORE the content script reads it. (See the architectural note at the
  // top of src/content/overlay.tsx for why the default is off.)
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ overlayEnabled: true }));

  const page = await context.newPage();
  await page.goto('https://example.com', { waitUntil: 'load' });
  await expect(page.locator('#chrome-buddy-overlay-host')).toHaveCount(1, { timeout: 15_000 });
});

test('overlay does NOT inject by default (overlayEnabled unset)', async ({ context }) => {
  // Fresh extension — no overlayEnabled set. Overlay must stay off.
  const page = await context.newPage();
  await page.goto('https://example.com', { waitUntil: 'load' });
  // Give the content script time to read storage + decide not to mount.
  await page.waitForTimeout(2_000);
  await expect(page.locator('#chrome-buddy-overlay-host')).toHaveCount(0);
});
