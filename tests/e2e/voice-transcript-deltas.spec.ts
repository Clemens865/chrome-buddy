// Regression for the user-reported transcript fragmentation:
// Gemini Live sends DELTA chunks with finished:true on each one. The
// previous implementation treated each delta as "close this bubble, next
// chunk starts a new one" — producing 't time it is?' / 'what time it is?'
// instead of one 'What time it is?'.
//
// This test sends a sequence of delta chunks that mimic what Gemini does:
//   user: 'Wha' (finished:true) + 't time it is?' (finished:true)
//   model: 'It is ' (finished:true) + '12:30 PM.' (finished:true)
//   then turnComplete:true
// and asserts ONE user bubble shows 'What time it is?' and ONE agent bubble
// shows 'It is 12:30 PM.' — not four separate fragments.
import { test, expect } from './fixtures';

test('Voice transcript deltas accumulate into one bubble per role per turn', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stub WebSocket + getUserMedia like the other voice tests.
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

  // Push the delta sequence that broke the old implementation.
  await sw.evaluate(() => {
    const inst = (globalThis as unknown as { __voiceCapture: { inst: { onmessage?: (ev: MessageEvent) => void } } }).__voiceCapture.inst;
    const push = (sc: Record<string, unknown>) =>
      inst.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ serverContent: sc }) }));
    // User says "What time it is?" — two deltas, both flagged finished.
    push({ inputTranscription: { text: 'Wha', finished: true } });
    push({ inputTranscription: { text: 't time it is?', finished: true } });
    // Model replies "It is 12:30 PM." — two deltas, both flagged finished.
    push({ outputTranscription: { text: 'It is ', finished: true } });
    push({ outputTranscription: { text: '12:30 PM.', finished: true } });
    // Turn ends.
    push({ turnComplete: true });
  });

  // Wait for React to flush.
  await panel.waitForTimeout(300);

  // The user message must be ONE bubble with the full text accumulated.
  const userBubbles = panel.locator('.msg-user');
  await expect(userBubbles).toHaveCount(1);
  await expect(userBubbles).toContainText('What time it is?');
  // The model reply must be ONE bubble with the full text.
  const agentBubbles = panel.locator('.msg-agent').filter({ hasNotText: 'Hi, I' });
  await expect(agentBubbles).toHaveCount(1);
  await expect(agentBubbles).toContainText('It is 12:30 PM.');
});
