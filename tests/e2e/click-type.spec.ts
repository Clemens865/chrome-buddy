// Live test: the agent TYPES into a form field and CLICKS a submit button on a
// real page, and we verify the typed value round-trips through the server.
// Run with: npm run test:e2e:clicktype  (needs .env key + network)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent types into a field and clicks submit', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://httpbin.org/forms/post', { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill(
      'On this page: first type the text "Ada Lovelace" into the input with CSS selector input[name="custname"], ' +
        'then click the button labeled "Submit order". Do the typing before the click.',
    );
  await panel.getByRole('button', { name: 'Send' }).click();

  // The form posts to /post and echoes the submitted fields — proof the agent
  // both typed the value and clicked submit.
  await site.waitForURL(/\/post/, { timeout: 60_000 });
  await expect(async () => {
    const body = await site.locator('body').innerText();
    expect(body).toContain('Ada Lovelace');
  }).toPass({ timeout: 20_000 });

  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '22-click-type.png') });
});
