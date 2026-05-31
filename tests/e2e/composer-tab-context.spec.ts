// Multi-tab chat context (Side Copilot parity). The composer "Tabs" picker
// lists other open http(s) tabs, lets you check them, and reflects the count on
// the chip. Separately, the SW can capture a SPECIFIC tab by id (the plumbing
// the picker relies on at send time). No LLM key needed.
// Run with: npx playwright test composer-tab-context.spec.ts
import { test, expect } from './fixtures';

test('Tabs picker: lists other tabs, toggles selection, updates the chip', async ({ context, extensionId }) => {
  // Two recognisable http(s)-ish tabs (data: URLs are excluded by the http/https
  // filter, so open real example pages the query will match).
  const a = await context.newPage();
  await a.goto('https://example.com/');
  const b = await context.newPage();
  await b.goto('https://example.org/');

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const chip = panel.getByTestId('tabctx-toggle');
  await expect(chip).toBeVisible({ timeout: 5_000 });
  await expect(chip).toHaveText('Tabs');

  // Open the picker → it lists the other open tabs (not the active panel).
  await chip.click();
  const pop = panel.getByTestId('tabctx-pop');
  await expect(pop).toBeVisible();
  const items = pop.locator('.tabctx-item');
  await expect(items.first()).toBeVisible();

  // Check the first tab → chip shows a count of 1.
  await items.first().locator('input[type="checkbox"]').check();
  await expect(chip).toHaveText('Tabs · 1');

  // Clear → back to none.
  await pop.locator('.tabctx-clear').click();
  await expect(chip).toHaveText('Tabs');
});

test('SW captures a specific tab by id (PAGE_CONTEXT tabId plumbing)', async ({ context, extensionId }) => {
  // A real http(s) page so chrome.scripting can read it (data: URLs are blocked).
  const target = await context.newPage();
  await target.goto('https://example.com/');
  await expect(target.getByRole('heading', { name: /example domain/i })).toBeVisible({ timeout: 30_000 });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Resolve the target tab's id, then ask the SW to capture THAT tab (not the
  // active one) and assert the captured text carries example.com's content.
  const captured = await panel.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const t = tabs.find((x) => (x.url ?? '').includes('example.com'));
    if (!t?.id) return null;
    const res = (await chrome.runtime.sendMessage({ type: 'PAGE_CONTEXT', tabId: t.id })) as
      | { ok?: boolean; page?: { url?: string; title?: string; text?: string } }
      | undefined;
    return res?.page ?? null;
  });

  expect(captured).not.toBeNull();
  expect(captured?.url ?? '').toContain('example.com');
  expect((captured?.text ?? '').toLowerCase()).toMatch(/example|domain|illustrative/);
});
