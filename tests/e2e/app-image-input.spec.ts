// A Tier-3 app's bridge.image({prompt, inputImage}) must forward inputImage to
// the image model so upload→restyle apps (e.g. Portrait Maker) work. The SW
// IMAGE_GENERATE is stubbed to ECHO the inputImage, so we can assert it arrived.
// Run with: npm run test:e2e:appimage
import { test, expect } from './fixtures';

const IMG = 'data:image/png;base64,UPLOADEDPHOTO';
const RESTYLER = JSON.stringify({
  name: 'Restyler',
  description: 'restyle an image',
  html: '<button id="go">Restyle</button><img id="out" alt="" />',
  css: '#out{display:block;margin-top:8px;max-width:80px}',
  ui: `root.querySelector('#go').addEventListener('click', async () => { const r = await bridge.image({ prompt: 'professional portrait', inputImage: '${IMG}' }); root.querySelector('#out').src = r; });`,
  permissions: ['image'],
});

test('bridge.image forwards inputImage (upload → restyle works)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate((app) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; inputImage?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        return { type: 'LLM_GENERATE', ok: true, result: { text: app, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      if (msg && msg.type === 'IMAGE_GENERATE') {
        // Echo the inputImage back so the test can confirm it was forwarded.
        return { type: 'IMAGE_GENERATE', ok: true, dataUrl: msg.inputImage ? msg.inputImage : 'data:NO_INPUT' };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, RESTYLER);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: /Build a full app/ }).click();
  await panel.getByLabel('App description').fill('a portrait restyler');
  await panel.getByRole('button', { name: 'Build', exact: true }).click();

  const preview = panel.frameLocator('.builder-preview iframe');
  await expect(preview.locator('#go')).toBeVisible({ timeout: 10_000 });
  await preview.locator('#go').click();
  // The result equals the uploaded image → inputImage made it to the model.
  await expect(preview.locator('#out')).toHaveAttribute('src', IMG, { timeout: 10_000 });
});
