// Guards the seed catalog (docs/catalog-seed) that ships to the public repo:
// the index parses, every entry's data file exists, and each seeded app
// survives the SAME re-validation that runs on install (parseAppBundle) — so a
// malformed seed can't reach users as an un-installable entry.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppBundle } from '../apps/appBundle';
import { parseCatalogIndex } from './index';

const seedDir = join(process.cwd(), 'docs/catalog-seed');
const read = (p: string) => readFileSync(join(seedDir, p), 'utf8');

describe('catalog seed', () => {
  it('index.json parses and every entry points at a present data file', () => {
    const idx = parseCatalogIndex(read('index.json'));
    expect(idx.entries.length).toBeGreaterThan(0);
    for (const e of idx.entries) {
      expect(() => read(e.dataPath), `${e.id} → ${e.dataPath}`).not.toThrow();
    }
  });

  it('each seeded app bundle re-validates on install (parseAppBundle keeps it)', () => {
    const idx = parseCatalogIndex(read('index.json'));
    const apps = idx.entries.filter((e) => e.kind === 'app');
    expect(apps.length).toBeGreaterThan(0);
    for (const e of apps) {
      const review = parseAppBundle(read(e.dataPath));
      expect(review.apps, `${e.id} should survive re-validation`).toHaveLength(1);
      expect(review.dropped).toBe(0);
      expect(review.apps[0].tier).toBe(e.tier);
    }
  });
});
