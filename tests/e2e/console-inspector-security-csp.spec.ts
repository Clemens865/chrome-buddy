// Security panel: real response-header rows + the generated-CSP artifact.
// scan_security is stubbed (missing headers + a set of resource origins) so the
// header findings + the CSP generator are deterministic.
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Security panel: header rows + Generate CSP artifact (copy + download)', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'scan_security') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
          url: 'https://shop.example.com/cart',
          tls: { https: true },
          csp: { metaPolicy: null, present: false, source: null, policy: null },
          headers: {}, // all security headers missing
          headersReadable: true,
          resourceOrigins: {
            script: ['https://shop.example.com', 'https://cdn.jsdelivr.net'],
            style: ['https://fonts.googleapis.com'],
            img: ['https://img.cdn.com'],
            connect: ['https://api.example.com'],
            font: ['https://fonts.gstatic.com'],
          },
          mixedContent: [],
          cookies: { total: 0, flagged: [] },
        } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-security').click();

  const sec = panel.getByTestId('ci-sec');
  await expect(sec).toBeVisible({ timeout: 8_000 });
  // Real-header rows render and flag the missing protections.
  await expect(sec.getByText('Strict-Transport-Security', { exact: true })).toBeVisible();
  await expect(sec.getByText(/No HSTS/)).toBeVisible();
  await expect(sec.getByText('X-Content-Type-Options', { exact: true })).toBeVisible();
  await expect(sec.getByText('Referrer-Policy', { exact: true })).toBeVisible();

  // Generate CSP → the artifact card shows a policy built from real origins.
  await panel.getByTestId('ci-sec-gen-csp').click();
  const card = panel.getByTestId('ci-sec-csp');
  await expect(card).toBeVisible({ timeout: 8_000 });
  const policy = await panel.getByTestId('ci-sec-csp-policy').textContent();
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' https://cdn.jsdelivr.net"); // self-origin dropped, third-party kept
  expect(policy).not.toContain('https://shop.example.com'); // page's own origin omitted ('self' covers it)
  expect(policy).toContain("connect-src 'self' https://api.example.com");
  expect(policy).toContain("frame-ancestors 'none'");

  await panel.screenshot({ path: path.join(SHOTS, '90-ci-security-csp.png') });

  // Copy policy → clipboard receives the bare policy.
  await panel.getByTestId('ci-sec-csp-copy').click();
  await expect(panel.getByTestId('ci-sec-csp-copy')).toHaveText(/Copied/);
  const clip = await panel.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(policy);

  // Download → the snippet file carries the policy + an nginx example.
  const [dl] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('ci-sec-csp-download').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('content-security-policy.txt');
  const file = await dl.path();
  const txt = readFileSync(file!, 'utf8');
  expect(txt).toContain('Content-Security-Policy: ' + policy);
  expect(txt).toContain('add_header Content-Security-Policy');
  expect(txt).toContain('shop.example.com');
});
