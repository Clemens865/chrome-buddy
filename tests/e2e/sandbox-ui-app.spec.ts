// Tier-3 sandbox-UI app runtime (P1 proof). Opens the built-in SVG Icon
// Generator, which renders its OWN interactive UI inside the opaque-origin
// sandbox iframe and calls the `gemini` capability via the bridge. We stub the
// SW LLM call so it's deterministic (no key needed), then assert the app
// renders the returned SVG into its gallery and that download is wired.
// Run with: npm run test:e2e:sandboxui
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const SHOTS = path.join(process.cwd(), 'screenshots');
const FAKE_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>';
// 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('SVG generator renders its own UI in the sandbox and runs via the bridge', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stub the SW LLM_GENERATE so bridge.gemini() returns a known SVG.
  await panel.evaluate((svg) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub onto typed handle
    chrome.runtime.sendMessage = async (msg: { type?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        return { type: 'LLM_GENERATE', ok: true, result: { text: `here you go: ${svg}`, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, FAKE_SVG);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('SVG Icon Generator', { exact: true }).first().click();

  // Host chrome is present (sandboxed badge) and the app frame mounted.
  await expect(panel.getByText(/Sandboxed app/)).toBeVisible({ timeout: 5_000 });
  const frame = panel.frameLocator('iframe.sandbox-app-frame');
  await expect(frame.locator('#desc')).toBeVisible({ timeout: 5_000 });

  // Drive the app's OWN UI inside the sandbox iframe.
  await frame.locator('#desc').fill('a rocket launching');
  await frame.locator('#count').selectOption('1');
  await frame.locator('#go').click();

  // The app rendered the bridge-returned SVG into its gallery.
  await expect(frame.locator('.gallery .card svg')).toHaveCount(1, { timeout: 10_000 });
  await expect(frame.locator('.gallery .card .dl')).toBeVisible();

  // Download is wired through the host bridge (anchor click → download event).
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    frame.locator('.gallery .card .dl').click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/icon-1\.svg/);
  await panel.screenshot({ path: path.join(SHOTS, '296-sandbox-svg-app.png') });
});

test('a capability the app did not declare is denied by the bridge broker', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('SVG Icon Generator', { exact: true }).first().click();
  const frame = panel.frameLocator('iframe.sandbox-app-frame');
  await expect(frame.locator('#desc')).toBeVisible({ timeout: 5_000 });

  // The app only declared gemini+download. An undeclared op must reject.
  const denied = await frame.locator('body').evaluate(async () => {
    // The app's bridge is not in scope here, so emulate an app calling an
    // ungranted op by posting the same SANDBOX_BRIDGE the runtime would, and
    // awaiting the broker's reply.
    return await new Promise<string>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const d = ev.data as { type?: string; id?: string; ok?: boolean; error?: string };
        if (d?.type === 'SANDBOX_BRIDGE_RESULT' && d.id === 'probe') {
          window.removeEventListener('message', onMsg);
          resolve(d.ok ? 'ALLOWED' : `DENIED: ${d.error}`);
        }
      };
      window.addEventListener('message', onMsg);
      window.parent.postMessage({ type: 'SANDBOX_BRIDGE', id: 'probe', runId: 'ui_builtin_svggen', op: 'github_write', args: {} }, '*');
    });
  });
  expect(denied).toMatch(/DENIED/);
});

test('image data-URL download decodes to real PNG bytes (not the data-URL text)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('SVG Icon Generator', { exact: true }).first().click();
  const frame = panel.frameLocator('iframe.sandbox-app-frame');
  await expect(frame.locator('#desc')).toBeVisible({ timeout: 5_000 });

  // The SVG app declares the `download` capability, so a download op is allowed.
  // Drive it with an IMAGE data URL (what bridge.image returns) and capture the
  // file the host writes.
  const dataUrl = `data:image/png;base64,${PNG_B64}`;
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    frame.locator('body').evaluate((_el, du) => {
      window.parent.postMessage(
        { type: 'SANDBOX_BRIDGE', id: 'dlimg', runId: 'ui_builtin_svggen', op: 'download', args: { filename: 'portrait.png', content: du } },
        '*',
      );
    }, dataUrl),
  ]);

  expect(dl.suggestedFilename()).toBe('portrait.png');
  const bytes = await readFile(await dl.path());
  // The saved file is the DECODED PNG — magic header + the decoded size — NOT
  // the literal (much longer) data-URL string the old bug wrote.
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.length).toBe(Buffer.from(PNG_B64, 'base64').length);
  expect(bytes.length).toBeLessThan(dataUrl.length);
});
