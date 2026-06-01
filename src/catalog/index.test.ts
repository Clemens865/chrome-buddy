import { describe, it, expect, vi } from 'vitest';
import {
  parseCatalogIndex,
  compareVersions,
  isUpdateAvailable,
  fetchCatalogIndex,
  fetchEntryData,
  type CatalogEntry,
} from './index';

const validIndex = JSON.stringify({
  schemaVersion: 1,
  entries: [
    { id: 'email-polisher', name: 'Email Polisher', description: 'Rewrite an email', kind: 'app', tier: 1, version: '1.0.0', dataPath: 'apps/email-polisher.json' },
    { id: 'summarize', name: 'Summarize', description: '', kind: 'skill', version: '0.2.1', dataPath: 'skills/summarize.md', permissions: ['page'] },
  ],
});

describe('parseCatalogIndex', () => {
  it('parses valid entries with their fields', () => {
    const idx = parseCatalogIndex(validIndex);
    expect(idx.schemaVersion).toBe(1);
    expect(idx.entries).toHaveLength(2);
    expect(idx.entries[0]).toMatchObject({ id: 'email-polisher', kind: 'app', tier: 1, version: '1.0.0' });
    expect(idx.entries[1]).toMatchObject({ kind: 'skill', permissions: ['page'] });
  });

  it('drops entries missing required fields (id/name/kind/version/dataPath)', () => {
    const idx = parseCatalogIndex(
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          { name: 'no id', kind: 'app', version: '1', dataPath: 'a.json' },
          { id: 'x', name: 'bad kind', kind: 'plugin', version: '1', dataPath: 'a.json' },
          { id: 'y', name: 'no path', kind: 'app', version: '1' },
          { id: 'ok', name: 'Good', kind: 'app', version: '1.0.0', dataPath: 'ok.json' },
        ],
      }),
    );
    expect(idx.entries.map((e) => e.id)).toEqual(['ok']);
  });

  it('returns an empty catalog for junk / non-JSON (never throws)', () => {
    expect(parseCatalogIndex('not json').entries).toEqual([]);
    expect(parseCatalogIndex('{"nope":1}').entries).toEqual([]);
  });
});

describe('compareVersions / isUpdateAvailable', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2.0')).toBe(1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1); // numeric, not lexical
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });
  it('flags an update only when the catalog is newer', () => {
    expect(isUpdateAvailable('1.0.0', '1.1.0')).toBe(true);
    expect(isUpdateAvailable('1.1.0', '1.1.0')).toBe(false);
    expect(isUpdateAvailable('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('fetch', () => {
  const ok = (body: string) => Promise.resolve({ ok: true, status: 200, text: async () => body } as Response);

  it('fetchCatalogIndex hits {base}/index.json and parses', async () => {
    const fetchFn = vi.fn(() => ok(validIndex));
    const idx = await fetchCatalogIndex('https://base', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('https://base/index.json', { cache: 'no-store' });
    expect(idx.entries).toHaveLength(2);
  });

  it('fetchEntryData resolves a relative dataPath against the base', async () => {
    const fetchFn = vi.fn(() => ok('{"schemaVersion":2,"apps":[]}'));
    const entry = { dataPath: 'apps/x.json' } as CatalogEntry;
    await fetchEntryData(entry, 'https://base', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('https://base/apps/x.json', { cache: 'no-store' });
  });

  it('fetchEntryData passes an absolute dataPath through unchanged', async () => {
    const fetchFn = vi.fn(() => ok('{}'));
    await fetchEntryData({ dataPath: 'https://cdn/x.json' } as CatalogEntry, 'https://base', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('https://cdn/x.json', { cache: 'no-store' });
  });

  it('throws on a non-OK response', async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: false, status: 404, text: async () => '' } as Response));
    await expect(fetchCatalogIndex('https://base', fetchFn)).rejects.toThrow(/404/);
  });
});
