// Phase 3 — browser-native research tools. list_tabs enumerates the user's open
// tabs and read_tab reads a SPECIFIC one by id (incl. pages a server-side agent
// can't reach). Drives the real SW TOOL_EXEC path against real open tabs.
// Run with: npx playwright test browser-research-tools.spec.ts
import { test, expect } from './fixtures';

test('list_tabs enumerates open tabs and read_tab reads a specific one', async ({ context, extensionId }) => {
  const a = await context.newPage();
  await a.goto('https://example.com/');
  await expect(a.getByRole('heading', { name: /example domain/i })).toBeVisible({ timeout: 30_000 });
  const b = await context.newPage();
  await b.goto('https://example.org/');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // list_tabs → both open http(s) tabs come back with ids + hosts.
  const list = await panel.evaluate(async () => {
    const res = (await chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool: 'list_tabs', args: {} })) as
      | { ok?: boolean; result?: { ok?: boolean; data?: { tabs?: { tabId: number; url: string; host: string }[] } } }
      | undefined;
    return res?.result?.data?.tabs ?? [];
  });
  const comTab = list.find((t) => t.host === 'example.com');
  expect(comTab).toBeTruthy();
  expect(list.some((t) => t.host === 'example.org')).toBe(true);

  // read_tab on the example.com tab id → its content, not the active panel.
  const page = await panel.evaluate(async (tabId) => {
    const res = (await chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool: 'read_tab', args: { tabId } })) as
      | { ok?: boolean; result?: { ok?: boolean; data?: { url?: string; text?: string } } }
      | undefined;
    return res?.result?.data ?? null;
  }, comTab!.tabId);

  expect(page?.url ?? '').toContain('example.com');
  expect((page?.text ?? '').toLowerCase()).toMatch(/example|domain|illustrative/);

  // read_tab with a bad id → a structured error, not a throw.
  const bad = await panel.evaluate(async () => {
    const res = (await chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool: 'read_tab', args: {} })) as
      | { result?: { ok?: boolean; error?: { code?: string } } }
      | undefined;
    return res?.result;
  });
  expect(bad?.ok).toBe(false);
  expect(bad?.error?.code).toBe('invalid-args');
});
