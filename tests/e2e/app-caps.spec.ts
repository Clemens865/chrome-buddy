// P2 capability bridge: a Tier-3 app uses `storage` (persist across reopen) and
// `page` (read the active tab). Built via the builder with a stubbed LLM, then
// reopened from the grid to prove app-scoped storage survives a remount.
// Run with: npm run test:e2e:appcaps
import { test, expect } from './fixtures';

const NOTES_APP = JSON.stringify({
  name: 'Notepad',
  description: 'A persistent note + page reader',
  html: '<input id="note" placeholder="note"/><button id="save">Save</button><div id="saved"></div><button id="read">Read page</button><div id="pg"></div>',
  css: '#saved,#pg{margin-top:8px;font-size:13px}',
  ui: [
    "const note=root.querySelector('#note'), saved=root.querySelector('#saved');",
    "(async()=>{ const v=await bridge.storage({action:'get',key:'note'}); if(v) saved.textContent='Saved: '+v; })();",
    "root.querySelector('#save').addEventListener('click', async()=>{ await bridge.storage({action:'set',key:'note',value:note.value}); saved.textContent='Saved: '+note.value; });",
    "root.querySelector('#read').addEventListener('click', async()=>{ const p=await bridge.page(); root.querySelector('#pg').textContent=p.title; });",
  ].join('\n'),
  permissions: ['storage', 'page'],
});

test('Tier-3 app uses storage (persists across reopen) + reads the page', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate((app) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        return { type: 'LLM_GENERATE', ok: true, result: { text: app, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      if (msg && msg.type === 'TOOL_EXEC' && msg.tool === 'read_dom') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { url: 'https://ex.com', title: 'Test Page', text: 'hello world', interactiveElements: [], tables: [], provenance: { url: 'https://ex.com', distilledAt: 0 } } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, NOTES_APP);

  // Build it.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: /Build a full app/ }).click();
  await panel.getByLabel('App description').fill('a notepad that remembers and can read the page');
  await panel.getByRole('button', { name: 'Build', exact: true }).click();

  const preview = panel.frameLocator('.builder-preview iframe');
  await expect(preview.locator('#note')).toBeVisible({ timeout: 10_000 });

  // Disclosure surfaces the privacy-relevant page-read capability.
  await expect(panel.getByText(/reads this page/)).toBeVisible();

  // storage.set persists a note.
  await preview.locator('#note').fill('buy milk');
  await preview.locator('#save').click();
  await expect(preview.locator('#saved')).toHaveText('Saved: buy milk');

  // page() reads the (stubbed) active tab title.
  await preview.locator('#read').click();
  await expect(preview.locator('#pg')).toHaveText('Test Page');

  // Save to the grid, then reopen → storage.get rehydrates the note (proves
  // app-scoped persistence survived the remount).
  await panel.getByRole('button', { name: 'Save to my apps' }).click();
  await expect(panel.locator('.app-card-name', { hasText: 'Notepad' })).toBeVisible({ timeout: 5_000 });
  await panel.locator('.app-card-name', { hasText: 'Notepad' }).first().click();
  const reopened = panel.frameLocator('.sandbox-app-frame');
  await expect(reopened.locator('#saved')).toHaveText('Saved: buy milk', { timeout: 10_000 });
});
