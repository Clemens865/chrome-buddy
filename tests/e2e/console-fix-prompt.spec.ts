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

test('Errors panel renders the AI Error Analysis artifact and copies the AI prompt', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const AI_PROMPT = 'I am seeing a TypeError (cannot read user of undefined). Please help me locate and fix it.';

  // Stub analyze_errors (one match), detect_tech_stack, read_console (raw logs),
  // and LLM_GENERATE (the structured analysis JSON the model would return).
  await panel.evaluate((aiPrompt) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error attaching the stub onto a typed handle
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'analyze_errors') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { scanned: 1, matchCount: 1, matches: [
          { text: "TypeError: Cannot read properties of undefined (reading 'user')", category: 'Null Reference', framework: 'JavaScript', description: 'Attempting to access property on null/undefined', suggestion: 'Add null checks or use optional chaining (?.)', severity: 'high', count: 2 },
        ] } } };
      }
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'detect_tech_stack') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { url: 'https://example.com/', count: 1, matches: [{ name: 'React', category: 'JavaScript Framework', evidence: ['window.React'] }] } } };
      }
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'read_console') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { capturing: true, entries: [
          { level: 'error', text: "TypeError: Cannot read properties of undefined (reading 'user')", source: 'https://example.com/assets/app-9f2.js:128:14', ts: 1, count: 2 },
        ] } } };
      }
      if (msg?.type === 'LLM_GENERATE') {
        const analysis = {
          summary: 'A value is undefined when the code reads .user.',
          rootCause: 'The user object is accessed before it is loaded.',
          suggestedFixes: ['Guard the access with optional chaining', 'Provide a default before render'],
          suggestedCode: 'const name = state?.user?.name ?? "";',
          filesToCheck: ['app-9f2.js'],
          searchTerms: ['cannot read properties of undefined reading user'],
          aiPrompt,
        };
        return { type: 'LLM_GENERATE', ok: true, result: { text: JSON.stringify(analysis), toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  }, AI_PROMPT);

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-errors').click();
  await panel.getByRole('button', { name: 'Scan errors', exact: true }).click();
  await expect(panel.getByText('Null Reference')).toBeVisible({ timeout: 8_000 });

  // The artifact renders AUTOMATICALLY once the error-set is present — no click.
  const card = panel.getByTestId('ci-errors-ai-analysis');
  await expect(card).toBeVisible({ timeout: 8_000 });
  await expect(card.getByText('A value is undefined when the code reads .user.')).toBeVisible();
  await expect(card.getByText('Root Cause')).toBeVisible();
  await expect(card.getByText('Guard the access with optional chaining')).toBeVisible();
  await expect(card.getByText('app-9f2.js')).toBeVisible(); // Files to Check
  await expect(card.getByText(/cannot read properties of undefined reading user/)).toBeVisible(); // Search For

  // Copy Prompt → clipboard receives the ready-to-paste AI prompt.
  await panel.getByTestId('ci-errors-ai-copy-prompt').click();
  await expect(panel.getByTestId('ci-errors-ai-copy-prompt')).toHaveText(/Copied/);
  const clip = await panel.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(AI_PROMPT);

  await panel.screenshot({ path: path.join(SHOTS, '88-ci-errors-ai-analysis.png') });

  // Hide dismisses the artifact.
  await panel.getByTestId('ci-errors-ai-hide').click();
  await expect(card).toHaveCount(0);
});
