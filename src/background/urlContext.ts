// fetch_url execution (runs in the SW): Gemini's native urlContext tool.
//
// Mirrors `search.ts`: the urlContext tool is a NATIVE generateContent feature
// (tools: [{ url_context: {} }]), not exposed via the OpenAI-compat chat
// adapter. So we call the native endpoint directly with the same key custody.
//
// What this gives the agent: a way to read PUBLIC URLs (html/json/xml/css/js/csv/
// text/image/pdf) without leaving the side panel. Up to 20 URLs per call, 34 MB
// per URL. Does NOT work with paywalled content, YouTube, Google Docs, or
// localhost. (See url-context.md L285-306, L73-89, L200-244.)
import { ok, err, type ToolResult } from '../types';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { safetySettingsForNative } from '../llm/safety';
import { BUDDY_UA } from '../llm/ua';
import { retryFetch } from '../llm/retry';

const URL_MODEL = 'gemini-3.5-flash';
const PROVIDER = 'google-gemini';

interface UrlContextResult {
  /** The model's reply, grounded in the fetched URL(s). */
  text: string;
  /** Which URLs were actually retrieved + their fetch status. */
  retrieved: { url: string; status: string }[];
}

export async function executeFetchUrl(
  args: Record<string, unknown>,
  getKey: (provider: string) => Promise<string | undefined>,
): Promise<ToolResult> {
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  const instruction =
    typeof args.instruction === 'string' && args.instruction.trim()
      ? args.instruction.trim()
      : 'Read the page at this URL and return its key contents.';
  if (!url) return err('invalid-args', 'fetch_url requires a `url`.');
  if (!/^https?:\/\//i.test(url)) return err('invalid-args', 'fetch_url requires an http(s) URL.');

  const key = await getKey(PROVIDER);
  if (!key) return err('runtime-error', `No API key set for provider '${PROVIDER}'.`);

  const provider = DEFAULT_REGISTRY.providers[PROVIDER];
  const base =
    (provider?.baseUrl ?? '').replace(/\/openai\/?$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  const apiUrl = `${base}/models/${URL_MODEL}:generateContent`;

  let resp: Response;
  try {
    resp = await retryFetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-api-client': BUDDY_UA,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${instruction}\n\nURL: ${url}` }] }],
        tools: [{ url_context: {} }],
        safetySettings: safetySettingsForNative(),
      }),
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return err('runtime-error', `URL Context API ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      url_context_metadata?: {
        url_metadata?: { retrieved_url?: string; url_retrieval_status?: string }[];
      };
    }[];
  };
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  const retrieved = (cand?.url_context_metadata?.url_metadata ?? [])
    .map((m) => ({ url: m.retrieved_url ?? '', status: m.url_retrieval_status ?? '' }))
    .filter((r) => r.url);

  if (!text) {
    return err('runtime-error', 'The URL Context tool returned no text — the URL may be unreachable or unsafe.');
  }
  if (retrieved.length === 0) {
    return err(
      'runtime-error',
      'The URL Context tool returned a reply but no URL was actually retrieved (paywall, YouTube, Google Docs and localhost are unsupported).',
    );
  }
  const failed = retrieved.find((r) => r.status && r.status !== 'URL_RETRIEVAL_STATUS_SUCCESS');
  if (failed) {
    return err('runtime-error', `URL retrieval failed for ${failed.url}: ${failed.status}.`);
  }

  const result: UrlContextResult = { text, retrieved };
  return ok(result, { provenance: retrieved.map((r) => r.url) });
}
