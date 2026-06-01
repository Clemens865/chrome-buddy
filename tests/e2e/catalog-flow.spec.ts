// Marketplace end-to-end: open Discover → catalog renders → Install an app →
// it lands in the user's grid. The catalog fetch is stubbed (window.fetch) with
// the real seed bundles so the flow is deterministic regardless of repo state.
// Run: npm run test:e2e:catalog
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

const index = JSON.stringify({
  schemaVersion: 1,
  entries: [
    { id: 'email-polisher', name: 'Email Polisher', description: 'Rewrite a rough email draft in the tone you choose.', kind: 'app', tier: 1, version: '1.0.0', author: 'Chrome Buddy', dataPath: 'apps/email-polisher.json' },
    { id: 'regex-explainer', name: 'Regex Explainer', description: 'Explain a regular expression in plain English.', kind: 'app', tier: 1, version: '1.0.0', author: 'Chrome Buddy', dataPath: 'apps/regex-explainer.json' },
  ],
});
const emailBundle = JSON.stringify({
  schemaVersion: 2,
  apps: [{ id: 'email-polisher', name: 'Email Polisher', description: 'Rewrite a rough email draft in the tone you choose.', tier: 1, inputs: [{ id: 'draft', label: 'Your draft', type: 'textarea' }, { id: 'tone', label: 'Tone', type: 'text' }], promptTemplate: 'Rewrite {{draft}} to be {{tone}}.', createdAt: 0 }],
});

test('Marketplace: discover → install → app appears in the grid', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stub the public catalog fetch with the seed bundles.
  await panel.evaluate((data) => {
    const real = window.fetch.bind(window);
    // @ts-expect-error override for the test
    window.fetch = async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/index.json')) return new Response(data.index, { status: 200 });
      if (u.endsWith('/apps/email-polisher.json')) return new Response(data.emailBundle, { status: 200 });
      return real(url, init);
    };
  }, { index, emailBundle });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByTestId('apps-discover').click();

  // The gallery renders both seeded apps.
  await expect(panel.getByTestId('catalog-view')).toBeVisible({ timeout: 5_000 });
  await expect(panel.getByTestId('catalog-card-email-polisher')).toBeVisible();
  await expect(panel.getByTestId('catalog-card-regex-explainer')).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, 'catalog-1-gallery.png') });

  // Install Email Polisher → the button flips to "Installed".
  await panel.getByTestId('catalog-install-email-polisher').click();
  await expect(panel.getByTestId('catalog-install-email-polisher')).toHaveText('Installed', { timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, 'catalog-2-installed.png') });

  // Back to the grid → the installed app is now one of the user's apps.
  await panel.getByRole('button', { name: 'Back to apps' }).click();
  await expect(panel.getByText('Email Polisher')).toBeVisible({ timeout: 5_000 });
  await panel.screenshot({ path: path.join(SHOTS, 'catalog-3-grid.png') });
});
