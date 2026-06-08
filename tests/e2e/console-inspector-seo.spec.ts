// Console Inspector — SEO tab + unified Copy-fix-prompt across analytical
// panels (A11y / Security / SEO). All three panels must now offer the same
// "Copy fix prompt" / "Send to Buddy" affordance the user asked for on Errors.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function openConsoleInspector(panel: import('@playwright/test').Page, extensionId: string) {
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
}

test('SEO tab scores the page and lists issues with fix suggestions', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-seo').click();

  const seo = panel.getByTestId('ci-seo');
  await expect(seo).toBeVisible({ timeout: 8_000 });
  // The score ring + facts grid renders.
  await expect(seo.locator('.ci-seo-score-ring')).toBeVisible();
  await expect(seo.locator('.ci-seo-fact', { hasText: 'Title' })).toBeVisible();
  await expect(seo.locator('.ci-seo-fact', { hasText: 'Description' })).toBeVisible();
  // example.com has no meta description, no canonical, no OG → at least one issue.
  await expect(seo.locator('.ci-card').first()).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '88-ci-seo.png') });
});

test('SEO Copy-fix-prompt produces a paste-ready markdown prompt', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-seo').click();

  // The copy button only renders once issues are present, which we expect on
  // bare example.com (no description / canonical / OG).
  const copy = panel.getByTestId('ci-seo-copy');
  await expect(copy).toBeVisible({ timeout: 8_000 });
  await copy.click();
  await expect(copy).toHaveText(/Copied/);

  const md = await panel.evaluate(() => navigator.clipboard.readText());
  expect(md).toContain('# SEO fix request');
  expect(md).toContain('## Your task');
  // At least one of the common example.com gaps must be present.
  expect(md).toMatch(/Meta description|Canonical URL|Open Graph/);
});

test('A11y panel now exposes Copy-fix-prompt + Send to Buddy', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });
  // Inject one trivial a11y issue so the Copy button has something to act on.
  await site.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'https://example.com/x.png';
    document.body.appendChild(img); // missing alt → 'image-alt' issue
  });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-a11y').click();

  const copy = panel.getByTestId('ci-a11y-copy');
  await expect(copy).toBeVisible({ timeout: 8_000 });
  await copy.click();
  await expect(copy).toHaveText(/Copied/);
  const md = await panel.evaluate(() => navigator.clipboard.readText());
  expect(md).toContain('# Accessibility fix request');
  // axe-core powers the audit now → its rule wording ("alternative text").
  expect(md).toMatch(/alternative text/i);
});

test('Security panel now exposes Copy-fix-prompt with structured findings', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-security').click();

  // example.com has no CSP meta tag → at least one Security finding.
  const copy = panel.getByTestId('ci-sec-copy');
  await expect(copy).toBeVisible({ timeout: 8_000 });
  await copy.click();
  await expect(copy).toHaveText(/Copied/);
  const md = await panel.evaluate(() => navigator.clipboard.readText());
  expect(md).toContain('# Security fix request');
  expect(md).toContain('Content-Security-Policy');
});
