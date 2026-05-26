// REAL Gemini Live e2e — connects to the actual wss endpoint with the
// VITE_GEMINI_API_KEY baked into the build. NO WebSocket stub, NO
// getUserMedia stub past the absolute minimum needed to pass the mic
// permission gate. Captures every SW console line + every panel-side
// VoiceEvent so when it fails we can SEE what the server actually rejected.
//
// This is the test I should have written the first time the user said
// 'Voice'. The stubbed e2e proves our wiring is sane; this one proves the
// wiring actually talks to Google.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: open a real Gemini Live WebSocket and verify the setup is accepted', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });

  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stub getUserMedia so we don't trip the mic permission chooser in
  // headless. The WebSocket path is REAL — that's what we're verifying.
  await panel.evaluate(() => {
    // @ts-expect-error stub the typed handle
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

  // Tap every SW console line so we see live.ts's own logs.
  const [sw] = context.serviceWorkers();
  const swLog: string[] = [];
  sw.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    swLog.push(line);
    // eslint-disable-next-line no-console
    console.log('SW>', line);
  });

  // Stash every VoiceEvent the panel emits — the panel-side controller's
  // onEvent fires for open / transcript / error / closed.
  await panel.evaluate(() => {
    const realConnect = chrome.runtime.connect.bind(chrome.runtime);
    // @ts-expect-error stash for test introspection
    globalThis.__voiceLog = [] as Array<{ type?: string; [k: string]: unknown }>;
    // @ts-expect-error overriding the typed handle
    chrome.runtime.connect = (info?: { name?: string }) => {
      const p = realConnect(info);
      if (info?.name === 'voice-stream') {
        p.onMessage.addListener((m) => {
          (globalThis as unknown as { __voiceLog: unknown[] }).__voiceLog.push(m as Record<string, unknown>);
        });
      }
      return p;
    };
    // Real WebSocket — DO NOT stub it. Real getUserMedia — we pre-granted
    // permission above so it should resolve without a chooser.
  });

  await panel.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(panel.getByTestId('voice-controls')).toBeVisible({ timeout: 5_000 });
  await panel.getByTestId('voice-start').click();

  // Wait 15s for the SW to either OPEN or ERROR; dump the log REGARDLESS
  // of what happened so debugging a regression is one read of stdout.
  await panel.waitForTimeout(15_000);
  const earlyLog = await panel.evaluate(
    () => (globalThis as unknown as { __voiceLog: Array<{ type?: string; [k: string]: unknown }> }).__voiceLog,
  );
  // eslint-disable-next-line no-console
  console.log('EARLY LOG (first 15s):', JSON.stringify(earlyLog, null, 2));
  expect(earlyLog.some((m) => m.type === 'OPEN'), `No OPEN within 15s — log: ${JSON.stringify(earlyLog)}`).toBe(true);

  // Now send a TEXT_IN through the SAME Port so we can verify a full
  // round-trip without needing real mic audio. The Live SW handler accepts
  // 'TEXT_IN' frames and forwards them as realtimeInput.text.
  await panel.evaluate(() => {
    // Reach into the same Port the VoiceSession opened by connecting a
    // new one — both go through the SW dispatcher. (For this assertion
    // we only need ONE alive voice-stream Port; re-using the VoiceSession's
    // is hard without changing the API, so we open a sibling Port whose
    // START we don't send. Instead, push the TEXT through the existing
    // Port by reaching into __voiceLog's source — easiest path is via a
    // small hook on the global session, which liveSession.ts doesn't
    // expose. Simplest: just construct another Port and START it, then
    // send TEXT_IN. The SW handles each Port independently.)
    const p = chrome.runtime.connect({ name: 'voice-stream' });
    (globalThis as unknown as { __secondLog: unknown[] }).__secondLog = [];
    p.onMessage.addListener((m) => {
      (globalThis as unknown as { __secondLog: unknown[] }).__secondLog.push(m as Record<string, unknown>);
    });
    p.postMessage({ type: 'START', responseModalities: 'AUDIO' });
    // After the SW opens its WS for THIS port, send a text question.
    setTimeout(() => {
      p.postMessage({ type: 'TEXT_IN', text: 'Say hello in exactly three short words.' });
    }, 4000);
  });

  // Give the server up to 20s to either respond with audio / transcript
  // or push an ERROR.
  await panel.waitForTimeout(20_000);

  const log = await panel.evaluate(
    () => (globalThis as unknown as { __voiceLog: Array<{ type?: string; [k: string]: unknown }> }).__voiceLog,
  );
  const log2 = await panel.evaluate(
    () => (globalThis as unknown as { __secondLog: Array<{ type?: string; [k: string]: unknown }> }).__secondLog,
  );
  // eslint-disable-next-line no-console
  console.log('PRIMARY VOICE LOG:', JSON.stringify(log, null, 2));
  // eslint-disable-next-line no-console
  console.log('TEXT_IN PORT LOG:', JSON.stringify(log2, null, 2));
  // eslint-disable-next-line no-console
  console.log('SW LOG:', swLog.join('\n'));
  await panel.screenshot({ path: path.join(SHOTS, '99-voice-live-real.png') });

  // Success criteria:
  // - The PRIMARY port must have OPENed (proves setup accepted).
  // - The SECOND port (which sent the TEXT_IN) must have OPENed AND seen
  //   either an AUDIO_OUT chunk or a TRANSCRIPT (model responded).
  const openSeen = log.some((m) => m.type === 'OPEN');
  const errorSeen = log.find((m) => m.type === 'ERROR') ?? log2.find((m) => m.type === 'ERROR');
  expect(errorSeen, errorSeen ? `Got ERROR: ${JSON.stringify(errorSeen)}` : '').toBeFalsy();
  expect(openSeen, 'Primary port did not OPEN within 15s').toBe(true);
  const secondOpen = log2.some((m) => m.type === 'OPEN');
  expect(secondOpen, 'TEXT_IN port did not OPEN within 20s').toBe(true);
  const responded = log2.some((m) => m.type === 'AUDIO_OUT' || m.type === 'TRANSCRIPT');
  expect(responded, 'Server did not respond to TEXT_IN within 20s — model + endpoint likely broken').toBe(true);
});
