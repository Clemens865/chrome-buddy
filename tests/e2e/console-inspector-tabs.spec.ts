// Console Inspector hybrid Tier 1 — verify each new mode tab renders the
// expected panel and the SW handler returns a usable shape. Vitals and
// Security work without any debugger capture; Errors and Network surface
// the "start capture" hint when no debugger is attached (the safe default).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Vitals tab measures Core Web Vitals for the active page', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await site.bringToFront();
  await panel.getByTestId('ci-mode-vitals').click();

  // The vitals grid renders with LCP / INP / CLS / FCP / TTFB cards (INP replaces
  // the deprecated FID).
  const vitals = panel.getByTestId('ci-vitals');
  await expect(vitals).toBeVisible({ timeout: 8_000 });
  for (const k of ['LCP', 'INP', 'CLS', 'FCP', 'TTFB']) {
    await expect(vitals.getByText(k, { exact: true })).toBeVisible();
  }
  await panel.screenshot({ path: path.join(SHOTS, '80-ci-vitals.png') });

  // Copy summary → clipboard receives a Web Vitals report.
  await panel.getByTestId('ci-vitals-copy').click();
  const summary = await panel.evaluate(() => navigator.clipboard.readText());
  expect(summary).toContain('Web Vitals');
  expect(summary).toMatch(/LCP:/);
});

test('Security tab scans HTTPS / CSP / mixed-content / cookies', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await site.bringToFront();
  await panel.getByTestId('ci-mode-security').click();

  const sec = panel.getByTestId('ci-sec');
  await expect(sec).toBeVisible({ timeout: 8_000 });
  // example.com is https → HTTPS row must be the "ok" state.
  await expect(sec.getByText(/Encrypted \(https\)/)).toBeVisible();
  // All four section labels render.
  for (const label of ['HTTPS', 'Content-Security-Policy', 'Mixed content', 'Cookies']) {
    await expect(sec.getByText(label, { exact: true })).toBeVisible();
  }
  await panel.screenshot({ path: path.join(SHOTS, '81-ci-security.png') });
});

test('Errors tab surfaces the "capture off" hint by default (no surprise debugger attach)', async ({
  context,
  extensionId,
}) => {
  // The user-visible Tier-1 safety: scanning without prior capture must NOT
  // pop the yellow "this browser is being debugged" banner — it returns a
  // hint asking the user to open the Console tab and click Start first.
  // The pattern-matcher itself is exhaustively unit-tested elsewhere
  // (src/console/errorPatterns.test.ts).
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-errors').click();
  await panel.getByRole('button', { name: 'Scan errors', exact: true }).click();
  await expect(panel.getByText(/Console capture is not running/)).toBeVisible({ timeout: 5_000 });
  await panel.screenshot({ path: path.join(SHOTS, '82-ci-errors.png') });
});
