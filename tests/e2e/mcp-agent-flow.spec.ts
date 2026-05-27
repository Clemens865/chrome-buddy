// Phase 2 e2e: prove the agent can actually call an MCP tool through
// TOOL_EXEC, end-to-end through the real SW dispatcher.
//
// Stub fetch in the SW for the MCP server's URL only; everything else
// (Settings UI, IDB store, TOOL_EXEC routing, MCP client, dispatcher,
// session pool) runs the real code path.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');
const STUB_URL = 'https://phase2-stub.test/mcp';

test('agent flow: enable an MCP tool, dispatch a call via TOOL_EXEC, get content back', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 1) SW-side: stub the MCP endpoint, leave every other fetch real.
  const [sw] = context.serviceWorkers();
  await sw.evaluate((stubUrl) => {
    const real = globalThis.fetch.bind(globalThis);
    // @ts-expect-error stash
    globalThis.__mcpStubCalls = [];
    // @ts-expect-error override
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url !== stubUrl) return real(input as RequestInfo, init);
      if (init?.method === 'DELETE') return new Response('', { status: 200 });
      const body = init?.body ? JSON.parse(init.body as string) : {};
      // @ts-expect-error stash
      globalThis.__mcpStubCalls.push({ method: body.method });
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            serverInfo: { name: 'P2Stub', version: '0.2.0' },
          },
        }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess_p2' } });
      }
      if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
      if (body.method === 'tools/list') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'echo', description: 'Echo input text', inputSchema: { type: 'object' } }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (body.method === 'tools/call') {
        const args = body.params?.arguments ?? {};
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: `echo: ${String(args.text ?? '(empty)')}` }],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return real(input as RequestInfo, init);
    };
  }, STUB_URL);

  // 2) Add the server through the UI.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('mcp-editor')).toBeVisible({ timeout: 8_000 });
  await panel.getByTestId('mcp-add-toggle').click();
  await panel.getByTestId('mcp-name').fill('Phase 2 Stub');
  await panel.getByTestId('mcp-url').fill(STUB_URL);
  await panel.getByTestId('mcp-token').fill('p2-test');
  await panel.getByTestId('mcp-save').click();
  await expect(panel.getByTestId('mcp-add-form')).toBeHidden({ timeout: 5_000 });

  // 3) Test → tools/list populates; server NOT yet enabled in agent.
  const row = panel.getByTestId('mcp-row-Phase 2 Stub');
  await row.getByTestId('mcp-row-test-Phase 2 Stub').click();
  await expect(row.getByTestId('mcp-row-result-Phase 2 Stub')).toContainText(
    /P2Stub\s*0\.2\.0\s*·\s*1 tool/,
    { timeout: 8_000 },
  );
  await expect(row).not.toHaveClass(/is-enabled/);

  // Confirm gating: before enabling, dispatching the namespaced TOOL_EXEC
  // must return 'not-found' (the server's tools aren't routed to the agent
  // yet — default OFF). We need the server id first; read it from IDB.
  const serverId = await panel.evaluate(async () => {
    const req = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('mcpServers', 'readonly');
    const all: Array<{ id: string; name: string }> = await new Promise((res, rej) => {
      const r = tx.objectStore('mcpServers').getAll();
      r.onsuccess = () => res(r.result as Array<{ id: string; name: string }>);
      r.onerror = () => rej(r.error);
    });
    return all.find((s) => s.name === 'Phase 2 Stub')!.id;
  });
  expect(serverId).toMatch(/^mcp_[a-z0-9]+$/);

  // ROUTING GATE: with enabledInAgent=false, the tool isn't exposed even though
  // the server is configured. Dispatch should return a 'not-found' result.
  const blocked = (await panel.evaluate(
    async ({ tool }) => chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool, args: { text: 'gate test' } }),
    { tool: `mcp__${serverId}__echo` },
  )) as { ok: boolean; result: { ok: boolean; error?: { kind: string; message: string } } };
  expect(blocked.result.ok).toBe(false);
  expect(blocked.result.error?.message).toMatch(/not enabled/i);

  // 4) Enable in agent → routing gate opens.
  await row.getByTestId('mcp-enable-Phase 2 Stub').click();
  await expect(row).toHaveClass(/is-enabled/);

  // 5) Now dispatch the tool call — full path through TOOL_EXEC → MCP dispatcher
  //    → session pool → real fetch (stubbed) → flatten content → result.
  const dispatched = (await panel.evaluate(
    async ({ tool }) => chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool, args: { text: 'hello phase 2' } }),
    { tool: `mcp__${serverId}__echo` },
  )) as { ok: boolean; result: { ok: boolean; data?: { text?: string; server?: { name: string }; tool?: string }; error?: { message: string } } };
  expect(dispatched.ok).toBe(true);
  expect(dispatched.result.ok).toBe(true);
  expect(dispatched.result.data?.text).toBe('echo: hello phase 2');
  expect(dispatched.result.data?.server?.name).toBe('Phase 2 Stub');
  expect(dispatched.result.data?.tool).toBe('echo');

  // The stubbed SW saw the full Streamable-HTTP conversation. Session reuse:
  // initialize happens once (during Test), then tools/list (Test), then
  // tools/call (agent dispatch) — no second initialize because the session
  // pool keeps the client warm.
  const stubCalls = (await sw.evaluate(
    () => (globalThis as unknown as { __mcpStubCalls: Array<{ method: string }> }).__mcpStubCalls,
  )) as Array<{ method: string }>;
  const methods = stubCalls.map((c) => c.method);
  expect(methods).toContain('initialize');
  expect(methods).toContain('tools/list');
  expect(methods).toContain('tools/call');

  await panel.screenshot({ path: path.join(SHOTS, '140-mcp-agent-flow.png') });
});
