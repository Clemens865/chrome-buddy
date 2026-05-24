// H6 — fetch_url tool (Gemini urlContext built-in).
//
// The agent can now call fetch_url(url) to read a public http(s) page without
// navigating to it. Backed by Gemini's native urlContext tool.
// Live — needs VITE_GEMINI_API_KEY. Run: npm run test:e2e:fetchurl
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent uses fetch_url to read a public URL and answers from it', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Use fetch_url on https://example.com and tell me what the page is about in one sentence.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The fetch_url tool call appears in the transcript.
  await expect(panel.locator('.tc-mini-name', { hasText: 'fetch_url' }).first()).toBeVisible({ timeout: 45_000 });

  // Wait for an actual content heading or paragraph from example.com to
  // appear anywhere on the panel (rendered via the AgentBody Markdown). This
  // is the real signal that synthesis completed.
  await expect(panel.getByRole('heading', { name: /example domain/i }).first()).toBeVisible({ timeout: 120_000 });
  // Give the citation footer a moment to render below the text.
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(SHOTS, '72-fetch-url.png') });
});
