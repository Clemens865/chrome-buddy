// Composer foot must keep EVERY control visible (no clipping / horizontal
// scroll) even in a narrow side panel. The foot is a two-tier layout: the mode
// segment on one line, model + toggle chips wrapping below. Regression guard for
// the overflow that appeared once the "Tabs" chip was added.
// Run with: npx playwright test composer-foot-layout.spec.ts
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('all composer-foot controls stay in-viewport at a narrow width', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  // Narrow — typical pinned Chrome side panel.
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Every foot control should be present AND fully inside the viewport.
  const controls = [
    panel.getByRole('button', { name: 'Auto', exact: true }),
    panel.getByRole('button', { name: 'Ask', exact: true }),
    panel.getByRole('button', { name: 'Agent', exact: true }),
    panel.getByRole('button', { name: 'Vision', exact: true }),
    panel.getByRole('button', { name: 'Voice', exact: true }),
    panel.getByTestId('model-picker'),
    panel.getByRole('button', { name: /Think harder/ }),
    panel.locator('button.ctx-chip', { hasText: 'This page' }),
    panel.getByTestId('tabctx-toggle'),
  ];
  for (const c of controls) {
    await expect(c).toBeVisible({ timeout: 5_000 });
    await expect(c).toBeInViewport({ ratio: 0.95 });
  }

  await panel.screenshot({ path: path.join(SHOTS, 'composer-foot-360.png') });
});
