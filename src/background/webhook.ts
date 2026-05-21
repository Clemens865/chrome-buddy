// send_webhook execution (runs in the SW). This is a CONSEQUENTIAL tool: the
// runtime's HITL gate (UI side) has already obtained user approval before this
// is ever called — the SW just performs the POST.
import { ok, err, type ToolResult } from '../types';

export async function executeWebhook(args: Record<string, unknown>): Promise<ToolResult> {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!/^https?:\/\//i.test(url)) {
    return err('invalid-args', 'send_webhook requires an http(s) URL.');
  }
  const payload = (args.payload as unknown) ?? {};
  const headers =
    args.headers && typeof args.headers === 'object'
      ? (args.headers as Record<string, string>)
      : {};

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    return ok({ status: resp.status, ok: resp.ok, url }, { provenance: [url] });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}
