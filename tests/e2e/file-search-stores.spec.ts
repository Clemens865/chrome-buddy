// H8 — Settings → File Search Stores section: paste a store id, see it
// appear, remove it. The actual file_search tool isn't exercised in this
// deterministic test (would need a populated store on the user's API key).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Settings → File Search Stores: add + list + remove', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByText('File Search Stores', { exact: true })).toBeVisible();

  // Paste a bare id — should be auto-prefixed with fileSearchStores/.
  const input = panel.getByPlaceholder(/fileSearchStores/);
  await input.fill('my-research-store');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByText('fileSearchStores/my-research-store')).toBeVisible();

  // Paste a full path — should NOT double-prefix.
  await input.fill('fileSearchStores/another-store');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByText('fileSearchStores/another-store')).toBeVisible();

  await panel.screenshot({ path: path.join(SHOTS, '82-file-search-stores.png') });

  // Remove the first one.
  await panel.getByRole('button', { name: 'Remove fileSearchStores/my-research-store' }).click();
  await expect(panel.getByText('fileSearchStores/my-research-store')).toBeHidden();
  await expect(panel.getByText('fileSearchStores/another-store')).toBeVisible();
});
