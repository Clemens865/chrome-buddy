// Audio Transcriber app: upload a known-speech WAV, transcribe via Gemini, and
// confirm the words come back. Fixture generated with macOS `say` (a clear TTS
// phrase). Run with: npm run test:e2e:transcriber  (needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');
const FIXTURE = path.join(process.cwd(), 'tests/fixtures/speech.wav');

test('live: transcribe an audio file to text', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Audio Transcriber').click();

  // Pick the fixture (the input is hidden; setInputFiles bypasses the dialog).
  await panel.locator('input[type="file"]').setInputFiles(FIXTURE);
  await expect(panel.getByRole('button', { name: 'Transcribe' })).toBeVisible();
  await panel.getByRole('button', { name: 'Transcribe' }).click();

  // The transcript comes back containing the spoken words.
  const result = panel.locator('.tr-result .msg-body');
  await expect(result).toContainText(/quick brown fox|fox|lazy dog/i, { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '48-transcriber.png') });
});
