// User explicitly asked for "at least two skills" — and the survey flagged
// that direct Run / Edit / Delete from the Skills view aren't covered by
// existing tests (only the agent-side call_skill tool is).
//
// This spec walks the full skills-CRUD flow deterministically:
//   - empty state
//   - create skill #1 (chat mode, no inputs)
//   - create skill #2 (agent mode, with {{variable}} → detected input chip)
//   - both appear in the list with correct mode + summary
//   - edit skill #1 → name change persists
//   - delete skill #2 → removed
//   - skill #1 still there after delete (no collateral damage)
//   - reload → list state survives a remount
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Skills: create 2, edit 1, delete 1, persist across reload', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 1) Empty state: no skills yet (fresh extension).
  await panel.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(panel.getByText('No skills yet')).toBeVisible({ timeout: 5_000 });

  // 2) Create skill #1 — Chat mode, plain prompt, no inputs.
  await panel.getByRole('button', { name: '+ New skill' }).click();
  await panel.getByLabel('Skill name').fill('Daily standup template');
  await panel.getByLabel('Skill description').fill('Format my day into a standup');
  // Default mode is chat — leave it.
  await panel
    .getByLabel('Skill prompt')
    .fill('Write a 3-line standup summary from my notes: yesterday / today / blockers.');
  // The Chat seg button must be the pressed default. (We use .last() because
  // the rail nav also has a 'Chat' button; the seg-btn is the editor one.)
  await expect(
    panel.getByRole('button', { name: 'Chat', exact: true }).last(),
  ).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Save' }).click();

  // The list should now have one row.
  await expect(panel.getByText('Daily standup template')).toBeVisible();
  // What did persistence actually store? Inspect IDB directly to spot any
  // editor → store kind-mapping issues independently of the row's text.
  const storedKind = await panel.evaluate(async () => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    return await new Promise<string | null>((res) => {
      const tx = db.transaction('skills', 'readonly');
      const all = tx.objectStore('skills').getAll();
      all.onsuccess = () => {
        const skills = all.result as Array<{ name: string; kind: string }>;
        const s = skills.find((x) => x.name === 'Daily standup template');
        res(s ? s.kind : null);
      };
    });
  });
  expect(storedKind).toBe('chat'); // default mode should persist as chat
  const firstRow = panel.locator('.stub-row').filter({ hasText: 'Daily standup template' });
  await expect(firstRow).toContainText('Chat'); // mode label
  await expect(firstRow).toContainText('Write a 3-line standup'); // prompt prefix

  // 3) Create skill #2 — Agent mode, with {{competitors}} input → auto-detected.
  await panel.getByRole('button', { name: '+ New skill' }).click();
  await panel.getByLabel('Skill name').fill('Competitor scan');
  await panel.getByLabel('Skill description').fill('Compare us against competitors');
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByLabel('Skill prompt')
    .fill('Research {{competitors}} on the web. Summarize their pricing and key differences.');
  // The detected-inputs chip should appear with "competitors".
  const inputsRow = panel.locator('.skill-inputs');
  await expect(inputsRow).toContainText('competitors');
  await panel.getByLabel('Allowed tools').fill('search_web, read_dom');
  await panel.getByRole('button', { name: 'Save' }).click();

  // Two skills in the list now.
  const rows = panel.locator('.stub-row');
  await expect(rows).toHaveCount(2);

  // The Competitor scan row should mark Agent mode and the detected input.
  const compRow = rows.filter({ hasText: 'Competitor scan' });
  await expect(compRow).toContainText('Agent');
  await expect(compRow).toContainText('competitors');
  await panel.screenshot({ path: path.join(SHOTS, '220-skills-two-saved.png') });

  // 4) Edit skill #1 — rename it.
  const standupRow = rows.filter({ hasText: 'Daily standup template' });
  await standupRow.getByRole('button', { name: 'Edit skill' }).click();
  await panel.getByLabel('Skill name').fill('Daily standup (renamed)');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByText('Daily standup (renamed)')).toBeVisible();
  await expect(panel.getByText('Daily standup template')).toHaveCount(0);

  // 5) Delete skill #2.
  const compRow2 = panel.locator('.stub-row').filter({ hasText: 'Competitor scan' });
  await compRow2.getByRole('button', { name: 'Delete skill' }).click();
  await expect(panel.getByText('Competitor scan')).toHaveCount(0);

  // Skill #1 remains.
  await expect(panel.getByText('Daily standup (renamed)')).toBeVisible();

  // 6) Reload — the renamed skill must survive (IDB persistence).
  await panel.reload();
  await panel.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(panel.getByText('Daily standup (renamed)')).toBeVisible({ timeout: 5_000 });
  await expect(panel.locator('.stub-row')).toHaveCount(1);
});

test('Skills: empty name OR empty prompt → Save button is disabled', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Skills', exact: true }).click();
  await panel.getByRole('button', { name: '+ New skill' }).click();

  const save = panel.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  await panel.getByLabel('Skill name').fill('Name only');
  await expect(save).toBeDisabled(); // still no prompt

  await panel.getByLabel('Skill prompt').fill('Some prompt');
  await expect(save).toBeEnabled();

  // Clear name, expect re-disabled.
  await panel.getByLabel('Skill name').fill('');
  await expect(save).toBeDisabled();
});
