// send_webhook execution (runs in the SW). This is a CONSEQUENTIAL tool: the
// runtime's HITL gate (UI side) has already obtained user approval before this
// is ever called — the SW just performs the POST.
//
// The tool accepts EITHER `url` (ad-hoc one-off) OR `name` (lookup in the
// saved Webhooks address book). When `name` is given, we resolve URL +
// default headers from IDB and merge per-call headers on top.
import { ok, err, type ToolResult } from '../types';
import { getWebhookByName, touchWebhookLastUsed, listWebhooks } from '../webhooks/store';

export async function executeWebhook(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const directUrl = typeof args.url === 'string' ? args.url : '';
  const perCallHeaders =
    args.headers && typeof args.headers === 'object'
      ? (args.headers as Record<string, string>)
      : {};
  const payload = (args.payload as unknown) ?? {};

  // Resolve target: prefer name → saved entry; fall back to URL.
  let targetUrl = directUrl;
  let savedHeaders: Record<string, string> = {};
  let savedId: string | undefined;
  if (name) {
    const saved = await getWebhookByName(name);
    if (!saved) {
      return err('not-found', `No saved webhook named "${name}". Add it in Settings → Webhooks first.`);
    }
    targetUrl = saved.url;
    savedHeaders = saved.headers ?? {};
    savedId = saved.id;
  }
  if (!/^https?:\/\//i.test(targetUrl)) {
    return err('invalid-args', 'send_webhook requires either a saved `name` or an http(s) `url`.');
  }
  const mergedHeaders = { 'content-type': 'application/json', ...savedHeaders, ...perCallHeaders };
  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: mergedHeaders,
      body: JSON.stringify(payload),
    });
    if (savedId) await touchWebhookLastUsed(savedId);
    return ok(
      { status: resp.status, ok: resp.ok, url: targetUrl, name: name || undefined },
      { provenance: [targetUrl] },
    );
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}

/**
 * list_webhooks tool — returns just the friendly names so the model can pick
 * one for send_webhook. URLs are deliberately NOT exposed to the model; they
 * stay in IDB and only the SW sees them on POST.
 */
export async function executeListWebhooks(): Promise<ToolResult> {
  const all = await listWebhooks();
  return ok({
    count: all.length,
    webhooks: all.map((w) => ({
      name: w.name,
      host: hostOf(w.url),
      note: w.note,
      lastUsedAt: w.lastUsedAt,
    })),
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
