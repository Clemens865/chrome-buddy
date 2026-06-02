// Composer model picker shows ACTUAL models (Auto + named Gemini/Claude, Claude
// key-gated) and the mode-help '?' popover explains what runs per mode.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('composer: real-model picker + mode-help popover', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const picker = panel.getByTestId('model-picker');
  await expect(picker).toBeVisible({ timeout: 5_000 });

  // It lists Auto + named Gemini + named Claude (not abstract tiers).
  const values = await picker.locator('option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  );
  expect(values).toContain('auto');
  expect(values.some((v) => v.startsWith('gemini'))).toBe(true);
  expect(values).toContain('claude-opus-4-8');
  expect(values).toContain('claude-haiku-4-5-20251001');

  // (Claude key-gating is unit-tested in modelMenu.test.ts — it depends on whether
  //  an Anthropic key is configured, so we don't assert enabled/disabled here.)

  // Pick a specific Gemini model — it sticks (custom intent).
  const gid = values.find((v) => v.startsWith('gemini'))!;
  await picker.selectOption(gid);
  await expect(picker).toHaveValue(gid);

  // Mode-help '?' popover explains modes + that model is independent.
  await panel.getByTestId('mode-help').click();
  const pop = panel.getByTestId('mode-help-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('Ask');
  await expect(pop).toContainText('Agent');
  await expect(pop).toContainText('Model');
  await panel.screenshot({ path: path.join(SHOTS, '101-model-picker.png') });
});
