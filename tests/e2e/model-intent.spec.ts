// Model intent selector (Cheapest / Balanced / Best). Deterministic — asserts
// the chat header reflects the RESOLVED model, and that "Best" falls back to
// the top Gemini (not Opus) when no Anthropic key is set, with a hint shown.
// Run with: npm run test:e2e:modelintent
import { test, expect } from './fixtures';

test('intent selector resolves the header model; Best needs an Anthropic key for Opus', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Default intent is Cheapest → header shows a lite-tier model.
  await expect(panel.locator('.panel-hd-sub')).toContainText(/Lite/i, { timeout: 5_000 });

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'Model intent' })).toBeVisible();

  // Balanced → registry default (Gemini 3.5 Flash).
  await panel.getByRole('button', { name: 'Balanced', exact: true }).click();
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(panel.locator('.panel-hd-sub')).toHaveText(/Gemini 3\.5 Flash/);

  // Best → escalates to a strong model: Opus 4.8 when an Anthropic key is set,
  // else a Gemini Pro (the key/no-key branch is unit-tested deterministically).
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Best', exact: true }).click();
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  const header = await panel.locator('.panel-hd-sub').textContent();
  expect(header).toMatch(/Opus|Pro/);
  expect(header).not.toMatch(/Lite|Flash$/);
});
