// Tab Manager — drives real chrome.tabs. We open extra tabs in the context,
// then assert the manager lists them, filters, closes one, dedupes, and
// saves/restores a session (persisted to chrome.storage.local). No LLM key
// needed (Group-by-topic is optional and not exercised here).
// Run with: npm run test:e2e:tabmanager
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

// data: URLs with <title> so the manager shows recognisable rows.
const tabHtml = (title: string) =>
  `data:text/html,<title>${encodeURIComponent(title)}</title><h1>${title}</h1>`;

async function openTabManager(panel: import('@playwright/test').Page) {
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Tab Manager', { exact: true }).click();
  await expect(panel.getByTestId('tab-manager-app')).toBeVisible({ timeout: 5_000 });
}

test('lists open tabs, filters, and closes one', async ({ context, extensionId }) => {
  // Open three recognisable tabs.
  for (const title of ['Alpha Page', 'Bravo Page', 'Charlie Page']) {
    const p = await context.newPage();
    await p.goto(tabHtml(title));
  }
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openTabManager(panel);

  await expect(panel.locator('.tab-row-title', { hasText: 'Alpha Page' })).toBeVisible();
  await expect(panel.locator('.tab-row-title', { hasText: 'Bravo Page' })).toBeVisible();

  // Filter to just Bravo.
  await panel.getByLabel('Search tabs').fill('bravo');
  await expect(panel.locator('.tab-row')).toHaveCount(1);
  await expect(panel.locator('.tab-row-title').first()).toHaveText(/Bravo/);
  await panel.getByLabel('Search tabs').fill('');
  await panel.screenshot({ path: path.join(SHOTS, '294-tab-manager.png') });

  // Close Charlie → its row disappears.
  await panel.getByRole('button', { name: 'Close Charlie Page' }).click();
  await expect(panel.locator('.tab-row-title', { hasText: 'Charlie Page' })).toHaveCount(0);
});

test('closes duplicate tabs', async ({ context, extensionId }) => {
  const dupUrl = tabHtml('Dup Page');
  for (let i = 0; i < 3; i++) {
    const p = await context.newPage();
    await p.goto(dupUrl);
  }
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openTabManager(panel);

  await expect(panel.locator('.tab-row-title', { hasText: 'Dup Page' })).toHaveCount(3);
  await panel.getByRole('button', { name: 'Close duplicates' }).click();
  await expect(panel.locator('.tab-row-title', { hasText: 'Dup Page' })).toHaveCount(1);
});

test('saves a session to storage and restores it', async ({ context, extensionId }) => {
  const p = await context.newPage();
  await p.goto('https://example.com/');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await openTabManager(panel);

  await panel.getByLabel('Session name').fill('Work set');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();

  // Row appears + the session is persisted in chrome.storage.local.
  await expect(panel.locator('.tab-session-name', { hasText: 'Work set' })).toBeVisible();
  await expect
    .poll(async () => panel.evaluate(() => chrome.storage.local.get('tabSessions').then((r) => (r.tabSessions ?? []).length)))
    .toBeGreaterThan(0);

  // Restore opens the saved http(s) tab(s); example.com should be present.
  await panel.getByRole('button', { name: 'Restore' }).click();
  await expect
    .poll(async () => panel.evaluate(() => chrome.tabs.query({}).then((ts) => ts.filter((t) => (t.url ?? '').includes('example.com')).length)), {
      timeout: 10_000,
    })
    .toBeGreaterThanOrEqual(2);
});
