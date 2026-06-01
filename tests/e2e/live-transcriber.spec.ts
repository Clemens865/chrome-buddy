// Voice Transcriber app — deterministic e2e for the record → transcribe →
// sessions → transforms flow.
//
// We seed a Gemini key, stub the SW's generateContent fetch (audio → a canned
// transcript; a "Summarize" prompt → a canned summary), and stub getUserMedia
// with a running oscillator so the recorder actually captures samples. Then we
// Record → Stop → assert the transcript session opens, run Summarize, and check
// the session persists in the list.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

const TRANSCRIPT = 'This is a recorded test of the voice transcriber feature.';
const SUMMARY = 'Summary: the speaker tested the voice transcriber.';

test('Voice Transcriber: Record → transcribe → session → Summarize', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const [sw] = context.serviceWorkers();

  // Seed a Gemini key via the real KEY_SET handler so the SW attempts the call.
  await panel.evaluate(
    (key) => chrome.runtime.sendMessage({ type: 'KEY_SET', provider: 'google-gemini', key }),
    'test-key-123',
  );

  // Stub the SW's Gemini fetch: audio (inlineData) → transcript; a transform
  // prompt ("Summarize") → summary; everything else passes through.
  await sw.evaluate(({ transcript, summary }) => {
    const real = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const raw = typeof init?.body === 'string' ? init.body : '';
      // Native generateContent — used by audio transcription.
      if (url.includes('generativelanguage.googleapis.com') && url.includes(':generateContent')) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: transcript }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // OpenAI-compatible chat/completions — used by the text transforms.
      if (url.includes('/chat/completions')) {
        const text = raw.includes('Summarize') ? summary : 'ok';
        return new Response(
          JSON.stringify({
            choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return real(input, init);
    };
  }, { transcript: TRANSCRIPT, summary: SUMMARY });

  // Stub the mic with a running oscillator so onaudioprocess fires + samples are
  // captured (sampleCount > 0). Also stub SpeechRecognition so the live caption
  // preview emits an interim result while recording.
  await panel.evaluate(() => {
    // @ts-expect-error stub
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const dst = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      osc.connect(dst);
      osc.start();
      return dst.stream;
    };
    class FakeRecognition {
      continuous = false; interimResults = false; lang = '';
      onresult: ((ev: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: { length: 1, 0: { isFinal: false, 0: { transcript: 'live caption preview' }, length: 1 } },
          });
        }, 50);
      }
      stop() { this.onend?.(); }
      abort() {}
    }
    // Force-override both names (a native webkitSpeechRecognition can shadow a
    // plain assignment) so our fake is the one the app picks up.
    Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  });

  // Apps grid → Voice Transcriber → empty state.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Voice Transcriber').first().click();
  await expect(panel.getByTestId('rec-start')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByTestId('voice-sessions')).toContainText('Press Record');

  // Record → recording state → live caption preview appears → Stop.
  await panel.getByTestId('rec-start').click();
  await expect(panel.getByText(/● Recording/)).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByTestId('voice-live')).toContainText('live caption preview', { timeout: 5_000 });
  await panel.screenshot({ path: path.join(SHOTS, '96-voice-live.png') });
  await panel.waitForTimeout(400);
  await panel.getByTestId('rec-stop').click();

  // After transcription the session detail opens with the transcript text.
  await expect(panel.getByTestId('voice-content')).toContainText(TRANSCRIPT, { timeout: 30_000 });
  await panel.screenshot({ path: path.join(SHOTS, '97-voice-transcript.png') });

  // Run Summarize → a Summary tab appears with the canned summary.
  await panel.getByTestId('voice-run-summary').click();
  await expect(panel.getByTestId('voice-tab-summary')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId('voice-content')).toContainText(SUMMARY, { timeout: 30_000 });
  await panel.screenshot({ path: path.join(SHOTS, '98-voice-summary.png') });

  // Back to the list → the session persisted as a card.
  await panel.getByTestId('voice-back-list').click();
  await expect(panel.getByTestId('voice-session').first()).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByTestId('voice-session').first()).toContainText(/transform/);
});
