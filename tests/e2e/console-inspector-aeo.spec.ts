// AEO panel (Answer Engine Optimization) — verifies the full artifact surface:
// score + facts, findings, Copy fix prompt, the downloadable llms.txt artifact,
// the "Ask an AI about this page" simulation, and the verify-loop score delta.
// analyze_aeo / read_dom / LLM_GENERATE are stubbed for determinism.
import { test, expect } from './fixtures';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('AEO panel: score, findings, llms.txt download, Ask-an-AI simulation, verify-loop delta', async ({ context, extensionId }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stub the SW. analyze_aeo returns an improving score on each call (so the
  // verify-loop delta has something to show on re-audit); read_dom returns page
  // text; LLM_GENERATE returns the simulation JSON.
  await panel.evaluate(() => {
    let calls = 0;
    const mkReport = (score: number) => ({
      type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {
        url: 'https://example.com/guide',
        title: 'The Widget Guide',
        metaDescription: 'A guide to widgets.',
        headings: ['What is a widget?', 'Installing widgets', 'Pricing'],
        score,
        issues: [
          { id: 'schema-missing', severity: 'high', rule: 'Structured data', description: 'No schema.org JSON-LD found.', suggestion: 'Add JSON-LD describing the page.' },
          { id: 'no-llms-txt', severity: 'low', rule: 'llms.txt manifest', description: 'No /llms.txt found.', suggestion: 'Add an /llms.txt at the site root.' },
        ],
        facts: { schemaTypes: [], wordCount: 850, questionHeadings: 1, hasFaq: false, hasLlmsTxt: false, aiCrawlersBlocked: 0, attributable: false },
      } } });
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'analyze_aeo') { calls += 1; return mkReport(calls === 1 ? 60 : 75); }
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'detect_tech_stack') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { url: 'https://example.com/guide', count: 0, matches: [] } } };
      }
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'read_dom') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { url: 'https://example.com/guide', title: 'The Widget Guide', text: 'Widgets are small components. They cost $5 and install in two minutes.' } } };
      }
      if (msg?.type === 'LLM_GENERATE') {
        const sim = { answer: 'This page explains what widgets are, their price, and how to install them.', citableFacts: ['Widgets cost $5', 'Installation takes two minutes'], gaps: ['No author or publish date', 'No structured data to confirm the price'] };
        return { type: 'LLM_GENERATE', ok: true, result: { text: JSON.stringify(sim), toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } } };
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  await panel.getByRole('button', { name: 'Apps', exact: true }).click();
  await panel.getByText('Console Inspector').first().click();
  await panel.getByTestId('ci-mode-aeo').click();

  // Score + facts render; findings render.
  const body = panel.getByTestId('ci-aeo');
  await expect(body).toBeVisible({ timeout: 8_000 });
  await expect(body.locator('.ci-seo-score-ring')).toHaveText('60');
  await expect(panel.getByText('Structured data')).toBeVisible();
  await expect(panel.getByText('No schema.org JSON-LD found.')).toBeVisible();

  // Download llms.txt → the artifact has the expected manifest content.
  const [download] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('ci-aeo-llms').click(),
  ]);
  expect(download.suggestedFilename()).toBe('llms.txt');
  const file = await download.path();
  const txt = readFileSync(file!, 'utf8');
  expect(txt).toMatch(/^# The Widget Guide/);
  expect(txt).toContain('> A guide to widgets.');
  expect(txt).toContain('- What is a widget?');
  expect(txt).toContain('example.com/llms.txt');

  // Ask an AI → the simulation artifact renders answer + facts + gaps.
  await panel.getByTestId('ci-aeo-ask').click();
  const sim = panel.getByTestId('ci-aeo-sim');
  await expect(sim).toBeVisible({ timeout: 8_000 });
  await expect(sim.getByText(/This page explains what widgets are/)).toBeVisible();
  await expect(sim.getByText('Widgets cost $5')).toBeVisible();
  await expect(sim.getByText('No author or publish date')).toBeVisible();

  await panel.screenshot({ path: path.join(SHOTS, '89-ci-aeo.png') });

  // Copy fix prompt → clipboard receives AEO-topic markdown.
  await panel.getByTestId('ci-aeo-copy').click();
  await expect(panel.getByTestId('ci-aeo-copy')).toHaveText(/Copied/);
  const md = await panel.evaluate(() => navigator.clipboard.readText());
  expect(md).toContain('# AEO fix request');
  expect(md).toContain('Structured data');

  // Verify loop: Re-audit → score improves 60 → 75 → delta shows ▲ +15.
  await panel.getByRole('button', { name: 'Re-audit', exact: true }).click();
  await expect(body.locator('.ci-seo-score-ring')).toHaveText('75', { timeout: 8_000 });
  await expect(panel.getByTestId('ci-aeo-delta')).toContainText('▲ +15');
});
