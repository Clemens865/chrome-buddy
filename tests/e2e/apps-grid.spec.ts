// Apps grid cleanup: Translator removed; Summarizer is a chat preset (seeds a
// prompt) rather than a stub app. Deterministic (the user bubble is added before
// any LLM call). Run: npm run test:e2e:appsgrid
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Summarizer seeds a chat prompt; Translator is gone', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  // Translator card removed.
  await expect(panel.getByText('Translator')).toHaveCount(0);

  // Clicking Summarizer jumps to chat and seeds the summarize prompt.
  await panel.getByText('Page Summarizer').first().click();
  await expect(
    panel.locator('.msg-user', { hasText: /Summarize this page/ }),
  ).toBeVisible({ timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, '47-summarizer-preset.png') });
});
