// The composer model chip overrides the Settings default on the fly and stays
// in sync with Settings + the chat header (one shared modelIntent preference).
// Deterministic. Run with: npm run test:e2e:modelchip
import { test, expect } from './fixtures';

test('composer model chip overrides + syncs with Settings and the header', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const chip = panel.getByLabel('Model quality vs cost');
  await expect(chip).toBeVisible({ timeout: 5_000 });

  // Default (Cheapest) → header shows a lite model.
  await expect(panel.locator('.panel-hd-sub')).toContainText(/Lite/i, { timeout: 5_000 });

  // Bump to Balanced from the composer → header reflects it immediately.
  await chip.selectOption('balanced');
  await expect(panel.locator('.panel-hd-sub')).toHaveText(/Gemini 3\.5 Flash/, { timeout: 5_000 });

  // Settings shows the same value (one shared preference).
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Balanced', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Back in chat, switch to Best per-query → header escalates (Opus or Gemini Pro).
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await chip.selectOption('best');
  const header = await panel.locator('.panel-hd-sub').textContent();
  expect(header).toMatch(/Opus|Pro/);
  expect(header).not.toMatch(/Lite|Flash$/);
});
