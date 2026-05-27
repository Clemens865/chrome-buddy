// The composer's paperclip button used to be a dead UI element (no onClick).
// This test locks the new flow: click paperclip → file picker is wired,
// picking a text file shows a chip, picking a PDF surfaces an error, picking
// an image shows an image chip, and the chip's ✕ removes the attachment.
//
// We exercise the wiring through the hidden <input type="file"> directly
// (Playwright's setInputFiles), which is exactly what `fileInputRef.click()`
// triggers in the real UI.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('composer attach: text file shows chip, PDF errors, image shows chip, ✕ removes', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The paperclip is rendered as soon as ChatView mounts.
  const paperclip = panel.getByTestId('composer-attach');
  await expect(paperclip).toBeVisible({ timeout: 8_000 });
  const fileInput = panel.getByTestId('composer-file-input');
  await expect(fileInput).toBeAttached();

  // 1) Attach a small text file → a text chip appears with the file name + size.
  await fileInput.setInputFiles({
    name: 'notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Heading\n\nHello attachment world.'),
  });
  const chips = panel.getByTestId('composer-attachments');
  await expect(chips).toBeVisible();
  await expect(chips.locator('.attach-chip-name')).toContainText('notes.md');

  // 2) Try a PDF → rejected with a friendly error message; no chip added.
  await fileInput.setInputFiles({
    name: 'paper.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake'),
  });
  await expect(chips.locator('.attach-error')).toContainText(/PDF/i);
  // Still exactly one chip (the text one).
  await expect(chips.locator('.attach-chip')).toHaveCount(1);

  // 3) Attach an image (1×1 PNG) → image chip joins the text chip.
  const onePx = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await fileInput.setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: onePx,
  });
  await expect(chips.locator('.attach-chip')).toHaveCount(2);
  await expect(chips.locator('.attach-chip-name').nth(1)).toContainText('pixel.png');

  await panel.screenshot({ path: path.join(SHOTS, '160-composer-attachments.png') });

  // 4) ✕ on the text chip removes only that one.
  await chips.locator('.attach-chip').nth(0).getByRole('button', { name: /Remove notes\.md/ }).click();
  await expect(chips.locator('.attach-chip')).toHaveCount(1);
  await expect(chips.locator('.attach-chip-name')).toContainText('pixel.png');
});
