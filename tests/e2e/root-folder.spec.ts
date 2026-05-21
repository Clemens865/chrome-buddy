// Root-folder UI: the File System Access picker is a native dialog Playwright
// can't drive, so we verify the Settings control is present + supported (the
// read/write logic is covered by src/fs/root.test.ts, and write_file's
// downloads fallback by file-write.spec.ts). Run: npm run test:e2e:rootfolder
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Settings exposes a root-folder picker', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByText('Root folder')).toBeVisible();
  // Chromium supports the File System Access API, so the picker button shows.
  await expect(panel.getByRole('button', { name: 'Choose folder' })).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '34-root-folder.png') });
});
