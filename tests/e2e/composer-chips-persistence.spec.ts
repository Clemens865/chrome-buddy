// Composer chips + mode persistence — survey flagged these as Tier-1 risks
// with NO existing coverage:
//   - "This page" chip toggles + persists across reload
//   - "Think harder" chip toggles + resets after submit
//   - Chat mode chip (Auto/Ask/Agent/Vision/Voice) persists across reload
//
// All deterministic — no LLM round-trip needed.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Composer: "This page" chip toggles and persists across reload', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The chip's aria-pressed reflects the persisted attachPage state.
  // "This page" greeting suggestion ALSO matches /This page/i; we want the
  // composer chip — locate by its CSS class.
  const chip = panel.locator('button.ctx-chip', { hasText: 'This page' });
  await expect(chip).toBeVisible({ timeout: 5_000 });
  // Default is true per usePersistedState('attachPage', true).
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // Toggle off.
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');

  // Reload and verify persistence — chip remembers the off state.
  await panel.reload();
  const after = panel.locator('button.ctx-chip', { hasText: 'This page' });
  await expect(after).toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });

  // Toggle back on and verify persistence again.
  await after.click();
  await expect(after).toHaveAttribute('aria-pressed', 'true');
  await panel.reload();
  await expect(panel.locator('button.ctx-chip', { hasText: 'This page' })).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
});

test('Composer: chat mode chip persists across reload', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Default mode is 'auto' — assert that first.
  const autoChip = panel.getByRole('button', { name: 'Auto', exact: true });
  await expect(autoChip).toBeVisible({ timeout: 5_000 });
  await expect(autoChip).toHaveAttribute('aria-pressed', 'true');

  // Switch to Agent.
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Auto', exact: true })).toHaveAttribute('aria-pressed', 'false');

  // Reload — mode survives.
  await panel.reload();
  await expect(panel.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 5_000 },
  );

  // Switch to Ask, reload again.
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await panel.reload();
  await expect(panel.getByRole('button', { name: 'Ask', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 5_000 },
  );

  await panel.screenshot({ path: path.join(SHOTS, '250-composer-mode-persisted.png') });
});

test('Composer: "Think harder" chip toggles ON but does NOT persist across reload (per-turn)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const chip = panel.getByRole('button', { name: /Think harder/i });
  await expect(chip).toBeVisible({ timeout: 5_000 });
  // Default off (per-turn flag).
  await expect(chip).toHaveAttribute('aria-pressed', 'false');

  // Toggle on.
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // Reload — the chip MUST NOT remember the on state. It's intentionally
  // per-turn so users explicitly opt in to higher-cost synthesis each time.
  await panel.reload();
  await expect(panel.getByRole('button', { name: /Think harder/i })).toHaveAttribute(
    'aria-pressed',
    'false',
    { timeout: 5_000 },
  );
});
