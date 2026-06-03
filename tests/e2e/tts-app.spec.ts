// Text to Speech app runs in the sandbox and drives the bridge.tts capability.
// Seeds the catalog bundle, stubs the SW TTS_GENERATE so it's deterministic, then
// pastes text → Speak → asserts the <audio> player got the synthesized WAV URL.
import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bundle = JSON.parse(readFileSync(join(process.cwd(), 'docs/catalog-seed/apps/text-to-speech.json'), 'utf8')) as {
  apps: Record<string, unknown>[];
};
const app = { ...bundle.apps[0], reviewed: true };
const WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

test('Text to Speech: paste → Speak synthesizes via bridge.tts and plays a WAV', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(async (a) => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('apps', 'readwrite');
      tx.objectStore('apps').put(a);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, app);
  await panel.reload();

  // Stub the SW TTS so the app's bridge.tts call resolves to a known WAV URL.
  await panel.evaluate((wav) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub onto typed handle
    chrome.runtime.sendMessage = async (msg: { type?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'TTS_GENERATE') return { type: 'TTS_GENERATE', ok: true, audioDataUrl: wav };
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, WAV);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Text to Speech', { exact: true }).first().click();

  const frame = panel.frameLocator('.sandbox-app-frame');
  await expect(frame.locator('#text')).toBeVisible({ timeout: 15_000 });
  // The app rendered the 30-voice picker.
  await expect(frame.locator('#voice option')).toHaveCount(30);

  await frame.locator('#text').fill('Hello world, this is a Chrome Buddy text-to-speech test.');
  await frame.locator('#speak').click();

  // bridge.tts → host broker → TTS_GENERATE → the player receives the WAV URL.
  await expect(frame.locator('#player')).toHaveAttribute('src', WAV, { timeout: 10_000 });
  await expect(frame.locator('#actions')).toBeVisible();
});
