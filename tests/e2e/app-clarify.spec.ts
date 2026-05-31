// The builder asks for directions when the request is vague: it returns
// clarifying questions, the user answers, then it builds. Run: npm run test:e2e:appclarify
import { test, expect } from './fixtures';

const counter = JSON.stringify({
  name: 'Counter', description: 'a counter', html: '<button id="b">0</button>', css: '',
  ui: "let n=0;const b=root.querySelector('#b');b.addEventListener('click',()=>{n++;b.textContent=String(n);});",
  permissions: [],
});

test('vague request → builder asks questions → answer → builds', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate((app) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; messages?: { content: string }[] }, ...rest: unknown[]) => {
      if (msg && msg.type === 'LLM_GENERATE') {
        const last = msg.messages?.[msg.messages.length - 1]?.content ?? '';
        // After the user answers → build; otherwise ask a clarifying question.
        const text = /my answers/i.test(last) ? app : '{"clarify":["What should it count?"]}';
        return { type: 'LLM_GENERATE', ok: true, result: { text, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, counter);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByRole('button', { name: /Build a full app/ }).click();
  await panel.getByLabel('App description').fill('a thing');
  await panel.getByRole('button', { name: 'Build', exact: true }).click();

  // The builder asks for directions instead of building blindly.
  await expect(panel.getByTestId('builder-clarify')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText('What should it count?')).toBeVisible();

  // Answer → it builds + previews.
  await panel.getByLabel('Answers').fill('count clicks');
  await panel.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(panel.frameLocator('.builder-preview iframe').locator('#b')).toBeVisible({ timeout: 10_000 });
});
