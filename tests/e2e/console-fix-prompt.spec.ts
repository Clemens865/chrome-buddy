// Verify the user-requested workflow:
//   capture an error → click "Copy fix prompt" → clipboard receives a
//   structured markdown prompt fit for pasting into an IDE.
//
// We seed the console controller via the SW with a synthetic error so the
// flow is deterministic and doesn't depend on a live page firing onload errors.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Errors panel produces a paste-ready bug-fix prompt and copies it', async ({ context, extensionId }) => {
  // Grant clipboard write so navigator.clipboard.writeText resolves.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Replace the analyze_errors response in the SW with a deterministic match.
  // We do this by stubbing chrome.runtime.sendMessage from the panel-side: the
  // panel calls runtime.sendMessage to talk to the SW, so we patch that here.
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error attaching the stub onto a typed handle
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string; args?: unknown }, ...rest: unknown[]) => {
      if (msg && msg.type === 'TOOL_EXEC' && msg.tool === 'analyze_errors') {
        return {
          type: 'TOOL_EXEC',
          ok: true,
          result: {
            ok: true,
            data: {
              scanned: 1,
              matchCount: 1,
              matches: [
                {
                  text: "TypeError: Cannot read properties of undefined (reading 'user')",
                  category: 'Null Reference',
                  framework: 'JavaScript',
                  description: 'Attempting to access property on null/undefined',
                  suggestion: 'Add null checks or use optional chaining (?.)',
                  severity: 'high',
                  count: 2,
                },
              ],
            },
          },
        };
      }
      if (msg && msg.type === 'TOOL_EXEC' && msg.tool === 'detect_tech_stack') {
        return {
          type: 'TOOL_EXEC',
          ok: true,
          result: { ok: true, data: { url: 'https://example.com/', count: 1, matches: [{ name: 'React', category: 'JavaScript Framework', evidence: ['window.React'] }] } },
        };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  // Navigate to Console Inspector → Errors mode.
  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-errors').click();
  // Click "Scan errors" to fire analyze_errors (without capturing on, it doesn't auto-run).
  await panel.getByRole('button', { name: 'Scan errors', exact: true }).click();

  // The deterministic match must render.
  await expect(panel.getByText('Null Reference')).toBeVisible({ timeout: 8_000 });
  await expect(panel.getByText('Attempting to access property on null/undefined')).toBeVisible();

  // Top-level "Copy fix prompt" → clipboard receives a markdown prompt.
  const copyAll = panel.getByTestId('ci-errors-copy-all');
  await expect(copyAll).toBeVisible();
  await copyAll.click();
  // The button flashes "Copied ✓" briefly.
  await expect(copyAll).toHaveText(/Copied/);

  const md = await panel.evaluate(() => navigator.clipboard.readText());
  // Structure: title + Context + numbered error section + Your task block.
  expect(md).toContain('Bug-fix request');
  expect(md).toContain('## Context');
  expect(md).toContain('React'); // detected tech stack threaded into the prompt
  expect(md).toContain('## 1. Null Reference · JavaScript — `high`');
  expect(md).toContain('Add null checks or use optional chaining');
  expect(md).toContain('## Your task');
  expect(md).toContain('Run the project test suite');

  await panel.screenshot({ path: path.join(SHOTS, '87-ci-errors-fix-prompt.png') });

  // Per-card "Copy" button also works (just verifies the affordance; the
  // full per-card markdown is unit-tested elsewhere).
  const copyOne = panel.getByTestId('ci-errors-copy-0');
  await expect(copyOne).toBeVisible();
  await copyOne.click();
  await expect(copyOne).toHaveText(/Copied/);
});
