// Per-collection "active this session" toggle in the chat composer. Create an
// 'active'-mode collection (the new-collection form defaults to active), then
// confirm the composer's Library chip appears, lists it, and toggling it on
// reflects in the chip count. No key needed — collection CRUD + listing are
// key-free; the retrieval itself is unit-tested (autoContextCollectionIds).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('chat composer: toggle an active collection on for the session', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Create an 'active'-mode collection via the Library UI.
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByTestId('library-view')).toBeVisible({ timeout: 5_000 });
  await panel.getByTestId('library-col-new').click();
  await panel.getByTestId('library-newcol-name').fill('Acme Project');
  await panel.getByTestId('library-newcol-create').click();
  await expect(panel.getByTestId('library-col-acme-project')).toBeVisible({ timeout: 5_000 });

  // Back to chat — the composer should now show the Library context chip.
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  const chip = panel.getByTestId('libctx-toggle');
  await expect(chip).toBeVisible({ timeout: 5_000 });
  await expect(chip).toHaveText(/Library$/); // nothing on yet

  // Open the popover, turn Acme on for the session.
  await chip.click();
  const pop = panel.getByTestId('libctx-pop');
  await expect(pop).toContainText('Acme Project');
  await panel.getByTestId('libctx-item-acme-project').locator('input[type=checkbox]').check();
  await expect(chip).toHaveText(/Library · 1/);
  await panel.screenshot({ path: path.join(SHOTS, '100-library-session-context.png') });
});
