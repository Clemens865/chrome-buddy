// Spend caps + a per-day spend ledger (NFR-COST-1, FR-SET-1). Budget *settings*
// live in chrome.storage.local via usePersistedState (UI). The day ledger is a
// small non-secret running total, also in storage.local. The pure helpers below
// are unit-tested; the chrome.* wrappers are thin.

export const BUDGET_KEYS = {
  perRun: 'budgetPerRun', // $ cap for a single agent run
  perDay: 'budgetPerDay', // $ cap across a calendar day
  steps: 'budgetSteps', // max plan steps per agent run
} as const;

export const BUDGET_DEFAULTS = {
  perRun: 0.5,
  perDay: 5,
  steps: 24,
} as const;

const LEDGER_KEY = 'spendLedger';

export interface SpendLedger {
  date: string; // YYYY-MM-DD (local)
  total: number; // dollars spent that day
}

/** Local calendar day key, e.g. "2026-05-21". */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Pure ledger update: resets when the day rolls over, else accumulates. */
export function applySpend(ledger: SpendLedger | null, amount: number, today: string): SpendLedger {
  if (!ledger || ledger.date !== today) return { date: today, total: Math.max(0, amount) };
  return { date: today, total: ledger.total + Math.max(0, amount) };
}

/** True when today's spend has reached the cap (cap <= 0 means "no cap"). */
export function isOverDailyCap(spentToday: number, cap: number): boolean {
  return cap > 0 && spentToday >= cap;
}

// ---- chrome.storage-backed ledger ---------------------------------------

function area() {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
}

export async function getTodaySpend(): Promise<number> {
  const store = area();
  if (!store) return 0;
  const ledger = ((await store.get(LEDGER_KEY))[LEDGER_KEY] as SpendLedger | undefined) ?? null;
  return ledger && ledger.date === todayKey() ? ledger.total : 0;
}

/** Add to today's spend, returning the new daily total. */
export async function addSpend(amount: number): Promise<number> {
  const store = area();
  if (!store || amount <= 0) return getTodaySpend();
  const cur = ((await store.get(LEDGER_KEY))[LEDGER_KEY] as SpendLedger | undefined) ?? null;
  const next = applySpend(cur, amount, todayKey());
  await store.set({ [LEDGER_KEY]: next });
  return next.total;
}
