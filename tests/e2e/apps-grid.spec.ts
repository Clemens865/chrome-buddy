// Apps grid cleanup: the chat-coverable cards (Translator, Page Summarizer)
// were removed from the grid — summarizing/translating is plain chat, not a
// dedicated app surface (PRESETS is the empty hook left for future presets).
// Run: npm run test:e2e:appsgrid
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('chat-coverable cards (Translator, Summarizer) are not on the grid', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  // Both folded into chat — neither card is rendered.
  await expect(panel.getByText('Translator')).toHaveCount(0);
  await expect(panel.getByText('Page Summarizer')).toHaveCount(0);
  await panel.screenshot({ path: path.join(SHOTS, '47-apps-grid-cleaned.png') });
});
