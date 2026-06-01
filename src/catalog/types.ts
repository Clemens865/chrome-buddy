// Buddy Marketplace — the public catalog of installable artifacts (apps, skills,
// workflows). Entries are DATA: an app config / skill prompt / workflow def.
// Hosted as a public GitHub repo; the extension fetches raw files (no auth).

export type CatalogKind = 'app' | 'skill' | 'workflow';

export interface CatalogEntry {
  /** Stable id within the catalog (also the installed-version key). */
  id: string;
  name: string;
  description: string;
  kind: CatalogKind;
  /** semver-ish "1.0.0" — drives the "Update available" check. */
  version: string;
  /** Apps only: which tier (1 declarative · 2 sandboxed code · 3 sandbox-UI). */
  tier?: 1 | 2 | 3;
  /** Declared bridge capabilities, shown BEFORE install (apps). */
  permissions?: string[];
  author?: string;
  /** Absolute https URL to a screenshot/preview, optional. */
  screenshot?: string;
  /** Path (relative to the catalog base) to the entry's data file. */
  dataPath: string;
  /** Optional content hash of the data file for a tamper check on install. */
  sha?: string;
}

export interface CatalogIndex {
  schemaVersion: number;
  entries: CatalogEntry[];
}

/** Schema version this build understands. */
export const CATALOG_SCHEMA_VERSION = 1;
