// Verifies workflow schedule triggers: setting a schedule registers a
// chrome.alarm, and a workflow flagged "due" shows a badge. No LLM key needed —
// the workflow is seeded directly via the SW store.
// Run with: npm run test:e2e:triggers
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('workflow schedule registers an alarm + shows a due badge', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a manual workflow through the SW store.
  await panel.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'WORKFLOW_SAVE',
      workflow: {
        id: 'wf_test',
        name: 'Daily digest',
        steps: [{ id: 's1', mode: 'chat', prompt: 'say hi' }],
        trigger: { type: 'manual' },
        createdAt: Date.now(),
      },
    });
  });

  await panel.getByRole('button', { name: 'Workflows', exact: true }).click();
  await expect(panel.locator('.stub-row-title', { hasText: 'Daily digest' })).toBeVisible();

  // Set a 15-minute schedule -> the SW should register a wf: alarm.
  await panel.getByLabel('Schedule for Daily digest').selectOption({ label: 'Every 15 min' });
  await expect
    .poll(async () => panel.evaluate(() => chrome.alarms.getAll().then((a) => a.map((x) => x.name))), {
      timeout: 10_000,
    })
    .toContain('wf:wf_test');
  await panel.screenshot({ path: path.join(SHOTS, '25-workflow-schedule.png') });

  // Simulate the alarm firing: mark the workflow due -> the badge appears.
  await panel.evaluate(() => chrome.storage.local.set({ dueWorkflows: ['wf_test'] }));
  await expect(panel.locator('.wf-due-badge')).toBeVisible({ timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, '26-workflow-due.png') });

  // Switching back to Manual removes the alarm.
  await panel.getByLabel('Schedule for Daily digest').selectOption({ label: 'Manual' });
  await expect
    .poll(async () => panel.evaluate(() => chrome.alarms.getAll().then((a) => a.map((x) => x.name))), {
      timeout: 10_000,
    })
    .not.toContain('wf:wf_test');
});
