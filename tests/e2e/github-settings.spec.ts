// Deterministic — GitHub Settings: paste a (fake) PAT, verify it stores in
// chrome.storage.session (NOT in chrome.storage.local), then remove. Live
// github_write/read/list tests aren't run in CI (would need a real repo).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Settings → GitHub: add + remove token (storage.session, never on disk)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();

  // Scroll the GitHub row into view (anchor on the row label, not the section).
  await panel.getByText('Personal access token', { exact: true }).scrollIntoViewIfNeeded();
  await expect(panel.getByText('Personal access token', { exact: true })).toBeVisible();
  // Allow time for chrome.storage.session.get to resolve hasToken=false. We use
  // the Pill class to disambiguate (the words "Not set" could appear elsewhere).
  const notSetPill = panel.locator('.pill', { hasText: 'Not set' });
  await expect(notSetPill).toBeVisible({ timeout: 15_000 });

  // Add a fake token.
  await panel.getByRole('button', { name: 'Add token', exact: true }).click();
  const input = panel.getByPlaceholder(/ghp_|github_pat_/);
  await input.fill('ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('.pill', { hasText: 'Token set' })).toBeVisible();

  // It must live in chrome.storage.session, NOT chrome.storage.local.
  const where = await panel.evaluate(async () => {
    const s = (await chrome.storage.session.get('gh_token')) as { gh_token?: string };
    const l = (await chrome.storage.local.get('gh_token')) as { gh_token?: string };
    return { inSession: typeof s.gh_token === 'string' && s.gh_token.length > 0, inLocal: typeof l.gh_token === 'string' };
  });
  expect(where.inSession).toBe(true);
  expect(where.inLocal).toBe(false);

  // Default repo persists.
  await panel.getByLabel('Default GitHub repo').fill('clemens/buddy-vault');
  await panel.screenshot({ path: path.join(SHOTS, '83-github-settings.png') });

  // Remove the token — scoped to the "Personal access token" row so we don't
  // accidentally click the Gemini API key's Remove button (which appears
  // earlier in the DOM).
  const ghRow = panel.locator('.settings-row', { hasText: 'Personal access token' });
  await ghRow.getByRole('button', { name: 'Remove', exact: true }).click();
  // Ground truth: the storage really IS cleared.
  const cleared = await panel.evaluate(async () => {
    const s = (await chrome.storage.session.get('gh_token')) as { gh_token?: string };
    return typeof s.gh_token !== 'string' || s.gh_token.length === 0;
  });
  expect(cleared).toBe(true);
  await expect(notSetPill).toBeVisible({ timeout: 10_000 });
});
