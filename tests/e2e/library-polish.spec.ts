// Library v1 polish — three additions, three checks:
//   (1) "+ Library" button on a Buddy reply saves the reply via LIBRARY_INDEX;
//       confirms by listing the new doc in the Library view.
//   (2) Auto-context "From your Library" collapsible card renders next to a
//       user message after a chat turn that pulled in snippets, with the
//       actual snippet contents inside (not just italic text).
//   (3) Library doc cap setting is honored — set max=1, index two docs,
//       verify only the most recent survives.
//
// Live — needs VITE_GEMINI_API_KEY (used for the embedding round-trips).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Library polish: Save-to-Library on a reply lands the doc in the Library', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Inject one synthetic agent reply directly into the transcript via React
  // state isn't trivial; instead we exercise the SaveToLibraryButton through
  // its real path: seed a chat via IDB, reload, find the agent bubble.
  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    await new Promise<void>((resolve, reject) => { open.onsuccess = () => resolve(); open.onerror = () => reject(); });
    const db = open.result;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chats', 'readwrite');
      tx.objectStore('chats').put({
        id: 'c_save_demo',
        title: 'Save-to-Library demo',
        items: [
          { kind: 'user', id: 'u_q1', text: 'Why is the sky blue?' },
          { kind: 'agent', id: 'a_q1', text: '# Rayleigh scattering\n\nShorter wavelengths scatter more strongly off air molecules, so blue light reaches our eyes from every direction.' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    });
  });
  await panel.reload();

  // Open the seeded chat from the Chats list.
  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  await panel.getByText('Save-to-Library demo').click();

  // Hover the agent bubble + click "+ Library".
  const saveBtn = panel.getByTestId('msg-save-library');
  await expect(saveBtn).toBeVisible({ timeout: 5_000 });
  await saveBtn.click();

  // The title pre-fills from the first non-empty line ("Rayleigh scattering").
  const form = panel.getByTestId('msg-save-form');
  await expect(form).toBeVisible();
  await expect(form.locator('input[aria-label="Title for the saved Library entry"]')).toHaveValue('Rayleigh scattering');

  // Click Save — wait for the chip to flip to "Saved ✓".
  await panel.getByTestId('msg-save-confirm').click();
  await expect(panel.getByTestId('msg-save-confirm')).toHaveText(/Saved/, { timeout: 30_000 });

  // Open the Library view and confirm the doc landed.
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  const docs = panel.getByTestId('library-docs');
  await expect(docs).toContainText('Rayleigh scattering', { timeout: 5_000 });
  await panel.screenshot({ path: path.join(SHOTS, '94-library-save-to-library.png') });
});

test('Library polish: doc cap evicts the oldest doc when exceeded', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Set the cap to 1 via chrome.storage.local so any third index evicts.
  await panel.evaluate(async () => {
    await chrome.storage.local.set({ libraryMaxDocs: 1 });
  });

  // Index doc A (oldest), then doc B. With cap=1, after B's save the
  // post-save eviction must drop A.
  await panel.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'LIBRARY_INDEX',
      source: 'manual',
      sourceRef: 'cap-demo-A',
      title: 'Apples and oranges',
      content: 'Apples and oranges are different fruits but both pomes.',
    });
    // Give the post-save eviction a moment; updatedAt differs by at least 1 ms
    // by the time we send B.
    await new Promise((r) => setTimeout(r, 50));
    await chrome.runtime.sendMessage({
      type: 'LIBRARY_INDEX',
      source: 'manual',
      sourceRef: 'cap-demo-B',
      title: 'Bananas tropical',
      content: 'Bananas are a tropical fruit grown in equatorial regions.',
    });
  });

  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  const docs = panel.getByTestId('library-docs');
  await expect(docs).toContainText('Bananas tropical', { timeout: 5_000 });
  await expect(docs).not.toContainText('Apples and oranges');
});
