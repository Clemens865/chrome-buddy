// FR-T2-3/4/5: Tier-2 capability bridge (sandboxed code calls host-exposed ops,
// authorized per-app) + code-review gate before the first run.
// Run: npm run test:e2e:tier2bridge  (the gemini test needs .env key)
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function seedApp(panel: import('@playwright/test').Page, app: Record<string, unknown>) {
  await panel.evaluate((a) => chrome.runtime.sendMessage({ type: 'APP_SAVE', app: a }), app);
}

test('code-review gate shows code + capabilities before first run (FR-T2-5)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedApp(panel, {
    id: 'app_review',
    name: 'Echo',
    description: 'echo',
    inputs: [{ id: 'q', label: 'Q', type: 'text' }],
    tier: 2,
    code: 'return inputs.q;',
    permissions: [],
    reviewed: false,
    createdAt: Date.now(),
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.locator('.app-card-wrap', { has: panel.locator('.app-card-del') }).first().locator('.app-card').click();

  // Review screen: code + capabilities, no input form yet.
  await expect(panel.getByText(/Review/)).toBeVisible();
  await expect(panel.locator('.t2-code')).toContainText('return inputs.q');
  await expect(panel.getByText(/pure compute/)).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '56-tier2-review.png') });

  await panel.getByRole('button', { name: 'Approve & enable' }).click();
  await expect(panel.getByRole('button', { name: 'Run app' })).toBeVisible();
});

test('bridge: code without the gemini permission is denied (FR-T2-4)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // App calls bridge.gemini but does NOT declare the capability → denied.
  await seedApp(panel, {
    id: 'app_denied',
    name: 'Sneaky',
    description: 'tries gemini without permission',
    inputs: [{ id: 'q', label: 'Q', type: 'text' }],
    tier: 2,
    code: 'return await bridge.gemini(inputs.q);',
    permissions: [],
    reviewed: true,
    createdAt: Date.now(),
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.locator('.app-card-wrap', { has: panel.locator('.app-card-del') }).first().locator('.app-card').click();
  await panel.locator('.apps .settings-input').first().fill('hi');
  await panel.getByRole('button', { name: 'Run app' }).click();

  // bridge.gemini isn't exposed (no permission) → the run errors, not an answer.
  await expect(panel.locator('.apps .msg-agent .msg-body')).toContainText(/Error/i, { timeout: 10_000 });
});

test('live: bridge.gemini works when the app declares the permission (FR-T2-3)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await seedApp(panel, {
    id: 'app_gemini',
    name: 'One-worder',
    description: 'asks the model for one word',
    inputs: [{ id: 'topic', label: 'Topic', type: 'text' }],
    tier: 2,
    code: 'return await bridge.gemini("Reply with exactly one word about: " + inputs.topic);',
    permissions: ['gemini'],
    reviewed: true,
    createdAt: Date.now(),
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.locator('.app-card-wrap', { has: panel.locator('.app-card-del') }).first().locator('.app-card').click();
  await panel.locator('.apps .settings-input').first().fill('oceans');
  await panel.getByRole('button', { name: 'Run app' }).click();

  await expect(panel.locator('.apps .msg-agent .msg-body')).not.toHaveText('', { timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '57-tier2-bridge.png') });
});
