// write_file (FR-TOOLS-10): a consequential tool that saves to Downloads via
// chrome.downloads. Two checks: the SW mechanism (deterministic, no key) and the
// full agent path with the HITL gate (live). Playwright intercepts downloads, so
// we verify the SW's structured result + the agent's tool trace rather than
// poking chrome.downloads.search (which it makes unreliable).
// Run with: npm run test:e2e:filewrite  (second test needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('write_file SW handler saves via chrome.downloads', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const res = await panel.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'write_file',
      args: { path: 'buddy-test.txt', contents: 'hello from buddy' },
    }),
  );
  expect(res).toMatchObject({
    type: 'TOOL_EXEC',
    ok: true,
    result: { ok: true, data: { filename: 'buddy-test.txt', bytes: 16 } },
  });
});

test('live: agent writes a file through the HITL gate', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Use the write_file tool to save a file named buddy-test.txt with the exact contents: hello from buddy');
  await panel.getByRole('button', { name: 'Send' }).click();

  // Consequential -> must pause at the HITL gate; approve it.
  const approve = panel.getByRole('button', { name: 'Approve action' });
  await expect(approve).toBeVisible({ timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '27-write-file-confirm.png') });
  await approve.click();

  // The write_file tool trace settles as succeeded, and the agent answers.
  await expect(panel.getByText('write_file', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText('succeeded', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '28-write-file-done.png') });
});
