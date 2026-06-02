// Settings model picker resolves the chat header model; Auto (Balanced) returns
// to the smart default. (Claude key-gating is covered in modelMenu unit tests.)
import { test, expect } from './fixtures';

test('Settings model picker drives the resolved chat-header model', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();

  const picker = panel.getByTestId('model-picker');
  await expect(picker).toBeVisible({ timeout: 5_000 });
  const proLabel = (await picker.locator('option[value="gemini-2.5-pro"]').textContent())!.split(' · ')[0].trim();
  await picker.selectOption('gemini-2.5-pro');

  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(panel.locator('.panel-hd-sub')).toHaveText(proLabel);

  // Auto (Balanced) → back to the default; header no longer shows the Pro model.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByTestId('model-picker').selectOption('auto');
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(panel.locator('.panel-hd-sub')).not.toHaveText(proLabel);
});
