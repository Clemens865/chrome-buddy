// Learned-flow recall: a past run is suggested for a similar new task, and
// clicking the suggestion re-runs it. Deterministic (no LLM key): we seed a run
// via the SW store and assert the chip + that clicking submits the recalled task.
// Run with: npm run test:e2e:recall
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('recall suggests a similar past run and reuses it', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Seed a completed agent run into history, then reload so it's loaded.
  await panel.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'MEMORY_SAVE_RUN',
      run: {
        id: 'run_seed',
        kind: 'agent',
        task: 'Extract the top headlines from this news page',
        answer: '1. Foo\n2. Bar\n3. Baz',
        outcome: 'completed',
        toolCount: 2,
        tools: ['read_dom', 'extract'],
        provenance: ['https://news.ycombinator.com/'],
        model: 'gemini-2.5-flash',
        startedAt: Date.now(),
        durationMs: 4200,
      },
    });
  });
  await panel.reload();

  // Typing a similar task surfaces the recall chip.
  await panel.getByPlaceholder('Message Buddy…').fill('Extract the headlines from the page');
  const chip = panel.locator('.recall-chip');
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await expect(chip).toContainText('Extract the top headlines from this news page');
  await panel.screenshot({ path: path.join(SHOTS, '29-recall.png') });

  // Clicking the chip re-runs the recalled task (a user bubble with it appears).
  await chip.click();
  await expect(panel.locator('.msg-user', { hasText: 'Extract the top headlines from this news page' })).toBeVisible({
    timeout: 10_000,
  });
});
