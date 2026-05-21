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
