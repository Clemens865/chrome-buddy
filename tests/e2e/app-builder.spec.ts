// Conversational Tier-3 app builder (P3). Stubs the SW LLM so the builder is
// deterministic: describe → live preview renders + RUNS in the sandbox →
// iterate (a second spec) → Save → the app deploys to the grid and reopens.
// Run with: npm run test:e2e:appbuilder
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

const counterV1 = JSON.stringify({
  name: 'Counter',
  description: 'A click counter',
  html: '<button id="b">0</button>',
  css: '#b{font-size:20px;padding:8px 16px}',
  ui: "let n=0; const b=root.querySelector('#b'); b.addEventListener('click',()=>{n++; b.textContent=String(n);});",
  permissions: [],
});
const counterV2 = JSON.stringify({
  name: 'Counter',
  description: 'A click counter with a reset',
  html: '<button id="b">Count: 0</button><button id="r">Reset</button>',
  css: '#b{font-size:20px}',
  ui: "let n=0; const b=root.querySelector('#b'); const r=root.querySelector('#r'); b.addEventListener('click',()=>{n++; b.textContent='Count: '+n;}); r.addEventListener('click',()=>{n=0; b.textContent='Count: 0';});",
  permissions: [],
});

async function stubBuilder(panel: import('@playwright/test').Page) {
  await panel.evaluate(({ v1, v2 }) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub onto typed handle
    chrome.runtime.sendMessage = async (msg: { type?: string; messages?: { role: string; content: string }[] }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        const last = msg.messages?.[msg.messages.length - 1]?.content ?? '';
        const text = /change it/i.test(last) ? v2 : v1;
        return { type: 'LLM_GENERATE', ok: true, result: { text, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, { v1: counterV1, v2: counterV2 });
}

test('describe → live preview runs → iterate → save deploys to the grid', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await stubBuilder(panel);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: /Build a full app/ }).click();
  await expect(panel.getByTestId('app-builder')).toBeVisible({ timeout: 5_000 });

  // Describe + build.
  await panel.getByLabel('App description').fill('a click counter');
  await panel.getByRole('button', { name: 'Build', exact: true }).click();

  // Live preview renders the app's OWN UI in the sandbox and it actually runs.
  const preview = panel.frameLocator('.builder-preview iframe');
  await expect(preview.locator('#b')).toBeVisible({ timeout: 10_000 });
  await preview.locator('#b').click();
  await expect(preview.locator('#b')).toHaveText('1');
  await panel.screenshot({ path: path.join(SHOTS, '297-app-builder.png') });

  // Iterate: ask for a reset button → the preview reflects the new version.
  await panel.getByLabel('Refine the app').fill('add a reset button');
  await panel.getByRole('button', { name: 'Refine', exact: true }).click();
  await expect(preview.locator('#r')).toBeVisible({ timeout: 10_000 });
  await expect(preview.locator('#b')).toHaveText('Count: 0');

  // Save → deploys to the grid and returns to Apps.
  await panel.getByRole('button', { name: 'Save to my apps' }).click();
  await expect(panel.getByText('Your generated apps')).toBeVisible({ timeout: 5_000 });
  await expect(panel.locator('.app-card-name', { hasText: 'Counter' })).toBeVisible();

  // Reopen the deployed app → it runs again in the sandbox host.
  await panel.locator('.app-card-name', { hasText: 'Counter' }).first().click();
  await expect(panel.getByTestId('sandbox-app')).toBeVisible({ timeout: 5_000 });
  await expect(panel.frameLocator('.sandbox-app-frame').locator('#r')).toBeVisible({ timeout: 10_000 });
});

test('Save is disabled until the app has run once', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  // Stub returns a spec whose ui throws at mount → status 'error' → no Save.
  await panel.evaluate(() => {
    const bad = JSON.stringify({ name: 'Broken', html: '<div id="x"></div>', css: '', ui: 'root.querySelector("#nope").textContent = "boom";', permissions: [] });
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        return { type: 'LLM_GENERATE', ok: true, result: { text: bad, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: /Build a full app/ }).click();
  await panel.getByLabel('App description').fill('a broken app');
  await panel.getByRole('button', { name: 'Build', exact: true }).click();

  // The app errors at mount → an Auto-fix affordance shows and Save is disabled.
  await expect(panel.getByRole('button', { name: /Auto-fix/ })).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole('button', { name: 'Save to my apps' })).toBeDisabled();
});
