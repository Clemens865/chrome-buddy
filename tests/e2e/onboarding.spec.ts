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

test('composer shows the H2 "Think harder" toggle that activates on click', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const chip = panel.getByRole('button', { name: 'Think harder' });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await panel.screenshot({ path: path.join(SHOTS, '70-think-harder-toggle.png') });
});

test('onboarding (no-key branch) shows the API-key restriction nudge (F5)', async ({ context, extensionId }) => {
  const [sw] = context.serviceWorkers();
  await sw.evaluate(() => chrome.storage.local.set({ onboardingDone: false }));

  const panel = await context.newPage();
  // The build has VITE_GEMINI_API_KEY baked in (live tests need it). Force the
  // panel to think no key is set so the input + the 2026-06-19 restriction
  // nudge actually render.
  await panel.addInitScript(() => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error overload juggle (callback or promise form, both honored)
    chrome.runtime.sendMessage = (msg: { type?: string } | unknown, cb?: (r: unknown) => void) => {
      if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'KEY_STATUS') {
        const r = { type: 'KEY_STATUS', ok: true, hasKey: false };
        if (typeof cb === 'function') cb(r);
        return Promise.resolve(r);
      }
      return orig(msg as never, cb as never);
    };
  });
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(panel.getByText('Welcome to Chrome Buddy')).toBeVisible();
  await expect(panel.getByPlaceholder('Paste your Gemini API key')).toBeVisible();
  await expect(panel.getByText(/restrict it to/i)).toBeVisible();
  await expect(panel.locator('.onb-note-warn code')).toContainText('generativelanguage.googleapis.com');
  await panel.screenshot({ path: path.join(SHOTS, '69-onboarding-key-nudge.png') });
});
