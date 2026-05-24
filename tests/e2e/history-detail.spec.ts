// Deterministic — seed two runs into the IDB 'runs' store, open History, click
// a row, and verify the inline detail panel renders the answer + tools + sources.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('History row expands inline to show answer, tools, and sources', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed two runs via the SW (uses the public MEMORY_SAVE_RUN handler).
  await panel.evaluate(async () => {
    const now = Date.now();
    await chrome.runtime.sendMessage({
      type: 'MEMORY_SAVE_RUN',
      run: {
        id: 'run_a',
        kind: 'agent',
        task: 'Compare laptop prices across three sites',
        answer: 'Dell XPS 13 is the cheapest at $999 on dell.com.',
        outcome: 'completed',
        toolCount: 3,
        tools: ['search_web', 'fetch_url', 'extract'],
        provenance: ['https://dell.com/xps-13', 'https://bestbuy.com/laptops', 'https://amazon.com/laptops'],
        model: 'gemini-3.5-flash',
        startedAt: now - 10_000,
        durationMs: 8_400,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'MEMORY_SAVE_RUN',
      run: {
        id: 'run_b',
        kind: 'chat',
        task: 'What is the capital of Austria?',
        answer: 'Vienna.',
        outcome: 'answered',
        toolCount: 0,
        tools: [],
        provenance: [],
        model: 'gemini-3.5-flash',
        startedAt: now - 5_000,
        durationMs: 1_200,
      },
    });
  });
  await panel.reload();

  // Open History → both rows visible.
  await panel.getByRole('button', { name: 'History', exact: true }).click();
  await expect(panel.locator('.stub-row-title', { hasText: 'Compare laptop prices across three sites' })).toBeVisible();
  await expect(panel.locator('.stub-row-title', { hasText: 'What is the capital of Austria?' })).toBeVisible();

  // Click the agent row → its detail panel expands.
  await panel.locator('.stub-row-clickable', { hasText: 'Compare laptop prices across three sites' }).click();
  const detail = panel.locator('.run-detail').first();
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Answer', { exact: true })).toBeVisible();
  await expect(detail.getByText(/Dell XPS 13 is the cheapest/)).toBeVisible();
  await expect(detail.getByText('Tools (3)')).toBeVisible();
  // Tool chips
  for (const t of ['search_web', 'fetch_url', 'extract']) {
    await expect(detail.locator('.run-detail-chip', { hasText: t })).toBeVisible();
  }
  // Sources rendered as clickable links
  await expect(detail.locator('.run-detail-sources a', { hasText: 'dell.com' })).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '79-history-detail.png') });

  // Click the same row again → collapses.
  await panel.locator('.stub-row-clickable', { hasText: 'Compare laptop prices across three sites' }).click();
  await expect(detail).toBeHidden();
});
