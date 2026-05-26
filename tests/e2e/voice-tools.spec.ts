// Voice + tools — function calling inside a Gemini Live session.
//
// Deterministic: stubs WebSocket + getUserMedia. Asserts:
//  - The setup payload sent by the SW includes a `tools.functionDeclarations`
//    array, with at least `search_library` declared (one of VOICE_TOOL_NAMES).
//  - When the stub server emits a `toolCall.functionCalls` frame for
//    `search_library`, the SW dispatches it to the real handler and sends
//    a `toolResponse` back over the WS (we inspect the captured frames).
//  - A user has saved a doc to the library first, so search_library returns
//    a real hit (this also exercises the live Gemini embedding path for
//    search — same as library-search.spec.ts).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Voice + tools: setup includes tools, model can call search_library', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 1) Seed one doc into the library so search_library has something to find.
  //    Uses the real Gemini embedding endpoint via LIBRARY_INDEX.
  await panel.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: 'LIBRARY_INDEX',
      source: 'note',
      sourceRef: 'voice-tools-demo',
      title: 'Pizza dough hydration',
      content:
        '# Pizza dough hydration\n\nNeapolitan style uses ~60% hydration. Higher (70%+) gives more open, airy crumb but is harder to handle.',
    }),
  );

  // 2) Stub WebSocket in the SW.
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => {
    // @ts-expect-error stash
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

  // 3) Stub getUserMedia in the panel.
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

  // 4) Open Voice mode and start.
  await panel.getByRole('button', { name: 'Voice', exact: true }).click();
  await panel.getByTestId('voice-start').click();
  await expect(panel.getByText('● Live — speak naturally')).toBeVisible({ timeout: 8_000 });

  // 5) Setup payload must include the tools declarations.
  const setupSent = await sw.evaluate(() => {
    const cap = (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture;
    return cap.sent[0] ?? '';
  });
  expect(setupSent).toContain('"functionDeclarations"');
  expect(setupSent).toContain('"search_library"');
  // Should NOT include the consequential ones.
  expect(setupSent).not.toContain('"send_webhook"');
  expect(setupSent).not.toContain('"write_file"');

  // 6) Push a toolCall frame from the stub server — model wants to call
  //    search_library({ query: 'pizza dough hydration' }).
  await sw.evaluate(() => {
    const inst = (globalThis as unknown as { __voiceCapture: { inst: { onmessage?: (ev: MessageEvent) => void } } }).__voiceCapture.inst;
    inst.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({
        toolCall: {
          functionCalls: [{ id: 'fc1', name: 'search_library', args: { query: 'pizza dough hydration', k: 3 } }],
        },
      }),
    }));
  });

  // 7) Wait for the SW to dispatch + send back a toolResponse. The real
  //    handler hits Gemini for the query embedding, so allow up to 30s.
  await expect(async () => {
    const sent = await sw.evaluate(() =>
      (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture.sent,
    );
    const responseFrame = sent.find((s) => s.includes('"toolResponse"'));
    expect(responseFrame).toBeTruthy();
    // The response must include a `result` (not an error) and reference the
    // seeded doc's title.
    expect(responseFrame).toContain('"result"');
    expect(responseFrame).toContain('Pizza dough hydration');
  }).toPass({ timeout: 30_000 });

  await panel.screenshot({ path: path.join(SHOTS, '98-voice-tools.png') });

  // 8) Clean up.
  await panel.getByTestId('voice-stop').click();
  await expect(panel.getByTestId('voice-start')).toBeVisible({ timeout: 5_000 });
});
