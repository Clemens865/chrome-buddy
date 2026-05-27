// GitHub tool fallback + error-path coverage. Survey flagged:
//   - No e2e for repo resolution fallback (explicit arg vs Settings default)
//   - No e2e for error responses (401 / 404 / 422)
//
// Stubs the real GitHub API via a SW-side fetch shim so we can drive each
// shape without touching the network. The token still flows through
// chrome.storage.session like the real path.
import { test, expect } from './fixtures';

async function installStubFetch(sw: import('@playwright/test').Worker, responses: Record<string, { status: number; body: Record<string, unknown> | string }>) {
  await sw.evaluate((resp) => {
    const real = globalThis.fetch.bind(globalThis);
    // @ts-expect-error stash
    globalThis.__ghCalls = [];
    // @ts-expect-error override
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (!url.startsWith('https://api.github.com')) return real(input as RequestInfo, init);
      // @ts-expect-error stash
      globalThis.__ghCalls.push({ url, method: init?.method ?? 'GET' });
      // Match URL to a response.
      for (const [pattern, spec] of Object.entries(resp)) {
        if (url.includes(pattern)) {
          const body = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
          return new Response(body, {
            status: spec.status,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    };
  }, responses);
}

test('github_write falls back to the Default repo from Settings when repo arg is omitted', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const [sw] = context.serviceWorkers();

  // Seed: token in storage.session, default repo in storage.local.
  await sw.evaluate(async () => {
    await chrome.storage.session.set({ gh_token: 'pat_xyz' });
    await chrome.storage.local.set({ githubDefaultRepo: 'Clemens865/Buddy-Knowledge' });
  });

  // Stub GitHub API: GET 404 (file doesn't exist) → PUT 201 (created).
  await installStubFetch(sw, {
    'contents/HELLO.md': { status: 404, body: { message: 'Not Found' } },
  });
  await sw.evaluate(() => {
    const orig = globalThis.fetch as (input: unknown, init?: unknown) => Promise<Response>;
    // @ts-expect-error refine override for the PUT path: respond 201
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(
          JSON.stringify({
            content: { html_url: 'https://github.com/Clemens865/Buddy-Knowledge/blob/main/HELLO.md', sha: 'abc', path: 'HELLO.md' },
            commit: { html_url: 'https://github.com/Clemens865/Buddy-Knowledge/commit/def', sha: 'def' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return orig(input, init);
    };
  });

  // Now dispatch github_write WITHOUT a repo argument — the SW must
  // substitute the configured default.
  const res = (await panel.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'github_write',
      args: { path: 'HELLO.md', content: 'hi from test' },
    }),
  )) as { ok: boolean; result: { ok: boolean; data?: { repo: string }; error?: { message: string } } };

  expect(res.result.ok).toBe(true);
  expect(res.result.data?.repo).toBe('Clemens865/Buddy-Knowledge');
});

test('github_write returns a helpful error when no repo arg AND no default is set', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const [sw] = context.serviceWorkers();
  await sw.evaluate(async () => {
    await chrome.storage.session.set({ gh_token: 'pat_xyz' });
    await chrome.storage.local.remove('githubDefaultRepo');
  });

  const res = (await panel.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'github_write',
      args: { path: 'HELLO.md', content: 'hi' },
    }),
  )) as { ok: boolean; result: { ok: boolean; error?: { code: string; message: string } } };

  expect(res.result.ok).toBe(false);
  expect(res.result.error?.message).toMatch(/Default repo in Settings/i);
});

test('github_read surfaces a 401 (bad token) as a runtime-error with the GitHub message', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const [sw] = context.serviceWorkers();
  await sw.evaluate(async () => {
    await chrome.storage.session.set({ gh_token: 'bad' });
    await chrome.storage.local.set({ githubDefaultRepo: 'Clemens865/Buddy-Knowledge' });
  });
  await installStubFetch(sw, {
    'contents/HELLO.md': { status: 401, body: { message: 'Bad credentials' } },
  });

  const res = (await panel.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'github_read',
      args: { path: 'HELLO.md' },
    }),
  )) as { ok: boolean; result: { ok: boolean; error?: { message: string } } };

  expect(res.result.ok).toBe(false);
  expect(res.result.error?.message).toMatch(/401/);
  expect(res.result.error?.message).toMatch(/Bad credentials/);
});

test('github_read surfaces a 404 as not-found (clean separation from runtime-error)', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const [sw] = context.serviceWorkers();
  await sw.evaluate(async () => {
    await chrome.storage.session.set({ gh_token: 'pat_xyz' });
    await chrome.storage.local.set({ githubDefaultRepo: 'Clemens865/Buddy-Knowledge' });
  });
  await installStubFetch(sw, {
    'contents/MISSING.md': { status: 404, body: { message: 'Not Found' } },
  });

  const res = (await panel.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'github_read',
      args: { path: 'MISSING.md' },
    }),
  )) as { ok: boolean; result: { ok: boolean; error?: { code: string; message: string } } };

  expect(res.result.ok).toBe(false);
  expect(res.result.error?.code).toBe('not-found');
  expect(res.result.error?.message).toMatch(/Not found/i);
});

test('github tools require a token — clear error when none is set', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const [sw] = context.serviceWorkers();
  await sw.evaluate(async () => {
    await chrome.storage.session.remove('gh_token');
    await chrome.storage.local.set({ githubDefaultRepo: 'Clemens865/Buddy-Knowledge' });
  });

  const res = (await panel.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'github_list',
      args: { path: '' },
    }),
  )) as { ok: boolean; result: { ok: boolean; error?: { message: string } } };

  expect(res.result.ok).toBe(false);
  expect(res.result.error?.message).toMatch(/No GitHub token set/i);
});
