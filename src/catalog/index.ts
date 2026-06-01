// Buddy Marketplace — catalog parsing, versioning, and fetch (read side).
//
// The catalog is a public GitHub repo. We fetch the raw index.json + entry data
// files over plain HTTPS (no auth, no PAT, no MCP, no LLM round-trip — it's
// public data). Parsing + version compare are pure so they unit-test without
// network; fetch takes an injectable fetcher.

import {
  type CatalogEntry,
  type CatalogIndex,
  type CatalogKind,
  CATALOG_SCHEMA_VERSION,
} from './types';

export type { CatalogEntry, CatalogIndex, CatalogKind };
export { CATALOG_SCHEMA_VERSION };

/** Raw base of the official catalog (main branch). Overridable for tests/forks. */
export const CATALOG_BASE_URL =
  'https://raw.githubusercontent.com/Clemens865/chrome-buddy-catalog/main';

const KINDS: readonly CatalogKind[] = ['app', 'skill', 'workflow'];

/** Re-validate one raw index entry. Returns null (dropped) when fields are
 *  missing/wrong — a garbage catalog can't crash the gallery. */
function parseEntry(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const kind = typeof o.kind === 'string' && KINDS.includes(o.kind as CatalogKind) ? (o.kind as CatalogKind) : null;
  const version = typeof o.version === 'string' && o.version.trim() ? o.version.trim() : '';
  const dataPath = typeof o.dataPath === 'string' && o.dataPath.trim() ? o.dataPath.trim() : '';
  if (!id || !name || !kind || !version || !dataPath) return null;
  const tier = o.tier === 1 || o.tier === 2 || o.tier === 3 ? o.tier : undefined;
  const permissions = Array.isArray(o.permissions) ? o.permissions.filter((p): p is string => typeof p === 'string') : undefined;
  return {
    id,
    name,
    description: typeof o.description === 'string' ? o.description : '',
    kind,
    version,
    ...(tier ? { tier } : {}),
    ...(permissions ? { permissions } : {}),
    ...(typeof o.author === 'string' ? { author: o.author } : {}),
    ...(typeof o.screenshot === 'string' ? { screenshot: o.screenshot } : {}),
    dataPath,
    ...(typeof o.sha === 'string' ? { sha: o.sha } : {}),
  };
}

/** Parse + validate a catalog index. Tolerant: drops bad entries, never throws. */
export function parseCatalogIndex(json: string): CatalogIndex {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { schemaVersion: 0, entries: [] };
  }
  const obj = (data ?? {}) as { schemaVersion?: unknown; entries?: unknown };
  const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
  const entries = rawEntries.map(parseEntry).filter((e): e is CatalogEntry => e !== null);
  return {
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0,
    entries,
  };
}

/** Keyword filter over name + description + kind (all terms must match).
 *  Empty query → all entries. Pure, so search ranking stays LLM-free + testable. */
export function filterCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const terms = q.split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    const hay = `${e.name} ${e.description} ${e.kind}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Compare two dotted version strings numerically: <0, 0, or >0. Missing/odd
 *  segments count as 0, so "1.2" vs "1.2.0" is equal and "1.2.1" is greater. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the catalog has a newer version than what's installed. */
export function isUpdateAvailable(installedVersion: string, catalogVersion: string): boolean {
  return compareVersions(catalogVersion, installedVersion) > 0;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetch + parse the catalog index from the raw repo (public, no auth). */
export async function fetchCatalogIndex(
  base: string = CATALOG_BASE_URL,
  fetchFn: Fetcher = fetch,
): Promise<CatalogIndex> {
  const res = await fetchFn(`${base}/index.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`catalog index fetch failed (${res.status})`);
  return parseCatalogIndex(await res.text());
}

/** Fetch one entry's raw data file (the AppBundle / skill / workflow JSON). */
export async function fetchEntryData(
  entry: CatalogEntry,
  base: string = CATALOG_BASE_URL,
  fetchFn: Fetcher = fetch,
): Promise<string> {
  const url = /^https?:\/\//.test(entry.dataPath) ? entry.dataPath : `${base}/${entry.dataPath.replace(/^\//, '')}`;
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`catalog entry fetch failed (${res.status})`);
  return res.text();
}
