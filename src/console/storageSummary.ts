// Summarise a page-side storage probe: total bytes, key count, top-N largest
// items, and a heuristic flag for keys that look auth/PII-related. Pure; safe
// to unit-test in any environment. The read_storage tool collects the raw
// snapshot in the page via chrome.scripting.executeScript and we score it here.

export interface StorageEntry {
  area: 'localStorage' | 'sessionStorage' | 'cookies';
  key: string;
  /** Byte length of the value (UTF-16 → UTF-8 isn't worth the precision here;
   * value.length is a good-enough proxy for storage quota concerns). */
  bytes: number;
  /** Heuristic shape preview (never the full value — keeps secrets out). */
  preview: string;
}

export interface StorageSnapshot {
  url: string;
  localStorage: ReadonlyArray<{ key: string; value: string }>;
  sessionStorage: ReadonlyArray<{ key: string; value: string }>;
  /** document.cookie split entries (name + value). */
  cookies: ReadonlyArray<{ name: string; value: string }>;
}

export interface StorageReport {
  url: string;
  total: { keys: number; bytes: number };
  byArea: Record<StorageEntry['area'], { keys: number; bytes: number }>;
  /** Top entries, severity-sorted: flagged keys first, then by bytes desc. */
  top: StorageEntry[];
  /** Keys that look like tokens/credentials by name (case-insensitive). */
  flagged: ReadonlyArray<{ area: StorageEntry['area']; key: string; reason: string }>;
}

const FLAG_RULES: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /^(?:authorization|auth_token|access_token|id_token|bearer)$/i, reason: 'looks like an auth token' },
  { pattern: /token|jwt|session|sid|csrf/i, reason: 'name hints at a session/token' },
  { pattern: /api[_-]?key|secret|password|passwd/i, reason: 'name hints at a credential' },
  { pattern: /email|phone|address|ssn|dob/i, reason: 'name hints at PII' },
];

/** Apply the name heuristics to a single key. */
export function flagKey(key: string): string | null {
  for (const r of FLAG_RULES) if (r.pattern.test(key)) return r.reason;
  return null;
}

/** Build a 1-line preview of a stored value (length + shape hint, never the
 * raw content). Keeps sensitive data out of the agent context window. */
export function previewValue(value: string): string {
  if (!value) return '(empty)';
  if (/^[\d]+$/.test(value)) return `number (${value.length} digits)`;
  if (/^https?:\/\//.test(value)) return `url (${value.length} chars)`;
  if (/^[{[]/.test(value)) return `json-ish (${value.length} chars)`;
  if (/^eyJ/.test(value)) return `jwt-ish (${value.length} chars)`;
  if (value.length > 32) return `string (${value.length} chars)`;
  return `string "${value.slice(0, 16)}${value.length > 16 ? '…' : ''}"`;
}

/** Build the full StorageReport from a snapshot. Pure. */
export function summarizeStorage(snap: StorageSnapshot, topN = 10): StorageReport {
  const all: StorageEntry[] = [];
  const byArea: StorageReport['byArea'] = {
    localStorage: { keys: 0, bytes: 0 },
    sessionStorage: { keys: 0, bytes: 0 },
    cookies: { keys: 0, bytes: 0 },
  };
  const flagged: { area: StorageEntry['area']; key: string; reason: string }[] = [];

  const consume = (area: StorageEntry['area'], key: string, value: string) => {
    const bytes = value?.length ?? 0;
    byArea[area].keys += 1;
    byArea[area].bytes += bytes;
    all.push({ area, key, bytes, preview: previewValue(value) });
    const reason = flagKey(key);
    if (reason) flagged.push({ area, key, reason });
  };

  for (const { key, value } of snap.localStorage) consume('localStorage', key, value);
  for (const { key, value } of snap.sessionStorage) consume('sessionStorage', key, value);
  for (const { name, value } of snap.cookies) consume('cookies', name, value);

  // Top entries: flagged first (any area), then by bytes desc.
  const flaggedKeys = new Set(flagged.map((f) => `${f.area}|${f.key}`));
  const top = [...all]
    .sort((a, b) => {
      const af = flaggedKeys.has(`${a.area}|${a.key}`) ? 0 : 1;
      const bf = flaggedKeys.has(`${b.area}|${b.key}`) ? 0 : 1;
      if (af !== bf) return af - bf;
      return b.bytes - a.bytes;
    })
    .slice(0, topN);

  const totals = Object.values(byArea).reduce(
    (acc, v) => ({ keys: acc.keys + v.keys, bytes: acc.bytes + v.bytes }),
    { keys: 0, bytes: 0 },
  );

  return { url: snap.url, total: totals, byArea, top, flagged };
}
