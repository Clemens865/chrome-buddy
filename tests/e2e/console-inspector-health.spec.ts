// Health aggregator — verifies that Console Inspector defaults to the Health
// tab, runs every audit in parallel, renders the score ring + 6 category
// chips, and that "Copy master prompt" yields ONE comprehensive markdown
// prompt covering findings across categories.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Health panel is the default mode and renders score + category chips', async ({ context, extensionId }) => {
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();

  // Health is the default mode — no need to click ci-mode-health, but verify.
  await expect(panel.getByTestId('ci-panel-health')).toBeVisible({ timeout: 8_000 });

  // Score ring renders with a number (the audits may take a moment).
  const score = panel.getByTestId('ci-health-score');
  await expect(score).toBeVisible({ timeout: 10_000 });
  const scoreText = await score.textContent();
  expect(scoreText).toMatch(/^\d{1,3}$/);

  // All 6 category chips render.
  for (const id of ['errors', 'security', 'a11y', 'seo', 'privacy', 'performance']) {
    await expect(panel.getByTestId(`ci-health-cat-${id}`)).toBeVisible();
  }
  await panel.screenshot({ path: path.join(SHOTS, '89-ci-health.png') });
});

test('Health panel "Copy master prompt" produces one comprehensive markdown prompt', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const site = await context.newPage();
  await site.goto('https://example.com/', { waitUntil: 'load' });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();

  // example.com lacks meta description / canonical / OG → SEO will surface
  // issues, and the bare page lacks CSP → Security will surface issues.
  // Either of these guarantees at least one finding for the Copy button.
  const copy = panel.getByTestId('ci-health-copy');
  await expect(copy).toBeVisible({ timeout: 15_000 });
  await copy.click();
  await expect(copy).toHaveText(/Copied/);

  const md = await panel.evaluate(() => navigator.clipboard.readText());
  expect(md).toContain('# Site-health fix request');
  expect(md).toContain('**Health Score:**');
  // The master prompt MUST end with the dynamic success-criterion sentence
  // referencing the captured score, so we can be sure the score was threaded in.
  expect(md).toMatch(/improves beyond \d{1,3} \/ 100/);
  // At least one category section should appear (SEO is reliable on example.com).
  expect(md).toMatch(/## (SEO|Security|Accessibility|Console Errors|Privacy|Performance)/);
});
