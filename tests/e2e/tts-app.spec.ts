// Built-in Text to Speech app: opens from the default Apps grid, prepares text
// with AI (bridge.gemini), and speaks it (bridge.tts). Both SW calls are stubbed
// for determinism (the real Gemini TTS round-trip is covered by tts-live.spec).
import { test, expect } from './fixtures';

const WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const SUMMARY = 'In short: Chrome Buddy reads pages aloud.';

test('Text to Speech (built-in): Prepare → Speak via bridge.gemini + bridge.tts', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stub the SW: bridge.gemini -> LLM_GENERATE, bridge.tts -> TTS_GENERATE.
  await panel.evaluate(({ wav, summary }) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TTS_GENERATE') return { type: 'TTS_GENERATE', ok: true, audioDataUrl: wav };
      if (msg?.type === 'LLM_GENERATE') return { type: 'LLM_GENERATE', ok: true, result: { text: summary, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, { wav: WAV, summary: SUMMARY });

  // Open the built-in app straight from the default grid (no seeding).
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Text to Speech', { exact: true }).first().click();

  const frame = panel.frameLocator('.sandbox-app-frame');
  await expect(frame.locator('#text')).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('#voice option')).toHaveCount(30);
  await expect(frame.locator('#prep')).toBeVisible(); // the Prepare control exists

  await frame.locator('#text').fill('This is a long page with lots of text to summarize before reading.');

  // Prepare → Summary: bridge.gemini replaces the text with the summary.
  await frame.locator('#prep').selectOption('Summary');
  await frame.locator('#prepBtn').click();
  await expect(frame.locator('#text')).toHaveValue(SUMMARY, { timeout: 10_000 });

  // Speak → the player gets the synthesized WAV.
  await frame.locator('#speak').click();
  await expect(frame.locator('#player')).toHaveAttribute('src', WAV, { timeout: 10_000 });
});
