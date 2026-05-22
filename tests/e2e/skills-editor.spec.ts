// FR-SKILL-4/5/6/9/10: create/edit a skill (with {{input}} detection) and an
// import consent screen that lists requested tools + flags unknown ones.
// Deterministic (no LLM key). Run: npm run test:e2e:skillseditor
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('create a skill with inputs, then import with a consent review', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Skills', exact: true }).click();

  // --- Create a skill; {{competitors}} is auto-detected as an input ---
  await panel.getByRole('button', { name: '+ New skill' }).click();
  await panel.getByLabel('Skill name').fill('Pricing check');
  await panel.getByLabel('Skill prompt').fill('Compare {{competitors}} pricing and summarise.');
  await expect(panel.locator('.skill-input-chip', { hasText: 'competitors' })).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '51-skill-editor.png') });
  await panel.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(panel.locator('.stub-row-title', { hasText: 'Pricing check' })).toBeVisible();
  await expect(panel.getByText(/inputs: competitors/)).toBeVisible();

  // --- Import a bundle; consent screen flags the unknown tool ---
  const bundle = {
    schemaVersion: 1,
    skills: [
      { id: 'imp1', name: 'Imported Scraper', description: 'x', kind: 'agent', prompt: 'do x', allowedTools: ['navigate', 'frobnicate'], createdAt: 1 },
    ],
  };
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'bundle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });

  await expect(panel.getByText('Import skills — review')).toBeVisible();
  await expect(panel.getByText(/unknown: frobnicate/)).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '52-skill-import-consent.png') });

  await panel.getByRole('button', { name: /Import 1 skill/ }).click();
  await expect(panel.locator('.stub-row-title', { hasText: 'Imported Scraper' })).toBeVisible();
});
