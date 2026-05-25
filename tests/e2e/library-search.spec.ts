// Library v1 — round-trip e2e. Seeds a couple of MD docs into the local
// library via LIBRARY_INDEX, then searches via the search_library tool and
// verifies the right snippet comes back.
// Live — needs VITE_GEMINI_API_KEY in .env (the build bakes it in).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('library: index two docs, then search returns the right one with a score', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed two MD docs through the SW. Each call chunks, embeds via Gemini,
  // and stores atomically in the libraryDocs + libraryChunks IDB stores.
  const seeded = await panel.evaluate(async () => {
    const docs = [
      {
        sourceRef: 'note:retry-patterns',
        title: 'Retry patterns',
        content:
          '# Retry patterns\n\nUse exponential backoff with full jitter. Cap the max delay at 30 seconds. Only retry on 429, 503, and 504 status codes. Read the Retry-After header when present.',
      },
      {
        sourceRef: 'note:dinner-recipes',
        title: 'Dinner recipes',
        content:
          '# Dinner recipes\n\nLasagna: layer pasta, ricotta, mozzarella, marinara. Bake at 375°F for 45 minutes. Let cool 10 minutes before slicing.',
      },
    ];
    const results: unknown[] = [];
    for (const d of docs) {
      const r = await chrome.runtime.sendMessage({
        type: 'LIBRARY_INDEX',
        source: 'note',
        sourceRef: d.sourceRef,
        title: d.title,
        content: d.content,
      });
      results.push(r);
    }
    return results;
  });
  // Both docs indexed (status: 'indexed', chunkCount > 0).
  expect(Array.isArray(seeded)).toBe(true);
  // Each result is { ok: true, result: { ok: true, data: { docId, reindexed, chunkCount } } }.
  for (const r of seeded as { ok: boolean; result: { ok: boolean; data?: { chunkCount: number }; error?: { code: string; message: string } } }[]) {
    if (!r.ok || !r.result.ok) {
      // eslint-disable-next-line no-console
      console.error('LIBRARY_INDEX failed:', JSON.stringify(r));
    }
    expect(r.ok).toBe(true);
    expect(r.result.ok).toBe(true);
    expect(r.result.data?.chunkCount ?? 0).toBeGreaterThan(0);
  }

  // Search for "how do I handle rate limits" — should hit the retry doc, not
  // the recipe doc.
  const searched = await panel.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'search_library',
      args: { query: 'how do I handle rate limits with backoff', k: 3 },
    });
  });
  type Hit = { docId: string; title: string; source: string; score: number; snippet: string };
  const result = searched as { ok: boolean; result: { ok: boolean; data: { hits: Hit[]; count: number } } };
  expect(result.ok).toBe(true);
  expect(result.result.ok).toBe(true);
  expect(result.result.data.count).toBeGreaterThan(0);

  // The TOP hit must be the retry doc, with a positive cosine score.
  const top = result.result.data.hits[0];
  expect(top.title).toBe('Retry patterns');
  expect(top.score).toBeGreaterThan(0.5);
  // Snippet must come from the indexed text, not the recipe.
  expect(top.snippet.toLowerCase()).toMatch(/retry|backoff|jitter|429|503|504|retry-after/);
  await panel.screenshot({ path: path.join(SHOTS, '90-library-search.png') });
});
