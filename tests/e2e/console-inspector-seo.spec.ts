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
  // The Google-style rich-result preview renders with the page title.
  const serp = panel.getByTestId('ci-seo-serp');
  await expect(serp).toBeVisible();
  await expect(serp.locator('.ci-serp-title')).toContainText(/Example Domain/i);
  // The score ring + facts grid renders.
  await expect(seo.locator('.ci-seo-score-ring')).toBeVisible();
  await expect(seo.locator('.ci-seo-fact', { hasText: 'Title' })).toBeVisible();
  await expect(seo.locator('.ci-seo-fact', { hasText: 'Description' })).toBeVisible();
  // example.com has no meta description, no canonical, no OG → at least one issue.
  await expect(seo.locator('.ci-card').first()).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '88-ci-seo.png') });
});

test('SEO panel validates JSON-LD and renders the structured-data section', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'analyze_seo') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          url: 'https://shop.example.com/p/widget', h1Text: 'Widget',
          score: 84,
          issues: [],
          facts: { titleLength: 42, descriptionLength: 120, canonical: 'https://shop.example.com/p/widget', ogKeys: 4, twitterKeys: 1, structuredData: 1 },
          preview: { title: 'Widget — Best Widget Ever | Acme', description: 'The best widget you can buy, with free shipping.', canonical: 'https://shop.example.com/p/widget', ogImage: '' },
          schema: { types: ['Product', 'BreadcrumbList'], findings: [{ type: 'Product', missing: ['image', 'offers'] }] },
        } } };
      }
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'detect_tech_stack') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { url: 'https://shop.example.com/', count: 0, matches: [] } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-seo').click();

  // SERP preview reflects the stubbed title/description.
  const serp = panel.getByTestId('ci-seo-serp');
  await expect(serp).toBeVisible({ timeout: 8_000 });
  await expect(serp.getByText('Widget — Best Widget Ever | Acme')).toBeVisible();
  await expect(serp.getByText(/free shipping/)).toBeVisible();

  // Structured-data section: detected types + the missing-fields finding.
  const schema = panel.getByTestId('ci-seo-schema');
  await expect(schema.locator('.ci-a11y-tag', { hasText: 'Product' })).toBeVisible();
  await expect(schema.locator('.ci-a11y-tag', { hasText: 'BreadcrumbList' })).toBeVisible();
  await expect(panel.getByTestId('ci-seo-schema-issue')).toContainText('image, offers');

  await panel.screenshot({ path: path.join(SHOTS, '97-ci-seo-schema.png') });

  // The schema gap is folded into the Copy-fix-prompt.
  await panel.getByTestId('ci-seo-copy').click();
  const md = await panel.evaluate(() => navigator.clipboard.readText());
  expect(md).toMatch(/Structured data — Product/);
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
