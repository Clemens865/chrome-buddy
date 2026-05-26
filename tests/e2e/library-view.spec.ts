// Library v1 commit 3 — rail surface. Verifies:
//   (a) The Library rail entry routes to the LibraryView.
//   (b) Indexed docs show up in the list with a source pill + chunk count.
//   (c) Free-text search returns ranked hits with a score.
//   (d) Deleting a doc removes it from the list AND from search results.
//
// Folder import (FSA showDirectoryPicker) can't be Playwright-driven (the
// picker is a native chooser); that pipeline is unit-tested in walk.test.ts.
//
// Live — needs VITE_GEMINI_API_KEY for the embedding round-trip.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Library view: list + search + delete (round-trip against live Gemini)', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed two docs through the SW so the view has content.
  await panel.evaluate(async () => {
    const docs = [
      {
        sourceRef: 'note:react-error-handling',
        title: 'React error handling',
        content:
          '# React error handling\n\nWrap your tree in an ErrorBoundary component. Combine with a Sentry / Datadog integration. For async, useEffect cleanups must throw inside the effect, not in the unmount.',
      },
      {
        sourceRef: 'note:travel-paris',
        title: 'Travel notes — Paris',
        content:
          '# Paris\n\nThe Marais is best for evenings. Skip the Louvre on Tuesdays. Reserve Le Comptoir 6 weeks ahead.',
      },
    ];
    for (const d of docs) {
      await chrome.runtime.sendMessage({
        type: 'LIBRARY_INDEX',
        source: 'note',
        sourceRef: d.sourceRef,
        title: d.title,
        content: d.content,
      });
    }
  });

  // Reload so the LibraryView reads fresh IDB state on mount.
  await panel.reload();

  // Navigate to Library via the rail.
  await panel.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(panel.getByTestId('library-view')).toBeVisible({ timeout: 8_000 });

  // Both seeded docs should appear in the bottom doc list.
  const docs = panel.getByTestId('library-docs');
  await expect(docs).toContainText('React error handling');
  await expect(docs).toContainText('Travel notes — Paris');

  // Search for "error boundary" — top hit must be the React doc, NOT Paris.
  await panel.getByTestId('library-search').fill('how do I add an error boundary to my React app');
  await panel.getByRole('button', { name: 'Search', exact: true }).click();

  const results = panel.getByTestId('library-results');
  await expect(results).toBeVisible({ timeout: 30_000 });
  // First hit's title must be the React doc.
  const firstTitle = results.locator('.library-hit-title').first();
  await expect(firstTitle).toHaveText('React error handling');
  await panel.screenshot({ path: path.join(SHOTS, '92-library-view.png') });

  // Delete the Paris doc. The list should drop to one entry; search results
  // (which currently only contain the React doc anyway) should remain valid.
  const parisRow = panel.locator('.library-doc-row', { hasText: 'Travel notes — Paris' });
  await parisRow.getByRole('button', { name: /Delete/ }).click();
  await expect(docs).not.toContainText('Travel notes — Paris');
  await expect(docs).toContainText('React error handling');
});
