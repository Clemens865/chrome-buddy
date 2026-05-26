// Webhook Flows store — saved one-tap automations ported from WebhookBuddy
// (https://github.com/Clemens865/WebhookBuddy). Each flow describes:
//   - which saved webhook to POST to (by name, looked up in the address book
//     at execution time so URLs/headers stay in one place)
//   - what to snapshot from the current page (title-only, headings + paras,
//     full content) and whether to attach profile info
//   - optional inline prompt to include in the payload (system + user)
//   - per-flow `trustNoConfirm` to skip the confirm modal for trusted hooks
//
// Categories are NOT a separate store — they're just a string column on each
// flow row, derived at list time. Deletes therefore can't orphan a category.
//
// The actual POST goes through the existing src/background/webhook.ts so
// NFR-SEC + last-used tracking + per-call header merging stay unchanged.

import { getDB } from '../db';

const STORE = 'webhookFlows';

/** What to include in the page snapshot field of the outgoing payload. */
export type SnapshotMode =
  | 'none' // do not extract page content at all
  | 'meta' // url + title + description + keywords (cheap)
  | 'text' // meta + headings + paragraphs (default; matches WebhookBuddy)
  | 'full'; // meta + text + raw HTML (large; opt-in)

export interface FlowPromptTemplate {
  /** Optional friendly name (e.g. "Summarize article"). */
  name?: string;
  /** System prompt to forward to the receiver's LLM. */
  systemPrompt?: string;
  /** User prompt template. {selected_text}, {url}, {title} are substituted at
   *  execution time in snapshot.ts — see substituteTemplate(). */
  userPrompt?: string;
}

export interface WebhookFlow {
  /** Stable id, generated on first save. */
  id: string;
  /** Friendly flow name shown in the app (e.g. "Send page to n8n"). */
  name: string;
  /** Free-text category; empty string means "Uncategorized". */
  categoryName: string;
  /** Saved webhook name from the address book — resolved at run time. */
  webhookName: string;
  /** Optional one-line description shown under the name. */
  description?: string;
  /** What to snapshot from the current page. Default: 'text'. */
  snapshotMode: SnapshotMode;
  /** Include the active selection (selectedText) when present. Default: true. */
  includeSelection: boolean;
  /** Attach the user's profile (name/role/about) to the payload. Default: true. */
  includeProfile: boolean;
  /** Optional inline prompt forwarded to the receiver. */
  prompt?: FlowPromptTemplate;
  /** Skip the per-run confirm modal (per-flow opt-out). Default: false. */
  trustNoConfirm: boolean;
  createdAt: number;
  updatedAt: number;
  /** Last execution timestamp, if any. */
  lastRunAt?: number;
  /** Last result for the inline status pill. */
  lastRunStatus?: 'ok' | 'error';
  /** Short message from the last run (HTTP code or error text). */
  lastRunMessage?: string;
}

export type NewFlowInput = Omit<
  WebhookFlow,
  'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunMessage'
> & {
  id?: string;
};

function genId(): string {
  return `flw_${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveFlow(input: NewFlowInput): Promise<WebhookFlow> {
  const db = await getDB();
  const now = Date.now();
  const existing = input.id ? ((await db.get(STORE, input.id)) as WebhookFlow | undefined) : undefined;
  const record: WebhookFlow = {
    id: input.id ?? genId(),
    name: input.name.trim(),
    categoryName: (input.categoryName ?? '').trim(),
    webhookName: input.webhookName.trim(),
    description: input.description?.trim() || undefined,
    snapshotMode: input.snapshotMode,
    includeSelection: input.includeSelection,
    includeProfile: input.includeProfile,
    prompt: normalizePrompt(input.prompt),
    trustNoConfirm: input.trustNoConfirm,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt,
    lastRunStatus: existing?.lastRunStatus,
    lastRunMessage: existing?.lastRunMessage,
  };
  if (!record.name) throw new Error('saveFlow: name is required');
  if (!record.webhookName) throw new Error('saveFlow: webhookName is required');
  await db.put(STORE, record);
  return record;
}

export async function listFlows(): Promise<WebhookFlow[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as WebhookFlow[];
  // Sort by updatedAt desc so the most-recently-edited flow is first.
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFlow(id: string): Promise<WebhookFlow | null> {
  if (!id) return null;
  const db = await getDB();
  const match = (await db.get(STORE, id)) as WebhookFlow | undefined;
  return match ?? null;
}

export async function deleteFlow(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function touchFlowRun(
  id: string,
  status: 'ok' | 'error',
  message: string,
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE, id)) as WebhookFlow | undefined;
  if (!existing) return;
  await db.put(STORE, {
    ...existing,
    lastRunAt: Date.now(),
    lastRunStatus: status,
    lastRunMessage: message.slice(0, 160),
  });
}

// --- Pure helpers (no IDB; unit-tested directly) --------------------------

/** Group flows by categoryName, preserving the listFlows() order within each
 *  group. Empty/missing categoryName maps to the 'Uncategorized' bucket. */
export function groupByCategory(flows: WebhookFlow[]): Array<{
  category: string;
  flows: WebhookFlow[];
}> {
  const buckets = new Map<string, WebhookFlow[]>();
  for (const f of flows) {
    const cat = f.categoryName?.trim() || 'Uncategorized';
    const arr = buckets.get(cat);
    if (arr) arr.push(f);
    else buckets.set(cat, [f]);
  }
  // Uncategorized sinks to the end; otherwise alphabetical.
  return Array.from(buckets.entries())
    .sort(([a], [b]) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    })
    .map(([category, flows]) => ({ category, flows }));
}

/** Strip empty/undefined prompt fields so storage stays clean. */
function normalizePrompt(p: FlowPromptTemplate | undefined): FlowPromptTemplate | undefined {
  if (!p) return undefined;
  const name = p.name?.trim();
  const systemPrompt = p.systemPrompt?.trim();
  const userPrompt = p.userPrompt?.trim();
  if (!name && !systemPrompt && !userPrompt) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(userPrompt ? { userPrompt } : {}),
  };
}
