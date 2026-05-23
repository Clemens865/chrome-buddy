// search_web execution (runs in the SW): Gemini's native google-search grounding.
// Grounding is a NATIVE generateContent feature (tools: [{ google_search: {} }]),
// not exposed via the OpenAI-compatible chat adapter — so this calls the native
// endpoint directly, like image generation.
import { ok, err, type ToolResult } from '../types';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { safetySettingsForNative } from '../llm/safety';
import { BUDDY_UA } from '../llm/ua';
import { retryFetch } from '../llm/retry';

const SEARCH_MODEL = 'gemini-2.5-flash';
const PROVIDER = 'google-gemini';

interface GroundedResult {
  text: string;
  sources: { title: string; url: string }[];
}

export async function executeWebSearch(
  args: Record<string, unknown>,
  getKey: (provider: string) => Promise<string | undefined>,
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return err('invalid-args', 'search_web requires a query.');

  const key = await getKey(PROVIDER);
  if (!key) return err('runtime-error', `No API key set for provider '${PROVIDER}'.`);

  const provider = DEFAULT_REGISTRY.providers[PROVIDER];
  const base =
    (provider?.baseUrl ?? '').replace(/\/openai\/?$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${SEARCH_MODEL}:generateContent`;

  let resp: Response;
  try {
    resp = await retryFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-api-client': BUDDY_UA,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
        safetySettings: safetySettingsForNative(),
      }),
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return err('runtime-error', `Search API ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
    }[];
  };
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '' }))
    .filter((s) => s.url);

  const result: GroundedResult = { text, sources };
  return ok(result, { provenance: sources.map((s) => s.url) });
}
