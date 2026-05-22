// FR-WF-2/4/7: linear workflow editor (steps + trigger incl. On-URL event) and
// JSON export/import with a review. Deterministic (no LLM key).
// Run: npm run test:e2e:wfeditor
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('edit a workflow (event trigger) and import a bundle', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a 2-step manual workflow.
  await panel.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'WORKFLOW_SAVE',
      workflow: {
        id: 'wf_seed',
        name: 'Daily digest',
        steps: [
          { id: 's1', mode: 'agent', prompt: 'search the web for AI news' },
          { id: 's2', mode: 'chat', prompt: 'summarise the top 3' },
        ],
        trigger: { type: 'manual' },
        createdAt: Date.now(),
      },
    });
  });

  await panel.getByRole('button', { name: 'Workflows', exact: true }).click();
  await panel.getByRole('button', { name: 'Edit workflow' }).click();

  // Editor shows the steps; switch the trigger to On-URL and save.
  await expect(panel.getByText('Edit workflow')).toBeVisible();
  await expect(panel.getByLabel('Step 1 prompt')).toHaveValue(/search the web/);
  await panel.getByRole('button', { name: 'On URL' }).click();
  await panel.getByLabel('URL pattern').fill('https://news.ycombinator.com/*');
  await panel.screenshot({ path: path.join(SHOTS, '53-workflow-editor.png') });
  await panel.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(panel.getByText('on URL visit')).toBeVisible();

  // Import a bundle → review → confirm.
  const bundle = {
    schemaVersion: 1,
    workflows: [
      { id: 'imp', name: 'Imported Flow', steps: [{ id: 'a', mode: 'chat', prompt: 'do x' }], trigger: { type: 'manual' }, createdAt: 1 },
    ],
  };
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'wf.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(panel.getByText('Import workflows — review')).toBeVisible();
  await panel.getByRole('button', { name: /Import 1/ }).click();
  await expect(panel.locator('.stub-row-title', { hasText: 'Imported Flow' })).toBeVisible();
});
