// Live test: the agent invokes a SAVED SKILL via the call_skill tool.
// Seeds a skill through the SW (SKILL_SAVE), then asks the agent to run it.
// Run with: npm run test:e2e:callskill  (needs .env key + network)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('live: agent runs a saved skill via call_skill', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a saved skill through the SW-owned store (skills are data).
  await panel.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'SKILL_SAVE',
      skill: {
        id: 'skill_headline',
        name: 'Headline grabber',
        description: 'Read the current page and return its single most prominent headline',
        kind: 'agent',
        prompt: 'Read the current page and return its single most prominent headline as one line.',
        createdAt: Date.now(),
      },
    });
  });

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill('Use the call_skill tool to run my saved skill "Headline grabber" (id skill_headline) on this page, then report the headline it found.');
  await panel.getByRole('button', { name: 'Send' }).click();

  // The agent should invoke call_skill and finish with a non-empty headline.
  await expect(panel.getByText('call_skill', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.msg-agent .msg-body').last()).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '21-call-skill.png') });
});
