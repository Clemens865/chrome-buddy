// LIVE: the SW TTS handler actually calls Gemini TTS and returns a WAV data URL.
// Proves the real round-trip (Google TTS → 24kHz PCM → WAV). Needs a Gemini key.
import { test, expect } from './fixtures';

test('live: TTS_GENERATE returns a WAV data URL from Gemini', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const res = await panel.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'TTS_GENERATE', text: 'Hello from Chrome Buddy.', voice: 'Kore' });
  });
  const r = res as { type?: string; ok?: boolean; audioDataUrl?: string; error?: string };
  if (r?.type === 'ERROR') console.log('TTS error:', r.error);
  expect(r?.ok).toBe(true);
  expect(r?.audioDataUrl).toMatch(/^data:audio\/wav;base64,/);
  // A real second of 24kHz mono 16-bit audio is tens of KB — far past the header.
  expect((r?.audioDataUrl ?? '').length).toBeGreaterThan(2000);
});
