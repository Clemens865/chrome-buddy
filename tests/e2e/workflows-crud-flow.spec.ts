// User explicitly asked for "at least two workflows" and the survey flagged
// that step add / remove / reorder mechanics, multi-workflow lifecycle, and
// trigger changes had no deterministic e2e coverage (only LLM-driven build).
//
// This spec seeds two workflows directly into IDB, opens FlowsView, exercises
// the editor's step mechanics, verifies persistence, and screenshots.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function seedWorkflows(panel: import('@playwright/test').Page) {
  await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('workflows', 'readwrite');
      const store = tx.objectStore('workflows');
      const now = Date.now();
      store.put({
        id: 'wf_alpha',
        name: 'Daily news briefing',
        steps: [
          { id: 'step_a1', mode: 'agent', prompt: 'Search the web for the top 3 AI stories today.' },
          { id: 'step_a2', mode: 'chat', prompt: 'Summarize the headlines into a 4-sentence briefing.' },
        ],
        trigger: { type: 'manual' },
        createdAt: now - 20_000,
        updatedAt: now - 20_000,
      });
      store.put({
        id: 'wf_beta',
        name: 'Inbox sweep',
        steps: [
          { id: 'step_b1', mode: 'chat', prompt: 'Read the open page and tell me the sender + ask.' },
        ],
        trigger: { type: 'manual' },
        createdAt: now - 5_000,
        updatedAt: now - 5_000,
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  });
}

async function readWorkflow(panel: import('@playwright/test').Page, id: string) {
  return await panel.evaluate(async (wid) => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    return await new Promise<Record<string, unknown> | null>((res) => {
      const tx = db.transaction('workflows', 'readonly');
      const get = tx.objectStore('workflows').get(wid);
      get.onsuccess = () => res(get.result ?? null);
    });
  }, id);
}

test('Workflows: 2 seeded → edit one (add/move/remove step + change trigger) → delete the other → persist', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedWorkflows(panel);
  await panel.reload();

  // Open Workflows view.
  await panel.getByRole('button', { name: 'Workflows', exact: true }).click();

  // Both seeded workflows render.
  await expect(panel.getByText('Daily news briefing')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByText('Inbox sweep')).toBeVisible();
  await expect(panel.locator('.stub-row')).toHaveCount(2);
  await panel.screenshot({ path: path.join(SHOTS, '230-workflows-two-seeded.png') });

  // Edit the Daily news briefing — open the editor.
  const alphaRow = panel.locator('.stub-row').filter({ hasText: 'Daily news briefing' });
  await alphaRow.getByRole('button', { name: 'Edit', exact: false }).first().click();
  // The editor shows the workflow name + 2 steps.
  await expect(panel.getByLabel('Workflow name')).toHaveValue('Daily news briefing');
  await expect(panel.getByLabel('Step 1 prompt')).toHaveValue(/Search the web/);
  await expect(panel.getByLabel('Step 2 prompt')).toHaveValue(/Summarize the headlines/);

  // (a) Add a 3rd step.
  await panel.getByRole('button', { name: '+ Add step' }).click();
  await panel.getByLabel('Step 3 prompt').fill('Post the briefing to my notes.');
  await expect(panel.getByLabel('Step 3 prompt')).toHaveValue('Post the briefing to my notes.');

  // (b) Move step 3 → step 2 (one up).
  await panel.getByRole('button', { name: 'Move step 3 up' }).click();
  // After the swap, the OLD step 3 prompt now lives in step 2.
  await expect(panel.getByLabel('Step 2 prompt')).toHaveValue('Post the briefing to my notes.');
  await expect(panel.getByLabel('Step 3 prompt')).toHaveValue(/Summarize the headlines/);

  // (c) Remove step 1 (the search step).
  await panel.getByRole('button', { name: 'Remove step 1' }).click();
  // Now there should be only 2 steps left.
  await expect(panel.getByLabel('Step 1 prompt')).toHaveValue('Post the briefing to my notes.');
  await expect(panel.getByLabel('Step 2 prompt')).toHaveValue(/Summarize the headlines/);
  await expect(panel.getByLabel('Step 3 prompt')).toHaveCount(0);

  // (d) Switch trigger to schedule.
  await panel.getByRole('button', { name: 'Schedule' }).click();
  await expect(panel.getByLabel('Schedule interval')).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '231-workflow-editor-mid.png') });

  // Save.
  await panel.getByRole('button', { name: 'Save' }).click();

  // Verify IDB has the expected state.
  const updatedAlpha = (await readWorkflow(panel, 'wf_alpha')) as {
    steps: { prompt: string }[];
    trigger: { type: string; everyMinutes?: number };
  } | null;
  expect(updatedAlpha).not.toBeNull();
  expect(updatedAlpha!.steps.length).toBe(2);
  expect(updatedAlpha!.steps[0].prompt).toBe('Post the briefing to my notes.');
  expect(updatedAlpha!.steps[1].prompt).toMatch(/Summarize the headlines/);
  expect(updatedAlpha!.trigger.type).toBe('schedule');
  expect(typeof updatedAlpha!.trigger.everyMinutes).toBe('number');

  // Delete the Inbox sweep workflow.
  const betaRow = panel.locator('.stub-row').filter({ hasText: 'Inbox sweep' });
  await betaRow.getByRole('button', { name: 'Delete', exact: false }).first().click();
  await expect(panel.getByText('Inbox sweep')).toHaveCount(0);
  await expect(panel.getByText('Daily news briefing')).toBeVisible();

  // Reload — alpha (edited) survives, beta (deleted) is gone.
  await panel.reload();
  await panel.getByRole('button', { name: 'Workflows', exact: true }).click();
  await expect(panel.getByText('Daily news briefing')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByText('Inbox sweep')).toHaveCount(0);

  const finalBeta = await readWorkflow(panel, 'wf_beta');
  expect(finalBeta).toBeNull();
});

test('Workflows: editor Save is disabled until name + at least one prompted step are set', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await seedWorkflows(panel);
  await panel.reload();
  await panel.getByRole('button', { name: 'Workflows', exact: true }).click();

  // Open the alpha workflow editor.
  await panel.locator('.stub-row').filter({ hasText: 'Daily news briefing' })
    .getByRole('button', { name: 'Edit', exact: false }).first().click();

  const save = panel.getByRole('button', { name: 'Save' });
  // Both steps + name filled → enabled.
  await expect(save).toBeEnabled();

  // Clear the name → disabled.
  await panel.getByLabel('Workflow name').fill('');
  await expect(save).toBeDisabled();

  // Restore name, but clear ALL step prompts → disabled.
  await panel.getByLabel('Workflow name').fill('OK');
  await panel.getByLabel('Step 1 prompt').fill('');
  await panel.getByLabel('Step 2 prompt').fill('');
  await expect(save).toBeDisabled();

  // Put one prompt back → enabled.
  await panel.getByLabel('Step 1 prompt').fill('Do something');
  await expect(save).toBeEnabled();
});
