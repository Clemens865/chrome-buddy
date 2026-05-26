// Webhooks address book — full round-trip:
//   1. User opens Settings → Webhooks, adds a saved endpoint.
//   2. The agent (or any caller) invokes send_webhook({ name }) via TOOL_EXEC.
//   3. The SW resolves the saved URL + default headers and POSTs.
//   4. We capture the request to confirm the URL resolution worked.
//   5. The HITL gate is OUT-OF-SCOPE here — TOOL_EXEC bypasses it. The
//      runtime's gateConsequentialAction is unit-tested separately.
//
// We stub global fetch in the SW page to capture the outbound POST without
// hitting the real network.
import { test, expect } from './fixtures';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'screenshots');

test('Add a saved webhook in Settings, then send_webhook resolves by name', async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // (1) Open Settings → Webhooks and add an entry.
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByTestId('webhooks-editor')).toBeVisible({ timeout: 8_000 });
  await panel.getByTestId('webhook-name').fill('Slack — design');
  await panel.getByTestId('webhook-url').fill('https://hooks.slack.com/services/T01ABCDEF/B01DEFGHI/abc1234567890');
  await panel.getByTestId('webhook-add').click();

  // The row appears with the URL masked (long path segments redacted).
  const row = panel.locator('.webhooks-row', { hasText: 'Slack — design' });
  await expect(row).toBeVisible({ timeout: 5_000 });
  const urlCell = row.locator('.webhooks-url');
  const masked = (await urlCell.textContent()) ?? '';
  expect(masked).not.toContain('ABCDEF'); // path id is redacted
  expect(masked).toContain('hooks.slack.com'); // host stays visible
  await panel.screenshot({ path: path.join(SHOTS, '95-webhooks-addressbook.png') });

  // (2) Stub the SW's fetch so we can see the resolved URL. We have to
  // reach the SW page directly — chrome.runtime.sendMessage runs there.
  const [sw] = context.serviceWorkers();
  let capturedUrl = '';
  let capturedBody = '';
  let capturedHeaders: Record<string, string> = {};
  await sw.evaluate(() => {
    const original = globalThis.fetch;
    // @ts-expect-error injecting a debugging surface for the test
    globalThis.__capturedFetch = { url: '', body: '', headers: {} as Record<string, string> };
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const cap = (globalThis as unknown as { __capturedFetch: { url: string; body: string; headers: Record<string, string> } }).__capturedFetch;
      cap.url = u;
      cap.body = typeof init?.body === 'string' ? init.body : '';
      const hs = init?.headers;
      if (hs && typeof hs === 'object' && !Array.isArray(hs)) {
        cap.headers = Object.fromEntries(Object.entries(hs as Record<string, string>));
      }
      // Pretend the POST succeeded so executeWebhook resolves cleanly.
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
    };
    // Keep the original for any other fetches the SW might do.
    void original;
  });

  // (3) Call send_webhook({name}) via TOOL_EXEC. The SW dispatcher reaches
  // executeWebhook → getWebhookByName('Slack — design') → POSTs the saved URL.
  const result = await panel.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'send_webhook',
      args: { name: 'Slack — design', payload: { text: 'hello world' } },
    });
  });
  type Resp = { ok: boolean; result: { ok: boolean; data?: { status: number; ok: boolean; url: string; name?: string }; error?: { message: string } } };
  const r = result as Resp;
  expect(r.ok).toBe(true);
  expect(r.result.ok).toBe(true);
  expect(r.result.data?.status).toBe(200);

  // (4) Verify the captured outbound request hit the FULL saved URL.
  const cap = await sw.evaluate(() =>
    (globalThis as unknown as { __capturedFetch: { url: string; body: string; headers: Record<string, string> } }).__capturedFetch,
  );
  capturedUrl = cap.url;
  capturedBody = cap.body;
  capturedHeaders = cap.headers;
  expect(capturedUrl).toBe('https://hooks.slack.com/services/T01ABCDEF/B01DEFGHI/abc1234567890');
  expect(JSON.parse(capturedBody)).toEqual({ text: 'hello world' });
  expect(capturedHeaders['content-type']).toBe('application/json');

  // (5) list_webhooks via TOOL_EXEC exposes the name + host but NOT the URL.
  const listed = await panel.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'list_webhooks',
      args: {},
    });
  });
  type ListResp = { ok: boolean; result: { ok: boolean; data?: { count: number; webhooks: Array<{ name: string; host: string }> } } };
  const lr = listed as ListResp;
  expect(lr.ok).toBe(true);
  expect(lr.result.data?.count).toBe(1);
  expect(lr.result.data?.webhooks[0]).toMatchObject({ name: 'Slack — design', host: 'hooks.slack.com' });
  expect(JSON.stringify(lr.result.data?.webhooks[0])).not.toContain('T01ABCDEF');
});

test('send_webhook by an unknown name returns a not-found error', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 440, height: 980 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const r = await panel.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: 'TOOL_EXEC',
      tool: 'send_webhook',
      args: { name: 'does-not-exist', payload: {} },
    });
  });
  type Resp = { ok: boolean; result: { ok: boolean; error?: { code: string; message: string } } };
  const tr = r as Resp;
  expect(tr.ok).toBe(true);
  expect(tr.result.ok).toBe(false);
  expect(tr.result.error?.code).toBe('not-found');
  expect(tr.result.error?.message).toMatch(/does-not-exist/);
});
