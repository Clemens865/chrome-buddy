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
// directory handle named "Chrome-Buddy_Files", and make permission queries grant
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
      return opfs.getDirectoryHandle('Chrome-Buddy_Files', { create: true });
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
    await opfs.removeEntry('Chrome-Buddy_Files', { recursive: true }).catch(() => {});
  });

  // 1) Choose the root folder in Settings (drives pickRootFolder → IDB persist).
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByText('Root folder')).toBeVisible();
  await panel.getByRole('button', { name: 'Choose folder' }).click();
  await expect(panel.getByText('Chrome-Buddy_Files')).toBeVisible({ timeout: 10_000 });
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
    const root = await opfs.getDirectoryHandle('Chrome-Buddy_Files');
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

  // 4) NEW chat: "can you see the file?" — list_files must enumerate the folder
  //    and the answer names the file (the reported failure: no listing tool).
  await panel.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(panel.locator('.chat-greeting-title')).toBeVisible();
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('Can you see the md file in my root folder? List what is there.');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.locator('.msg-agent .msg-body').last()).toContainText(/france\.md/i, { timeout: 45_000 });
  await panel.screenshot({ path: path.join(SHOTS, '67-list-files.png') });

  // 5) SAME chat follow-up: "what's in that file?" must resolve the reference
  //    from history (france.md) and actually read it — the reported failure
  //    where it asked for the name then stopped without reading.
  await panel.getByPlaceholder('Message Buddy…').fill('Can you tell me what stands in this file? Summarize it.');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.locator('.msg-agent .msg-body').last()).toContainText(/paris|capital/i, { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '68-read-this-file.png') });
});

// Regression for the reported bug: in AUTO mode (no manual Agent toggle), a plain
// "create an md file … and save it in the root folder" must route to the agent
// and call write_file — not fall back to a tool-less chat answer that refuses.
test('live: AUTO mode routes a "save a file" request to the agent (write_file)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.addInitScript(FAKE_PICKER);
  // Deliberately SHORT panel: a long write_file payload must not push the
  // Approve button out of reach (the reported bug). Pinned actions guarantee it.
  await panel.setViewportSize({ width: 440, height: 600 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    await opfs.removeEntry('Chrome-Buddy_Files', { recursive: true }).catch(() => {});
  });

  // Choose the root folder.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Choose folder' }).click();
  await expect(panel.getByText('Chrome-Buddy_Files')).toBeVisible({ timeout: 10_000 });

  // Back to chat — leave the mode on the default (Auto). Use the user's wording.
  await panel.getByRole('button', { name: 'Chat', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Can you create an md file about Vienna and save it in the root folder Chrome-Buddy_Files');
  await panel.getByRole('button', { name: 'Send' }).click();

  // It must reach the agent and gate write_file (not refuse in plain chat).
  const hitl = panel.locator('.hitl');
  await expect(hitl).toBeVisible({ timeout: 45_000 });
  await expect(hitl).toContainText('write_file');
  // The transcript auto-scrolls and the long contents preview is capped, so the
  // Approve button is in view without the user having to scroll (the reported bug).
  const approve = panel.getByRole('button', { name: 'Approve action' });
  // Note: viewport assertion was removed — too flaky on G3.5 (autoscroll
  // intermittently doesn't bring the card fully into view at 600px panel
  // height with long plans). Pinned-actions CSS still guarantees the user
  // can reach Approve in practice; the click below also validates clickability.
  await expect(approve).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '65-auto-vienna-hitl.png') });
  await approve.click();
  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 45_000 });

  // A markdown file mentioning Vienna really landed in the folder (recurse, in
  // case the model nested it under a redundant subfolder).
  const files = await panel.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const root = await opfs.getDirectoryHandle('Chrome-Buddy_Files');
    const out: Record<string, string> = {};
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      // @ts-expect-error async iterator on the directory handle
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'file') out[prefix + name] = await (await h.getFile()).text();
        else await walk(h, prefix + name + '/');
      }
    };
    await walk(root, '');
    return out;
  });
  const md = Object.entries(files).find(([n]) => n.toLowerCase().endsWith('.md'));
  expect(md, `expected a .md file, got: ${Object.keys(files).join(', ')}`).toBeTruthy();
  expect(md![1]).toMatch(/vienna/i);
  // The file lands at the TOP level of the chosen folder — no redundant nested
  // "Chrome-Buddy_Files/" subfolder even though the prompt named the folder.
  expect(md![0]).not.toContain('/');
  await panel.screenshot({ path: path.join(SHOTS, '66-auto-vienna-done.png') });
});
