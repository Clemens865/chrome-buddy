// Playwright fixture that loads the built MV3 extension from dist/.
// Extensions require Chromium + a persistent context (no headless on older
// Chromium; --headless=new supports them on recent builds).
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const pathToExtension = path.join(process.cwd(), 'dist');

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--headless=new',
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // The MV3 service worker URL carries the extension id.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];
    // Defaults that keep feature specs unblocked (each gate has its own spec):
    //  - onboardingDone: skip the first-run walkthrough (onboarding.spec opts in).
    //  - askBeforePlan: off, so agent specs don't stall at the plan gate
    //    (plan-gate.spec opts back in). Both are persisted UI prefs, not product
    //    defaults — the shipped defaults remain onboarding-on / plan-gate-on.
    await sw.evaluate(() =>
      chrome.storage.local.set({ onboardingDone: true, askBeforePlan: false }),
    );
    await use(extensionId);
  },
});

export const expect = test.expect;
