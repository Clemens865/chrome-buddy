// Shared helpers for the night-audit test suite. Pure utility — no fixture,
// just functions any spec can import.
//
// The big repeating pattern: most deterministic specs need to seed IDB with
// a specific transcript or settings state before opening the panel. Doing
// this through the UI is slow + brittle; doing it via `page.evaluate` against
// the panel's `indexedDB` is fast and stable.
//
// All helpers operate on the panel page (a chrome-extension:// page) so they
// share the SAME IDB the running app uses.
import type { Page } from '@playwright/test';

export interface ChatSeed {
  id: string;
  title: string;
  items: Array<Record<string, unknown>>;
  createdAt?: number;
  updatedAt?: number;
}

/** Open the chrome-buddy DB on the panel page and return it. The DB is
 *  upgraded by getDB() in src/db.ts; tests assume the panel was navigated
 *  already (so the SW + panel have opened it at least once). */
async function openDb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const req = indexedDB.open('chrome-buddy');
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

/** Put a chat into IDB so the panel can load it from the Chats list.
 *  Returns the seeded id (defaulting to one based on title if none given). */
export async function seedChat(page: Page, seed: ChatSeed): Promise<string> {
  await openDb(page);
  const id = seed.id ?? `seed_${seed.title.replace(/\W+/g, '_').slice(0, 16)}_${Date.now()}`;
  await page.evaluate(async (chat) => {
    const open = indexedDB.open('chrome-buddy');
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('chats', 'readwrite');
      tx.objectStore('chats').put({
        id: chat.id,
        title: chat.title,
        items: chat.items,
        createdAt: chat.createdAt ?? Date.now() - 10_000,
        updatedAt: chat.updatedAt ?? Date.now(),
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }, { ...seed, id });
  return id;
}

/** Click into a seeded chat by its visible title. Assumes the panel is on
 *  the Chat view; opens the slide-over and clicks the row. */
export async function openSeededChat(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.getByText(title, { exact: true }).click();
}

/** Common transcript item factories. Keep the shapes in sync with
 *  src/views/ChatView.tsx TranscriptItem. */
export const items = {
  user(id: string, text: string) {
    return { kind: 'user', id, text };
  },
  agent(id: string, text: string) {
    return { kind: 'agent', id, text };
  },
  plan(id: string, steps: string[]) {
    return {
      kind: 'plan',
      id,
      plan: steps.map((intent, i) => ({ index: i + 1, intent })),
    };
  },
  tool(id: string, name: string, args: Record<string, unknown>, status: 'running' | 'done' | 'denied' = 'running', verdict?: string) {
    return {
      kind: 'tool',
      id,
      step: 0,
      call: { id: `call_${id}`, name, arguments: args },
      status,
      verdict,
    };
  },
  confirm(id: string, name: string, args: Record<string, unknown>, summary = '') {
    return {
      kind: 'confirm',
      id,
      step: 0,
      call: { id: `call_${id}`, name, arguments: args },
      summary: summary || `${name} call`,
    };
  },
  error(id: string, text: string) {
    return { kind: 'error', id, text };
  },
};
