// Settings → Profile switching. Survey flagged this as Tier-2 risk — the
// professional / personal profile fields share the same form but should
// store INDEPENDENTLY so switching back recovers the other profile's data.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Profile: professional + personal fields are stored independently', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();

  // Active profile defaults to professional. Fill professional fields.
  const proBtn = panel.locator('button.seg-btn').filter({ hasText: 'professional' });
  const persBtn = panel.locator('button.seg-btn').filter({ hasText: 'personal' });
  await expect(proBtn).toHaveClass(/is-on/);

  await panel.getByPlaceholder('Your name').fill('Pro Clemens');
  await panel.getByLabel('Role').fill('Director, Engineering');
  await panel.getByLabel('About').fill('Builds infra. Coffee-fueled.');

  // Switch to personal — fields must show blank/different (per-profile state).
  await persBtn.click();
  await expect(persBtn).toHaveClass(/is-on/);
  await expect(panel.getByPlaceholder('Your name')).toHaveValue('');
  await expect(panel.getByLabel('Role')).toHaveValue('');
  await expect(panel.getByLabel('About')).toHaveValue('');

  // Fill personal fields with different content.
  await panel.getByPlaceholder('Your name').fill('Casual Clemens');
  await panel.getByLabel('Role').fill('Hiker, photographer');
  await panel.getByLabel('About').fill('Mountains > meetings.');

  // Switch back to professional — original values must still be there.
  await proBtn.click();
  await expect(panel.getByPlaceholder('Your name')).toHaveValue('Pro Clemens');
  await expect(panel.getByLabel('Role')).toHaveValue('Director, Engineering');
  await expect(panel.getByLabel('About')).toHaveValue('Builds infra. Coffee-fueled.');

  // Reload — both profiles persist independently.
  await panel.reload();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByPlaceholder('Your name')).toHaveValue('Pro Clemens');
  await persBtn.click();
  await expect(panel.getByPlaceholder('Your name')).toHaveValue('Casual Clemens');
  await panel.screenshot({ path: path.join(SHOTS, '280-profile-personal.png') });
});
