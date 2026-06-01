// Library collections + file ingest — deterministic e2e.
//
// Seeds a Gemini key, stubs the SW embedContent fetch (so indexing needs no
// network), then exercises the new collection bar: it renders the seeded
// defaults, creates a "Competitors" collection, and adds a markdown file into
// it with a note — asserting the doc lands in that collection with the note +
// 'file' source, and the markdown H1 becomes the title (parseFile).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Library: create a collection + add a file into it with a note', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const [sw] = context.serviceWorkers();

  await panel.evaluate(
    (key) => chrome.runtime.sendMessage({ type: 'KEY_SET', provider: 'google-gemini', key }),
    'test-key-123',
  );
  // Stub the embedding endpoint — any small vector works for cosine ranking.
  await sw.evaluate(() => {
    const real = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(':embedContent')) {
        return new Response(JSON.stringify({ embedding: { values: [0.11, 0.22, 0.33, 0.44] } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    };
  });

  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByTestId('library-view')).toBeVisible({ timeout: 5_000 });

  // The seeded default collections render.
  const cols = panel.getByTestId('library-collections');
  await expect(cols).toContainText('General');
  await expect(cols).toContainText('Personal Profile');

  // Create a "Competitors" collection.
  await panel.getByTestId('library-col-new').click();
  await panel.getByTestId('library-newcol-name').fill('Competitors');
  await panel.getByTestId('library-newcol-create').click();
  // The new pill appears and becomes the selected collection.
  await expect(panel.getByTestId('library-col-competitors')).toBeVisible({ timeout: 5_000 });

  // Add a note + a markdown file into the selected collection.
  await panel.getByTestId('library-note').fill('is a competitor');
  await panel.getByTestId('library-file-input').setInputFiles({
    name: 'rival.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Rival Corp\n\nThey ship a similar product weekly.'),
  });

  // The doc lands: title from the H1, the note chip, and a 'file' source pill.
  await expect(panel.getByTestId('library-import-status')).toContainText(/Added 1 file/, { timeout: 30_000 });
  const docs = panel.getByTestId('library-docs');
  await expect(docs).toContainText('Rival Corp', { timeout: 30_000 });
  await expect(docs).toContainText('is a competitor');
  await expect(docs.getByText('file', { exact: true }).first()).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '99-library-collections.png') });

  // Switching to General shows it's NOT there (scoped to Competitors).
  await panel.getByTestId('library-col-general').click();
  await expect(panel.getByTestId('library-docs')).not.toContainText('Rival Corp');
});
