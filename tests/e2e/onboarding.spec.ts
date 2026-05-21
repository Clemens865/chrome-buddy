// FR-ONB-1..4: first-run walkthrough that takes over until a key is set or the
// user skips, explains key storage, and gates the panel. The shared fixture
// skips onboarding for other specs; here we opt back in. Run: npm run test:e2e:onboarding
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('first-run onboarding shows, explains storage, and dismisses to the panel', async ({
  context,
  extensionId,
}) => {
  // Opt back into onboarding (the fixture cleared it).
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ onboardingDone: false }));

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // The walkthrough takes over; the panel rail/chat are not shown yet.
  await expect(panel.getByText('Welcome to Chrome Buddy')).toBeVisible();
  await expect(panel.getByText(/never written to disk/)).toBeVisible(); // FR-ONB-4
  await expect(panel.getByPlaceholder('Message Buddy…')).toHaveCount(0);
  await panel.screenshot({ path: path.join(SHOTS, '39-onboarding.png') });

  // A key is already configured in the test env, so finishing is one click.
  await panel.getByRole('button', { name: 'Get started' }).click();

  // Now the panel is usable.
  await expect(panel.getByPlaceholder('Message Buddy…')).toBeVisible();
});
