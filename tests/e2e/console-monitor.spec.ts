// Console Monitor — live capture → search, export, and chat-with-console.
// Capture is real (CDP); the chat's LLM call is stubbed for determinism.
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Console Monitor: capture → search, export, chat-with-console', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stub only the chat LLM call; let capture (TOOL/debugger) pass through.
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'LLM_GENERATE') {
        return { type: 'LLM_GENERATE', ok: true, result: { text: 'The error is a null dereference in app.js — guard the value before use.', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-console').click();

  // Capture targets the ACTIVE tab — focus the site so the debugger attaches
  // there (the panel is its own tab in the test harness).
  await site.bringToFront();

  // Start capture, then emit a distinctive console error from the page.
  await panel.getByRole('button', { name: 'Start', exact: true }).click();
  await panel.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await site.evaluate(() => console.error('ZX_MONITOR_MARKER boom from app.js'));
    await site.waitForTimeout(120);
  }

  // The captured error streams into the list.
  const list = panel.locator('.console-list');
  await expect(list.getByText(/ZX_MONITOR_MARKER/).first()).toBeVisible({ timeout: 8_000 });

  // Search narrows the stream; a non-match hides it.
  await panel.getByTestId('ci-console-search').fill('ZX_MONITOR_MARKER');
  await expect(list.getByText(/ZX_MONITOR_MARKER/).first()).toBeVisible();
  await panel.getByTestId('ci-console-search').fill('definitely-not-present-xyz');
  await expect(list.getByText(/ZX_MONITOR_MARKER/)).toHaveCount(0);
  await panel.getByTestId('ci-console-search').fill('');

  await panel.screenshot({ path: path.join(SHOTS, '93-ci-monitor.png') });

  // Export → a .txt session log containing the captured marker.
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('ci-console-export').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('console-log.txt');
  expect(readFileSync((await dl.path())!, 'utf8')).toContain('ZX_MONITOR_MARKER');

  // Chat with the console → a stubbed answer renders.
  await panel.getByTestId('ci-console-chat-toggle').click();
  const chat = panel.getByTestId('ci-console-chat');
  await expect(chat).toBeVisible();
  await panel.getByTestId('ci-console-chat-input').fill('what is the error?');
  await panel.getByTestId('ci-console-chat-send').click();
  await expect(chat.getByText(/null dereference in app\.js/)).toBeVisible({ timeout: 8_000 });

  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
});
