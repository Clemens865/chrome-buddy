// Deterministic e2e for Settings → MCP Servers. The "MCP server" is a stub
// fetch handler installed in the SW that responds to the same URL the user
// pastes in the form, so the whole Add → Save → Test → see tools flow runs
// end-to-end without any network. Live testing against real hosted MCP
// servers is deferred to Phase 2 (when we have the agent dispatcher to
// actually exercise tool calls).
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');
const STUB_URL = 'https://stub-mcp.test/mcp';

test('Settings → MCP Servers: add → test → tools listed', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Install a stub fetch in the SW that responds to STUB_URL with a valid
  // MCP handshake + tools/list. The real Streamable-HTTP transport code path
  // runs unchanged; only the network bytes are stubbed.
  const [sw] = context.serviceWorkers();
  await sw.evaluate((stubUrl) => {
    const real = globalThis.fetch.bind(globalThis);
    // @ts-expect-error stash for the test
    globalThis.__stubCalls = [];
    // @ts-expect-error override
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url !== stubUrl) return real(input as RequestInfo, init);
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      );
      // @ts-expect-error stash
      globalThis.__stubCalls.push({ method: body.method, hadAuth: !!headers['authorization'], hadSession: !!headers['mcp-session-id'] });
      if (init?.method === 'DELETE') return new Response('', { status: 200 });
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'StubMcp', version: '0.1.0' },
            instructions: 'Stub server for e2e — do not connect for real.',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess_stub' },
        });
      }
      if (body.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      if (body.method === 'tools/list') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: 'search', description: 'Search the corpus', inputSchema: { type: 'object' } },
              { name: 'fetch_doc', description: 'Fetch a document by id', inputSchema: { type: 'object' } },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return real(input as RequestInfo, init);
    };
  }, STUB_URL);

  // 1) Open Settings → MCP editor visible, empty state.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('mcp-editor')).toBeVisible({ timeout: 8_000 });
  await expect(panel.getByText('No servers yet')).toBeVisible();

  // 2) Click Add → fill in the form.
  await panel.getByTestId('mcp-add-toggle').click();
  await expect(panel.getByTestId('mcp-add-form')).toBeVisible();
  await panel.getByTestId('mcp-name').fill('Stub MCP');
  await panel.getByTestId('mcp-url').fill(STUB_URL);
  await panel.getByTestId('mcp-token').fill('test-token-xyz');

  // 3) Save → form closes, row appears, no plaintext key anywhere on screen.
  await panel.getByTestId('mcp-save').click();
  await expect(panel.getByTestId('mcp-add-form')).toBeHidden({ timeout: 5_000 });
  const row = panel.getByTestId('mcp-row-Stub MCP');
  await expect(row).toBeVisible();
  // The plaintext token must NOT appear anywhere in the rendered DOM.
  const bodyText = await panel.locator('body').innerText();
  expect(bodyText).not.toContain('test-token-xyz');

  // 4) Click Test → confirm the success line with server info + tool count.
  await panel.getByTestId('mcp-row-test-Stub MCP').click();
  await expect(panel.getByTestId('mcp-row-result-Stub MCP')).toContainText(
    /StubMcp\s*0\.1\.0\s*·\s*2 tools/,
    { timeout: 8_000 },
  );

  // 5) Expand the tool list → both tools rendered inside the row.
  await panel.getByTestId('mcp-tools-toggle-Stub MCP').click();
  const toolList = row.locator('.mcp-tools-list');
  await expect(toolList).toBeVisible();
  await expect(toolList.locator('code', { hasText: /^search$/ })).toBeVisible();
  await expect(toolList.locator('code', { hasText: /^fetch_doc$/ })).toBeVisible();

  // 6) Inspect the captured SW calls: bearer header attached, session id
  // echoed back after initialize. Token NEVER leaked through the message
  // channel (the panel sent only serverId).
  const stubCalls = await sw.evaluate(() => (globalThis as unknown as { __stubCalls: Array<{ method: string; hadAuth: boolean; hadSession: boolean }> }).__stubCalls);
  expect(stubCalls.map((c) => c.method)).toEqual([
    'initialize',
    'notifications/initialized',
    'tools/list',
  ]);
  for (const c of stubCalls) {
    expect(c.hadAuth).toBe(true);
  }
  // initialize is the FIRST call, so no session id yet on that request.
  expect(stubCalls[0].hadSession).toBe(false);
  // initialized + tools/list are AFTER, so they MUST carry the session id.
  expect(stubCalls[1].hadSession).toBe(true);
  expect(stubCalls[2].hadSession).toBe(true);

  await panel.screenshot({ path: path.join(SHOTS, '130-mcp-server-tested.png') });
});
