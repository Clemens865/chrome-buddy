// The "debugger" permission makes chrome.debugger available, which the Console
// Inspector needs to capture console/network. Run: npm run test:e2e:console
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Console Inspector can start capturing (debugger permission present)', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The permission is granted: chrome.debugger is now defined in the extension.
  const hasDebugger = await panel.evaluate(() => typeof chrome.debugger !== 'undefined');
  expect(hasDebugger).toBe(true);

  // Open the Console Inspector and start capturing against the real tab.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').click();
  await site.bringToFront(); // make the http page the active tab to attach to
  await panel.getByRole('button', { name: 'Start', exact: true }).click();

  // It must NOT report the old "chrome.debugger is unavailable" error.
  await expect(panel.getByText(/chrome\.debugger is unavailable/)).toHaveCount(0);
  // Capturing started (the toggle flips to Stop).
  await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, '46-console-inspector.png') });

  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
});
