// Live Transcriber app — deterministic e2e.
//
// We stub WebSocket in the SW + getUserMedia in the panel, then push a few
// fake `inputTranscription` chunks from the stub server and assert the
// transcript renders. Then click "+ Library" and confirm the doc landed.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function installLiveStubs(
  sw: import('@playwright/test').Worker,
  panel: import('@playwright/test').Page,
) {
  await sw.evaluate(() => {
    // @ts-expect-error stash for the test
    globalThis.__voiceCapture = { url: '', sent: [] as string[], inst: null as unknown };
    class FakeWS extends EventTarget {
      readonly url: string;
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: Event) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      constructor(url: string) {
        super();
        this.url = url;
        const g = globalThis as unknown as { __voiceCapture: { url: string; inst: unknown } };
        g.__voiceCapture.url = url;
        g.__voiceCapture.inst = this;
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); }, 5);
      }
      send(data: string) {
        (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture.sent.push(data);
      }
      close() { this.readyState = 3; this.onclose?.(new Event('close')); }
    }
    // @ts-expect-error global override
    globalThis.WebSocket = FakeWS;
  });
  await panel.evaluate(() => {
    // @ts-expect-error stub
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const dst = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.frequency.value = 0;
      osc.connect(dst);
      osc.start();
      return dst.stream;
    };
  });
}

test('Live Transcriber: Record → stubbed transcripts → Save to Library', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const [sw] = context.serviceWorkers();
  await installLiveStubs(sw, panel);

  // Apps grid → Live Transcriber.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Live Transcriber').first().click();
  await expect(panel.getByTestId('live-start')).toBeVisible({ timeout: 5_000 });

  // Press Record → SW opens stub WS → setup frame sent with TEXT modality.
  await panel.getByTestId('live-start').click();
  await expect(panel.getByText('● Listening')).toBeVisible({ timeout: 8_000 });

  // Setup payload should mark responseModalities: ['TEXT'] for this app.
  const setupSent = await sw.evaluate(() => {
    const cap = (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture;
    return cap.sent[0] ?? '';
  });
  expect(setupSent).toContain('"responseModalities":["TEXT"]');

  // Push 3 transcript chunks. First two interim ("This is a"), then final full sentence.
  await sw.evaluate(() => {
    const inst = (globalThis as unknown as { __voiceCapture: { inst: { onmessage?: (ev: MessageEvent) => void } } }).__voiceCapture.inst;
    inst.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ serverContent: { inputTranscription: { text: 'This is a', finished: false } } }),
    }));
    inst.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ serverContent: { inputTranscription: { text: 'This is a test of the live transcriber.', finished: true } } }),
    }));
    inst.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ serverContent: { inputTranscription: { text: 'It captures continuous speech.', finished: true } } }),
    }));
  });

  // Both finalised lines should be visible in the transcript area.
  const transcript = panel.getByTestId('live-transcript');
  await expect(transcript.getByText(/This is a test of the live transcriber/)).toBeVisible({ timeout: 5_000 });
  await expect(transcript.getByText(/It captures continuous speech/)).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '97-live-transcriber.png') });

  // Stop → state flips back to idle; "+ Library" button enabled.
  await panel.getByTestId('live-stop').click();
  await expect(panel.getByTestId('live-start')).toBeVisible({ timeout: 5_000 });

  // Save to Library → button flashes Saved ✓.
  await panel.getByTestId('live-save').click();
  await expect(panel.getByTestId('live-save')).toHaveText(/Saved/, { timeout: 30_000 });

  // Cross-check: the Library now contains a 'Live transcript <stamp>' doc.
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByTestId('library-docs')).toContainText(/Live transcript/i, { timeout: 5_000 });
});
