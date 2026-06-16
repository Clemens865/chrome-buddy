// Slice 3 e2e: drive the full MCP OAuth 2.1 connect flow through the REAL UI +
// SW code path. Everything network-facing is stubbed in the SW (discovery, DCR,
// token, MCP handshake) and chrome.identity.launchWebAuthFlow is stubbed in the
// panel to echo the authorize redirect back. Asserts: the row reports Connected,
// and the access token (session) + sealed refresh token (local) actually land in
// the vault.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');
const MCP_URL = 'https://oauth-stub.test/mcp';
const PRM_URL = 'https://oauth-stub.test/.well-known/oauth-protected-resource';
const AS = 'https://as.oauth-stub.test';
const AS_META = `${AS}/.well-known/oauth-authorization-server`;
const REGISTER_URL = `${AS}/register`;
const TOKEN_URL = `${AS}/token`;

test('mcp oauth: add an oauth server, connect via launchWebAuthFlow, tokens vaulted', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 1) SW-side: stub every OAuth + MCP endpoint. Branch the MCP URL on the
  //    Authorization header — unauthenticated POST = the 401 challenge probe;
  //    authenticated POST = the real initialize during the post-connect Test.
  const [sw] = context.serviceWorkers();
  await sw.evaluate((cfg) => {
    const real = globalThis.fetch.bind(globalThis);
    // @ts-expect-error stash
    globalThis.__oauthCalls = [];
    // @ts-expect-error override
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers ?? {});
      const auth = headers.get('authorization');
      // @ts-expect-error stash
      globalThis.__oauthCalls.push({ url, method, hasAuth: !!auth });
      const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

      if (url === cfg.MCP_URL) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (method === 'DELETE') return new Response('', { status: 200 });
        // Unauthenticated initialize → 401 with the RFC 9728 challenge.
        if (body.method === 'initialize' && !auth) {
          return new Response('Unauthorized', {
            status: 401,
            headers: { 'www-authenticate': `Bearer resource_metadata="${cfg.PRM_URL}"` },
          });
        }
        if (body.method === 'initialize') {
          return json(
            {
              jsonrpc: '2.0',
              id: body.id,
              result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'OAuthStub', version: '1.0.0' } },
            },
            200,
            { 'mcp-session-id': 'sess_oauth' },
          );
        }
        if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
        if (body.method === 'tools/list') {
          return json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'whoami', description: 'Who am I', inputSchema: { type: 'object' } }] } });
        }
        return new Response('bad', { status: 400 });
      }
      if (url === cfg.PRM_URL) return json({ resource: cfg.MCP_URL, authorization_servers: [cfg.AS] });
      if (url === cfg.AS_META) {
        return json({
          issuer: cfg.AS,
          authorization_endpoint: `${cfg.AS}/authorize`,
          token_endpoint: cfg.TOKEN_URL,
          registration_endpoint: cfg.REGISTER_URL,
          scopes_supported: ['read'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url === cfg.REGISTER_URL && method === 'POST') return json({ client_id: 'cli_oauth_1' }, 201);
      if (url === cfg.TOKEN_URL && method === 'POST') {
        return json({ access_token: 'ACCESS_1', refresh_token: 'REFRESH_1', expires_in: 3600, token_type: 'Bearer', scope: 'read' });
      }
      return real(input as RequestInfo, init);
    };
  }, { MCP_URL, PRM_URL, AS, AS_META, REGISTER_URL, TOKEN_URL });

  // 2) Panel-side: stub launchWebAuthFlow to echo the authorize redirect with a
  //    code + the SAME state the SW embedded in the authorize URL.
  await panel.evaluate(() => {
    // @ts-expect-error override the extension API for the test
    chrome.identity.launchWebAuthFlow = async ({ url }: { url: string }) => {
      const u = new URL(url);
      const state = u.searchParams.get('state');
      const redirectUri = u.searchParams.get('redirect_uri');
      return `${redirectUri}?code=TESTCODE&state=${state}`;
    };
  });

  // 3) Add the server through the UI with the OAuth auth kind.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('mcp-editor')).toBeVisible({ timeout: 8_000 });
  await panel.getByTestId('mcp-add-toggle').click();
  await panel.getByTestId('mcp-name').fill('OAuth Stub');
  await panel.getByTestId('mcp-url').fill(MCP_URL);
  await panel.getByTestId('mcp-auth-oauth').click();
  await expect(panel.getByTestId('mcp-oauth-hint')).toBeVisible();
  await panel.getByTestId('mcp-save').click();
  await expect(panel.getByTestId('mcp-add-form')).toBeHidden({ timeout: 5_000 });

  const row = panel.getByTestId('mcp-row-OAuth Stub');
  await expect(row.getByTestId('mcp-row-connect-OAuth Stub')).toHaveText('Connect');

  // 4) Connect → BEGIN (discover+DCR) → launchWebAuthFlow (stub) → COMPLETE
  //    (token exchange + tools/list). Assert the success line + tool count.
  await row.getByTestId('mcp-row-connect-OAuth Stub').click();
  await expect(row.getByTestId('mcp-row-result-OAuth Stub')).toContainText(/Connected · OAuthStub · 1 tool/, { timeout: 12_000 });
  await expect(row.getByTestId('mcp-row-connect-OAuth Stub')).toHaveText('Reconnect');
  await expect(row).toContainText('oauth · connected');

  // 5) Read the server id from IDB, then assert tokens are vaulted:
  //    access blob in storage.session, SEALED refresh in storage.local.
  const serverId = await panel.evaluate(async () => {
    const req = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('mcpServers', 'readonly');
    const all: Array<{ id: string; name: string; authKind: string; oauth?: { clientId: string } }> = await new Promise((res, rej) => {
      const r = tx.objectStore('mcpServers').getAll();
      r.onsuccess = () => res(r.result as never);
      r.onerror = () => rej(r.error);
    });
    const srv = all.find((s) => s.name === 'OAuth Stub')!;
    return { id: srv.id, authKind: srv.authKind, clientId: srv.oauth?.clientId };
  });
  expect(serverId.authKind).toBe('oauth');
  expect(serverId.clientId).toBe('cli_oauth_1');

  const vault = (await sw.evaluate(async (id: string) => {
    const session = await chrome.storage.session.get(`mcp_oauth_at_${id}`);
    const local = await chrome.storage.local.get(`mcp_oauth_rt_${id}`);
    return {
      access: session[`mcp_oauth_at_${id}`] as { accessToken?: string } | undefined,
      sealed: local[`mcp_oauth_rt_${id}`] as { v?: number; iv?: string; ct?: string } | undefined,
    };
  }, serverId.id)) as { access?: { accessToken?: string }; sealed?: { v?: number; iv?: string; ct?: string } };

  // Access token present in session (plaintext, short-lived).
  expect(vault.access?.accessToken).toBe('ACCESS_1');
  // Refresh token present in local but SEALED — never plaintext on disk.
  expect(vault.sealed?.v).toBe(1);
  expect(typeof vault.sealed?.iv).toBe('string');
  expect(typeof vault.sealed?.ct).toBe('string');
  expect(JSON.stringify(vault.sealed)).not.toContain('REFRESH_1');

  await panel.screenshot({ path: path.join(SHOTS, '141-mcp-oauth.png') });
});

test('mcp oauth: a 401 on a tool call triggers a token refresh + retry', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Stateful stub: tools/call rejects ACCESS_1 (401) but accepts ACCESS_2. The
  // token endpoint mints ACCESS_1 for the auth-code grant and ACCESS_2 for the
  // refresh grant — so the dispatcher must refresh + retry to succeed.
  const [sw] = context.serviceWorkers();
  await sw.evaluate((cfg) => {
    const real = globalThis.fetch.bind(globalThis);
    // @ts-expect-error stash
    globalThis.__grants = [];
    // @ts-expect-error override
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      const auth = new Headers(init?.headers ?? {}).get('authorization');
      const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

      if (url === cfg.MCP_URL) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (method === 'DELETE') return new Response('', { status: 200 });
        if (body.method === 'initialize' && !auth) {
          return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${cfg.PRM_URL}"` } });
        }
        if (body.method === 'initialize') {
          return json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'OAuthStub', version: '1.0.0' } } }, 200, { 'mcp-session-id': `sess_${auth}` });
        }
        if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
        if (body.method === 'tools/list') {
          return json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'whoami', description: 'Who am I', inputSchema: { type: 'object' } }] } });
        }
        if (body.method === 'tools/call') {
          if (auth === 'Bearer ACCESS_1') {
            return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${cfg.PRM_URL}"` } });
          }
          return json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'you are user' }] } });
        }
        return new Response('bad', { status: 400 });
      }
      if (url === cfg.PRM_URL) return json({ resource: cfg.MCP_URL, authorization_servers: [cfg.AS] });
      if (url === cfg.AS_META) {
        return json({ issuer: cfg.AS, authorization_endpoint: `${cfg.AS}/authorize`, token_endpoint: cfg.TOKEN_URL, registration_endpoint: cfg.REGISTER_URL, scopes_supported: ['read'] });
      }
      if (url === cfg.REGISTER_URL && method === 'POST') return json({ client_id: 'cli_oauth_2' }, 201);
      if (url === cfg.TOKEN_URL && method === 'POST') {
        const grant = new URLSearchParams((init?.body as string) ?? '').get('grant_type');
        // @ts-expect-error stash
        globalThis.__grants.push(grant);
        if (grant === 'refresh_token') {
          return json({ access_token: 'ACCESS_2', refresh_token: 'REFRESH_2', expires_in: 3600, token_type: 'Bearer' });
        }
        return json({ access_token: 'ACCESS_1', refresh_token: 'REFRESH_1', expires_in: 3600, token_type: 'Bearer' });
      }
      return real(input as RequestInfo, init);
    };
  }, { MCP_URL, PRM_URL, AS, AS_META, REGISTER_URL, TOKEN_URL });

  await panel.evaluate(() => {
    // @ts-expect-error override the extension API for the test
    chrome.identity.launchWebAuthFlow = async ({ url }: { url: string }) => {
      const u = new URL(url);
      return `${u.searchParams.get('redirect_uri')}?code=TESTCODE&state=${u.searchParams.get('state')}`;
    };
  });

  // Add + connect the OAuth server through the UI.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('mcp-editor')).toBeVisible({ timeout: 8_000 });
  await panel.getByTestId('mcp-add-toggle').click();
  await panel.getByTestId('mcp-name').fill('OAuth Retry');
  await panel.getByTestId('mcp-url').fill(MCP_URL);
  await panel.getByTestId('mcp-auth-oauth').click();
  await panel.getByTestId('mcp-save').click();
  await expect(panel.getByTestId('mcp-add-form')).toBeHidden({ timeout: 5_000 });

  const row = panel.getByTestId('mcp-row-OAuth Retry');
  await row.getByTestId('mcp-row-connect-OAuth Retry').click();
  await expect(row.getByTestId('mcp-row-result-OAuth Retry')).toContainText(/Connected · OAuthStub · 1 tool/, { timeout: 12_000 });

  // Enable in agent so the tool is dispatchable.
  await row.getByTestId('mcp-enable-OAuth Retry').click();
  await expect(row).toHaveClass(/is-enabled/);

  const serverId = await panel.evaluate(async () => {
    const req = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('mcpServers', 'readonly');
    const all: Array<{ id: string; name: string }> = await new Promise((res, rej) => {
      const r = tx.objectStore('mcpServers').getAll();
      r.onsuccess = () => res(r.result as never);
      r.onerror = () => rej(r.error);
    });
    return all.find((s) => s.name === 'OAuth Retry')!.id;
  });

  // Dispatch the tool call: first attempt 401s with ACCESS_1 → refresh →
  // ACCESS_2 → success. The agent sees a clean success, never the 401.
  const dispatched = (await panel.evaluate(
    async ({ tool }) => chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool, args: {} }),
    { tool: `mcp__${serverId}__whoami` },
  )) as { ok: boolean; result: { ok: boolean; data?: { text?: string } } };
  expect(dispatched.result.ok).toBe(true);
  expect(dispatched.result.data?.text).toBe('you are user');

  // A refresh_token grant was issued (proof the retry path fired), and the new
  // access token is now vaulted in session.
  const grants = (await sw.evaluate(() => (globalThis as unknown as { __grants: string[] }).__grants)) as string[];
  expect(grants).toContain('authorization_code');
  expect(grants).toContain('refresh_token');

  const access = (await sw.evaluate(async (id: string) => {
    const s = await chrome.storage.session.get(`mcp_oauth_at_${id}`);
    return (s[`mcp_oauth_at_${id}`] as { accessToken?: string } | undefined)?.accessToken;
  }, serverId)) as string | undefined;
  expect(access).toBe('ACCESS_2');

  await panel.screenshot({ path: path.join(SHOTS, '142-mcp-oauth-refresh.png') });
});
