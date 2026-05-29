// Image Generator: AI-iterate (edit with the current image as input), undo,
// interactive crop, and rounded-corner PNG export. The SW IMAGE_GENERATE is
// stubbed to synthesize a real colored PNG (red for generate, blue for edit)
// so the canvas editor + crop operate on actual pixels. No key needed.
// Run with: npm run test:e2e:imageedit
import { test, expect } from './fixtures';

async function stubImages(panel: import('@playwright/test').Page) {
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; inputImage?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'IMAGE_GENERATE') {
        const c = document.createElement('canvas');
        c.width = 80; c.height = 80;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = msg.inputImage ? '#2266ff' : '#ff3333'; // edit→blue, generate→red
        ctx.fillRect(0, 0, 80, 80);
        return { type: 'IMAGE_GENERATE', ok: true, dataUrl: c.toDataURL('image/png') };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });
}

test('generate → iterate with AI → undo', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await stubImages(panel);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Image Generator', { exact: true }).first().click();

  await panel.getByPlaceholder(/Describe an image/).fill('a red square');
  await panel.getByRole('button', { name: 'Generate' }).click();

  const img = panel.locator('.img-crop-stage img.art');
  await expect(img).toBeVisible({ timeout: 10_000 });
  const generated = await img.getAttribute('src');
  expect(generated).toMatch(/^data:image\/png/);

  // Iterate with AI — the edit re-generates using the current image as input.
  await panel.getByLabel('Edit instruction').fill('make it blue');
  await panel.getByRole('button', { name: 'Edit with AI' }).click();
  await expect.poll(async () => img.getAttribute('src')).not.toBe(generated);
  const edited = await img.getAttribute('src');

  // Undo restores the previous version.
  await panel.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => img.getAttribute('src')).toBe(generated);
  expect(edited).not.toBe(generated);
});

test('crop a region, then export a rounded-corner PNG', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await stubImages(panel);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Image Generator', { exact: true }).first().click();
  await panel.getByPlaceholder(/Describe an image/).fill('a red square');
  await panel.getByRole('button', { name: 'Generate' }).click();

  const img = panel.locator('.img-crop-stage img.art');
  await expect(img).toBeVisible({ timeout: 10_000 });
  const before = await img.getAttribute('src');

  // Enter crop mode, drag a box across the image, apply.
  await panel.getByRole('button', { name: 'Crop', exact: true }).click();
  const box = (await img.boundingBox())!;
  await panel.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await panel.mouse.down();
  await panel.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 5 });
  await panel.mouse.up();
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => img.getAttribute('src')).not.toBe(before); // image changed (cropped)

  // Set a corner radius and export — a PNG download streams.
  await panel.getByLabel('Corner radius').fill('20');
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download PNG' }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('chrome-buddy-image.png');
});
