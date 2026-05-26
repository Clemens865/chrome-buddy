// Stop / abort button on the chat composer.
//
// Deterministic: we stub chrome.runtime.connect so the streaming Port emits
// a few DELTA chunks slowly. The user clicks Stop mid-stream → the port is
// disconnected → runPlainChat resolves with outcome 'aborted' + whatever
// text already streamed → a "_Stopped by user._" narration is appended.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Stop button appears while generating and aborts the stream', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Replace chrome.runtime.connect with a fake Port that emits 1 DELTA
  // chunk, then sits idle waiting to be disconnected. The Stop button hits
  // port.disconnect(); runPlainChat treats that as a graceful 'aborted'.
  await panel.evaluate(() => {
    const realConnect = chrome.runtime.connect.bind(chrome.runtime);
    // @ts-expect-error overriding the typed handle
    chrome.runtime.connect = (info?: { name?: string }) => {
      if (info?.name !== 'chat-stream') return realConnect(info);
      type Listener<T> = (arg: T) => void;
      const msgListeners: Listener<unknown>[] = [];
      const discListeners: Listener<unknown>[] = [];
      const fake = {
        onMessage: { addListener: (fn: Listener<unknown>) => msgListeners.push(fn) },
        onDisconnect: { addListener: (fn: Listener<unknown>) => discListeners.push(fn) },
        postMessage: (msg: unknown) => {
          if ((msg as { type?: string })?.type === 'START') {
            // First chunk arrives quickly so the user sees text + the Stop button.
            setTimeout(() => msgListeners.forEach((fn) => fn({ type: 'DELTA', text: 'partial reply…' })), 80);
            // Then we wait forever — the Stop click will disconnect.
          }
        },
        disconnect: () => {
          // Mirror the real Port: notify onDisconnect listeners.
          discListeners.forEach((fn) => fn({} as unknown));
        },
      };
      return fake as unknown as ReturnType<typeof realConnect>;
    };
  });

  // Send a message in chat mode (the default; tool-less path so we exercise
  // the streaming Port code path).
  await panel.getByPlaceholder('Message Buddy…').fill('Tell me a long story please.');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();

  // Stop button must surface while the chat is busy.
  const stop = panel.getByTestId('chat-stop');
  await expect(stop).toBeVisible({ timeout: 5_000 });
  // The first chunk should land before we click stop.
  await expect(panel.getByText('partial reply…')).toBeVisible({ timeout: 5_000 });
  await panel.screenshot({ path: path.join(SHOTS, '93-chat-stop-button.png') });

  // Click Stop. The aborted narration appears + the composer flips back to Send.
  await stop.click();
  // Agent items render markdown, so '_Stopped by user._' surfaces as
  // <em>Stopped by user.</em>. Match on the inner text.
  await expect(panel.getByText('Stopped by user.', { exact: false })).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  // Stop button is gone (busy cleared).
  await expect(stop).toHaveCount(0);
});
