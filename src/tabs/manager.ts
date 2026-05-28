// Tab Manager helpers (pure, testable). The app does the chrome.tabs I/O; the
// logic that's worth locking down — duplicate detection, host parsing, session
// shaping, and parsing the LLM's topic grouping — lives here, side-effect-free.
//
// v1 deliberately uses only the existing "tabs" permission: no chrome.tabGroups
// (which would enlarge the Web Store review footprint). Topic groups are
// rendered in our own UI rather than the browser tab strip.

/** The minimal tab shape the manager reasons about (subset of chrome.tabs.Tab). */
export interface TabLite {
  id: number;
  title: string;
  url: string;
  windowId: number;
  favIconUrl?: string;
  active?: boolean;
}

/** A saved session: a named snapshot of tab URLs + titles. */
export interface TabSession {
  id: string;
  name: string;
  createdAt: number;
  tabs: { title: string; url: string }[];
}

/** Display host for a URL ("example.com"), or '' for non-http/opaque URLs. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/** Normalize a URL for duplicate comparison (drop hash + trailing slash). */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

/**
 * Duplicate tabs to close: for each set of tabs sharing a normalized URL, keep
 * the first (lowest index in the input order) and return the rest's ids. The
 * active tab is preferred as the keeper so we never close what the user is on.
 */
export function findDuplicateTabIds(tabs: TabLite[]): number[] {
  const seen = new Map<string, TabLite>();
  const close: number[] = [];
  for (const t of tabs) {
    const key = normalizeUrl(t.url);
    const keeper = seen.get(key);
    if (!keeper) {
      seen.set(key, t);
    } else if (t.active && !keeper.active) {
      // Prefer keeping the active tab: close the previous keeper instead.
      close.push(keeper.id);
      seen.set(key, t);
    } else {
      close.push(t.id);
    }
  }
  return close;
}

/** Case-insensitive filter over title + url. Empty query → all tabs. */
export function filterTabs(tabs: TabLite[], query: string): TabLite[] {
  const q = query.trim().toLowerCase();
  if (!q) return tabs;
  return tabs.filter((t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
}

/** Group tabs by their windowId, preserving input order within each window. */
export function groupByWindow(tabs: TabLite[]): { windowId: number; tabs: TabLite[] }[] {
  const order: number[] = [];
  const map = new Map<number, TabLite[]>();
  for (const t of tabs) {
    if (!map.has(t.windowId)) { map.set(t.windowId, []); order.push(t.windowId); }
    map.get(t.windowId)!.push(t);
  }
  return order.map((windowId) => ({ windowId, tabs: map.get(windowId)! }));
}

/** Build a session payload from the current tabs (drops ids; keeps title+url). */
export function toSession(id: string, name: string, createdAt: number, tabs: TabLite[]): TabSession {
  return { id, name, createdAt, tabs: tabs.map((t) => ({ title: t.title, url: t.url })) };
}

export interface TabGroupResult {
  name: string;
  /** Indices into the tabs array the LLM was given. */
  tabIndices: number[];
}

/**
 * Parse the LLM's topic-grouping reply. Tolerant of fences + prose; expects
 * {"groups":[{"name":"…","tabIndices":[0,2]}]}. Out-of-range indices are
 * dropped; empty groups are removed. Returns [] when nothing usable.
 */
export function parseTabGroups(text: string, tabCount: number): TabGroupResult[] {
  if (!text) return [];
  let raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (raw[0] !== '{' && raw[0] !== '[') {
    const start = raw.search(/[[{]/);
    if (start < 0) return [];
    raw = raw.slice(start);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (end < 0) return [];
    try { parsed = JSON.parse(raw.slice(0, end + 1)); } catch { return []; }
  }
  const groups = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).groups)
      ? ((parsed as Record<string, unknown>).groups as unknown[])
      : [];
  const out: TabGroupResult[] = [];
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const obj = g as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : '';
    const idx = Array.isArray(obj.tabIndices)
      ? obj.tabIndices
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n < tabCount)
      : [];
    if (name && idx.length) out.push({ name, tabIndices: Array.from(new Set(idx)) });
  }
  return out;
}
