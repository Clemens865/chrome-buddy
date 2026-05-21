// Heavier, realistic agent tasks on a real content-rich site (Hacker News).
// Run with: npx playwright test complex.spec.ts  (needs .env key + network)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: extract top headlines from a real news page', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('List the titles of the top 6 stories on this page as a numbered list.');
  await panel.getByRole('button', { name: 'Send' }).click();

  const answer = panel.locator('.msg-agent .msg-body').last();
  await expect(answer).not.toHaveText('', { timeout: 60_000 });
  // A real extraction should be a multi-item list, not a one-liner.
  await expect(async () => {
    const text = await answer.innerText();
    expect(text.length).toBeGreaterThan(60);
  }).toPass({ timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '12-news-extract.png') });
});

test('live: agent searches the web (Gemini grounding)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Search the web for recent news about AI and list three items with their source links.');
  await panel.getByRole('button', { name: 'Send' }).click();

  const answer = panel.locator('.msg-agent .msg-body').last();
  await expect(answer).not.toHaveText('', { timeout: 60_000 });
  // A grounded answer should cite sources.
  await expect(async () => {
    const text = await answer.innerText();
    expect(text.length).toBeGreaterThan(80);
  }).toPass({ timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '15-web-search.png') });
});

test('live: agent navigates the browser to a new URL', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
  expect(site.url()).toContain('example.com');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Navigate to https://news.ycombinator.com and tell me the title of the first story.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The agent should drive the browser: the tab leaves example.com for HN.
  await site.waitForURL(/ycombinator\.com/, { timeout: 60_000 });
  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '14-navigate.png') });
});

test('live: navigate to a site, then list AI-related items', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Which stories on this page relate to AI, ML, or LLMs? List them, or say none if there are none.');
  await panel.getByRole('button', { name: 'Send' }).click();

  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '13-news-ai-filter.png') });
});
