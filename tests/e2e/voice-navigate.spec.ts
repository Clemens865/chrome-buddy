// Regression for the user's screenshot: "Buddy can you go to google.com" →
// "I can't open new websites." Voice mode now has page-driving tools in
// its declarations + a system prompt that tells the model about them.
//
// Deterministic — stubs WebSocket + getUserMedia + chrome.tabs.update to
// observe whether the navigate call lands. Hits the real Live API path
// only if you flip to a non-stubbed WS; here we assert the FUNCTION CALL
// reaches our dispatcher.
import { test, expect } from './fixtures';

test('Voice mode declares page tools and dispatches navigate', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const [sw] = context.serviceWorkers();
  // Stub WebSocket + record chrome.tabs.update calls to confirm navigate routes.
  await sw.evaluate(() => {
    // @ts-expect-error stash
    globalThis.__voiceCapture = { url: '', sent: [] as string[], inst: null as unknown, tabUpdates: [] as Array<unknown> };
    class FakeWS extends EventTarget {
      readonly url: string;
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: Event) => void) | null = null;
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
      send(data: string) { (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture.sent.push(data); }
      close() { this.readyState = 3; this.onclose?.(new Event('close')); }
    }
    // @ts-expect-error override
    globalThis.WebSocket = FakeWS;
    // Capture chrome.tabs.update so we can prove the navigate call resolves.
    const realUpdate = chrome.tabs.update.bind(chrome.tabs);
    // @ts-expect-error override
    chrome.tabs.update = (id: number, opts: { url?: string }) => {
      (globalThis as unknown as { __voiceCapture: { tabUpdates: Array<unknown> } }).__voiceCapture.tabUpdates.push({ id, opts });
      return realUpdate(id, opts);
    };
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

  await panel.getByRole('button', { name: 'Voice', exact: true }).click();
  await panel.getByTestId('voice-start').click();
  await expect(panel.getByText('● Live — speak naturally')).toBeVisible({ timeout: 8_000 });

  // 1) Setup payload must include the new page tools in functionDeclarations.
  const setupSent = await sw.evaluate(() => {
    const cap = (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture;
    return cap.sent[0] ?? '';
  });
  expect(setupSent).toContain('"navigate"');
  expect(setupSent).toContain('"read_dom"');
  expect(setupSent).toContain('"click"');
  expect(setupSent).toContain('"extract"');
  // And still NO consequential tools.
  expect(setupSent).not.toContain('"send_webhook"');
  expect(setupSent).not.toContain('"write_file"');

  // 2) Push a model toolCall asking to navigate. The SW must dispatch it
  // through executePageTool and send back a toolResponse.
  await sw.evaluate(() => {
    const inst = (globalThis as unknown as { __voiceCapture: { inst: { onmessage?: (ev: MessageEvent) => void } } }).__voiceCapture.inst;
    inst.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({
        toolCall: { functionCalls: [{ id: 'nav1', name: 'navigate', args: { url: 'https://example.com' } }] },
      }),
    }));
  });

  // 3) Wait for the SW to send a toolResponse back over the WS — proves the
  // dispatch actually ran (whether the page tool 'succeeded' on the fake
  // page or surfaced a structured error doesn't matter; what matters is
  // that the request reached the handler instead of bouncing with
  // 'not available in voice mode').
  await expect(async () => {
    const sent = await sw.evaluate(() =>
      (globalThis as unknown as { __voiceCapture: { sent: string[] } }).__voiceCapture.sent,
    );
    const responseFrame = sent.find((s) => s.includes('"toolResponse"'));
    expect(responseFrame).toBeTruthy();
    // The response must reference navigate by name.
    expect(responseFrame).toContain('"navigate"');
    // And NOT contain the 'not available in voice mode' message.
    expect(responseFrame).not.toContain('not available in voice mode');
  }).toPass({ timeout: 10_000 });
});
