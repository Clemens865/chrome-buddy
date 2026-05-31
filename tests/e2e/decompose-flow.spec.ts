// Phase 2 decomposed run end-to-end through the panel (opt-in toggle ON). A
// content-aware LLM stub: the decomposer splits the task into 2 sub-tasks, each
// runs (planner → executor), then the composer writes one final answer. Asserts
// the sub-task section headers render and a SINGLE composed answer appears.
// Run with: npx playwright test decompose-flow.spec.ts
import { test, expect } from './fixtures';

test('decompose ON: 2 sub-tasks render section headers + one composed answer', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Enable the opt-in decompose setting; disable plan review so sub-task plans
  // auto-run (no per-sub-task approval card in this deterministic test).
  await panel.evaluate(() => chrome.storage.local.set({ decomposeTasks: true, askBeforePlan: false }));
  await panel.reload();

  // Content-aware LLM stub keyed by the system prompt.
  await panel.evaluate(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    const reply = (text: string, toolCalls: unknown[] = []) => ({
      type: 'LLM_GENERATE', ok: true,
      result: { text, toolCalls, finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0.001 } },
    });
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; messages?: { content: string }[]; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'KEY_STATUS') return { type: 'KEY_STATUS', hasKey: true };
      if (msg?.type === 'SKILL_LIST') return { type: 'SKILL_LIST', skills: [] };
      if (msg?.type === 'TOOL_EXEC') return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: {} } };
      if (msg?.type === 'LLM_GENERATE') {
        const sys = msg.messages?.[0]?.content ?? '';
        if (sys.includes('Decomposer')) return reply(JSON.stringify({ subtasks: [{ goal: 'research pricing', role: 'researcher' }, { goal: 'compile a table', role: 'summarizer' }] }));
        if (sys.includes('Composer')) return reply('COMPOSED: pricing researched and tabulated.');
        if (sys.includes('Planner')) return reply(JSON.stringify({ steps: [{ intent: 'do it' }] }));
        return reply('sub-result'); // executor answers directly (no tool)
      }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
  });

  // Force Agent mode so the request routes to the agentic loop (decompose path).
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('research pricing then compile a table');
  await panel.getByLabel('Send').click();

  // Both sub-task section headers render…
  await expect(panel.getByTestId('subtask-head').filter({ hasText: 'research pricing' })).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByTestId('subtask-head').filter({ hasText: 'compile a table' })).toBeVisible({ timeout: 15_000 });
  // …and exactly one composed final answer (sub-task answers were suppressed).
  await expect(panel.getByText('COMPOSED: pricing researched and tabulated.')).toBeVisible({ timeout: 15_000 });
});
