// A11y panel (axe engine) — deterministic coverage of the rich details:
// WCAG tags, per-element selectors, the engine badge, and the JSON report
// download. analyze_a11y_axe is stubbed so the assertions don't depend on a
// live axe run (that path is smoke-tested in console-inspector-tier2).
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('A11y panel renders axe WCAG tags + selectors and downloads a JSON report', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'analyze_a11y_axe') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          engine: 'axe', axeVersion: '4.12.0', url: 'https://example.com/',
          total: 3,
          issues: [
            { id: 'image-alt', severity: 'critical', rule: 'Images must have alternative text', description: 'Ensures img has alt.', suggestion: 'Element does not have an alt attribute.', count: 1, docUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt', wcag: ['wcag2a', 'wcag111'], nodes: [{ target: 'img.hero', html: '<img class="hero">' }] },
            { id: 'color-contrast', severity: 'serious', rule: 'Elements must meet minimum color contrast ratio thresholds', description: 'Ensures contrast.', suggestion: 'Fix any of the following: element has insufficient color contrast.', count: 2, docUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast', wcag: ['wcag2aa', 'wcag143'], nodes: [{ target: 'p.muted', html: '<p class="muted">' }, { target: 'a.link', html: '<a class="link">' }] },
          ],
        } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-a11y').click();

  const a11y = panel.getByTestId('ci-a11y');
  await expect(a11y).toBeVisible({ timeout: 8_000 });
  // Engine badge shows axe-core + version.
  await expect(panel.getByTestId('ci-a11y-engine')).toContainText('axe-core 4.12.0');
  // WCAG tags render.
  await expect(a11y.getByText('wcag143', { exact: true })).toBeVisible();
  // Per-element selectors render.
  await expect(a11y.getByText('p.muted', { exact: true })).toBeVisible();
  await expect(a11y.getByText('img.hero', { exact: true })).toBeVisible();
  // Critical sorts above serious.
  await expect(a11y.locator('.ci-card').first().getByText('Images must have alternative text')).toBeVisible();

  await panel.screenshot({ path: path.join(SHOTS, '91-ci-a11y-axe.png') });

  // Download report → CI-ingestible JSON carrying the engine + issues.
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('ci-a11y-report').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('a11y-report.json');
  const json = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
  expect(json.engine).toBe('axe-core 4.12.0');
  expect(json.issues).toHaveLength(2);
  expect(json.issues[0].rule).toBe('Images must have alternative text');
});
