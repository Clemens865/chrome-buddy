// Visual check that the new logo renders on the Onboarding screen and that
// the three manifest icons are reachable. No assertions beyond presence —
// the screenshot is the artifact.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('logo renders on Onboarding + all manifest icons reachable', async ({ context, extensionId }) => {
  // The fixture default sets onboardingDone=true to skip the walkthrough.
  // Flip it OFF in the SW's chrome.storage before opening the panel so the
  // Onboarding view actually renders.
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ onboardingDone: false }));

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The Onboarding card shows the new logo image now (was a small SVG mark).
  const logo = panel.locator('.onb-mark-logo img');
  await expect(logo).toBeVisible({ timeout: 8_000 });
  await expect(logo).toHaveAttribute('src', '/logo.png');

  // Snapshot the onboarding so we can eyeball it.
  await panel.screenshot({ path: path.join(SHOTS, '150-onboarding-logo.png') });

  // Make sure each manifest icon size actually serves a valid PNG (not 404).
  for (const size of [16, 48, 128]) {
    const status = await panel.evaluate(async (s) => {
      const r = await fetch(`/icon-${s}.png`);
      return r.status;
    }, size);
    expect(status).toBe(200);
  }
});
