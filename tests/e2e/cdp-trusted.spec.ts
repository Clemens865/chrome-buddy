// FR-BC-2/3: trusted-input via chrome.debugger (CDP). We drive a real form with
// trusted:true type+click and confirm the values reach the server — proving the
// CDP engine dispatches genuine OS-level input (not synthetic events).
// Run with: npm run test:e2e:cdp  (needs the "debugger" permission in the build)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('CDP trusted type + click drive a real form', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://httpbin.org/forms/post', { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Type into the field via CDP trusted input.
  const typeRes = await panel.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'type',
      args: { selector: 'input[name="custname"]', text: 'Ada via CDP', trusted: true },
    }),
  );
  expect(typeRes).toMatchObject({ ok: true, result: { ok: true, data: { engine: 'cdp' } } });

  // Click the submit button via CDP trusted input.
  const clickRes = await panel.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'click',
      args: { text: 'Submit order', trusted: true },
    }),
  );
  expect(clickRes).toMatchObject({ ok: true, result: { ok: true, data: { engine: 'cdp' } } });

  // The form posted the trusted-typed value to the server.
  await site.waitForURL(/\/post/, { timeout: 30_000 });
  await expect(async () => {
    expect(await site.locator('body').innerText()).toContain('Ada via CDP');
  }).toPass({ timeout: 15_000 });
  await site.screenshot({ path: path.join(SHOTS, '45-cdp-trusted.png') });
});
