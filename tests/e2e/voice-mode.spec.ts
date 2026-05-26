// Voice mode — Gemini Live.
// Deterministic: we stub WebSocket in the SW so no real network is needed.
// The test only verifies the panel-side wiring: mode switch shows the
// controls, Start opens the Port + WS, the stubbed server emits transcripts
// and an audio chunk, the panel renders the transcript bubbles, Stop closes
// everything cleanly.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Voice mode: switch + Start + stubbed transcripts + Stop', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Replace WebSocket in the SW so we don't hit the real Gemini Live endpoint.
  // The stub captures the URL the SW tries to open + lets the test push
  // 'serverContent' frames into the panel.
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => {
    const OriginalWS = globalThis.WebSocket;
    // @ts-expect-error stash original for restore
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
        (globalThis as unknown as { __voiceCapture: { url: string; inst: unknown } }).__voiceCapture.url = url;
        (globalThis as unknown as { __voiceCapture: { inst: unknown } }).__voiceCapture.inst = this;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.(new Event('open'));
        }, 5);
      }
      send(data: string) {
        (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture.sent.push(data);
      }
      close() {
        this.readyState = 3;
        this.onclose?.(new Event('close'));
      }
    }
    // @ts-expect-error replacing the global
    globalThis.WebSocket = FakeWS;
    // Keep the original around in case other code paths need it.
    void OriginalWS;
  });

  // Switch to Voice mode.
  await panel.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(panel.getByTestId('voice-controls')).toBeVisible({ timeout: 5_000 });

  // BLOCK the mic permission dialog: pre-grant via the CDP / use stub.
  // We can fake getUserMedia inside the panel.
  await panel.evaluate(() => {
    // @ts-expect-error mocking the standard interface
    navigator.mediaDevices.getUserMedia = async () => {
      // Fake a MediaStream with one silent audio track.
      const ctx = new AudioContext();
      const dst = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.frequency.value = 0;
      osc.connect(dst);
      osc.start();
      return dst.stream;
    };
  });

  // Click Start voice → panel connects Port, SW opens the (stub) WS.
  await panel.getByTestId('voice-start').click();

  // Wait for the panel to receive OPEN from the SW (state goes 'live').
  await expect(panel.getByText('● Live — speak naturally')).toBeVisible({ timeout: 8_000 });

  // The SW must have sent the URL containing BidiGenerateContent.
  const cap1 = await sw.evaluate(() => (globalThis as unknown as { __voiceCapture: { url: string; sent: string[] } }).__voiceCapture);
  expect(cap1.url).toContain('BidiGenerateContent');
  // The first frame the SW sent the WS must be the setup payload.
  expect(cap1.sent[0]).toContain('"setup"');
  expect(cap1.sent[0]).toContain('responseModalities');

  // Push a fake serverContent frame from the SW side — inputTranscription +
  // outputTranscription + turnComplete. The panel renders bubbles for each.
  await sw.evaluate(() => {
    const cap = (globalThis as unknown as { __voiceCapture: { inst: { onmessage?: (ev: MessageEvent) => void } } }).__voiceCapture;
    cap.inst.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'Hello Buddy.', finished: true },
        },
      }),
    }));
    cap.inst.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({
        serverContent: {
          outputTranscription: { text: 'Hi there — what can I help with?', finished: true },
          turnComplete: true,
        },
      }),
    }));
  });

  // Both transcripts should land as transcript bubbles.
  await expect(panel.getByText('Hello Buddy.')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByText(/Hi there — what can I help/)).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '96-voice-mode.png') });

  // Click Stop voice → Port disconnects, SW closes WS, controls flip back.
  await panel.getByTestId('voice-stop').click();
  await expect(panel.getByTestId('voice-start')).toBeVisible({ timeout: 5_000 });
});
