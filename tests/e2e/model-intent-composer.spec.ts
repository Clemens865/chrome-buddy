// Composer model picker → the chat header reflects the chosen model, and the
// choice syncs to Settings (both read the same persisted preference).
import { test, expect } from './fixtures';

test('composer model picker updates the header + syncs to Settings', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const picker = panel.getByTestId('model-picker');
  await expect(picker).toBeVisible({ timeout: 5_000 });

  // Pick a specific model; the header subtitle shows its name.
  const label = (await picker.locator('option[value="gemini-2.5-pro"]').textContent())!.split(' · ')[0].trim();
  await picker.selectOption('gemini-2.5-pro');
  await expect(panel.locator('.panel-hd-sub')).toHaveText(label);

  // Shared state → Settings shows the same selection.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('model-picker')).toHaveValue('gemini-2.5-pro');
});
