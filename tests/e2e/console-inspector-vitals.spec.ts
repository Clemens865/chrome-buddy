// Vitals panel — deterministic coverage of INP, budget targets, and attribution
// (which element caused LCP / the top CLS source). web_vitals is stubbed.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Vitals panel shows INP, budget targets, and LCP/CLS attribution', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'web_vitals') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          url: 'https://shop.example.com/', title: 'Shop',
          vitals: {
            lcp: { value: 3200, unit: 'ms', verdict: 'needs-improvement', target: 2500 },
            inp: { value: 240, unit: 'ms', verdict: 'needs-improvement', target: 200 },
            cls: { value: 0.18, unit: '', verdict: 'needs-improvement', target: 0.1 },
            fcp: { value: 1500, unit: 'ms', verdict: 'good', target: 1800 },
            ttfb: { value: 600, unit: 'ms', verdict: 'good', target: 800 },
            fid: { value: 90, unit: 'ms', verdict: 'good', target: 100 },
          },
          attribution: { lcpElement: 'img.hero', lcpUrl: 'https://cdn.example.com/hero.jpg', clsSource: 'div.banner' },
        } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-vitals').click();

  const vitals = panel.getByTestId('ci-vitals');
  await expect(vitals).toBeVisible({ timeout: 8_000 });
  // INP card with its value + budget target.
  await expect(vitals.getByText('INP', { exact: true })).toBeVisible();
  await expect(vitals.getByText('240')).toBeVisible();
  await expect(vitals.getByText('≤ 200ms')).toBeVisible();
  // Attribution: the LCP element + the top CLS source.
  await expect(vitals.getByText(/img\.hero/)).toBeVisible();
  await expect(vitals.getByText(/div\.banner/)).toBeVisible();
  // FID is not shown (superseded by INP).
  await expect(vitals.getByText('FID', { exact: true })).toHaveCount(0);

  await panel.screenshot({ path: path.join(SHOTS, '94-ci-vitals-attribution.png') });

  // Copy summary → includes attribution.
  await panel.getByTestId('ci-vitals-copy').click();
  const summary = await panel.evaluate(() => navigator.clipboard.readText());
  expect(summary).toContain('element: img.hero');
  expect(summary).toContain('top shift: div.banner');
  expect(summary).toMatch(/INP: 240 ms \(needs-improvement\)/);
});
