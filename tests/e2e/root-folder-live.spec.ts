// LIVE round-trip for the root folder (FR-FS-1..3, FR-TOOLS-10): pick a folder,
// have the agent WRITE a markdown file into it (HITL-gated), then in a NEW chat
// have the agent READ that file back. The native showDirectoryPicker is an OS
// dialog Playwright can't drive, so we back it with a genuine OPFS-backed
// FileSystemDirectoryHandle (a real handle: persisted in IndexedDB, real
// createWritable/getFile) and grant permission. Every other path is the real
// app: Settings pick → IDB persist → runner write_file/read_file across chats.
//
// Requires a built-in key (npm run build with VITE_GEMINI_API_KEY).
// Run with: npm run test:e2e:rootlive
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

// Injected before any page script: replace the native picker with an OPFS-backed
// directory handle named "BuddyTestRoot", and make permission queries grant
// (OPFS handles don't implement query/requestPermission, which the app needs).
const FAKE_PICKER = `
  (() => {
    const proto = window.FileSystemDirectoryHandle && window.FileSystemDirectoryHandle.prototype;
    if (proto) {
      proto.queryPermission = async () => 'granted';
      proto.requestPermission = async () => 'granted';
    }
    window.showDirectoryPicker = async () => {
      const opfs = await navigator.storage.getDirectory();
      return opfs.getDirectoryHandle('BuddyTestRoot', { create: true });
    };
  })();
`;

test('live: agent writes a markdown file to the root folder, then reads it back in a new chat', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.addInitScript(FAKE_PICKER);
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Start from a clean OPFS so the assertions are deterministic.
  await panel.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    await opfs.removeEntry('BuddyTestRoot', { recursive: true }).catch(() => {});
  });

  // 1) Choose the root folder in Settings (drives pickRootFolder → IDB persist).
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByText('Root folder')).toBeVisible();
  await panel.getByRole('button', { name: 'Choose folder' }).click();
  await expect(panel.getByText('BuddyTestRoot')).toBeVisible({ timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, '61-root-chosen.png') });

  // 2) New agent chat: ask Buddy to write a markdown file into the root folder.
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill(
      'Use the write_file tool to save a short markdown note to my root folder. ' +
        'Path: france.md. Contents: a one-line markdown summary stating that Paris ' +
        'is the capital of France.',
    );
  await panel.getByRole('button', { name: 'Send' }).click();

  // write_file is consequential → the HITL gate must fire before any write.
  const hitl = panel.locator('.hitl');
  await expect(hitl).toBeVisible({ timeout: 45_000 });
  await expect(hitl).toContainText('write_file');
  await panel.screenshot({ path: path.join(SHOTS, '62-write-hitl.png') });
  await panel.getByRole('button', { name: 'Approve action' }).click();

  // The run completes.
  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 45_000 });
  await panel.screenshot({ path: path.join(SHOTS, '63-write-done.png') });

  // Ground truth: the file really exists in the chosen folder with Paris in it.
  const onDisk = await panel.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const root = await opfs.getDirectoryHandle('BuddyTestRoot');
    const fh = await root.getFileHandle('france.md');
    return (await fh.getFile()).text();
  });
  expect(onDisk).toMatch(/paris/i);

  // 3) NEW chat (fresh transcript): ask Buddy to read the file back.
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(panel.locator('.chat-greeting-title')).toBeVisible();
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Use the read_file tool to read france.md from my root folder. Which city does it name as the capital?');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The synthesized answer (from the file's contents) names Paris.
  await expect(panel.locator('.msg-agent .msg-body').last()).toContainText(/paris/i, { timeout: 45_000 });
  await panel.screenshot({ path: path.join(SHOTS, '64-read-back.png') });
});
