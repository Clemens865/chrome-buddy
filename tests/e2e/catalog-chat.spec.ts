// Conversational marketplace: ask in chat → the agent calls search_catalog →
// install cards render in the transcript → one-tap install. Agent loop + the
// catalog fetch are stubbed so it's deterministic.
// Run: npm run test:e2e:catalogchat
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

const emailBundle = JSON.stringify({
  schemaVersion: 2,
  apps: [{ id: 'email-polisher', name: 'Email Polisher', description: 'Rewrite a rough email draft.', tier: 1, inputs: [{ id: 'draft', label: 'Draft', type: 'textarea' }], promptTemplate: 'Rewrite {{draft}}.', createdAt: 0 }],
});

const entries = [
  { id: 'email-polisher', name: 'Email Polisher', description: 'Rewrite a rough email draft in the tone you choose.', kind: 'app', tier: 1, version: '1.0.0', permissions: [], dataPath: 'apps/email-polisher.json' },
];

test('chat: search_catalog renders install cards → install from chat', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(() => chrome.storage.local.set({ askBeforePlan: false }));
  await panel.reload();

  // Stub the agent loop (LLM_GENERATE queue + TOOL_EXEC search_catalog).
  await panel.evaluate((data) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    const llm = (text: string, toolCalls: unknown[] = []) => ({
      type: 'LLM_GENERATE', ok: true,
      result: { text, toolCalls, finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'mock', cost: { totalCost: 0 } },
    });
    const queue = [
      llm(JSON.stringify({ steps: [{ intent: 'find an email app in the marketplace' }] })), // plan
      llm('', [{ id: 'c1', name: 'search_catalog', arguments: { query: 'email' } }]),         // executor
      llm(JSON.stringify({ steps: [] })),                                                     // replan → done
      llm('Here are apps you can install:'),                                                  // synthesis
    ];
    let i = 0;
    // @ts-expect-error stub
    chrome.runtime.sendMessage = async (msg: { type?: string; tool?: string }, ...rest: unknown[]) => {
      if (msg?.type === 'KEY_STATUS') return { type: 'KEY_STATUS', hasKey: true };
      if (msg?.type === 'SKILL_LIST') return { type: 'SKILL_LIST', skills: [] };
      if (msg?.type === 'TOOL_EXEC' && msg.tool === 'search_catalog') {
        return { type: 'TOOL_EXEC', ok: true, result: { ok: true, data: { query: 'email', entries: data.entries } } };
      }
      if (msg?.type === 'LLM_GENERATE') { const r = queue[Math.min(i, queue.length - 1)]; i += 1; return r; }
      return real(msg as Parameters<typeof real>[0], ...(rest as []));
    };
    // Stub the public catalog entry fetch used by install.
    const realFetch = window.fetch.bind(window);
    // @ts-expect-error override
    window.fetch = async (url: string, init?: RequestInit) =>
      String(url).endsWith('/apps/email-polisher.json') ? new Response(data.emailBundle, { status: 200 }) : realFetch(url, init);
  }, { entries, emailBundle });

  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel.getByPlaceholder('Message Buddy…').fill('find me an app to polish emails');
  await panel.getByLabel('Send').click();

  // The search_catalog result renders an install card in the transcript.
  await expect(panel.getByTestId('chat-catalog-email-polisher')).toBeVisible({ timeout: 15_000 });
  await panel.screenshot({ path: path.join(SHOTS, 'catalog-chat-1-cards.png') });

  // Install from the chat card → flips to Installed.
  await panel.getByTestId('chat-catalog-install-email-polisher').click();
  await expect(panel.getByTestId('chat-catalog-install-email-polisher')).toHaveText('Installed', { timeout: 10_000 });
  await panel.screenshot({ path: path.join(SHOTS, 'catalog-chat-2-installed.png') });
});
