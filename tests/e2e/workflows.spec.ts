// Live workflow tests: build a multi-step workflow from a description, then run
// it (steps execute in sequence, threading results). Covers a simple 2-chat-step
// flow and an advanced agent+chat flow (web search -> briefing).
// Run with: npm run test:e2e:workflows  (needs .env key + network)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function buildWorkflow(panel: import('@playwright/test').Page, name: string, desc: string) {
  await panel.getByRole('button', { name: 'Workflows', exact: true }).click();
  await panel.getByRole('button', { name: '+ New workflow' }).click();
  await panel.getByPlaceholder('Workflow name').fill(name);
  await panel.getByPlaceholder(/Describe the workflow/).fill(desc);
  await panel.getByRole('button', { name: 'Generate steps' }).click();
  // The generated workflow appears in the list.
  await expect(panel.locator('.stub-row-title', { hasText: name })).toBeVisible({ timeout: 45_000 });
}

test('live: build + run a simple 2-step workflow', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await buildWorkflow(panel, 'Color pair', 'First name a primary color. Then suggest a color that complements it.');
  await panel.screenshot({ path: path.join(SHOTS, '18-workflows.png') });

  await panel.getByRole('button', { name: 'Run', exact: true }).first().click();
  await expect(panel.getByText('▶ Workflow: Color pair')).toBeVisible({ timeout: 20_000 });
  // Both steps produce an answer.
  await expect(async () => {
    expect(await panel.locator('.msg-agent .msg-body').count()).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '19-workflow-simple-run.png') });
});

test('live: build + run an advanced workflow (web search -> briefing)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await buildWorkflow(
    panel,
    'AI briefing',
    'Search the web for recent news about AI, then write a short 3-bullet briefing of the most important items.',
  );

  await panel.getByRole('button', { name: 'Run', exact: true }).first().click();
  await expect(panel.getByText('▶ Workflow: AI briefing')).toBeVisible({ timeout: 20_000 });
  // The advanced flow runs multiple steps and ends with a non-empty briefing.
  await expect(async () => {
    expect(await panel.locator('.msg-agent .msg-body').count()).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 90_000 });
  await panel.screenshot({ path: path.join(SHOTS, '20-workflow-advanced-run.png') });
});
