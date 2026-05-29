// Theme-aware Tier-3 apps + the "dead buttons" fix. The app uses a .cb-btn
// (Chrome Buddy theme class) and carries a decoy inline onclick (must be
// stripped) while wiring the real handler via addEventListener in `ui`. Proves:
// (1) the host theme is injected into the sandbox, (2) interactive buttons work.
// Run with: npm run test:e2e:apptheme
import { test, expect } from './fixtures';

const THEMED_APP = JSON.stringify({
  name: 'Themed',
  description: 'uses host theme + a real handler',
  html: '<button class="cb-btn" id="go" onclick="nope()">Go</button><div id="out" class="cb-muted">idle</div>',
  css: '',
  ui: "root.querySelector('#go').addEventListener('click',()=>{root.querySelector('#out').textContent='clicked';});",
  permissions: [],
});

test('app inherits the host theme + buttons work (inline handler stripped)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate((app) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        return { type: 'LLM_GENERATE', ok: true, result: { text: app, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, THEMED_APP);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: /Build a full app/ }).click();
  await panel.getByLabel('App description').fill('a themed button demo');
  await panel.getByRole('button', { name: 'Build', exact: true }).click();

  const frame = panel.frameLocator('.builder-preview iframe');
  await expect(frame.locator('#go')).toBeVisible({ timeout: 10_000 });

  // (1) Theme injected: --cb-accent resolves and the .cb-btn picked it up.
  const probe = await frame.locator('#go').evaluate((el) => ({
    accent: getComputedStyle(document.documentElement).getPropertyValue('--cb-accent').trim(),
    bg: getComputedStyle(el).backgroundColor,
    hasInlineOnclick: el.hasAttribute('onclick'),
  }));
  expect(probe.accent.length).toBeGreaterThan(0); // theme tokens were injected
  expect(probe.bg).not.toBe('rgba(0, 0, 0, 0)'); // .cb-btn got a real background
  expect(probe.hasInlineOnclick).toBe(false); // decoy inline handler stripped

  // (2) The real handler (addEventListener) works — button is interactive.
  await frame.locator('#go').click();
  await expect(frame.locator('#out')).toHaveText('clicked');
});
