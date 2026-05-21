// Live test: voice input (STT) fills the composer, and the speak button (TTS)
// invokes speechSynthesis on an answer. Real audio can't be driven in Playwright,
// so we inject a fake SpeechRecognition and spy on speechSynthesis.speak — this
// verifies our wiring, not the browser's engine.
// Run with: npm run test:e2e:voice  (needs .env key for the chat turn)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: voice input fills the box and speak reads the answer', async ({ context, extensionId }) => {
  // Fake STT + spy on TTS before any page script runs.
  await context.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [{ 0: { transcript: 'hello from voice' }, isFinal: true }],
          });
          this.onend?.();
        }, 30);
      }
      stop() {
        this.onend?.();
      }
    }
    // Override BOTH names — Chromium ships a native SpeechRecognition that our
    // code prefers, but it needs a real mic, so swap in the fake for the test.
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;

    (window as unknown as Record<string, unknown>).__spoken = [];
    if (window.speechSynthesis) {
      const spoken = (window as unknown as { __spoken: string[] }).__spoken;
      window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
        spoken.push(u.text);
      };
      window.speechSynthesis.cancel = () => {};
    }
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // STT: clicking the mic transcribes into the composer.
  await panel.getByRole('button', { name: 'Voice input' }).click();
  await expect(panel.getByPlaceholder('Message Buddy…')).toHaveValue(/hello from voice/, { timeout: 10_000 });

  // Send a real chat turn (Ask mode) to get an agent answer.
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('Reply with one short friendly sentence.');
  await panel.getByRole('button', { name: 'Send' }).click();
  const answer = panel.locator('.msg-agent .msg-body').last();
  await expect(answer).not.toHaveText('', { timeout: 60_000 });

  // TTS: clicking the speak button invokes speechSynthesis.speak.
  await answer.getByRole('button', { name: 'Read aloud' }).click();
  await expect
    .poll(async () => panel.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  await panel.screenshot({ path: path.join(SHOTS, '24-voice.png') });
});
