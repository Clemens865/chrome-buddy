// Console Inspector hybrid Tier 2 — verify the 4 new mode tabs render the
// expected panel + the SW handler returns a usable shape.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

async function openConsoleInspector(panel: import('@playwright/test').Page, extensionId: string) {
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
}

test('Storage tab summarises localStorage / session / cookies', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });
  // Seed localStorage so the table has something interesting to render.
  await site.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('access_token', 'eyJhbGciOiJIUzI1NiJ9.payload.sig'); // flagged
    sessionStorage.setItem('sid', 'session-abc-' + 'x'.repeat(60));
  });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-storage').click();

  const storage = panel.getByTestId('ci-storage');
  await expect(storage).toBeVisible({ timeout: 8_000 });
  // The three area pills always render (even when empty); look up by class.
  await expect(storage.locator('.ci-storage-area-key')).toHaveCount(3);
  // The flagged 'access_token' row must surface.
  await expect(storage.getByText('Flagged keys')).toBeVisible();
  await expect(storage.locator('code', { hasText: 'access_token' }).first()).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '83-ci-storage.png') });
});

test('Secrets tab scans storage + DOM for redacted tokens', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });
  await site.evaluate(() => {
    localStorage.setItem('jwt', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-sensitive').click();

  const sensitive = panel.getByTestId('ci-sensitive');
  await expect(sensitive).toBeVisible({ timeout: 8_000 });
  // The JWT must be detected, with a redacted preview.
  await expect(sensitive.getByText(/JSON Web Token/)).toBeVisible({ timeout: 8_000 });
  // Preview must be redacted — middle of the JWT payload ('SflK…') must not be in the DOM.
  const html = await sensitive.innerHTML();
  expect(html).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  await panel.screenshot({ path: path.join(SHOTS, '84-ci-sensitive.png') });
});

test('Stack tab fingerprints the page', async ({ context, extensionId }) => {
  const site = await context.newPage();
  // Inject a fake React global so the detector has at least one match without
  // touching the real example.com baseline.
  await site.goto('https://example.com/', { waitUntil: 'load' });
  await site.evaluate(() => {
    (window as unknown as Record<string, unknown>).React = { version: '18.0.0' };
    (window as unknown as Record<string, unknown>).gtag = function gtag() {};
  });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-tech').click();

  const tech = panel.getByTestId('ci-tech');
  await expect(tech).toBeVisible({ timeout: 8_000 });
  await expect(tech.getByText('React', { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(tech.getByText('Google Analytics', { exact: true })).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '85-ci-tech.png') });
});

test('A11y tab audits the page for accessibility issues', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });
  // Inject several deliberate a11y problems so the audit has matches.
  await site.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'https://example.com/x.png';
    document.body.appendChild(img); // missing alt → 'image-alt'
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input); // missing label → 'label'
    const h3 = document.createElement('h3');
    h3.textContent = 'jumped from h1';
    document.body.appendChild(h3); // h1 → h3 jump → 'heading-order'
  });

  const panel = await context.newPage();
  await openConsoleInspector(panel, extensionId);
  await site.bringToFront();
  await panel.getByTestId('ci-mode-a11y').click();

  const a11y = panel.getByTestId('ci-a11y');
  await expect(a11y).toBeVisible({ timeout: 8_000 });
  await expect(a11y.getByText('Form controls must have labels')).toBeVisible({ timeout: 8_000 });
  await expect(a11y.getByText('Images must have alt text')).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '86-ci-a11y.png') });
});
