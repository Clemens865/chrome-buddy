// Embedding-scheme auto-heal. Index a doc (lands on the current EMBED_VERSION),
// downgrade its version in IDB to simulate a pre-upgrade doc, then run a search
// — which fires the guarded background re-embed — and confirm the doc heals back
// to the current version. Embeddings are stubbed so no network is needed.
import { test, expect } from './fixtures';

async function openDb(panel: import('@playwright/test').Page) {
  return panel.evaluate(
    () =>
      new Promise<void>((res) => {
        const r = indexedDB.open('chrome-buddy');
        r.onsuccess = () => { r.result.close(); res(); };
        r.onerror = () => res();
      }),
  );
}

const getEmbedVersion = (panel: import('@playwright/test').Page, id: string) =>
  panel.evaluate(async (docId) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const o = indexedDB.open('chrome-buddy');
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error);
    });
    const d = await new Promise<{ embedVersion?: number } | undefined>((res, rej) => {
      const g = db.transaction('libraryDocs', 'readonly').objectStore('libraryDocs').get(docId);
      g.onsuccess = () => res(g.result as { embedVersion?: number });
      g.onerror = () => rej(g.error);
    });
    return d?.embedVersion;
  }, id);

test('search auto-heals docs on an older embedding scheme', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const [sw] = context.serviceWorkers();

  await panel.evaluate((k) => chrome.runtime.sendMessage({ type: 'KEY_SET', provider: 'google-gemini', key: k }), 'test-key');
  await sw.evaluate(() => {
    const real = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(':embedContent')) {
        return new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    };
  });

  // Index a doc → it lands on the current EMBED_VERSION.
  const docId = (await panel.evaluate(async () => {
    const r = (await chrome.runtime.sendMessage({
      type: 'LIBRARY_INDEX', source: 'manual', sourceRef: 'wid1', title: 'Widgets',
      content: 'Old notes about widgets and gadgets for the workshop.',
    })) as { result: { data: { docId: string } } };
    return r.result.data.docId;
  })) as string;
  await openDb(panel);
  expect(await getEmbedVersion(panel, docId)).toBe(2);

  // Downgrade it to v1 in IDB (simulate a pre-upgrade doc).
  await panel.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const o = indexedDB.open('chrome-buddy');
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error);
    });
    await new Promise<void>((res, rej) => {
      const st = db.transaction('libraryDocs', 'readwrite').objectStore('libraryDocs');
      const g = st.get(id);
      g.onsuccess = () => { const d = g.result; d.embedVersion = 1; st.put(d); };
      const tx = st.transaction;
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, docId);
  expect(await getEmbedVersion(panel, docId)).toBe(1);

  // A search fires the guarded background re-embed → the doc heals back to v2.
  await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'TOOL_EXEC', tool: 'search_library', args: { query: 'widgets', k: 3 } }),
  );
  await expect.poll(() => getEmbedVersion(panel, docId), { timeout: 20_000 }).toBe(2);
});
