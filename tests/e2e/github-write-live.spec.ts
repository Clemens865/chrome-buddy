// End-to-end against the real GitHub API. Writes a timestamped file via the
// agent's github_write tool (with the HITL gate), then reads it back via
// github_read to verify the file actually landed.
//
// REQUIRED env vars (paste in your local .env — NEVER in source):
//   GITHUB_TEST_PAT  — fine-grained PAT, Contents=Read+Write on the test repo.
//                       NO `VITE_` prefix on purpose: this MUST NOT be inlined
//                       into the extension bundle. The test reads it at
//                       runtime via process.env and injects into
//                       chrome.storage.session for one test run only.
//   GITHUB_TEST_REPO — e.g. "Clemens865/Buddy-Knowledge". The repo the PAT
//                       is scoped to.
//   VITE_GEMINI_API_KEY — already required by other live tests for the LLM.
//
// Run with:
//   npx playwright test github-write-live.spec.ts --reporter=line
//
// Cleanup: each run writes a timestamped path (tests/buddy-live-<ts>.md) so
// reruns don't conflict. Delete the test files from the repo periodically.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

const PAT = process.env.GITHUB_TEST_PAT;
const REPO = process.env.GITHUB_TEST_REPO;

test('live: agent commits a file to GitHub through the HITL gate, then reads it back', async ({
  context,
  extensionId,
}) => {
  test.skip(!PAT || !REPO, 'Set GITHUB_TEST_PAT + GITHUB_TEST_REPO in .env to run.');

  // Timestamped path so consecutive runs don't collide on the same file.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = `tests/buddy-live-${ts}.md`;
  const fileContent = `# Hello from Chrome Buddy\n\nWritten by the e2e test at ${ts}.\n`;

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 1) Inject the PAT into chrome.storage.session — same key the Settings UI
  //    writes ('gh_token'). The token NEVER hits IDB, never enters the bundle.
  const [sw] = context.serviceWorkers();
  await sw.evaluate(async (tok) => {
    await chrome.storage.session.set({ gh_token: tok });
  }, PAT as string);

  // 2) Switch to Agent mode and send the prompt.
  await panel.getByRole('button', { name: 'Agent', exact: true }).click();
  await panel
    .getByPlaceholder('Message Buddy…')
    .fill(
      `Use the github_write tool to create a file at path ${filePath} in repo ${REPO} ` +
        `with this exact content: ${fileContent.replace(/\n/g, '\\n')}`,
    );
  await panel.getByRole('button', { name: 'Send' }).click();

  // 3) Wait for the HITL confirm card and screenshot it (regression for the
  //    confirm-card-invisible bug we just fixed).
  const approve = panel.getByRole('button', { name: 'Approve action' });
  await expect(approve).toBeVisible({ timeout: 120_000 });
  await expect(approve).toBeInViewport();
  await expect(panel.getByText(/github_write/).first()).toBeVisible();
  await panel.screenshot({ path: path.join(SHOTS, '180-github-live-confirm.png') });

  // 4) Approve → real PUT to GitHub.
  await approve.click();

  // 5) Tool trace flips to 'succeeded'. The github_write call returns the
  //    commit sha + url; the planner usually loops once more to summarize.
  await expect(panel.getByText('succeeded', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await panel.screenshot({ path: path.join(SHOTS, '181-github-live-success.png') });

  // 6) Verify out-of-band via a direct TOOL_EXEC github_read — the file we
  //    just wrote must come back with the exact content we sent. This proves
  //    the round-trip end-to-end, independent of the model's summary text.
  const readBack = (await panel.evaluate(
    async ({ repo, p }) => {
      return await chrome.runtime.sendMessage({
        type: 'TOOL_EXEC',
        tool: 'github_read',
        args: { repo, path: p },
      });
    },
    { repo: REPO as string, p: filePath },
  )) as { ok: boolean; result: { ok: boolean; data?: { content?: string; path?: string; sha?: string }; error?: { message: string } } };

  expect(readBack.ok).toBe(true);
  expect(readBack.result.ok).toBe(true);
  expect(readBack.result.data?.path).toBe(filePath);
  // The content we get back should match what we sent (Buddy base64-encodes
  // for PUT; github_read decodes on the way back).
  expect(readBack.result.data?.content).toContain('Hello from Chrome Buddy');
  expect(readBack.result.data?.content).toContain(ts);

  await panel.screenshot({ path: path.join(SHOTS, '182-github-live-readback.png') });
});
