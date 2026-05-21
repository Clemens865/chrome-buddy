// FR-TOOLS-11: the agent can pause and ask the user a question inline, then
// resume with the answer. Run with: npm run test:e2e:askuser  (needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent asks the user and resumes with the answer', async ({ context, extensionId }) => {
  // Isolate ask_user: turn the plan gate off (covered by plan-gate.spec).
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ askBeforePlan: false }));

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Use the ask_user tool to ask me to pick a color: red or blue. Then reply telling me which color I picked.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The agent surfaces the question inline.
  const ask = panel.locator('.ask-user');
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '42-ask-user.png') });

  // Answer via a choice button if offered, else type it.
  const choice = ask.locator('.ask-user-choices button', { hasText: 'blue' });
  if (await choice.count()) {
    await choice.first().click();
  } else {
    await ask.locator('input').fill('blue');
    await ask.getByRole('button', { name: 'Send answer' }).click();
  }

  // The agent resumes and produces a final answer mentioning the choice.
  await expect(panel.locator('.msg-agent:not(.msg-subtle) .msg-body').last()).toContainText(/blue/i, {
    timeout: 60_000,
  });
  await panel.screenshot({ path: path.join(SHOTS, '43-ask-user-answered.png') });
});
