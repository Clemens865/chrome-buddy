// file_search execution (runs in the SW): Gemini's native file_search RAG.
//
// The user pastes one or more `fileSearchStores/<id>` names into Settings →
// File Search Stores (chrome.storage.local: fileSearchStores). At query time
// we call generateContent with tools:[{file_search:{file_search_store_names}}]
// — server-side retrieval + grounding, response shape mirrors googleSearch.
//
// Upload + document-management UI is deferred — see docs/gemini/action-items.md
// H8. For now, store creation + upload happens via the official client SDKs or
// the REST endpoints in file-search.md L378-386 (curl).
import { ok, err, type ToolResult } from '../types';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { safetySettingsForNative } from '../llm/safety';
import { BUDDY_UA } from '../llm/ua';
import { retryFetch } from '../llm/retry';

const FS_MODEL = 'gemini-3.5-flash';
const PROVIDER = 'google-gemini';

interface FileSearchResult {
  text: string;
  /** Documents the retrieval pulled in (provenance for the answer). */
  sources: { title: string; uri: string }[];
  /** Which stores were queried. */
  stores: string[];
}

async function readConfiguredStores(): Promise<string[]> {
  const r = (await chrome.storage.local.get('fileSearchStores')) as { fileSearchStores?: string[] };
  return Array.isArray(r.fileSearchStores) ? r.fileSearchStores.filter((s) => typeof s === 'string' && s.trim()) : [];
}

export async function executeFileSearch(
  args: Record<string, unknown>,
  getKey: (provider: string) => Promise<string | undefined>,
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return err('invalid-args', 'file_search requires a `query`.');

  // Caller may pass an explicit store list; otherwise we use the configured set.
  const argStores = Array.isArray(args.stores)
    ? (args.stores as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : undefined;
  const stores = argStores && argStores.length > 0 ? argStores : await readConfiguredStores();
  if (stores.length === 0) {
    return err(
      'invalid-args',
      'No file_search stores configured. Open Settings → File Search Stores and paste a ' +
        '`fileSearchStores/<id>` name first. (Store creation + document upload are managed ' +
        'via the Gemini API today; an in-app UI is deferred — see docs/gemini/action-items.md H8.)',
    );
  }

  const key = await getKey(PROVIDER);
  if (!key) return err('runtime-error', `No API key set for provider '${PROVIDER}'.`);

  const provider = DEFAULT_REGISTRY.providers[PROVIDER];
  const base =
    (provider?.baseUrl ?? '').replace(/\/openai\/?$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${FS_MODEL}:generateContent`;

  // Normalize store names so callers can pass either bare ids or full paths.
  const fileSearchStoreNames = stores.map((s) =>
    /^fileSearchStores\//i.test(s) ? s : `fileSearchStores/${s}`,
  );

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
        tools: [{ fileSearch: { fileSearchStoreNames } }],
        safetySettings: safetySettingsForNative(),
      }),
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return err('runtime-error', `File Search API ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: {
        groundingChunks?: {
          retrievedContext?: { uri?: string; title?: string };
          web?: { uri?: string; title?: string };
        }[];
      };
    }[];
  };
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => {
      const r = c.retrievedContext ?? c.web ?? {};
      return { title: r.title ?? '', uri: r.uri ?? '' };
    })
    .filter((s) => s.uri || s.title);

  if (!text) return err('runtime-error', 'The file_search tool returned no text.');

  const result: FileSearchResult = { text, sources, stores };
  return ok(result, { provenance: sources.map((s) => s.uri || s.title).filter(Boolean) });
}
