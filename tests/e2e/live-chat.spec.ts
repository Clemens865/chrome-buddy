// LIVE end-to-end test: drives the real side-panel chat against the real Gemini
// API (key inlined from .env at build time) and screenshots each step.
//
// Requires: `npm run build` with VITE_GEMINI_API_KEY set in .env, plus network.
// Run with: npm run test:e2e:live
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: plain chat answers a question end-to-end', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 440, height: 900 }); // side-panel-ish
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(page.getByText("Hi, I'm Buddy.")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '01-empty.png') });

  // Type a simple question (auto-routes to cheap plain chat, no agent).
  await page.getByPlaceholder('Message Buddy…').fill('What is the capital of France? Answer in one short sentence.');
  await page.screenshot({ path: path.join(SHOTS, '02-typed.png') });

  await page.getByRole('button', { name: 'Send' }).click();

  // Wait for Buddy's reply bubble to contain the answer (real model call).
  const answer = page.locator('.msg-agent .msg-body').last();
  await expect(answer).toContainText(/paris/i, { timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, '03-answer.png') });
});

test('live: agent reads the page and answers', async ({ context, extensionId }) => {
  // A normal page so the content script + read_dom have something to read.
  const site = await context.newPage();
  await site.goto('https://example.com');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Force Agent mode to exercise the read_dom → synthesize path.
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('What is this page about? One sentence.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The run renders a tool trace then a synthesized answer.
  await expect(panel.locator('.msg-agent .msg-body').last()).toContainText(/example|domain|illustrative/i, {
    timeout: 45_000,
  });
  await panel.screenshot({ path: path.join(SHOTS, '04-agent-answer.png') });
});
