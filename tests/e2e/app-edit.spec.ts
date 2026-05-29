// Edit/iterate a SAVED Tier-3 app: build → save → reopen via ✎ Edit (builder
// seeds the existing app, no re-describe) → refine → save UPDATES the same app
// (no duplicate). Stubbed LLM for determinism. Run: npm run test:e2e:appedit
import { test, expect } from './fixtures';

const v1 = JSON.stringify({
  name: 'Counter', description: 'a counter', html: '<button id="b">0</button>', css: '',
  ui: "let n=0;const b=root.querySelector('#b');b.addEventListener('click',()=>{n++;b.textContent=String(n);});",
  permissions: [],
});
const v2 = JSON.stringify({
  name: 'Counter', description: 'a counter with reset', html: '<button id="b">0</button><button id="r">Reset</button>', css: '',
  ui: "let n=0;const b=root.querySelector('#b');const r=root.querySelector('#r');b.addEventListener('click',()=>{n++;b.textContent=String(n);});r.addEventListener('click',()=>{n=0;b.textContent='0';});",
  permissions: [],
});

async function stub(panel: import('@playwright/test').Page) {
  await panel.evaluate(({ a, b }) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; messages?: { content: string }[] }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        const last = msg.messages?.[msg.messages.length - 1]?.content ?? '';
        return { type: 'LLM_GENERATE', ok: true, result: { text: /change it/i.test(last) ? b : a, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, { a: v1, b: v2 });
}

test('build → save → Edit reopens it → refine → updates the same app', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await stub(panel);

  // Build + save a Counter.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: /Build a full app/ }).click();
  await panel.getByLabel('App description').fill('a counter');
  await panel.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(panel.frameLocator('.builder-preview iframe').locator('#b')).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('button', { name: 'Save to my apps' }).click();
  await expect(panel.locator('.app-card-name', { hasText: 'Counter' })).toHaveCount(1, { timeout: 5_000 });

  // Reopen via ✎ Edit — the builder seeds the saved app (preview renders #b
  // immediately, no describe step).
  await panel.getByRole('button', { name: 'Edit Counter' }).click();
  await expect(panel.getByTestId('app-builder')).toBeVisible();
  const preview = panel.frameLocator('.builder-preview iframe');
  await expect(preview.locator('#b')).toBeVisible({ timeout: 10_000 });
  await expect(preview.locator('#r')).toHaveCount(0); // v1 has no reset yet

  // Refine → the edit produces v2 (with a reset button).
  await panel.getByLabel('Refine the app').fill('add a reset button');
  await panel.getByRole('button', { name: 'Refine', exact: true }).click();
  await expect(preview.locator('#r')).toBeVisible({ timeout: 10_000 });

  // Save → UPDATES the same app: still exactly one "Counter" in the grid.
  await panel.getByRole('button', { name: 'Save to my apps' }).click();
  await expect(panel.locator('.app-card-name', { hasText: 'Counter' })).toHaveCount(1, { timeout: 5_000 });
});
