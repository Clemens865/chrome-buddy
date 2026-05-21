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
    // Skip the first-run onboarding by default so feature specs land on the panel.
    // (The onboarding spec sets this back to false to exercise the walkthrough.)
    await sw.evaluate(() => chrome.storage.local.set({ onboardingDone: true }));
    await use(extensionId);
  },
});

export const expect = test.expect;
