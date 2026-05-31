// Live validation — needs VITE_GEMINI_API_KEY baked into the build.
// With decompose ON, a cross-tab Agent task should drive the browser-native
// research tools (list_tabs / read_tab) against the user's REAL open tabs and
// answer from them. Run: npm run test:e2e:liveresearch
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent researches the open tabs via list_tabs/read_tab and answers', async ({ context, extensionId }) => {
  // Two distinct, reachable tabs.
  const a = await context.newPage();
  await a.goto('https://example.com/');
  await expect(a.getByRole('heading', { name: /example domain/i })).toBeVisible({ timeout: 30_000 });
  const b = await context.newPage();
  await b.goto('https://www.iana.org/help/example-domains');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  // Decompose ON (validate the toggle path); plans auto-run (no per-step gate).
  await panel.evaluate(() => chrome.storage.local.set({ decomposeTasks: true, askBeforePlan: false }));
  await panel.reload();

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Look at my other open browser tabs and tell me what each one is about. Use my open tabs, not a web search.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The agent reaches the user's tabs via the browser-native research tools.
  await expect(
    panel.locator('.tc-mini-name', { hasText: /list_tabs|read_tab/ }).first(),
  ).toBeVisible({ timeout: 90_000 });

  // And synthesizes an answer that references the real tab content.
  await expect(panel.locator('.msg-agent .msg-body').last()).toContainText(/example|domain|iana|reserved|documentation/i, {
    timeout: 150_000,
  });
  await panel.screenshot({ path: path.join(SHOTS, 'live-browser-research.png') });
});
