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

test('overlay injects on a web page', async ({ context }) => {
  const page = await context.newPage();
  // Needs a real http(s) page for the content script to match.
  await page.goto('https://example.com', { waitUntil: 'load' });
  // The overlay mounts after an async chrome.storage read — be patient.
  await expect(page.locator('#chrome-buddy-overlay-host')).toHaveCount(1, { timeout: 15_000 });
});
