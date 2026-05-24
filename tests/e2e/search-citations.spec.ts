// H5 — Gemini googleSearch grounding citation rendering.
//
// search_web already calls the native generateContent endpoint with
// `tools: [{ google_search: {} }]`, so we get groundingMetadata for free.
// This test proves the synthesized answer now carries a numbered Markdown
// citations footer ("**Sources**" + [Title](url) entries) and a "Searched:"
// line, rather than the old comma-joined URL dump.
//
// Live — needs VITE_GEMINI_API_KEY in .env. Run: npm run test:e2e:search
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: search_web answer carries Markdown citations + "Searched:" line', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Agent mode forces routing through the agent loop (which exposes search_web).
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Use the search_web tool to find the current population of Vienna, Austria, and cite your sources.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The final synthesized answer should mention Vienna and include the new
  // Markdown citation footer (rendered as a "Sources" heading + clickable links).
  const lastAgent = panel.locator('.msg-agent:not(.msg-subtle) .msg-body').last();
  await expect(lastAgent).toContainText(/vienna/i, { timeout: 90_000 });
  // The footer renders as a heading "Sources" (from **Sources** markdown).
  await expect(lastAgent.getByText('Sources', { exact: true })).toBeVisible({ timeout: 5_000 });
  // …and at least one clickable citation link to a real https URL.
  const firstCite = lastAgent.locator('a[href^="http"]').first();
  await expect(firstCite).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '71-search-citations.png') });
});
