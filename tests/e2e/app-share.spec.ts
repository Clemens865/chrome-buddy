// P4 export/import sharing. Importing a bundle re-validates each app, forces
// the first-run review gate (reviewed:false), and discloses capabilities;
// exporting produces a re-importable bundle. No LLM key needed.
// Run with: npm run test:e2e:appshare
import { test, expect } from './fixtures';
import path from 'node:path';
import fs from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

// A shared bundle: a tier-3 counter app marked reviewed:true by the author —
// import must FORCE it back to reviewed:false so the gate runs on this machine.
const BUNDLE = JSON.stringify({
  schemaVersion: 2,
  apps: [
    {
      id: 'shared_1', name: 'Shared Counter', description: 'imported demo', inputs: [], tier: 3,
      html: '<button id="b">0</button>', css: '#b{font-size:20px}',
      ui: "let n=0;const b=root.querySelector('#b');b.addEventListener('click',()=>{n++;b.textContent=String(n);});",
      permissions: ['gemini', 'github_write'], reviewed: true, createdAt: 1,
    },
  ],
});

test('import a shared app → review → first-run gate → run; consequential cap stripped', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();

  // Feed the bundle into the hidden import input.
  await panel.locator('input[type="file"]').setInputFiles({ name: 'apps.json', mimeType: 'application/json', buffer: Buffer.from(BUNDLE) });

  // Review screen: app listed; github_write (consequential) was stripped → only
  // the safe cap is disclosed, and it's gated on first run.
  await expect(panel.getByTestId('apps-import-review')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByText('Shared Counter')).toBeVisible();
  await expect(panel.getByText(/uses AI text/)).toBeVisible();
  await expect(panel.getByText(/github/)).toHaveCount(0); // consequential cap not present
  await panel.screenshot({ path: path.join(SHOTS, '298-app-import-review.png') });
  await panel.getByRole('button', { name: /^Import/ }).click();

  // Deployed to the grid; opening it hits the first-run review gate (NOT auto-run).
  await expect(panel.locator('.app-card-name', { hasText: 'Shared Counter' })).toBeVisible({ timeout: 5_000 });
  await panel.locator('.app-card-name', { hasText: 'Shared Counter' }).first().click();
  await expect(panel.getByTestId('sandbox-app-review')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByRole('button', { name: 'Approve & run' })).toBeVisible();

  // Approve → it runs.
  await panel.getByRole('button', { name: 'Approve & run' }).click();
  const frame = panel.frameLocator('.sandbox-app-frame');
  await expect(frame.locator('#b')).toBeVisible({ timeout: 10_000 });
  await frame.locator('#b').click();
  await expect(frame.locator('#b')).toHaveText('1');
});

test('export produces a re-importable bundle', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();

  // Seed one app via import so there's something to export.
  await panel.locator('input[type="file"]').setInputFiles({ name: 'apps.json', mimeType: 'application/json', buffer: Buffer.from(BUNDLE) });
  await panel.getByRole('button', { name: /^Import/ }).click();
  await expect(panel.locator('.app-card-name', { hasText: 'Shared Counter' })).toBeVisible({ timeout: 5_000 });

  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('chrome-buddy-apps.json');
  const p = await dl.path();
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  expect(parsed.schemaVersion).toBe(2);
  expect(parsed.apps.some((a: { name: string }) => a.name === 'Shared Counter')).toBe(true);
});
