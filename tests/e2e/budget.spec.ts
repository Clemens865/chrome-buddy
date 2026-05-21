// NFR-COST-1 / FR-SET-1: per-run/day spend caps + step budget in Settings, with
// a hard stop when the daily cap is hit. Deterministic (no key) — the cap blocks
// before any LLM call. Run: npm run test:e2e:budget
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Settings exposes budget caps', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByText('Per-run cap')).toBeVisible();
  await expect(panel.getByText('Daily cap')).toBeVisible();
  await expect(panel.getByText('Step budget')).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '37-budget-settings.png') });
});

test('daily cap hard-stops a new run', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed today's ledger over the default $5 daily cap, then reload to load it.
  await panel.evaluate(() => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return chrome.storage.local.set({ spendLedger: { date: key, total: 99 } });
  });
  await panel.reload();

  await panel.getByPlaceholder('Message Buddy…').fill('hello');
  await panel.getByRole('button', { name: 'Send' }).click();

  // Blocked before any model call: cap notice shows, no assistant answer.
  await expect(panel.getByText(/Daily spend cap reached/)).toBeVisible({ timeout: 10_000 });
  // No real assistant answer (the cap notice is a subtle error row, not an answer).
  await expect(panel.locator('.msg-agent:not(.msg-subtle) .msg-body')).toHaveCount(0);
  await panel.screenshot({ path: path.join(SHOTS, '38-budget-cap-block.png') });
});
